-- The issue is that all policies are RESTRICTIVE and the INSERT requires SELECT capability
-- for the RETURNING clause (.select().single()). Let's fix by making policies PERMISSIVE.

-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Admins can insert invitations" ON public.invitations;

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "No direct SELECT on invitations" ON public.invitations;

-- Create PERMISSIVE INSERT policy for admins
CREATE POLICY "Admins can insert invitations" 
ON public.invitations 
FOR INSERT 
TO authenticated
WITH CHECK (
  is_platform_admin() 
  OR (org_id IS NOT NULL AND is_org_admin(org_id))
);

-- Create PERMISSIVE SELECT policy for admins only (needed for RETURNING clause on insert)
-- Note: We keep token hidden via RPC functions, but allow admin SELECT for insert operations
CREATE POLICY "Admins can view invitations" 
ON public.invitations 
FOR SELECT 
TO authenticated
USING (
  is_platform_admin() 
  OR (org_id IS NOT NULL AND is_org_admin(org_id))
);