import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, getCorsHeaders } from '../shared/cors';

interface ReportData {
  organizationName: string;
  totalMembers: number;
  departmentStats: {
    department: string;
    totalUsers: number;
    coursesCompleted: number;
    avgQuizScore: number;
    complianceRate: number;
  }[];
  courseStats: {
    title: string;
    enrolled: number;
    completed: number;
    completionRate: number;
  }[];
  generatedAt: string;
}

function generatePDF(data: ReportData): Uint8Array {
  const generatedDate = new Date(data.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  let departmentSection = '';
  if (data.departmentStats.length > 0) {
    data.departmentStats.forEach((dept, index) => {
      const yPos = 420 - (index * 60);
      departmentSection += `
        BT /F1 10 Tf 50 ${yPos} Td (${dept.department || 'Unassigned'}) Tj ET
        BT /F1 10 Tf 200 ${yPos} Td (${dept.totalUsers} users) Tj ET
        BT /F1 10 Tf 300 ${yPos} Td (${dept.coursesCompleted} completed) Tj ET
        BT /F1 10 Tf 420 ${yPos} Td (${dept.complianceRate}% compliance) Tj ET
      `;
    });
  } else {
    departmentSection = `BT /F1 10 Tf 50 420 Td (No department data available) Tj ET`;
  }

  let courseSection = '';
  const courseStartY = 280;
  if (data.courseStats.length > 0) {
    data.courseStats.slice(0, 5).forEach((course, index) => {
      const yPos = courseStartY - (index * 40);
      const truncatedTitle = course.title.length > 40 ? course.title.substring(0, 37) + '...' : course.title;
      courseSection += `
        BT /F1 9 Tf 50 ${yPos} Td (${truncatedTitle}) Tj ET
        BT /F1 9 Tf 350 ${yPos} Td (${course.completed}/${course.enrolled} \\(${course.completionRate}%\\)) Tj ET
      `;
    });
  } else {
    courseSection = `BT /F1 10 Tf 50 ${courseStartY} Td (No course data available) Tj ET`;
  }

  const overallCompliance = data.departmentStats.length > 0
    ? Math.round(data.departmentStats.reduce((acc, d) => acc + d.complianceRate, 0) / data.departmentStats.length)
    : 0;

  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>
endobj

4 0 obj
<< /Length 3500 >>
stream
0.1 0.3 0.5 rg
0 742 612 50 re f

1 1 1 rg
BT /F2 18 Tf 50 760 Td (AI Act Compliance Documentation Report) Tj ET

0 0 0 rg
BT /F2 14 Tf 50 700 Td (Organization: ${data.organizationName}) Tj ET
BT /F1 10 Tf 50 680 Td (Report Generated: ${generatedDate}) Tj ET
BT /F1 10 Tf 50 665 Td (Total Staff Members: ${data.totalMembers}) Tj ET

0.95 0.95 0.95 rg
40 600 532 50 re f
0.2 0.2 0.2 rg
BT /F2 12 Tf 50 630 Td (Overall Compliance Summary) Tj ET
BT /F1 11 Tf 50 610 Td (Organization Compliance Rate: ${overallCompliance}%) Tj ET

0.1 0.3 0.5 rg
BT /F2 12 Tf 50 560 Td (Department Breakdown) Tj ET

0.5 0.5 0.5 rg
BT /F1 9 Tf 50 540 Td (Department) Tj ET
BT /F1 9 Tf 200 540 Td (Staff) Tj ET
BT /F1 9 Tf 300 540 Td (Courses Completed) Tj ET
BT /F1 9 Tf 420 540 Td (Compliance Rate) Tj ET

0.8 0.8 0.8 RG
0.5 w
50 535 m 560 535 l S

0 0 0 rg
${departmentSection}

0.1 0.3 0.5 rg
BT /F2 12 Tf 50 320 Td (Course Completion Status) Tj ET

0.5 0.5 0.5 rg
BT /F1 9 Tf 50 300 Td (Course Title) Tj ET
BT /F1 9 Tf 350 300 Td (Completion) Tj ET

0.8 0.8 0.8 RG
50 295 m 560 295 l S

0 0 0 rg
${courseSection}

0.5 0.5 0.5 rg
BT /F1 8 Tf 50 50 Td (This report is generated for AI Act compliance documentation purposes.) Tj ET
BT /F1 8 Tf 50 38 Td (It provides an overview of staff training completion status within the organization.) Tj ET

endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

6 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj

xref
0 7
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000003820 00000 n
0000003897 00000 n

trailer
<< /Size 7 /Root 1 0 R >>
startxref
3978
%%EOF`;

  return new TextEncoder().encode(pdfContent);
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const { orgId } = await req.json() as { orgId: string };

    // Access check: platform admin OR org admin — resolve via entra_oid
    const authCheck = await queryOne<{ can_access: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM profiles WHERE entra_oid = $1 AND is_platform_admin = TRUE)
        OR EXISTS(
          SELECT 1 FROM org_memberships om
          JOIN profiles p ON p.id = om.user_id
          WHERE p.entra_oid = $1 AND om.org_id = $2 AND om.role = 'org_admin' AND om.status = 'active'
        )
      ) AS can_access`,
      [user.id, orgId]
    );
    if (!authCheck?.can_access) {
      return { status: 403, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const org = await queryOne<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [orgId]);

    // Fetch members with department info
    const members = await query<{ user_id: string; department: string | null }>(
      `SELECT om.user_id, p.department
       FROM org_memberships om
       JOIN profiles p ON p.id = om.user_id
       WHERE om.org_id = $1 AND om.status = 'active'`,
      [orgId]
    );

    // Group by department
    const deptMap = new Map<string, string[]>();
    for (const m of members) {
      const dept = m.department ?? 'Unassigned';
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(m.user_id);
    }

    const departmentStats = await Promise.all(
      [...deptMap.entries()].map(async ([dept, userIds]) => {
        const enrollments = await query<{ status: string }>(
          'SELECT status FROM enrollments WHERE org_id = $1 AND user_id = ANY($2)',
          [orgId, userIds]
        );
        const quizAttempts = await query<{ score: number }>(
          'SELECT score FROM quiz_attempts WHERE org_id = $1 AND user_id = ANY($2)',
          [orgId, userIds]
        );
        const completed = enrollments.filter(e => e.status === 'completed').length;
        const avgScore = quizAttempts.length > 0
          ? Math.round(quizAttempts.reduce((acc, a) => acc + a.score, 0) / quizAttempts.length)
          : 0;
        return {
          department: dept,
          totalUsers: userIds.length,
          coursesCompleted: completed,
          avgQuizScore: avgScore,
          complianceRate: enrollments.length > 0 ? Math.round((completed / enrollments.length) * 100) : 0,
        };
      })
    );

    // Course stats
    const orgCourses = await query<{ course_id: string; title: string }>(
      `SELECT oca.course_id, c.title
       FROM org_course_access oca
       JOIN courses c ON c.id = oca.course_id
       WHERE oca.org_id = $1 AND oca.access = 'enabled'`,
      [orgId]
    );

    const courseStats = await Promise.all(
      orgCourses.map(async (c) => {
        const courseEnrollments = await query<{ status: string }>(
          'SELECT status FROM enrollments WHERE org_id = $1 AND course_id = $2',
          [orgId, c.course_id]
        );
        const enrolled = courseEnrollments.length;
        const completed = courseEnrollments.filter(e => e.status === 'completed').length;
        return {
          title: c.title,
          enrolled,
          completed,
          completionRate: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
        };
      })
    );

    const reportData: ReportData = {
      organizationName: org?.name ?? 'Unknown Organization',
      totalMembers: members.length,
      departmentStats,
      courseStats,
      generatedAt: new Date().toISOString(),
    };

    const pdfBytes = generatePDF(reportData);

    return {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ai-act-compliance-report-${Date.now()}.pdf"`,
      },
      body: Buffer.from(pdfBytes).toString('binary'),
    };
  } catch (err: unknown) {
    if (err instanceof AuthError) return { status: 401, headers: getCorsHeaders(origin), body: JSON.stringify({ error: (err as Error).message }) };
    return { status: 500, headers: getCorsHeaders(origin), body: JSON.stringify({ error: err instanceof Error ? err.message : 'error' }) };
  }
}

export default handler;
app.http('generate-compliance-report', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
