-- =============================================
-- AIR Academy LMS - Complete Database Schema
-- =============================================

-- 1. Create custom types
CREATE TYPE public.org_role AS ENUM ('org_admin', 'learner');
CREATE TYPE public.membership_status AS ENUM ('active', 'invited', 'disabled');
CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'expired');
CREATE TYPE public.course_level AS ENUM ('basic', 'intermediate', 'advanced');
CREATE TYPE public.lesson_type AS ENUM ('video', 'document', 'quiz');
CREATE TYPE public.enrollment_status AS ENUM ('enrolled', 'completed');
CREATE TYPE public.progress_status AS ENUM ('not_started', 'in_progress', 'completed');
CREATE TYPE public.access_type AS ENUM ('enabled', 'disabled');

-- 2. Create profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  is_platform_admin BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Create organizations table
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Create org_memberships table
CREATE TABLE public.org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'learner',
  status public.membership_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(org_id, user_id)
);

-- 5. Create invitations table
CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.org_role NOT NULL DEFAULT 'learner',
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status public.invitation_status NOT NULL DEFAULT 'pending',
  invited_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days') NOT NULL
);

-- 6. Create courses table
CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  level public.course_level NOT NULL DEFAULT 'basic',
  is_published BOOLEAN DEFAULT FALSE NOT NULL,
  thumbnail_url TEXT,
  created_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7. Create course_modules table
CREATE TABLE public.course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 8. Create lessons table
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lesson_type public.lesson_type NOT NULL,
  content_text TEXT,
  video_storage_path TEXT,
  document_storage_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER
);

-- 9. Create quizzes table
CREATE TABLE public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID UNIQUE NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  passing_score INTEGER NOT NULL DEFAULT 70
);

-- 10. Create quiz_questions table
CREATE TABLE public.quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 11. Create quiz_options table
CREATE TABLE public.quiz_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE
);

-- 12. Create org_course_access table (controls which courses each org can see)
CREATE TABLE public.org_course_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  access public.access_type NOT NULL DEFAULT 'enabled',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(org_id, course_id)
);

-- 13. Create enrollments table (tenant-scoped)
CREATE TABLE public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  status public.enrollment_status NOT NULL DEFAULT 'enrolled',
  enrolled_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE(org_id, user_id, course_id)
);

-- 14. Create lesson_progress table (tenant-scoped)
CREATE TABLE public.lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  status public.progress_status NOT NULL DEFAULT 'not_started',
  completed_at TIMESTAMPTZ,
  UNIQUE(org_id, user_id, lesson_id)
);

-- 15. Create quiz_attempts table (tenant-scoped)
CREATE TABLE public.quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  finished_at TIMESTAMPTZ
);

-- =============================================
-- HELPER FUNCTIONS FOR RLS
-- =============================================

-- Check if current user is platform admin
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_platform_admin = TRUE
  )
$$;

-- Get current user's org IDs
CREATE OR REPLACE FUNCTION public.current_org_ids_for_user()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.org_memberships
  WHERE user_id = auth.uid() AND status = 'active'
$$;

-- Check if current user is org admin for a specific org
CREATE OR REPLACE FUNCTION public.is_org_admin(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE user_id = auth.uid() 
      AND org_id = check_org_id 
      AND role = 'org_admin'
      AND status = 'active'
  )
$$;

-- Check if current user is a member of a specific org
CREATE OR REPLACE FUNCTION public.is_org_member(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE user_id = auth.uid() 
      AND org_id = check_org_id 
      AND status = 'active'
  )
$$;

-- =============================================
-- ENABLE RLS ON ALL TABLES
-- =============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_course_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES
-- =============================================

-- PROFILES POLICIES
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_platform_admin());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "Platform admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can view profiles in their org"
  ON public.profiles FOR SELECT
  USING (
    id IN (
      SELECT om.user_id FROM public.org_memberships om
      WHERE om.org_id IN (SELECT public.current_org_ids_for_user())
    )
  );

-- ORGANIZATIONS POLICIES
CREATE POLICY "Platform admins can do everything with orgs"
  ON public.organizations FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org members can view their org"
  ON public.organizations FOR SELECT
  USING (id IN (SELECT public.current_org_ids_for_user()));

-- ORG_MEMBERSHIPS POLICIES
CREATE POLICY "Platform admins can do everything with memberships"
  ON public.org_memberships FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can manage memberships in their org"
  ON public.org_memberships FOR ALL
  USING (public.is_org_admin(org_id));

CREATE POLICY "Users can view their own membership"
  ON public.org_memberships FOR SELECT
  USING (user_id = auth.uid());

-- INVITATIONS POLICIES
CREATE POLICY "Platform admins can do everything with invitations"
  ON public.invitations FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can manage invitations in their org"
  ON public.invitations FOR ALL
  USING (public.is_org_admin(org_id));

CREATE POLICY "Anyone can read invitation by token for signup"
  ON public.invitations FOR SELECT
  USING (TRUE);

