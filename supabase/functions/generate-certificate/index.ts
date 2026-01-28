import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Helper to encode text for PDF
function pdfString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Generate a professional PDF certificate
function generateCertificatePDF(
  recipientName: string,
  courseName: string,
  completionDate: string,
  organizationName: string,
  certificateId: string
): Uint8Array {
  const pageWidth = 842; // A4 landscape width in points
  const pageHeight = 595; // A4 landscape height in points
  const centerX = pageWidth / 2;

  // PDF structure
  const objects: string[] = [];
  let objectCount = 0;
  const offsets: number[] = [];

  const addObject = (content: string): number => {
    objectCount++;
    offsets.push(0); // Will be calculated later
    objects.push(content);
    return objectCount;
  };

  // Object 1: Catalog
  addObject(`1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj`);

  // Object 2: Pages
  addObject(`2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj`);

  // Object 3: Page
  addObject(`3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>
endobj`);

  // Build the content stream
  const contentLines: string[] = [];

  // Background - elegant cream/off-white
  contentLines.push('q');
  contentLines.push('0.98 0.96 0.92 rg');
  contentLines.push(`0 0 ${pageWidth} ${pageHeight} re f`);
  contentLines.push('Q');

  // Decorative border - outer
  contentLines.push('q');
  contentLines.push('0.6 0.5 0.4 RG'); // Bronze/gold color
  contentLines.push('3 w'); // Line width
  contentLines.push(`30 30 ${pageWidth - 60} ${pageHeight - 60} re S`);
  contentLines.push('Q');

  // Decorative border - inner
  contentLines.push('q');
  contentLines.push('0.7 0.6 0.5 RG');
  contentLines.push('1.5 w');
  contentLines.push(`45 45 ${pageWidth - 90} ${pageHeight - 90} re S`);
  contentLines.push('Q');

  // Corner decorations (simple elegant lines)
  contentLines.push('q');
  contentLines.push('0.6 0.5 0.4 RG');
  contentLines.push('2 w');
  // Top left
  contentLines.push('60 535 m 60 555 l 80 555 l S');
  contentLines.push('60 535 m 80 535 l S');
  // Top right
  contentLines.push(`${pageWidth - 60} 535 m ${pageWidth - 60} 555 l ${pageWidth - 80} 555 l S`);
  contentLines.push(`${pageWidth - 60} 535 m ${pageWidth - 80} 535 l S`);
  // Bottom left
  contentLines.push('60 60 m 60 40 l 80 40 l S');
  contentLines.push('60 60 m 80 60 l S');
  // Bottom right
  contentLines.push(`${pageWidth - 60} 60 m ${pageWidth - 60} 40 l ${pageWidth - 80} 40 l S`);
  contentLines.push(`${pageWidth - 60} 60 m ${pageWidth - 80} 60 l S`);
  contentLines.push('Q');

  // Header text - "CERTIFICATE"
  contentLines.push('BT');
  contentLines.push('/F1 14 Tf');
  contentLines.push('0.4 0.35 0.3 rg');
  const headerText = 'CERTIFICATE';
  contentLines.push(`${centerX - 55} 520 Td`);
  contentLines.push(`(${pdfString(headerText)}) Tj`);
  contentLines.push('ET');

  // "OF COMPLETION"
  contentLines.push('BT');
  contentLines.push('/F1 10 Tf');
  contentLines.push('0.5 0.45 0.4 rg');
  const subHeaderText = 'OF COMPLETION';
  contentLines.push(`${centerX - 42} 502 Td`);
  contentLines.push(`(${pdfString(subHeaderText)}) Tj`);
  contentLines.push('ET');

  // Decorative line under header
  contentLines.push('q');
  contentLines.push('0.7 0.6 0.5 RG');
  contentLines.push('1 w');
  contentLines.push(`${centerX - 100} 490 m ${centerX + 100} 490 l S`);
  contentLines.push('Q');

  // "This is to certify that"
  contentLines.push('BT');
  contentLines.push('/F2 12 Tf');
  contentLines.push('0.3 0.3 0.3 rg');
  contentLines.push(`${centerX - 70} 450 Td`);
  contentLines.push('(This is to certify that) Tj');
  contentLines.push('ET');

  // Recipient name - large and prominent
  contentLines.push('BT');
  contentLines.push('/F1 32 Tf');
  contentLines.push('0.2 0.2 0.25 rg');
  const nameWidth = recipientName.length * 14; // Approximate width
  contentLines.push(`${centerX - nameWidth / 2} 400 Td`);
  contentLines.push(`(${pdfString(recipientName)}) Tj`);
  contentLines.push('ET');

  // Decorative line under name
  contentLines.push('q');
  contentLines.push('0.7 0.6 0.5 RG');
  contentLines.push('0.5 w');
  contentLines.push(`${centerX - 150} 390 m ${centerX + 150} 390 l S`);
  contentLines.push('Q');

  // "has successfully completed"
  contentLines.push('BT');
  contentLines.push('/F2 12 Tf');
  contentLines.push('0.3 0.3 0.3 rg');
  contentLines.push(`${centerX - 75} 360 Td`);
  contentLines.push('(has successfully completed) Tj');
  contentLines.push('ET');

  // Course name
  contentLines.push('BT');
  contentLines.push('/F1 22 Tf');
  contentLines.push('0.25 0.25 0.3 rg');
  const courseWidth = courseName.length * 10;
  contentLines.push(`${centerX - courseWidth / 2} 320 Td`);
  contentLines.push(`(${pdfString(courseName)}) Tj`);
  contentLines.push('ET');

  // Organization info
  contentLines.push('BT');
  contentLines.push('/F2 11 Tf');
  contentLines.push('0.4 0.4 0.4 rg');
  const orgText = `Offered by ${organizationName}`;
  const orgWidth = orgText.length * 5;
  contentLines.push(`${centerX - orgWidth / 2} 290 Td`);
  contentLines.push(`(${pdfString(orgText)}) Tj`);
  contentLines.push('ET');

  // Completion date
  contentLines.push('BT');
  contentLines.push('/F2 11 Tf');
  contentLines.push('0.4 0.4 0.4 rg');
  const dateText = `Completed on ${completionDate}`;
  const dateWidth = dateText.length * 5;
  contentLines.push(`${centerX - dateWidth / 2} 270 Td`);
  contentLines.push(`(${pdfString(dateText)}) Tj`);
  contentLines.push('ET');

  // Award icon (simple star shape using lines)
  contentLines.push('q');
  contentLines.push('0.85 0.75 0.5 rg'); // Gold fill
  contentLines.push('0.7 0.6 0.4 RG'); // Gold stroke
  contentLines.push('1 w');
  const starCenterX = centerX;
  const starCenterY = 200;
  const outerR = 25;
  const innerR = 10;
  // Draw a 5-point star
  const starPoints: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const x = starCenterX + r * Math.cos(angle);
    const y = starCenterY + r * Math.sin(angle);
    if (i === 0) {
      starPoints.push(`${x.toFixed(1)} ${y.toFixed(1)} m`);
    } else {
      starPoints.push(`${x.toFixed(1)} ${y.toFixed(1)} l`);
    }
  }
  contentLines.push(starPoints.join(' '));
  contentLines.push('h B'); // Close path and fill+stroke
  contentLines.push('Q');

  // Certificate ID (small, at bottom)
  contentLines.push('BT');
  contentLines.push('/F3 8 Tf');
  contentLines.push('0.5 0.5 0.5 rg');
  const idText = `Certificate ID: ${certificateId}`;
  contentLines.push(`${centerX - 60} 100 Td`);
  contentLines.push(`(${pdfString(idText)}) Tj`);
  contentLines.push('ET');

  // Signature lines
  contentLines.push('q');
  contentLines.push('0.5 0.5 0.5 RG');
  contentLines.push('0.5 w');
  // Left signature
  contentLines.push('200 130 m 350 130 l S');
  // Right signature
  contentLines.push('492 130 m 642 130 l S');
  contentLines.push('Q');

  // Signature labels
  contentLines.push('BT');
  contentLines.push('/F2 9 Tf');
  contentLines.push('0.4 0.4 0.4 rg');
  contentLines.push('245 115 Td');
  contentLines.push('(Instructor) Tj');
  contentLines.push('ET');

  contentLines.push('BT');
  contentLines.push('/F2 9 Tf');
  contentLines.push('0.4 0.4 0.4 rg');
  contentLines.push('545 115 Td');
  contentLines.push('(Director) Tj');
  contentLines.push('ET');

  const contentStream = contentLines.join('\n');

  // Object 4: Content stream
  addObject(`4 0 obj
<< /Length ${contentStream.length} >>
stream
${contentStream}
endstream
endobj`);

  // Object 5: Font 1 (Helvetica-Bold for headers)
  addObject(`5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj`);

  // Object 6: Font 2 (Helvetica for body text)
  addObject(`6 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj`);

  // Object 7: Font 3 (Courier for certificate ID)
  addObject(`7 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>
endobj`);

  // Build PDF
  let pdf = '%PDF-1.4\n';
  
  // Add objects with offsets
  for (let i = 0; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += objects[i] + '\n';
  }

  // Cross-reference table
  const xrefOffset = pdf.length;
  pdf += 'xref\n';
  pdf += `0 ${objectCount + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 0; i < objectCount; i++) {
    pdf += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
  }

  // Trailer
  pdf += 'trailer\n';
  pdf += `<< /Size ${objectCount + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += xrefOffset + '\n';
  pdf += '%%EOF';

  return new TextEncoder().encode(pdf);
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create authenticated client
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Failed to get user:', userError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User authenticated:', user.id);

    // Parse request body
    const { enrollmentId } = await req.json();
    if (!enrollmentId) {
      console.error('No enrollmentId provided');
      return new Response(
        JSON.stringify({ error: 'Enrollment ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating certificate for enrollment:', enrollmentId);

    // Fetch enrollment with course and org data
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .select(`
        *,
        course:courses(id, title),
        organization:organizations(id, name)
      `)
      .eq('id', enrollmentId)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .maybeSingle();

    if (enrollmentError) {
      console.error('Error fetching enrollment:', enrollmentError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch enrollment' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!enrollment) {
      console.error('Enrollment not found or not completed');
      return new Response(
        JSON.stringify({ error: 'Enrollment not found or not completed' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Error fetching profile:', profileError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const recipientName = profile?.full_name || user.email || 'Learner';
    const courseName = (enrollment.course as any)?.title || 'Course';
    const organizationName = (enrollment.organization as any)?.name || 'Organization';
    const completionDate = new Date(enrollment.completed_at!).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Generate a unique certificate ID
    const certificateId = `CERT-${enrollmentId.substring(0, 8).toUpperCase()}`;

    console.log('Generating PDF for:', { recipientName, courseName, organizationName, completionDate, certificateId });

    // Generate PDF
    const pdfBytes = generateCertificatePDF(
      recipientName,
      courseName,
      completionDate,
      organizationName,
      certificateId
    );

    console.log('PDF generated successfully, size:', pdfBytes.length);

    // Return PDF - convert Uint8Array to ArrayBuffer for Response
    return new Response(pdfBytes.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-${courseName.replace(/[^a-zA-Z0-9]/g, '-')}.pdf"`,
      },
    });

  } catch (error) {
    console.error('Error generating certificate:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
