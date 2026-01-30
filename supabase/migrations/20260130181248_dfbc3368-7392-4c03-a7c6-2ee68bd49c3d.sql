-- =============================================
-- COMMUNITY MODULE - PHASE 1B: MAIN TABLES
-- =============================================

-- 1. Helper function to check if user can post in restricted category
CREATE OR REPLACE FUNCTION public.can_post_restricted_category(p_scope community_scope, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_scope = 'global' THEN is_platform_admin()
      WHEN p_scope = 'org' AND p_org_id IS NOT NULL THEN 
        is_platform_admin() OR is_org_admin(p_org_id)
      ELSE false
    END
$$;

-- 2. Create community_posts table
CREATE TABLE public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope community_scope NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.community_categories(id),
  title text NOT NULL,
  content text NOT NULL,
  tags text[] DEFAULT '{}',
  is_pinned boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  event_date timestamptz,
  event_location text,
  event_registration_url text,
  event_recording_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_scope_requires_org CHECK (
    (scope = 'global' AND org_id IS NULL) OR
    (scope = 'org' AND org_id IS NOT NULL)
  )
);

-- Create indexes
CREATE INDEX idx_community_posts_scope ON public.community_posts(scope);
CREATE INDEX idx_community_posts_org_id ON public.community_posts(org_id);
CREATE INDEX idx_community_posts_category_id ON public.community_posts(category_id);
CREATE INDEX idx_community_posts_user_id ON public.community_posts(user_id);
CREATE INDEX idx_community_posts_created_at ON public.community_posts(created_at DESC);
CREATE INDEX idx_community_posts_tags ON public.community_posts USING GIN(tags);

-- Enable RLS
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for community_posts

-- SELECT: Users can view posts they have access to
CREATE POLICY "Users can view accessible posts"
  ON public.community_posts FOR SELECT
  USING (
    is_hidden = false AND (
      (scope = 'global') OR
      (scope = 'org' AND is_org_member(org_id))
    )
  );

-- Platform admins can see all posts including hidden
CREATE POLICY "Platform admins can view all posts"
  ON public.community_posts FOR SELECT
  USING (is_platform_admin());

-- Org admins can see all posts in their org including hidden
CREATE POLICY "Org admins can view all org posts"
  ON public.community_posts FOR SELECT
  USING (scope = 'org' AND is_org_admin(org_id));

-- INSERT: Users can create posts
CREATE POLICY "Users can create posts"
  ON public.community_posts FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    (
      (scope = 'global') OR
      (scope = 'org' AND is_org_member(org_id))
    ) AND
    (
      NOT EXISTS (
        SELECT 1 FROM community_categories 
        WHERE id = category_id AND is_restricted = true
      ) OR
      can_post_restricted_category(scope, org_id)
    )
  );

-- UPDATE: Authors can update their own posts (if not hidden/locked)
CREATE POLICY "Authors can update own posts"
  ON public.community_posts FOR UPDATE
  USING (
    user_id = auth.uid() AND
    is_hidden = false AND
    NOT EXISTS (
      SELECT 1 FROM community_categories 
      WHERE id = category_id AND is_restricted = true
    )
  );

-- Admins can update posts for moderation
CREATE POLICY "Platform admins can update any post"
  ON public.community_posts FOR UPDATE
  USING (is_platform_admin());

CREATE POLICY "Org admins can update org posts"
  ON public.community_posts FOR UPDATE
  USING (scope = 'org' AND is_org_admin(org_id));

-- DELETE: Authors can delete own posts (if not restricted category)
CREATE POLICY "Authors can delete own posts"
  ON public.community_posts FOR DELETE
  USING (
    user_id = auth.uid() AND
    NOT EXISTS (
      SELECT 1 FROM community_categories 
      WHERE id = category_id AND is_restricted = true
    )
  );

-- Admins can delete posts
CREATE POLICY "Platform admins can delete any post"
  ON public.community_posts FOR DELETE
  USING (is_platform_admin());

CREATE POLICY "Org admins can delete org posts"
  ON public.community_posts FOR DELETE
  USING (scope = 'org' AND is_org_admin(org_id));

