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

// Generate Azure SAS token for blob upload
async function generateSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  blobName: string,
  expiryMinutes: number = 30
): Promise<string> {
  const permissions = 'cw'; // create, write
  const start = new Date();
  start.setMinutes(start.getMinutes() - 5);
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + expiryMinutes);
  
  const startTime = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiryTime = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  const signedResource = 'b';
  const signedVersion = '2022-11-02';
  const canonicalResource = `/blob/${accountName}/${containerName}/${blobName}`;
  
  const stringToSign = [
    permissions,
    startTime,
    expiryTime,
    canonicalResource,
    '',
    '',
    'https',
    signedVersion,
    signedResource,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ].join('\n');
  
  const keyBytes = Uint8Array.from(atob(accountKey), c => c.charCodeAt(0));
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(stringToSign);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageBytes);
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
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
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('azure-document-upload-url: Request received');
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('azure-document-upload-url: Missing or invalid auth header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      console.log('azure-document-upload-url: JWT validation failed:', userError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = user.id;
    console.log('azure-document-upload-url: User ID:', userId);

    // Check if user is platform admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.is_platform_admin) {
      console.log('azure-document-upload-url: Not a platform admin');
      return new Response(JSON.stringify({ error: 'Only platform admins can upload documents' }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { fileName, contentType } = await req.json();
    
    if (!fileName) {
      return new Response(JSON.stringify({ error: 'fileName is required' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const accountName = Deno.env.get('AZURE_STORAGE_ACCOUNT_NAME');
    const accountKey = Deno.env.get('AZURE_STORAGE_ACCOUNT_KEY');
    // Use a documents subfolder in the same container, or a separate container if configured
    const containerName = Deno.env.get('AZURE_STORAGE_CONTAINER_NAME') || 'lms-videos';

    if (!accountName || !accountKey) {
      console.error('Azure credentials not configured');
      return new Response(JSON.stringify({ error: 'Azure storage not configured' }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Generate unique blob name with documents prefix
    const ext = fileName.split('.').pop() || 'pdf';
    const uniqueName = `documents/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const sasToken = await generateSasToken(accountName, accountKey, containerName, uniqueName, 30);
    const uploadUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${uniqueName}?${sasToken}`;

    console.log(`Generated document upload URL for blob: ${uniqueName}`);

    return new Response(JSON.stringify({
      uploadUrl,
      blobPath: uniqueName,
      contentType: contentType || 'application/pdf',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error generating document upload URL:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate upload URL' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
