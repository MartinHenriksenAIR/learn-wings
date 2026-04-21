CREATE OR REPLACE FUNCTION public.can_access_lms_asset(file_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM lessons l
      JOIN course_modules cm ON cm.id = l.module_id
      JOIN courses c ON c.id = cm.course_id
      JOIN org_course_access oca ON oca.course_id = c.id
      WHERE c.is_published = TRUE
        AND oca.org_id IN (SELECT current_org_ids_for_user())
        AND oca.access = 'enabled'
        AND (l.video_storage_path = file_path OR l.document_storage_path = file_path)
    )
    OR EXISTS (
      SELECT 1
      FROM courses c
      JOIN org_course_access oca ON oca.course_id = c.id
      WHERE c.is_published = TRUE
        AND oca.org_id IN (SELECT current_org_ids_for_user())
        AND oca.access = 'enabled'
        AND c.thumbnail_url = file_path
    )
$function$;

CREATE OR REPLACE FUNCTION public.can_user_access_lms_asset(file_path text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND is_platform_admin = TRUE)
    OR EXISTS (
      SELECT 1
      FROM lessons l
      JOIN course_modules cm ON cm.id = l.module_id
      JOIN courses c ON c.id = cm.course_id
      JOIN org_course_access oca ON oca.course_id = c.id
      JOIN org_memberships om ON om.org_id = oca.org_id
      WHERE c.is_published = TRUE
        AND oca.access = 'enabled'
        AND om.user_id = p_user_id
        AND om.status = 'active'
        AND (l.video_storage_path = file_path OR l.document_storage_path = file_path)
    )
    OR EXISTS (
      SELECT 1
      FROM courses c
      JOIN org_course_access oca ON oca.course_id = c.id
      JOIN org_memberships om ON om.org_id = oca.org_id
      WHERE c.is_published = TRUE
        AND oca.access = 'enabled'
        AND om.user_id = p_user_id
        AND om.status = 'active'
        AND c.thumbnail_url = file_path
    )
$function$;