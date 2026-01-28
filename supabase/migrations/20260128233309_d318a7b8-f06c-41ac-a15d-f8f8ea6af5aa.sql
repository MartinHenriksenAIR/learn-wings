-- Fix invitations table: Add explicit SELECT policy to prevent unauthorized access
-- The table currently only has INSERT/UPDATE/DELETE policies for org_admins
-- We need an explicit SELECT policy that restricts viewing to org admins and platform admins only

-- Add SELECT policy for org admins to view invitations in their org
CREATE POLICY "Org admins can view invitations in their org" 
ON public.invitations 
FOR SELECT 
USING (is_org_admin(org_id) OR is_platform_admin());