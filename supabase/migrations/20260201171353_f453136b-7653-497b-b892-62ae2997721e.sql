-- Drop and recreate the invitations SELECT policy to only allow viewing invitations you created
DROP POLICY IF EXISTS "Admins can view invitations" ON public.invitations;

-- Create new restrictive policy: org admins can only see invitations they created
-- Platform admins can see all invitations
CREATE POLICY "Admins can view invitations they created"
ON public.invitations
FOR SELECT
USING (
  is_platform_admin() 
  OR (
    org_id IS NOT NULL 
    AND is_org_admin(org_id) 
    AND invited_by_user_id = auth.uid()
  )
);

-- Update the safe RPC function to also respect this restriction for org admins
CREATE OR REPLACE FUNCTION public.get_org_invitations_safe(p_org_id uuid)
RETURNS TABLE(
  id uuid, 
  org_id uuid, 
  email text, 
  role org_role, 
  status invitation_status, 
  expires_at timestamp with time zone, 
  created_at timestamp with time zone, 
  link_id text, 
  is_platform_admin_invite boolean, 
  invited_by_user_id uuid
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
    AND (
      is_platform_admin() 
      OR (is_org_admin(p_org_id) AND i.invited_by_user_id = auth.uid())
    )
  ORDER BY i.created_at DESC;
$$;