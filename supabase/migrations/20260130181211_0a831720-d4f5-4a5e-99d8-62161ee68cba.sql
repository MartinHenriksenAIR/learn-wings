-- =============================================
-- COMMUNITY MODULE - PHASE 1A: ENUMS AND CATEGORIES
-- =============================================

-- 1. Create new enum types
CREATE TYPE public.community_scope AS ENUM ('org', 'global');
CREATE TYPE public.report_status AS ENUM ('pending', 'reviewed', 'dismissed');
CREATE TYPE public.report_target_type AS ENUM ('post', 'comment');
CREATE TYPE public.business_area AS ENUM ('hr', 'finance', 'sales', 'support', 'ops', 'it', 'legal', 'other');

-- 2. Add new enum values to idea_status
ALTER TYPE idea_status ADD VALUE IF NOT EXISTS 'in_review';
ALTER TYPE idea_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE idea_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE idea_status ADD VALUE IF NOT EXISTS 'done';

-- 3. Create community_categories table
CREATE TABLE public.community_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  icon text,
  is_restricted boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default categories
INSERT INTO public.community_categories (name, slug, description, icon, is_restricted, sort_order) VALUES
  ('Ideas / Opportunities', 'ideas-opportunities', 'Share ideas for AI and process improvements', 'Lightbulb', false, 1),
  ('Challenges / Obstacles', 'challenges-obstacles', 'Discuss challenges you are facing', 'AlertTriangle', false, 2),
  ('Risks & Mitigation', 'risks-mitigation', 'Identify risks and mitigation strategies', 'Shield', false, 3),
  ('Questions & Help', 'questions-help', 'Ask questions and get help from the community', 'HelpCircle', false, 4),
  ('Wins / Learnings', 'wins-learnings', 'Share your successes and lessons learned', 'Trophy', false, 5),
  ('Resources / Templates', 'resources-templates', 'Share useful resources, templates, and tools', 'FileText', false, 6),
  ('Announcements', 'announcements', 'Important announcements from admins', 'Megaphone', true, 7),
  ('Events / Office Hours', 'events', 'Upcoming events, webinars, and office hours', 'Calendar', true, 8);

-- Enable RLS
ALTER TABLE public.community_categories ENABLE ROW LEVEL SECURITY;

-- Categories are public to all authenticated users
CREATE POLICY "Anyone can view categories"
  ON public.community_categories FOR SELECT
  USING (true);