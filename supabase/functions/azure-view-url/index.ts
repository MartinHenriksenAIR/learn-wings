import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// Allowed origins for CORS
const allowedOrigins = [
  'https://learn-wings.lovable.app',
  'https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app',
  'https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com',
  'https://ai-uddannelse.dk',
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Credentials': 'true',
  };
}

// Generate Azure SAS token for blob read access
function generateReadSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  blobName: string,
  expiryMinutes: number = 120
): Promise<string> {
  // SAS token parameters
  const permissions = 'r'; // read only
  const start = new Date();
  start.setMinutes(start.getMinutes() - 5); // 5 minutes before now for clock skew
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + expiryMinutes);
  
  const startTime = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiryTime = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  // String to sign for blob-level SAS
  const signedResource = 'b'; // blob
  const signedVersion = '2022-11-02';
  
  // Canonical resource
  const canonicalResource = `/blob/${accountName}/${containerName}/${blobName}`;
  
  // String to sign - order matters!
  const stringToSign = [
    permissions,        // signedPermissions
    startTime,          // signedStart
    expiryTime,         // signedExpiry
    canonicalResource,  // canonicalizedResource
    '',                 // signedIdentifier
    '',                 // signedIP
    'https',            // signedProtocol
    signedVersion,      // signedVersion
    signedResource,     // signedResource
    '',                 // signedSnapshotTime
    '',                 // signedEncryptionScope
    '',                 // rscc (cache-control)
    '',                 // rscd (content-disposition)
    '',                 // rsce (content-encoding)
    '',                 // rscl (content-language)
    '',                 // rsct (content-type)
  ].join('\n');
  
  // Create HMAC-SHA256 signature
  const keyBytes = Uint8Array.from(atob(accountKey), c => c.charCodeAt(0));
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(stringToSign);
  
  // Use Web Crypto API for HMAC
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ).then(async (key) => {
    const signature = await crypto.subtle.sign('HMAC', key, messageBytes);
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    // Build SAS query string
    const sasParams = new URLSearchParams({
      'sp': permissions,
      'st': startTime,
      'se': expiryTime,
      'sr': signedResource,
      'sv': signedVersion,
      'spr': 'https',
      'sig': signatureBase64,
    });
    
    return sasParams.toString();
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  console.log('azure-view-url: Request received');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated
    const authHeader = req.headers.get('Authorization');
    console.log('azure-view-url: Auth header present:', !!authHeader);
    
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('azure-view-url: Missing or invalid auth header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Use service role key to bypass RLS for user verification
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Validate JWT token by passing it to getUser
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.log('azure-view-url: Auth failed:', userError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = user.id;
    console.log('azure-view-url: User authenticated:', userId);

    // Parse request body
    const { blobPath, lessonId } = await req.json();
    
    if (!blobPath) {
      return new Response(JSON.stringify({ error: 'blobPath is required' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Optional: Verify user has access to this lesson via enrollment
    // For now, we check if user is platform admin or has valid org membership
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .single();

    const isPlatformAdmin = profile?.is_platform_admin || false;

    if (!isPlatformAdmin) {
      // Use the can_user_access_lms_asset function that accepts user_id parameter
      // This is needed because service role client doesn't have auth.uid()
      const { data: hasAccess, error: accessError } = await supabase.rpc(
        'can_user_access_lms_asset',
        { p_user_id: userId, file_path: blobPath }
      );

      if (accessError) {
        console.error('Error checking asset access:', accessError);
        return new Response(JSON.stringify({ error: 'Access check failed' }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      if (!hasAccess) {
        console.log(`Access denied for user ${userId} to blob: ${blobPath}`);
        return new Response(JSON.stringify({ error: 'Access denied' }), { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    // Get Azure credentials from environment
    const accountName = Deno.env.get('AZURE_STORAGE_ACCOUNT_NAME');
    const accountKey = Deno.env.get('AZURE_STORAGE_ACCOUNT_KEY');
    const containerName = Deno.env.get('AZURE_STORAGE_CONTAINER_NAME') || 'lms-videos';

    if (!accountName || !accountKey) {
      console.error('Azure credentials not configured');
      return new Response(JSON.stringify({ error: 'Azure storage not configured' }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Generate read-only SAS token (2 hour expiry)
    const sasToken = await generateReadSasToken(accountName, accountKey, containerName, blobPath, 120);

    // Build view URL
    const viewUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${blobPath}?${sasToken}`;

    console.log(`Generated view URL for blob: ${blobPath}`);

    return new Response(JSON.stringify({
      viewUrl,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error generating view URL:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate view URL' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
