
-- Drop all existing INSERT policies on invitations
DROP POLICY IF EXISTS "Admins can insert invitations" ON public.invitations;
DROP POLICY IF EXISTS "Platform admins can insert invitations" ON public.invitations;
DROP POLICY IF EXISTS "Org admins can insert invitations in their org" ON public.invitations;

-- Create a single INSERT policy that works for both platform admins and org admins
CREATE POLICY "Admins can insert invitations" 
ON public.invitations 
FOR INSERT 
TO authenticated
WITH CHECK (
  is_platform_admin() 
  OR (org_id IS NOT NULL AND is_org_admin(org_id))
);
