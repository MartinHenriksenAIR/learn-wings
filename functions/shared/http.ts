import type { HttpResponseInit } from '@azure/functions';
import { getCorsHeaders } from './cors';

/**
 * 200 + CORS + a binary `application/pdf` attachment download. Shared source of
 * truth for the two hand-rolled PDF endpoints (generate-certificate,
 * generate-compliance-report) — they stay hand-rolled per ADR-0015 (binary body
 * + token-only auth), but the response literal lives here so the body encoding
 * stops being an implicit, per-endpoint decision.
 *
 * ENCODING: the body is a raw `Buffer`, never `.toString('binary')` (latin1).
 * The latin1 form corrupts any byte the worker cannot round-trip: the string is
 * re-encoded as UTF-8 on the way out, so every byte >= 0x80 becomes two bytes
 * and the file no longer opens. That is fatal for compressed PDFs (pdfkit emits
 * zlib streams) and a latent bug for the raw-bytes certificate the moment a
 * learner/course name contains a non-ASCII character (æøå, which this product
 * ships in Danish, are multi-byte in UTF-8). The Buffer form is the one proven
 * in production — the compliance report has shipped it since #230/PR #233 and
 * the prod smoke on `a3e635a` downloaded a real ~10 KB `%PDF-`. No unit test
 * can catch the difference (the mock never re-encodes), so it is written down
 * here instead.
 */
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
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf),
  };
}
