-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Org admins can manage AI champions" ON public.ai_champions;
DROP POLICY IF EXISTS "Org members can view AI champions" ON public.ai_champions;
DROP POLICY IF EXISTS "Platform admins can manage all AI champions" ON public.ai_champions;
DROP POLICY IF EXISTS "Platform admins can view all AI champions" ON public.ai_champions;

-- Recreate as PERMISSIVE policies (default, uses OR logic)
CREATE POLICY "Platform admins can manage all AI champions"
ON public.ai_champions
FOR ALL
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY "Org admins can manage AI champions"
ON public.ai_champions
FOR ALL
USING (is_org_admin(org_id))
WITH CHECK (is_org_admin(org_id));

CREATE POLICY "Org members can view AI champions"
ON public.ai_champions
FOR SELECT
USING (is_org_member(org_id));