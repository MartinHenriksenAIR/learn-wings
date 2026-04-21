import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestSmtpPayload {
  host: string;
  port: number;
  username?: string;
  password?: string;
  encryption: 'none' | 'ssl_tls' | 'starttls';
  fromEmail?: string | null;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as TestSmtpPayload;

    if (!payload.host || !payload.port || !payload.encryption) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: host, port, encryption' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const timeoutMs = 8000;
    let conn: Deno.Conn | Deno.TlsConn | null = null;

    try {
      if (payload.encryption === 'ssl_tls') {
        conn = await Promise.race([
          Deno.connectTls({ hostname: payload.host, port: Number(payload.port) }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), timeoutMs)),
        ]);
      } else {
        conn = await Promise.race([
          Deno.connect({ hostname: payload.host, port: Number(payload.port) }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), timeoutMs)),
        ]);
      }

      conn.close();

      return new Response(
        JSON.stringify({
          success: true,
          message: `Connected to ${payload.host}:${payload.port}${payload.username ? ' and credentials were provided.' : '.'}`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } catch (connectionError: any) {
      if (conn) conn.close();
      return new Response(
        JSON.stringify({ success: false, error: connectionError.message || 'Unable to establish SMTP connection' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
};

serve(handler);
