-- Drop the existing restrictive delete policy
DROP POLICY IF EXISTS "Users can delete their own draft ideas" ON public.ideas;

-- Create new policy: Users can delete their own ideas (any status)
CREATE POLICY "Users can delete their own ideas"
ON public.ideas
FOR DELETE
USING (user_id = auth.uid());

-- Create policy: Org admins can delete any idea in their org
CREATE POLICY "Org admins can delete ideas in their org"
ON public.ideas
FOR DELETE
USING (is_org_admin(org_id));