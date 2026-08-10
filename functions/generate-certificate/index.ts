// Hand-rolled (not shared/endpoint.ts): binary PDF response and token-only auth (oid-scoped SQL lookups, no getProfile).
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, getCorsHeaders } from '../shared/cors';
import { internalError } from '../shared/errors';
import { pdfResponse } from '../shared/http';
import { pdfString } from '../shared/pdf';

/**
 * Every byte of the document is emitted through `Buffer.from(s, PDF_ENCODING)`
 * and measured with `Buffer.byteLength(s, PDF_ENCODING)` — never `String.length`
 * (UTF-16 code units), which is what made every non-ASCII certificate
 * structurally invalid: the xref offsets, `startxref` and the content-stream
 * `/Length` all under-counted by one per `æøå` (see #273).
 *
 * `latin1` is safe as the emit encoding ONLY because every dynamic value is
 * folded through `toWinAnsi()` first, so no code point above 0xFF ever reaches
 * it (latin1 would silently truncate one to its low byte).
 */
const PDF_ENCODING: BufferEncoding = 'latin1';

/**
 * Unicode → cp1252 byte for the 27 codes in 0x80–0x9F that WinAnsiEncoding
 * fills with typographic punctuation. This is the one range where cp1252 and
 * ISO-8859-1 (Node's `latin1`) disagree — Latin-1 leaves it as unprintable C1
 * controls — so it has to be mapped by hand.
 */
const CP1252_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

/**
 * Fold text to cp1252 / WinAnsiEncoding, the encoding declared on the three
 * Type1 fonts below. Returns a string whose every code point is <= 0xFF, i.e.
 * exactly one `latin1` byte per character.
 *
 * SUPPORTED — the full cp1252 repertoire, and nothing else:
 *   - ASCII 0x20–0x7E, mapped byte-for-byte. All-ASCII certificates therefore
 *     produce the exact bytes they did before this function existed.
 *   - All of Latin-1 0xA0–0xFF: the entire Danish set `æ ø å Æ Ø Å`, plus
 *     `é è ü ö ä ñ ç ß à á â` and the rest of Western European Latin.
 *   - The 27 cp1252-only punctuation codes above (curly quotes, en/em dash,
 *     `€`, `…`, `†`, `™`, `Œ`, `Š`, `Ž`, `ƒ`, `‰`). This is genuine cp1252,
 *     not merely Latin-1 — a name pasted from Word with a `'` in it renders
 *     as an apostrophe rather than being dropped.
 *
 * OUTSIDE THAT SET — CJK (`李娜`), Cyrillic, Greek, Polish `ł`, Turkish `ğ`,
 * emoji, and the unprintable C0/C1 control ranges — every code point is
 * replaced by a single `?`. We substitute rather than drop so the glyph loss is
 * visible to whoever reads the certificate, and rather than emit the raw byte
 * so the file stays valid: a code point > 0xFF handed to `latin1` would be
 * truncated to a wrong byte, and handed to `utf8` would desynchronise the byte
 * count from the character count all over again. Substitution is 1 code point →
 * 1 byte, so offsets stay exact either way.
 *
 * Non-BMP code points are iterated whole (`for...of`), so an emoji collapses to
 * one `?` rather than two surrogate halves.
 */
function toWinAnsi(value: string): string {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff)) {
      out += ch;
      continue;
    }
    const mapped = CP1252_HIGH[ch];
    out += mapped === undefined ? '?' : String.fromCharCode(mapped);
  }
  return out;
}

/**
 * The single gate every dynamic value must pass on its way into a `(...) Tj`.
 * Order matters and is load-bearing: escape FIRST (`pdfString` neutralises the
 * `\ ( )` delimiters — #232), fold to WinAnsi SECOND, and only then measure. Do
 * it the other way round and the bytes you count are not the bytes you emit,
 * which is the whole of #273. `toWinAnsi` never produces a `\`, `(` or `)` that
 * `pdfString` did not already escape — its only inventions are `?` and the
 * 0x80–0x9F punctuation — so escaping first loses nothing.
 */
function pdfText(value: string): string {
  return toWinAnsi(pdfString(value));
}

