-- Allow org admins to update ideas in their organization (needed for status management in kanban board)
CREATE POLICY "Org admins can update ideas in their org"
  ON public.ideas
  FOR UPDATE
  TO authenticated
  USING (is_org_admin(org_id))
  WITH CHECK (is_org_admin(org_id));
