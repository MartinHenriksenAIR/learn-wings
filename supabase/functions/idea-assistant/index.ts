import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an AI brainstorming partner for process optimization ideas within an organization. Your role is to help users develop well-thought-out, actionable ideas for improving their work processes using AI and automation.

## Your Approach

**Be a Critical Thinking Partner, Not a Yes-Person:**
- Challenge assumptions constructively
- Ask probing questions about feasibility, scope, and impact
- Help users think through potential obstacles
- Guide toward realistic, achievable goals

**Key Questions to Explore:**
1. **Problem Clarity**: Is the problem well-defined? What's the current pain point?
2. **Scope Boundaries**: Where does this process start and end? What's in/out of scope?
3. **Resource Requirements**: What people, tools, or data would be needed?
4. **Measurable Outcomes**: How would success be measured? What KPIs would improve?
5. **Potential Risks**: What could go wrong? What are the dependencies?
6. **Stakeholder Impact**: Who would be affected? Who needs to approve?

**Conversation Flow:**
1. Start by understanding the user's initial observation or idea
2. Ask clarifying questions one or two at a time (don't overwhelm)
3. Challenge assumptions where appropriate
4. Help quantify the current state and potential impact
5. Guide toward a structured idea that can be submitted for review

**When the User's Idea is Ready:**
When the conversation has sufficiently explored the idea and it's ready for submission, help them summarize it with:
- A clear problem statement
- A proposed solution
- Expected impact/benefits

**Tone:**
- Professional but friendly
- Encouraging but realistic
- Curious and helpful

**Context Awareness:**
You have access to the user's learning history (courses completed, quiz scores) and previous ideas. Use this context to:
- Reference relevant concepts from courses they've taken
- Avoid suggesting ideas similar to ones already submitted
- Tailor your questions based on their expertise level`;

interface LearningContext {
  completedCourses: Array<{
    title: string;
    level: string;
    completedAt: string;
  }>;
  quizScores: Array<{
    courseTitle: string;
    lessonTitle: string;
    score: number;
    passed: boolean;
  }>;
  previousIdeas: Array<{
    title: string;
    status: string;
    createdAt: string;
  }>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

async function getLearningContext(
  supabase: any,
  userId: string,
  orgId: string
): Promise<LearningContext> {
  // Get completed courses
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(`
      completed_at,
      courses:course_id (
        title,
        level
      )
    `)
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(10);

  // Get quiz attempts
  const { data: quizAttempts } = await supabase
    .from("quiz_attempts")
    .select(`
      score,
      passed,
      quizzes:quiz_id (
        lessons:lesson_id (
          title,
          course_modules:module_id (
            courses:course_id (
              title
            )
          )
        )
      )
    `)
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .order("finished_at", { ascending: false })
    .limit(10);

  // Get previous ideas
  const { data: ideas } = await supabase
    .from("ideas")
    .select("title, status, created_at")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(10);

  const completedCourses = (enrollments || []).map((e: any) => ({
    title: e.courses?.title || "Unknown Course",
    level: e.courses?.level || "basic",
    completedAt: e.completed_at,
  }));

  const quizScores = (quizAttempts || []).map((q: any) => ({
    courseTitle: q.quizzes?.lessons?.course_modules?.courses?.title || "Unknown",
    lessonTitle: q.quizzes?.lessons?.title || "Unknown",
    score: q.score,
    passed: q.passed,
  }));

  const previousIdeas = (ideas || []).map((i: any) => ({
    title: i.title,
    status: i.status,
    createdAt: i.created_at,
  }));

  return { completedCourses, quizScores, previousIdeas };
}

function buildContextMessage(context: LearningContext): string {
  const parts: string[] = [];

  if (context.completedCourses.length > 0) {
    parts.push(
      `**Completed Courses:** ${context.completedCourses
        .map((c) => `${c.title} (${c.level})`)
        .join(", ")}`
    );
  }

  if (context.quizScores.length > 0) {
    const avgScore =
      context.quizScores.reduce((sum, q) => sum + q.score, 0) /
      context.quizScores.length;
    parts.push(`**Average Quiz Score:** ${avgScore.toFixed(0)}%`);
  }

  if (context.previousIdeas.length > 0) {
    parts.push(
      `**Previous Ideas Submitted:** ${context.previousIdeas
        .map((i) => `"${i.title}" (${i.status})`)
        .join(", ")}`
    );
  }

  if (parts.length === 0) {
    return "This is a new user with no prior learning history or submitted ideas.";
  }

  return parts.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create client with service role for fetching context
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create client with user token to verify identity
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, orgId, conversationId } = await req.json();

    if (!messages || !Array.isArray(messages) || !orgId) {
      return new Response(
        JSON.stringify({ error: "Missing messages or orgId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Processing request for user ${user.id} in org ${orgId}`);

    // Verify user belongs to org
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("org_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .eq("status", "active")
      .single();

    if (membershipError || !membership) {
      console.error("Membership check failed:", membershipError);
      return new Response(
        JSON.stringify({ error: "Not a member of this organization" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get learning context
    const learningContext = await getLearningContext(supabaseAdmin, user.id, orgId);
    const contextMessage = buildContextMessage(learningContext);

    console.log("Learning context:", contextMessage);

    // Build messages for AI
    const aiMessages = [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\n## User's Learning Context\n${contextMessage}`,
      },
      ...messages.map((m: Message) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // Call Lovable AI Gateway with streaming
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: aiMessages,
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add more credits." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Return streaming response
    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("idea-assistant error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
