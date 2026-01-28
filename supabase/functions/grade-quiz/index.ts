import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// Allowed origins for CORS
const allowedOrigins = [
  'https://learn-wings.lovable.app',
  'https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app',
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

interface GradeQuizRequest {
  quiz_id: string;
  answers: Record<string, string>; // question_id -> option_id
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('Missing or invalid Authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Validate user using getUser
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData?.user) {
      console.error('Failed to get user:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    console.log('Grading quiz for user:', userId);

    // Parse request body
    const body: GradeQuizRequest = await req.json();
    const { quiz_id, answers } = body;

    if (!quiz_id || !answers || typeof answers !== 'object') {
      console.error('Invalid request body:', body);
      return new Response(
        JSON.stringify({ error: 'Invalid request: quiz_id and answers are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate user has access to this quiz via their organization
    const { data: hasAccess, error: accessError } = await supabase.rpc('user_can_access_quiz', {
      p_quiz_id: quiz_id
    });

    if (accessError) {
      console.error('Error checking quiz access:', accessError);
      return new Response(
        JSON.stringify({ error: 'Failed to validate quiz access' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasAccess) {
      console.error('User does not have access to quiz:', quiz_id);
      return new Response(
        JSON.stringify({ error: 'Quiz not found or access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role to access quiz_options with is_correct
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get quiz details
    const { data: quiz, error: quizError } = await serviceClient
      .from('quizzes')
      .select('id, passing_score, lesson_id')
      .eq('id', quiz_id)
      .single();

    if (quizError || !quiz) {
      console.error('Quiz not found:', quizError);
      return new Response(
        JSON.stringify({ error: 'Quiz not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all questions for this quiz
    const { data: questions, error: questionsError } = await serviceClient
      .from('quiz_questions')
      .select('id')
      .eq('quiz_id', quiz_id);

    if (questionsError || !questions) {
      console.error('Failed to get questions:', questionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to load quiz questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all correct options for these questions
    const questionIds = questions.map(q => q.id);
    const { data: correctOptions, error: optionsError } = await serviceClient
      .from('quiz_options')
      .select('id, question_id, is_correct')
      .in('question_id', questionIds)
      .eq('is_correct', true);

    if (optionsError) {
      console.error('Failed to get correct options:', optionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to grade quiz' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build a map of question_id -> correct_option_id
    const correctAnswers: Record<string, string> = {};
    for (const opt of correctOptions || []) {
      correctAnswers[opt.question_id] = opt.id;
    }

    // Grade each answer
    let correctCount = 0;
    const totalQuestions = questions.length;
    
    for (const questionId of questionIds) {
      const userAnswer = answers[questionId];
      const correctAnswer = correctAnswers[questionId];
      if (userAnswer && userAnswer === correctAnswer) {
        correctCount++;
      }
    }

    const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const passed = score >= quiz.passing_score;

    console.log(`Quiz graded: ${correctCount}/${totalQuestions} = ${score}%, passed: ${passed}`);

    // Return results (without revealing correct answers)
    return new Response(
      JSON.stringify({
        score,
        passed,
        passing_score: quiz.passing_score,
        correct_count: correctCount,
        total_questions: totalQuestions,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