-- COURSES POLICIES
CREATE POLICY "Platform admins can do everything with courses"
  ON public.courses FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Users can view published courses accessible to their org"
  ON public.courses FOR SELECT
  USING (
    is_published = TRUE AND (
      public.is_platform_admin() OR
      id IN (
        SELECT course_id FROM public.org_course_access
        WHERE org_id IN (SELECT public.current_org_ids_for_user())
          AND access = 'enabled'
      )
    )
  );

-- COURSE_MODULES POLICIES
CREATE POLICY "Platform admins can do everything with modules"
  ON public.course_modules FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Users can view modules for accessible courses"
  ON public.course_modules FOR SELECT
  USING (
    course_id IN (
      SELECT id FROM public.courses WHERE is_published = TRUE
    ) AND (
      public.is_platform_admin() OR
      course_id IN (
        SELECT course_id FROM public.org_course_access
        WHERE org_id IN (SELECT public.current_org_ids_for_user())
          AND access = 'enabled'
      )
    )
  );

-- LESSONS POLICIES
CREATE POLICY "Platform admins can do everything with lessons"
  ON public.lessons FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Users can view lessons for accessible courses"
  ON public.lessons FOR SELECT
  USING (
    module_id IN (
      SELECT cm.id FROM public.course_modules cm
      JOIN public.courses c ON c.id = cm.course_id
      WHERE c.is_published = TRUE
    ) AND (
      public.is_platform_admin() OR
      module_id IN (
        SELECT cm.id FROM public.course_modules cm
        JOIN public.org_course_access oca ON oca.course_id = cm.course_id
        WHERE oca.org_id IN (SELECT public.current_org_ids_for_user())
          AND oca.access = 'enabled'
      )
    )
  );

-- QUIZZES POLICIES
CREATE POLICY "Platform admins can do everything with quizzes"
  ON public.quizzes FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Users can view quizzes for accessible lessons"
  ON public.quizzes FOR SELECT
  USING (
    lesson_id IN (
      SELECT l.id FROM public.lessons l
      JOIN public.course_modules cm ON cm.id = l.module_id
      JOIN public.courses c ON c.id = cm.course_id
      WHERE c.is_published = TRUE
    )
  );

-- QUIZ_QUESTIONS POLICIES
CREATE POLICY "Platform admins can do everything with questions"
  ON public.quiz_questions FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Users can view questions for accessible quizzes"
  ON public.quiz_questions FOR SELECT
  USING (
    quiz_id IN (SELECT id FROM public.quizzes)
  );

-- QUIZ_OPTIONS POLICIES
CREATE POLICY "Platform admins can do everything with options"
  ON public.quiz_options FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Users can view options for accessible questions"
  ON public.quiz_options FOR SELECT
  USING (
    question_id IN (SELECT id FROM public.quiz_questions)
  );

-- ORG_COURSE_ACCESS POLICIES
CREATE POLICY "Platform admins can do everything with course access"
  ON public.org_course_access FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can view course access for their org"
  ON public.org_course_access FOR SELECT
  USING (public.is_org_admin(org_id) OR public.is_org_member(org_id));

-- ENROLLMENTS POLICIES
CREATE POLICY "Platform admins can do everything with enrollments"
  ON public.enrollments FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can view enrollments in their org"
  ON public.enrollments FOR SELECT
  USING (public.is_org_admin(org_id));

CREATE POLICY "Users can manage their own enrollments in their org"
  ON public.enrollments FOR ALL
  USING (user_id = auth.uid() AND public.is_org_member(org_id));

-- LESSON_PROGRESS POLICIES
CREATE POLICY "Platform admins can do everything with progress"
  ON public.lesson_progress FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can view progress in their org"
  ON public.lesson_progress FOR SELECT
  USING (public.is_org_admin(org_id));

CREATE POLICY "Users can manage their own progress in their org"
  ON public.lesson_progress FOR ALL
  USING (user_id = auth.uid() AND public.is_org_member(org_id));

-- QUIZ_ATTEMPTS POLICIES
CREATE POLICY "Platform admins can do everything with attempts"
  ON public.quiz_attempts FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Org admins can view attempts in their org"
  ON public.quiz_attempts FOR SELECT
  USING (public.is_org_admin(org_id));

CREATE POLICY "Users can manage their own attempts in their org"
  ON public.quiz_attempts FOR ALL
  USING (user_id = auth.uid() AND public.is_org_member(org_id));

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, is_platform_admin)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    FALSE
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- STORAGE BUCKET
-- =============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lms-assets',
  'lms-assets',
  false,
  52428800, -- 50MB
  ARRAY['video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']
);

-- Storage policies
CREATE POLICY "Platform admins can upload assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'lms-assets' AND public.is_platform_admin());

CREATE POLICY "Platform admins can update assets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'lms-assets' AND public.is_platform_admin());

CREATE POLICY "Platform admins can delete assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'lms-assets' AND public.is_platform_admin());

CREATE POLICY "Authenticated users can view assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lms-assets' AND auth.role() = 'authenticated');