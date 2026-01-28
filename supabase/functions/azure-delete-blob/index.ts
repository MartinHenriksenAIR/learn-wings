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

// Generate Azure SAS token for blob deletion
async function generateDeleteSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  blobName: string,
  expiryMinutes: number = 10
): Promise<string> {
  const permissions = 'd'; // delete permission
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
    '', '', 'https', signedVersion, signedResource,
    '', '', '', '', '', '',
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
    console.log('azure-delete-blob: Request received');
    
    // Verify user is authenticated and is platform admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('azure-delete-blob: Missing or invalid auth header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Extract and verify the JWT token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      console.log('azure-delete-blob: JWT validation failed:', userError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = user.id;
    console.log('azure-delete-blob: User ID:', userId);

    // Check if user is platform admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.is_platform_admin) {
      console.log('azure-delete-blob: Not a platform admin');
      return new Response(JSON.stringify({ error: 'Only platform admins can delete videos' }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Parse request body
    const { blobPath } = await req.json();
    
    if (!blobPath) {
      return new Response(JSON.stringify({ error: 'blobPath is required' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log('azure-delete-blob: Deleting blob:', blobPath);

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

    // Generate SAS token for deletion
    const sasToken = await generateDeleteSasToken(accountName, accountKey, containerName, blobPath, 10);

    // Build delete URL and execute delete
    const deleteUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${blobPath}?${sasToken}`;
    
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
    });

    if (deleteResponse.ok || deleteResponse.status === 404) {
      // 404 is acceptable - blob might already be deleted
      console.log(`azure-delete-blob: Successfully deleted blob: ${blobPath} (status: ${deleteResponse.status})`);
      return new Response(JSON.stringify({
        success: true,
        message: deleteResponse.status === 404 ? 'Blob not found (already deleted)' : 'Blob deleted successfully',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      const errorText = await deleteResponse.text();
      console.error(`azure-delete-blob: Failed to delete blob: ${deleteResponse.status} - ${errorText}`);
      return new Response(JSON.stringify({ 
        error: 'Failed to delete blob from Azure',
        details: errorText,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Error deleting blob:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete blob' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
