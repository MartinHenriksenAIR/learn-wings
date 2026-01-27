-- Fix: Create RPC function to get quiz options for learners
-- This replaces the view approach since RLS cannot be enabled on views

-- Create a SECURITY DEFINER function that checks access and returns options (without is_correct)
CREATE OR REPLACE FUNCTION public.get_quiz_options_for_learner(p_question_id UUID)
RETURNS TABLE (id UUID, question_id UUID, option_text TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT qo.id, qo.question_id, qo.option_text
  FROM quiz_options qo
  WHERE qo.question_id = p_question_id
    AND (
      -- Platform admins can see all options
      is_platform_admin()
      OR
      -- Users can see options for courses they have access to
      EXISTS (
        SELECT 1
        FROM quiz_questions qq
        JOIN quizzes q ON q.id = qq.quiz_id
        JOIN lessons l ON l.id = q.lesson_id
        JOIN course_modules cm ON cm.id = l.module_id
        JOIN courses c ON c.id = cm.course_id
        JOIN org_course_access oca ON oca.course_id = c.id
        WHERE qq.id = p_question_id
          AND c.is_published = TRUE
          AND oca.org_id IN (SELECT current_org_ids_for_user())
          AND oca.access = 'enabled'
      )
    )
  ORDER BY qo.id;
$$;

-- Also create a function for org admins to get invitations safely
CREATE OR REPLACE FUNCTION public.get_org_invitations_safe(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  org_id UUID,
  email TEXT,
  role org_role,
  status invitation_status,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  link_id TEXT,
  is_platform_admin_invite BOOLEAN,
  invited_by_user_id UUID
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    i.id,
    i.org_id,
    i.email,
    i.role,
    i.status,
    i.expires_at,
    i.created_at,
    i.link_id,
    i.is_platform_admin_invite,
    i.invited_by_user_id
  FROM invitations i
  WHERE i.org_id = p_org_id
    AND i.status = 'pending'
    AND (is_platform_admin() OR is_org_admin(p_org_id))
  ORDER BY i.created_at DESC;
$$;