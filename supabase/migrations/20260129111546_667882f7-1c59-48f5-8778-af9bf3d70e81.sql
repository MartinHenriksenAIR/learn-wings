
-- Update user_can_access_quiz to also allow platform admins
CREATE OR REPLACE FUNCTION public.user_can_access_quiz(p_quiz_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT 
    -- Platform admins can access all quizzes
    is_platform_admin()
    OR
    -- Regular users need org course access
    EXISTS (
      SELECT 1
      FROM quizzes q
      JOIN lessons l ON l.id = q.lesson_id
      JOIN course_modules cm ON cm.id = l.module_id
      JOIN courses c ON c.id = cm.course_id
      JOIN org_course_access oca ON oca.course_id = c.id
      WHERE q.id = p_quiz_id
        AND c.is_published = TRUE
        AND oca.org_id IN (SELECT current_org_ids_for_user())
        AND oca.access = 'enabled'
    );
$$;
