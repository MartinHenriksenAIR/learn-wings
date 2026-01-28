-- Fix invitations table: Remove direct SELECT access to prevent token exposure
-- The safe RPCs (get_org_invitations_safe, get_platform_invitations_safe) already exclude tokens
-- We need to deny direct SELECT and only allow access through these RPCs

-- Drop the existing SELECT policy that exposes tokens
DROP POLICY IF EXISTS "Org admins can view invitations in their org" ON public.invitations;

-- Create a restrictive SELECT policy that denies direct access
-- Users must use the safe RPC functions instead
CREATE POLICY "No direct SELECT on invitations"
ON public.invitations
FOR SELECT
USING (false);

-- Platform admin ALL policy already exists and is needed for INSERT/UPDATE/DELETE operations
-- But we need to ensure they also go through safe RPCs for SELECT
-- The existing "Platform admins can do everything with invitations" policy grants ALL
-- We need to drop it and recreate with specific operation policies

DROP POLICY IF EXISTS "Platform admins can do everything with invitations" ON public.invitations;

-- Platform admins can INSERT
CREATE POLICY "Platform admins can insert invitations"
ON public.invitations
FOR INSERT
WITH CHECK (is_platform_admin());

-- Platform admins can UPDATE
CREATE POLICY "Platform admins can update invitations"
ON public.invitations
FOR UPDATE
USING (is_platform_admin());

-- Platform admins can DELETE
CREATE POLICY "Platform admins can delete invitations"
ON public.invitations
FOR DELETE
USING (is_platform_admin());

-- Verify quiz_options_public view has proper security
-- The view should use security_invoker to respect caller's permissions
DROP VIEW IF EXISTS public.quiz_options_public;

CREATE VIEW public.quiz_options_public
WITH (security_invoker = true)
AS SELECT 
  id,
  question_id,
  option_text
  -- is_correct is intentionally excluded
FROM public.quiz_options;