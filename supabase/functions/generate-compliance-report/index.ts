import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Build department breakdown text
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

  // Build course breakdown text
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

  // Calculate overall compliance
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
% Header background
0.1 0.3 0.5 rg
0 742 612 50 re f

% Title
1 1 1 rg
BT /F2 18 Tf 50 760 Td (AI Act Compliance Documentation Report) Tj ET

% Organization info
0 0 0 rg
BT /F2 14 Tf 50 700 Td (Organization: ${data.organizationName}) Tj ET
BT /F1 10 Tf 50 680 Td (Report Generated: ${generatedDate}) Tj ET
BT /F1 10 Tf 50 665 Td (Total Staff Members: ${data.totalMembers}) Tj ET

% Compliance Summary Box
0.95 0.95 0.95 rg
40 600 532 50 re f
0.2 0.2 0.2 rg
BT /F2 12 Tf 50 630 Td (Overall Compliance Summary) Tj ET
BT /F1 11 Tf 50 610 Td (Organization Compliance Rate: ${overallCompliance}%) Tj ET

% Section: Department Breakdown
0.1 0.3 0.5 rg
BT /F2 12 Tf 50 560 Td (Department Breakdown) Tj ET

% Department headers
0.5 0.5 0.5 rg
BT /F1 9 Tf 50 540 Td (Department) Tj ET
BT /F1 9 Tf 200 540 Td (Staff) Tj ET
BT /F1 9 Tf 300 540 Td (Courses Completed) Tj ET
BT /F1 9 Tf 420 540 Td (Compliance Rate) Tj ET

% Line
0.8 0.8 0.8 RG
0.5 w
50 535 m 560 535 l S

% Department data
0 0 0 rg
${departmentSection}

% Section: Course Completion Status
0.1 0.3 0.5 rg
BT /F2 12 Tf 50 320 Td (Course Completion Status) Tj ET

0.5 0.5 0.5 rg
BT /F1 9 Tf 50 300 Td (Course Title) Tj ET
BT /F1 9 Tf 350 300 Td (Completion) Tj ET

0.8 0.8 0.8 RG
50 295 m 560 295 l S

0 0 0 rg
${courseSection}

% Footer
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orgId } = await req.json();

    if (!orgId) {
      return new Response(JSON.stringify({ error: "Organization ID required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user is org admin or platform admin
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_platform_admin && membership?.role !== "org_admin") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch organization
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .single();

    // Fetch members with profiles
    const { data: members } = await supabase
      .from("org_memberships")
      .select("user_id, profile:profiles(id, full_name, department)")
      .eq("org_id", orgId)
      .eq("status", "active");

    // Get unique departments
    const departments = [...new Set(
      (members || [])
        .map(m => (m.profile as any)?.department)
        .filter(Boolean)
    )];

    // Add null for users without department
    const hasUnassigned = (members || []).some(m => !(m.profile as any)?.department);
    if (hasUnassigned) {
      departments.push(null as any);
    }

    // Calculate department stats
    const departmentStats = await Promise.all(
      departments.map(async (dept) => {
        const deptMembers = (members || []).filter(m => 
          dept === null 
            ? !(m.profile as any)?.department 
            : (m.profile as any)?.department === dept
        );
        
        const userIds = deptMembers.map(m => (m.profile as any)?.id).filter(Boolean);
        
        // Get enrollments for department users
        const { data: enrollments } = await supabase
          .from("enrollments")
          .select("status, user_id")
          .eq("org_id", orgId)
          .in("user_id", userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

        const totalEnrollments = enrollments?.length || 0;
        const completedEnrollments = enrollments?.filter(e => e.status === "completed").length || 0;

        // Get quiz attempts
        const { data: quizAttempts } = await supabase
          .from("quiz_attempts")
          .select("score")
          .eq("org_id", orgId)
          .in("user_id", userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

        const avgScore = quizAttempts && quizAttempts.length > 0
          ? Math.round(quizAttempts.reduce((acc, a) => acc + a.score, 0) / quizAttempts.length)
          : 0;

        return {
          department: dept || "Unassigned",
          totalUsers: deptMembers.length,
          coursesCompleted: completedEnrollments,
          avgQuizScore: avgScore,
          complianceRate: totalEnrollments > 0 
            ? Math.round((completedEnrollments / totalEnrollments) * 100) 
            : 0,
        };
      })
    );

    // Get course stats
    const { data: orgCourses } = await supabase
      .from("org_course_access")
      .select("course_id, course:courses(id, title)")
      .eq("org_id", orgId)
      .eq("access", "enabled");

    const courseStats = await Promise.all(
      (orgCourses || []).map(async (access) => {
        const course = access.course as any;
        if (!course) return null;

        const { data: courseEnrollments } = await supabase
          .from("enrollments")
          .select("status")
          .eq("org_id", orgId)
          .eq("course_id", course.id);

        const enrolled = courseEnrollments?.length || 0;
        const completed = courseEnrollments?.filter(e => e.status === "completed").length || 0;

        return {
          title: course.title,
          enrolled,
          completed,
          completionRate: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
        };
      })
    );

    const reportData: ReportData = {
      organizationName: org?.name || "Unknown Organization",
      totalMembers: members?.length || 0,
      departmentStats,
      courseStats: courseStats.filter(Boolean) as any[],
      generatedAt: new Date().toISOString(),
    };

    const pdfBytes = generatePDF(reportData);

    return new Response(pdfBytes.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ai-act-compliance-report-${Date.now()}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generating report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
