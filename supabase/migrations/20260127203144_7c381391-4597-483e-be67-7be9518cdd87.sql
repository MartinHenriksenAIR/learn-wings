-- Fix 1: Remove overly permissive storage policies for lms-assets
-- The secure policy "Users can view assets for their accessible courses" already exists
DROP POLICY IF EXISTS "Authenticated users can read lms assets" ON storage.objects;

-- Also remove duplicate platform admin policies if they exist (keeping the original secure ones)
DROP POLICY IF EXISTS "Platform admins can upload lms assets" ON storage.objects;
DROP POLICY IF EXISTS "Platform admins can update lms assets" ON storage.objects;
DROP POLICY IF EXISTS "Platform admins can delete lms assets" ON storage.objects;

-- Fix 2: Create a function to validate quiz access for the grade-quiz edge function
CREATE OR REPLACE FUNCTION public.user_can_access_quiz(p_quiz_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
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

-- Fix 3: Update invitations RLS policies to ensure org admins use the safe view
-- First, drop the existing org admin policy on invitations
DROP POLICY IF EXISTS "Org admins can manage invitations in their org" ON public.invitations;

-- Re-create with restricted column access via using the safe view pattern
-- Org admins can only INSERT and UPDATE (not read token/token_hash directly)
CREATE POLICY "Org admins can insert invitations in their org"
ON public.invitations FOR INSERT
WITH CHECK (is_org_admin(org_id));

CREATE POLICY "Org admins can update invitations in their org"
ON public.invitations FOR UPDATE
USING (is_org_admin(org_id));

CREATE POLICY "Org admins can delete invitations in their org"
ON public.invitations FOR DELETE
USING (is_org_admin(org_id));

-- Note: For SELECT, org admins should use the invitations_safe view which excludes token/token_hash
-- The existing RLS prevents direct SELECT access to the invitations table for org admins