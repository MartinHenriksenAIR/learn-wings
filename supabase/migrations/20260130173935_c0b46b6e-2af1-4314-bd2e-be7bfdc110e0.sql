-- Create a new function that accepts user_id as a parameter for use by edge functions
-- This is needed because edge functions using service role don't have auth.uid()
CREATE OR REPLACE FUNCTION public.can_user_access_lms_asset(p_user_id uuid, file_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    -- Check if user is platform admin
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND is_platform_admin = TRUE
    )
    OR 
    -- Check if user has access through org membership and course access
    EXISTS (
      SELECT 1 
      FROM lessons l
      JOIN course_modules cm ON cm.id = l.module_id
      JOIN courses c ON c.id = cm.course_id
      JOIN org_course_access oca ON oca.course_id = c.id
      JOIN org_memberships om ON om.org_id = oca.org_id
      WHERE c.is_published = TRUE
        AND om.user_id = p_user_id
        AND om.status = 'active'
        AND oca.access = 'enabled'
        AND (l.video_storage_path = file_path 
             OR l.document_storage_path = file_path 
             OR l.azure_blob_path = file_path)
    )
$$;