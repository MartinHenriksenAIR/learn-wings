// Hand-rolled (not shared/endpoint.ts): binary PDF response and token-only auth (oid-scoped SQL lookups, no getProfile).
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, getCorsHeaders } from '../shared/cors';
import { internalError } from '../shared/errors';

// Pure TypeScript PDF generation — no Deno APIs, works unchanged in Node.js
function pdfString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function generateCertificatePDF(
  recipientName: string,
  courseName: string,
  completionDate: string,
  organizationName: string,
  certificateId: string
): Uint8Array {
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
  contentLines.push(`${centerX - nameWidth / 2} 400 Td`); contentLines.push(`(${pdfString(recipientName)}) Tj`); contentLines.push('ET');
  contentLines.push('q'); contentLines.push('0.7 0.6 0.5 RG'); contentLines.push('0.5 w'); contentLines.push(`${centerX - 150} 390 m ${centerX + 150} 390 l S`); contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F2 12 Tf'); contentLines.push('0.3 0.3 0.3 rg'); contentLines.push(`${centerX - 75} 360 Td`); contentLines.push('(has successfully completed) Tj'); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F1 22 Tf'); contentLines.push('0.25 0.25 0.3 rg');
  const courseWidth = courseName.length * 10;
  contentLines.push(`${centerX - courseWidth / 2} 320 Td`); contentLines.push(`(${pdfString(courseName)}) Tj`); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F2 11 Tf'); contentLines.push('0.4 0.4 0.4 rg');
  const orgText = `Offered by ${organizationName}`;
  const orgWidth = orgText.length * 5;
  contentLines.push(`${centerX - orgWidth / 2} 290 Td`); contentLines.push(`(${pdfString(orgText)}) Tj`); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F2 11 Tf'); contentLines.push('0.4 0.4 0.4 rg');
  const dateText = `Completed on ${completionDate}`;
  const dateWidth = dateText.length * 5;
  contentLines.push(`${centerX - dateWidth / 2} 270 Td`); contentLines.push(`(${pdfString(dateText)}) Tj`); contentLines.push('ET');
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
  contentLines.push(`${centerX - 60} 100 Td`); contentLines.push(`(${pdfString(`Certificate ID: ${certificateId}`)}) Tj`); contentLines.push('ET');
  contentLines.push('q'); contentLines.push('0.5 0.5 0.5 RG'); contentLines.push('0.5 w');
  contentLines.push('200 130 m 350 130 l S'); contentLines.push('492 130 m 642 130 l S'); contentLines.push('Q');
  contentLines.push('BT'); contentLines.push('/F2 9 Tf'); contentLines.push('0.4 0.4 0.4 rg'); contentLines.push('245 115 Td'); contentLines.push('(Instructor) Tj'); contentLines.push('ET');
  contentLines.push('BT'); contentLines.push('/F2 9 Tf'); contentLines.push('0.4 0.4 0.4 rg'); contentLines.push('545 115 Td'); contentLines.push('(Director) Tj'); contentLines.push('ET');

  const contentStream = contentLines.join('\n');
  addObject(`4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj`);
  addObject(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`);
  addObject(`6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);
  addObject(`7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj`);

  let pdf = '%PDF-1.4\n';
  for (let i = 0; i < objects.length; i++) { offsets[i] = pdf.length; pdf += objects[i] + '\n'; }
  const xrefOffset = pdf.length;
  pdf += 'xref\n'; pdf += `0 ${objectCount + 1}\n`; pdf += '0000000000 65535 f \n';
  for (let i = 0; i < objectCount; i++) { pdf += offsets[i].toString().padStart(10, '0') + ' 00000 n \n'; }
  pdf += 'trailer\n'; pdf += `<< /Size ${objectCount + 1} /Root 1 0 R >>\n`; pdf += 'startxref\n'; pdf += xrefOffset + '\n'; pdf += '%%EOF';
  return new TextEncoder().encode(pdf);
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const { enrollmentId } = await req.json() as { enrollmentId: string };

    // Look up enrollment owned by this user (join via profiles.entra_oid)
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
      queryOne<{ name: string }>(
        `SELECT o.name FROM organizations o
         JOIN org_memberships om ON om.org_id = o.id
         JOIN profiles p ON p.id = om.user_id
         WHERE p.entra_oid = $1 AND om.status = 'active' LIMIT 1`,
        [user.id]
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

    return {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-${(course?.title ?? 'course').replace(/[^a-zA-Z0-9]/g, '-')}.pdf"`,
      },
      body: Buffer.from(pdfBytes).toString('binary'),
    };
  } catch (err: unknown) {
    if (err instanceof AuthError) return { status: 401, headers: getCorsHeaders(origin), body: JSON.stringify({ error: (err as Error).message }) };
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('generate-certificate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
