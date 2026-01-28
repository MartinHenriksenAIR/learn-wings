-- Allow org admins to update their organization's logo
CREATE POLICY "Org admins can update their org logo"
ON public.organizations
FOR UPDATE
USING (is_org_admin(id))
WITH CHECK (is_org_admin(id));