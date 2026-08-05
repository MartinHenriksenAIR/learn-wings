-- 10-course-categories.sql
-- #361 course categories: platform-admin-managed, bilingual (en/da) category list;
-- exactly one category per course (courses.category_id, nullable = uncategorized).
-- Idempotent; safe to re-run. Existing courses keep NULL (uncategorized).
-- MUST run on prod BEFORE the #361 deploy: the new course-category functions and the
-- course-create / course-update category logic reference public.course_categories and
-- courses.category_id unconditionally, so the table and column must exist the moment the
-- new function code goes live.
CREATE TABLE IF NOT EXISTS public.course_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en    text NOT NULL,
  name_da    text NOT NULL,
  slug       text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.course_categories(id) ON DELETE SET NULL;

-- Default category set (idempotent by slug).
INSERT INTO public.course_categories (name_en, name_da, slug, sort_order) VALUES
  ('AI Basics',     'AI Basics',      'ai-basics',   0),
  ('Data & Ethics', 'Data & etik',    'data-ethics', 1),
  ('Automation',    'Automatisering', 'automation',  2)
ON CONFLICT (slug) DO NOTHING;
