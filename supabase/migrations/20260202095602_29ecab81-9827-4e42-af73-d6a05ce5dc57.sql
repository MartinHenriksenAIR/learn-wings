-- Fix community_posts insert policy to allow platform admins
DROP POLICY IF EXISTS "Users can create posts" ON public.community_posts;

CREATE POLICY "Users can create posts" 
ON public.community_posts 
FOR INSERT 
WITH CHECK (
  (user_id = auth.uid()) AND (
    -- Platform admins can post anywhere
    is_platform_admin()
    OR
    -- Global scope is open to all authenticated users
    (scope = 'global'::community_scope)
    OR
    -- Org scope requires membership
    ((scope = 'org'::community_scope) AND is_org_member(org_id))
  ) AND (
    -- Restricted category check
    (NOT (EXISTS (
      SELECT 1 FROM community_categories
      WHERE community_categories.id = community_posts.category_id
        AND community_categories.is_restricted = true
    ))) 
    OR can_post_restricted_category(scope, org_id)
  )
);

-- Also delete the "Ideas / Opportunities" category since ideas have their own module
DELETE FROM community_categories WHERE slug = 'ideas-opportunities';