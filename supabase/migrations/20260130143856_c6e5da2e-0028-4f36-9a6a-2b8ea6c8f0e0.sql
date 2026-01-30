
-- Drop the existing org admin insert policy
DROP POLICY IF EXISTS "Org admins can insert invitations in their org" ON public.invitations;

-- Create a new policy that allows both platform admins and org admins to insert invitations
CREATE POLICY "Admins can insert invitations" 
ON public.invitations 
FOR INSERT 
WITH CHECK (
  is_platform_admin() 
  OR (org_id IS NOT NULL AND is_org_admin(org_id))
);

-- Also drop and recreate the platform admin insert policy since we've combined them
DROP POLICY IF EXISTS "Platform admins can insert invitations" ON public.invitations;
