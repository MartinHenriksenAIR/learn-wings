import type { HttpResponseInit } from '@azure/functions';
import { getCorsHeaders } from './cors';

/**
 * `filename` is interpolated into a quoted `Content-Disposition` value, where a
 * stray `"`, a CR/LF or a non-ASCII byte breaks the header outright or trips
 * Node's header validation into a 500. Both current callers pre-sanitize, so
 * this is defence in depth for the next one (a raw course title is the obvious
 * trap): anything outside `[A-Za-z0-9._-]` collapses to `-`, which is a no-op
 * on the names the two live callers produce today.
 */
function safeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * 200 + CORS + a binary `application/pdf` attachment download. Shared source of
 * truth for the two hand-rolled PDF endpoints (generate-certificate,
 * generate-compliance-report) — they stay hand-rolled per ADR-0015 (binary body
 * + token-only auth), but the response literal lives here so the body encoding
 * stops being an implicit, per-endpoint decision.
 *
 * ENCODING: the body is a raw `Buffer`, never `.toString('binary')` (latin1).
 * A latin1 string body is re-encoded as UTF-8 on the way out, so every byte
 * >= 0x80 becomes two and the file no longer opens — fatal for the compliance
 * report's zlib streams (pdfkit) and corrupting for any certificate whose
 * learner/course name carries æøå. No unit test can catch that (the mock never
 * re-encodes), which is why it is written down here. The Buffer body shipped in
 * `24ede7a` (PR #230); both endpoints are now prod-smoked as real `%PDF-`
 * downloads — the compliance report on `a3e635a` and the certificate on
 * `813b4c4` (PR #272).
 *
 * This helper only owns the response envelope, not the bytes handed to it: the
 * certificate's own UTF-16-vs-UTF-8 offset bug (#273) had to be fixed inside
 * `generate-certificate`, which now emits cp1252 through a byte cursor.
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
      'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
    },
    body: Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf),
  };
}
