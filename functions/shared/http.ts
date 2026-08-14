import type { HttpResponseInit } from '@azure/functions';
import { getCorsHeaders } from './cors';

function safeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function pdfResponse(
  origin: string | null,
  filename: string,
  pdf: Buffer | Uint8Array
): HttpResponseInit {
  return {
    status: 200,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
    },
    body: Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf),
  };
}