function generateCertificatePDF(
  recipientName: string,
  courseName: string,
  completionDate: string,
  organizationName: string,
  certificateId: string
): Buffer {
  const pageWidth = 842;
  const pageHeight = 595;
  const centerX = pageWidth / 2;

  const objects: string[] = [];
  let objectCount = 0;
  const offsets: number[] = [];

  const addObject = (content: string): number => {
    objectCount++;
    offsets.push(0);
    objects.push(content);
    return objectCount;
  };

  addObject(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`);
  addObject(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`);
  addObject(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>\nendobj`);

  const contentLines: string[] = [];
  contentLines.push('q'); contentLines.push('0.98 0.96 0.92 rg'); contentLines.push(`0 0 ${pageWidth} ${pageHeight} re f`); contentLines.push('Q');
  contentLines.push('q'); contentLines.push('0.6 0.5 0.4 RG'); contentLines.push('3 w'); contentLines.push(`30 30 ${pageWidth - 60} ${pageHeight - 60} re S`); contentLines.push('Q');
  contentLines.push('q'); contentLines.push('0.7 0.6 0.5 RG'); contentLines.push('1.5 w'); contentLines.push(`45 45 ${pageWidth - 90} ${pageHeight - 90} re S`); contentLines.push('Q');
  contentLines.push('q'); contentLines.push('0.6 0.5 0.4 RG'); contentLines.push('2 w');
  contentLines.push('60 535 m 60 555 l 80 555 l S'); contentLines.push('60 535 m 80 535 l S');
  contentLines.push(`${pageWidth - 60} 535 m ${pageWidth - 60} 555 l ${pageWidth - 80} 555 l S`); contentLines.push(`${pageWidth - 60} 535 m ${pageWidth - 80} 535 l S`);
  contentLines.push('60 60 m 60 40 l 80 40 l S'); contentLines.push('60 60 m 80 60 l S');
  contentLines.push(`${pageWidth - 60} 60 m ${pageWidth - 60} 40 l ${pageWidth - 80} 40 l S`); contentLines.push(`${pageWidth - 60} 60 m ${pageWidth - 80} 60 l S`);
  contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F1 14 Tf'); contentLines.push('0.4 0.35 0.3 rg'); contentLines.push(`${centerX - 55} 520 Td`); contentLines.push('(CERTIFICATE) Tj'); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F1 10 Tf'); contentLines.push('0.5 0.45 0.4 rg'); contentLines.push(`${centerX - 42} 502 Td`); contentLines.push('(OF COMPLETION) Tj'); contentLines.push('ET');
  contentLines.push('q'); contentLines.push('0.7 0.6 0.5 RG'); contentLines.push('1 w'); contentLines.push(`${centerX - 100} 490 m ${centerX + 100} 490 l S`); contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F2 12 Tf'); contentLines.push('0.3 0.3 0.3 rg'); contentLines.push(`${centerX - 70} 450 Td`); contentLines.push('(This is to certify that) Tj'); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F1 32 Tf'); contentLines.push('0.2 0.2 0.25 rg');
  const nameWidth = recipientName.length * 14;
  contentLines.push(`${centerX - nameWidth / 2} 400 Td`); contentLines.push(`(${pdfText(recipientName)}) Tj`); contentLines.push('ET');
  contentLines.push('q'); contentLines.push('0.7 0.6 0.5 RG'); contentLines.push('0.5 w'); contentLines.push(`${centerX - 150} 390 m ${centerX + 150} 390 l S`); contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F2 12 Tf'); contentLines.push('0.3 0.3 0.3 rg'); contentLines.push(`${centerX - 75} 360 Td`); contentLines.push('(has successfully completed) Tj'); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F1 22 Tf'); contentLines.push('0.25 0.25 0.3 rg');
  const courseWidth = courseName.length * 10;
  contentLines.push(`${centerX - courseWidth / 2} 320 Td`); contentLines.push(`(${pdfText(courseName)}) Tj`); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F2 11 Tf'); contentLines.push('0.4 0.4 0.4 rg');
  const orgText = `Offered by ${organizationName}`;
  const orgWidth = orgText.length * 5;
  contentLines.push(`${centerX - orgWidth / 2} 290 Td`); contentLines.push(`(${pdfText(orgText)}) Tj`); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F2 11 Tf'); contentLines.push('0.4 0.4 0.4 rg');
  const dateText = `Completed on ${completionDate}`;
  const dateWidth = dateText.length * 5;
  contentLines.push(`${centerX - dateWidth / 2} 270 Td`); contentLines.push(`(${pdfText(dateText)}) Tj`); contentLines.push('ET');
  contentLines.push('q'); contentLines.push('0.85 0.75 0.5 rg'); contentLines.push('0.7 0.6 0.4 RG'); contentLines.push('1 w');
  const starCenterX = centerX; const starCenterY = 200; const outerR = 25; const innerR = 10;
  const starPoints: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const x = starCenterX + r * Math.cos(angle); const y = starCenterY + r * Math.sin(angle);
    starPoints.push(i === 0 ? `${x.toFixed(1)} ${y.toFixed(1)} m` : `${x.toFixed(1)} ${y.toFixed(1)} l`);
  }
  contentLines.push(starPoints.join(' ')); contentLines.push('h B'); contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F3 8 Tf'); contentLines.push('0.5 0.5 0.5 rg');
  contentLines.push(`${centerX - 60} 100 Td`); contentLines.push(`(${pdfText(`Certificate ID: ${certificateId}`)}) Tj`); contentLines.push('ET');
  contentLines.push('q'); contentLines.push('0.5 0.5 0.5 RG'); contentLines.push('0.5 w');
  contentLines.push('200 130 m 350 130 l S'); contentLines.push('492 130 m 642 130 l S'); contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F2 9 Tf'); contentLines.push('0.4 0.4 0.4 rg'); contentLines.push('245 115 Td'); contentLines.push('(Instructor) Tj'); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F2 9 Tf'); contentLines.push('0.4 0.4 0.4 rg'); contentLines.push('545 115 Td'); contentLines.push('(Director) Tj'); contentLines.push('ET');

  const contentStream = contentLines.join('\n');
  addObject(`4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, PDF_ENCODING)} >>\nstream\n${contentStream}\nendstream\nendobj`);
  // /Encoding is not optional now that text is emitted as cp1252 bytes: without
  // it a Type1 font falls back to StandardEncoding, which has no glyph at 0xF8,
  // so `ø` renders as a blank or as mojibake. It must match toWinAnsi().
  addObject(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`);
  addObject(`6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`);
  addObject(`7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj`);

  const chunks: Buffer[] = [];
  let cursor = 0;
  const emit = (s: string): void => {
    const buf = Buffer.from(s, PDF_ENCODING);
    chunks.push(buf);
    cursor += buf.length;
  };

  emit('%PDF-1.4\n');
  for (let i = 0; i < objects.length; i++) { offsets[i] = cursor; emit(objects[i] + '\n'); }
  const xrefOffset = cursor;
  emit('xref\n'); emit(`0 ${objectCount + 1}\n`); emit('0000000000 65535 f \n');
  for (let i = 0; i < objectCount; i++) { emit(offsets[i].toString().padStart(10, '0') + ' 00000 n \n'); }
  emit('trailer\n'); emit(`<< /Size ${objectCount + 1} /Root 1 0 R >>\n`); emit('startxref\n'); emit(xrefOffset + '\n'); emit('%%EOF');
  return Buffer.concat(chunks);
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const { enrollmentId } = await req.json() as { enrollmentId: string };

    const enrollment = await queryOne<{ user_id: string; status: string; course_id: string; completed_at: string }>(
      `SELECT e.user_id, e.status, e.course_id, e.completed_at
       FROM enrollments e
       JOIN profiles p ON p.id = e.user_id
       WHERE e.id = $1 AND p.entra_oid = $2`,
      [enrollmentId, user.id]
    );
    if (!enrollment) {
      return { status: 403, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Access denied' }) };
    }
    if (enrollment.status !== 'completed') {
      return { status: 400, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Course not completed' }) };
    }

    const [profile, course, org] = await Promise.all([
      queryOne<{ full_name: string }>('SELECT full_name FROM profiles WHERE entra_oid = $1', [user.id]),
      queryOne<{ title: string }>('SELECT title FROM courses WHERE id = $1', [enrollment.course_id]),
      // Issuer = the org that OWNS this enrollment, not "any active membership":
      // a solo course prints the placeholder org's name ("AI Uddannelse") with no
      // special-casing, a company course prints the company, and the pre-existing
      // multi-org wrong-issuer bug is fixed. (#354)
      queryOne<{ name: string }>(
        `SELECT o.name FROM organizations o
           JOIN enrollments e ON e.org_id = o.id
          WHERE e.id = $1`,
        [enrollmentId],
      ),
    ]);

    const completionDate = new Date(enrollment.completed_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const certificateId = `CERT-${enrollmentId.substring(0, 8).toUpperCase()}`;

    const pdfBytes = generateCertificatePDF(
      profile?.full_name ?? 'Learner',
      course?.title ?? 'Course',
      completionDate,
      org?.name ?? 'Organization',
      certificateId
    );

    return pdfResponse(
      origin,
      `certificate-${(course?.title ?? 'course').replace(/[^a-zA-Z0-9]/g, '-')}.pdf`,
      pdfBytes
    );
  } catch (err: unknown) {
    if (err instanceof AuthError) return { status: 401, headers: getCorsHeaders(origin), body: JSON.stringify({ error: (err as Error).message }) };
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('generate-certificate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