-- 3. Create community_comments table
CREATE TABLE public.community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  parent_comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_community_comments_post_id ON public.community_comments(post_id);
CREATE INDEX idx_community_comments_user_id ON public.community_comments(user_id);
CREATE INDEX idx_community_comments_parent ON public.community_comments(parent_comment_id);

-- Enable RLS
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user can access post
CREATE OR REPLACE FUNCTION public.can_access_community_post(p_post_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM community_posts p
    WHERE p.id = p_post_id AND (
      is_platform_admin() OR
      (p.scope = 'global') OR
      (p.scope = 'org' AND is_org_member(p.org_id))
    )
  )
$$;

-- Helper to get post org_id
CREATE OR REPLACE FUNCTION public.get_post_org_id(p_post_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM community_posts WHERE id = p_post_id
$$;

-- RLS Policies for community_comments

-- SELECT: Users can view comments on posts they can access
CREATE POLICY "Users can view accessible comments"
  ON public.community_comments FOR SELECT
  USING (
    is_hidden = false AND can_access_community_post(post_id)
  );

-- Admins can see hidden comments
CREATE POLICY "Platform admins can view all comments"
  ON public.community_comments FOR SELECT
  USING (is_platform_admin());

CREATE POLICY "Org admins can view all org comments"
  ON public.community_comments FOR SELECT
  USING (is_org_admin(get_post_org_id(post_id)));

-- INSERT: Users can comment on posts they can access (if not locked)
CREATE POLICY "Users can create comments"
  ON public.community_comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM community_posts p
      WHERE p.id = post_id AND
      p.is_locked = false AND
      can_access_community_post(post_id)
    )
  );

-- UPDATE: Authors can update their own comments (if not hidden)
CREATE POLICY "Authors can update own comments"
  ON public.community_comments FOR UPDATE
  USING (user_id = auth.uid() AND is_hidden = false);

-- Admins can update for moderation
CREATE POLICY "Platform admins can update any comment"
  ON public.community_comments FOR UPDATE
  USING (is_platform_admin());

CREATE POLICY "Org admins can update org comments"
  ON public.community_comments FOR UPDATE
  USING (is_org_admin(get_post_org_id(post_id)));

-- DELETE: Authors can delete own comments
CREATE POLICY "Authors can delete own comments"
  ON public.community_comments FOR DELETE
  USING (user_id = auth.uid());

-- Admins can delete comments
CREATE POLICY "Platform admins can delete any comment"
  ON public.community_comments FOR DELETE
  USING (is_platform_admin());

CREATE POLICY "Org admins can delete org comments"
  ON public.community_comments FOR DELETE
  USING (is_org_admin(get_post_org_id(post_id)));

-- 4. Create community_reports table
CREATE TABLE public.community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type report_target_type NOT NULL,
  target_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status report_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_community_reports_status ON public.community_reports(status);
CREATE INDEX idx_community_reports_org_id ON public.community_reports(org_id);
CREATE INDEX idx_community_reports_target ON public.community_reports(target_type, target_id);

-- Enable RLS
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for community_reports

-- INSERT: Any authenticated user can report content
CREATE POLICY "Users can create reports"
  ON public.community_reports FOR INSERT
  WITH CHECK (reporter_user_id = auth.uid());

-- SELECT: Admins can view reports
CREATE POLICY "Platform admins can view all reports"
  ON public.community_reports FOR SELECT
  USING (is_platform_admin());

CREATE POLICY "Org admins can view org reports"
  ON public.community_reports FOR SELECT
  USING (org_id IS NOT NULL AND is_org_admin(org_id));

-- UPDATE: Admins can update reports
CREATE POLICY "Platform admins can update any report"
  ON public.community_reports FOR UPDATE
  USING (is_platform_admin());

CREATE POLICY "Org admins can update org reports"
  ON public.community_reports FOR UPDATE
  USING (org_id IS NOT NULL AND is_org_admin(org_id));

-- 5. Create updated_at triggers
CREATE OR REPLACE FUNCTION public.update_community_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_community_updated_at();

CREATE TRIGGER update_community_comments_updated_at
  BEFORE UPDATE ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_community_updated_at();