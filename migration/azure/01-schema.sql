-- =====================================================================
-- learn-wings (AIR Academy LMS) — Azure PostgreSQL 15 schema
-- =====================================================================
-- Derived from supabase/migrations/*.sql (42 files, final state) and
-- reconciled against src/integrations/supabase/types.ts (generated DB
-- types = authoritative final column sets) and the Azure Functions in
-- functions/*/index.ts (the runtime consumers).
--
-- ---------------------------------------------------------------------
-- WHAT WAS STRIPPED FROM THE SUPABASE MIGRATIONS (and why)
-- ---------------------------------------------------------------------
--  * Row Level Security: every `ALTER TABLE ... ENABLE ROW LEVEL
--    SECURITY`, `CREATE POLICY`, `DROP POLICY`. Authorization is now
--    enforced in app code by the Azure Functions, so RLS is removed.
--  * The `auth` schema: `profiles.id REFERENCES auth.users` becomes a
--    plain `uuid PRIMARY KEY DEFAULT gen_random_uuid()`. The
--    `handle_new_user()` trigger on `auth.users` is dropped — profiles
--    are now provisioned by functions/user-context on first Entra login.
--  * `auth.uid()` / `auth.role()` / `auth.jwt()` usages: dropped, or for
--    a few useful SQL helpers re-parameterized with an explicit
--    `p_user_id uuid` argument (see "PORTED FUNCTIONS" below).
--  * `storage.*` (buckets/objects + their policies), the
--    `supabase_realtime` publication, and all GRANT/REVOKE to
--    anon/authenticated/service_role: dropped. Blob storage is Azure
--    Blob Storage, accessed via SAS tokens from the azure-* functions.
--  * `extensions.gen_random_bytes()` / `uuid_generate_v4()`: replaced
--    with `gen_random_bytes()` (pgcrypto) and `gen_random_uuid()`
--    (built into PG13+). pgcrypto is the ONLY extension required — it is
--    on the Azure Flexible Server allow-list and is created below. It is
--    needed for the invitation `token` default (sha256/gen_random_bytes).
--  * The `moddatetime` extension was never used; all updated_at
--    maintenance uses plain plpgsql trigger functions (preserved).
--
-- ---------------------------------------------------------------------
-- WHAT WAS ADDED (the Entra delta + function-required columns)
-- ---------------------------------------------------------------------
--  * profiles.entra_oid text, profiles.entra_tid text (nullable) with a
--    partial UNIQUE index — required by functions/user-context which
--    looks up / provisions profiles by (entra_oid, entra_tid).
--  * profiles.email text and profiles.avatar_url text — selected and
--    inserted by functions/user-context (and email read by
--    org-analytics-data). Absent from Supabase migrations; added here so
--    the consuming functions match.
--  * quiz_options.sort_order integer — selected/ordered by
--    functions/quiz-options and quiz-options-admin. Absent from Supabase
--    migrations; added with default 0.
--  See migration/azure/README.md for the full functions->tables matrix
--  and the flagged gaps (e.g. functions/invitation-link).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- SECTION 1: ENUM TYPES
-- =====================================================================
CREATE TYPE public.org_role            AS ENUM ('org_admin', 'learner');
CREATE TYPE public.membership_status   AS ENUM ('active', 'invited', 'disabled');
CREATE TYPE public.invitation_status   AS ENUM ('pending', 'accepted', 'expired');
CREATE TYPE public.course_level        AS ENUM ('basic', 'intermediate', 'advanced');
CREATE TYPE public.lesson_type         AS ENUM ('video', 'document', 'quiz');
CREATE TYPE public.enrollment_status   AS ENUM ('enrolled', 'completed');
CREATE TYPE public.progress_status     AS ENUM ('not_started', 'in_progress', 'completed');
CREATE TYPE public.access_type         AS ENUM ('enabled', 'disabled');
CREATE TYPE public.community_scope     AS ENUM ('org', 'global');
CREATE TYPE public.report_status       AS ENUM ('pending', 'reviewed', 'dismissed');
CREATE TYPE public.report_target_type  AS ENUM ('post', 'comment');
CREATE TYPE public.business_area       AS ENUM ('hr', 'finance', 'sales', 'support', 'ops', 'it', 'legal', 'other');

-- idea_status: base values plus the four ADD VALUE entries from later
-- migrations. (Supabase ADDed these incrementally; we declare the full
-- final set up front — order matches the generated types.ts.)
CREATE TYPE public.idea_status AS ENUM (
  'draft', 'submitted', 'under_review', 'approved', 'in_progress',
  'completed', 'archived', 'in_review', 'accepted', 'rejected', 'done'
);

-- =====================================================================
-- SECTION 2: TABLES
-- (FKs declared inline between app tables; ordered so referenced
--  tables exist first. No auth/storage references remain.)
-- =====================================================================

-- ---- organizations ----
CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  logo_url   text,
  seat_limit integer DEFAULT NULL,   -- NULL = unlimited
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.organizations.seat_limit IS 'Maximum number of users allowed in this organization. NULL means unlimited.';

-- ---- profiles ----
-- id was `REFERENCES auth.users` in Supabase; now a self-owned uuid PK.
-- entra_oid/entra_tid/email/avatar_url are the Azure delta (see header).
CREATE TABLE public.profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  first_name         text,
  last_name          text,
  department         text,
  email              text,                         -- ADDED (functions/user-context, org-analytics-data)
  avatar_url         text,                         -- ADDED (functions/user-context)
  is_platform_admin  boolean NOT NULL DEFAULT false,
  preferred_language text DEFAULT 'en' CHECK (preferred_language IN ('en', 'da')),
  entra_oid          text,                         -- ADDED (Entra object id)
  entra_tid          text,                         -- ADDED (Entra tenant id)
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---- org_memberships ----
CREATE TABLE public.org_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       public.org_role NOT NULL DEFAULT 'learner',
  status     public.membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- ---- invitations ----
-- token default uses gen_random_bytes (pgcrypto). link_id is the
-- shareable id (was extensions.gen_random_bytes -> gen_random_bytes).
CREATE TABLE public.invitations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  email                   text NOT NULL,
  role                    public.org_role NOT NULL DEFAULT 'learner',
  token                   text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  token_hash              text,
  link_id                 text DEFAULT encode(gen_random_bytes(16), 'hex'),
  status                  public.invitation_status NOT NULL DEFAULT 'pending',
  is_platform_admin_invite boolean NOT NULL DEFAULT false,
  invited_by_user_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_name              text,
  last_name               text,
  department              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  CONSTRAINT invitations_org_or_platform_admin_check
    CHECK (org_id IS NOT NULL OR is_platform_admin_invite = true)
);

-- ---- courses ----
CREATE TABLE public.courses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  description         text,
  level               public.course_level NOT NULL DEFAULT 'basic',
  is_published        boolean NOT NULL DEFAULT false,
  thumbnail_url       text,
  created_by_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---- course_modules ----
CREATE TABLE public.course_modules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title      text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

-- ---- lessons ----
CREATE TABLE public.lessons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id             uuid NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  lesson_type           public.lesson_type NOT NULL,
  content_text          text,
  video_storage_path    text,
  document_storage_path text,
  azure_blob_path       text,   -- Azure Blob Storage video path
  video_url             text,   -- external (e.g. SharePoint) video URL
  sort_order            integer NOT NULL DEFAULT 0,
  duration_minutes      integer
);

-- ---- quizzes ----
CREATE TABLE public.quizzes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     uuid UNIQUE NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  passing_score integer NOT NULL DEFAULT 70
);

-- ---- quiz_questions ----
CREATE TABLE public.quiz_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0
);

-- ---- quiz_options ----
-- sort_order ADDED for functions/quiz-options(-admin) ordering.
CREATE TABLE public.quiz_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  option_text text NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0   -- ADDED
);

-- ---- org_course_access ----
CREATE TABLE public.org_course_access (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  access     public.access_type NOT NULL DEFAULT 'enabled',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, course_id)
);

-- ---- enrollments ----
CREATE TABLE public.enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  status       public.enrollment_status NOT NULL DEFAULT 'enrolled',
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, user_id, course_id)
);

-- ---- lesson_progress ----
-- UNIQUE (org_id, user_id, lesson_id) backs the ON CONFLICT upsert in
-- functions/lesson-progress.
CREATE TABLE public.lesson_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  status       public.progress_status NOT NULL DEFAULT 'not_started',
  completed_at timestamptz,
  UNIQUE (org_id, user_id, lesson_id)
);

-- ---- quiz_attempts ----
CREATE TABLE public.quiz_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_id     uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  score       integer NOT NULL DEFAULT 0,
  passed      boolean NOT NULL DEFAULT false,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- ---- course_reviews ----
CREATE TABLE public.course_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  rating     integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, course_id)
);

-- ---- platform_settings ----
CREATE TABLE public.platform_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text UNIQUE NOT NULL,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

-- ---- org_settings ----
-- NOTE: Supabase modelled this with org_id as the PRIMARY KEY. The
-- generated types.ts exposes a separate `id` plus a UNIQUE org_id
-- (isOneToOne). We keep org_id as the PK (one settings row per org); a
-- standalone `id` is unnecessary and the frontend selects by org_id.
CREATE TABLE public.org_settings (
  org_id     uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  features   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

-- ---- community_categories ----
CREATE TABLE public.community_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  description   text,
  icon          text,
  is_restricted boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- community_posts ----
CREATE TABLE public.community_posts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                  public.community_scope NOT NULL,
  org_id                 uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id            uuid NOT NULL REFERENCES public.community_categories(id),
  title                  text NOT NULL,
  content                text NOT NULL,
  tags                   text[] DEFAULT '{}',
  is_pinned              boolean NOT NULL DEFAULT false,
  is_hidden              boolean NOT NULL DEFAULT false,
  is_locked              boolean NOT NULL DEFAULT false,
  event_date             timestamptz,
  event_location         text,
  event_registration_url text,
  event_recording_url    text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_scope_requires_org CHECK (
    (scope = 'global' AND org_id IS NULL) OR
    (scope = 'org'    AND org_id IS NOT NULL)
  )
);

-- ---- community_comments ----
CREATE TABLE public.community_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content           text NOT NULL,
  parent_comment_id uuid REFERENCES public.community_comments(id) ON DELETE CASCADE,
  is_hidden         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---- community_reports ----
CREATE TABLE public.community_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type      public.report_target_type NOT NULL,
  target_id        uuid NOT NULL,
  org_id           uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  reason           text NOT NULL,
  status           public.report_status NOT NULL DEFAULT 'pending',
  reviewed_by      uuid REFERENCES public.profiles(id),
  reviewed_at      timestamptz,
  admin_notes      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---- community_resources ----
CREATE TABLE public.community_resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  resource_type text NOT NULL DEFAULT 'link',   -- link, document, template, guide
  url           text,
  tags          text[] DEFAULT '{}'::text[],
  is_pinned     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- ai_champions ----
CREATE TABLE public.ai_champions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

-- ---- idea_categories ----
-- Present in the generated types.ts but NEVER created by a migration
-- (Supabase project drift). Reconstructed from types.ts so ideas.* and
-- the frontend can reference it.
CREATE TABLE public.idea_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  parent_id   uuid REFERENCES public.idea_categories(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- ideas ----
-- The migrations only ALTER `ideas` (Phase 1C) and add policies; the
-- CREATE never appears in supabase/migrations. Reconstructed from the
-- authoritative generated types.ts (full final column set).
CREATE TABLE public.ideas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id         uuid REFERENCES public.idea_categories(id),
  course_context_id   uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  lesson_context_id   uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  problem_statement   text,
  proposed_solution   text,
  expected_impact     text,
  status              public.idea_status NOT NULL DEFAULT 'draft',
  business_area       public.business_area,
  tags                text[] DEFAULT '{}',
  current_process     text,
  pain_points         text,
  affected_roles      text,
  frequency_volume    text,
  proposed_improvement text,
  desired_process     text,
  data_inputs         text,
  systems_involved    text,
  constraints_risks   text,
  success_metrics     text,
  admin_notes         text,
  rejection_reason    text,
  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---- idea_votes ----
CREATE TABLE public.idea_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id    uuid NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, user_id)
);

-- ---- idea_comments ----
CREATE TABLE public.idea_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id           uuid NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content           text NOT NULL,
  parent_comment_id uuid REFERENCES public.idea_comments(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---- idea_evaluations ----
-- From generated types.ts (no migration creates it). One row per idea
-- in practice; modelled with a plain id PK.
CREATE TABLE public.idea_evaluations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id               uuid NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  evaluated_by          uuid NOT NULL REFERENCES public.profiles(id),
  value_score           integer,
  complexity_score      integer,
  viability_assessment  text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ---- idea_specifications ----
-- From generated types.ts (no migration creates it).
CREATE TABLE public.idea_specifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id             uuid NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  created_by          uuid NOT NULL REFERENCES public.profiles(id),
  title               text NOT NULL,
  problem_definition  text,
  requirements        text,
  success_criteria    text,
  out_of_scope        text,
  dependencies        text,
  risks               text,
  estimated_effort    text,
  next_steps          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---- ai_conversations ----
-- From generated types.ts (no migration creates it). Stores chat
-- transcripts as jsonb. context_type is free-form text in the source.
CREATE TABLE public.ai_conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idea_id      uuid REFERENCES public.ideas(id) ON DELETE CASCADE,
  context_type text NOT NULL,
  context_id   uuid,
  messages     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- SECTION 3: INDEXES
-- (PKs / UNIQUE constraints above already create their own indexes.)
-- =====================================================================

-- profiles: Entra identity lookup (functions/user-context). Partial
-- UNIQUE so multiple NULL (not-yet-provisioned) rows are allowed.
CREATE UNIQUE INDEX idx_profiles_entra
  ON public.profiles (entra_oid, entra_tid)
  WHERE entra_oid IS NOT NULL;

-- community_posts
CREATE INDEX idx_community_posts_scope       ON public.community_posts (scope);
CREATE INDEX idx_community_posts_org_id      ON public.community_posts (org_id);
CREATE INDEX idx_community_posts_category_id ON public.community_posts (category_id);
CREATE INDEX idx_community_posts_user_id     ON public.community_posts (user_id);
CREATE INDEX idx_community_posts_created_at  ON public.community_posts (created_at DESC);
CREATE INDEX idx_community_posts_tags        ON public.community_posts USING GIN (tags);

-- community_comments
CREATE INDEX idx_community_comments_post_id ON public.community_comments (post_id);
CREATE INDEX idx_community_comments_user_id ON public.community_comments (user_id);
CREATE INDEX idx_community_comments_parent  ON public.community_comments (parent_comment_id);

-- community_reports (+ unique reporter/target guard)
CREATE INDEX idx_community_reports_status ON public.community_reports (status);
CREATE INDEX idx_community_reports_org_id ON public.community_reports (org_id);
CREATE INDEX idx_community_reports_target ON public.community_reports (target_type, target_id);
CREATE UNIQUE INDEX community_reports_unique_reporter_target
  ON public.community_reports (reporter_user_id, target_id, target_type);

-- ai_champions
CREATE INDEX idx_ai_champions_org_id  ON public.ai_champions (org_id);
CREATE INDEX idx_ai_champions_user_id ON public.ai_champions (user_id);

-- ideas
CREATE INDEX idx_ideas_tags          ON public.ideas USING GIN (tags);
CREATE INDEX idx_ideas_business_area ON public.ideas (business_area);

-- =====================================================================
-- SECTION 4: FUNCTIONS (PORTED FROM SUPABASE RPCs)
-- =====================================================================
-- Supabase had many SECURITY DEFINER RPCs whose sole purpose was RLS /
-- auth.uid() resolution. Those are DROPPED — authorization now lives in
-- the Azure Functions. The handful below are pure, reusable predicates
-- that the app may still call; each Supabase `auth.uid()` was replaced
-- with an explicit `p_user_id uuid` parameter.
--
-- OMITTED (re-implemented in app code, not ported):
--   is_platform_admin(), is_org_admin(), is_org_member(),
--   current_org_ids_for_user(), can_access_lms_asset(file_path) [implicit
--   auth.uid() variant], can_access_community_post(), get_post_org_id(),
--   can_post_restricted_category(), can_view_idea_admin_fields(),
--   get_invitation_by_token(), accept_invitation(),
--   get_org_invitations_safe(), get_platform_invitations_safe(),
--   get_quiz_options_for_learner(), get_quiz_options_with_answers(),
--   hash_invitation_token() trigger, handle_new_user() trigger.
-- See README for the full rationale + per-function notes.
-- =====================================================================

-- can_user_access_lms_asset(file_path, p_user_id):
-- already parameter-based in Supabase (used by edge functions). Ported
-- verbatim minus the `public.` qualifiers / search_path pragma.
CREATE OR REPLACE FUNCTION public.can_user_access_lms_asset(file_path text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_platform_admin = TRUE)
    OR EXISTS (
      SELECT 1
      FROM public.lessons l
      JOIN public.course_modules cm ON cm.id = l.module_id
      JOIN public.courses c ON c.id = cm.course_id
      JOIN public.org_course_access oca ON oca.course_id = c.id
      JOIN public.org_memberships om ON om.org_id = oca.org_id
      WHERE c.is_published = TRUE
        AND oca.access = 'enabled'
        AND om.user_id = p_user_id
        AND om.status = 'active'
        AND (l.video_storage_path = file_path
             OR l.document_storage_path = file_path
             OR l.azure_blob_path = file_path)
    )
    OR EXISTS (
      SELECT 1
      FROM public.courses c
      JOIN public.org_course_access oca ON oca.course_id = c.id
      JOIN public.org_memberships om ON om.org_id = oca.org_id
      WHERE c.is_published = TRUE
        AND oca.access = 'enabled'
        AND om.user_id = p_user_id
        AND om.status = 'active'
        AND c.thumbnail_url = file_path
    )
$$;

-- user_can_access_quiz(p_quiz_id, p_user_id):
-- Supabase used implicit auth.uid()/current_org_ids_for_user(); replaced
-- with an explicit p_user_id and an inline membership join.
CREATE OR REPLACE FUNCTION public.user_can_access_quiz(p_quiz_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_platform_admin = TRUE)
    OR EXISTS (
      SELECT 1
      FROM public.quizzes q
      JOIN public.lessons l ON l.id = q.lesson_id
      JOIN public.course_modules cm ON cm.id = l.module_id
      JOIN public.courses c ON c.id = cm.course_id
      JOIN public.org_course_access oca ON oca.course_id = c.id
      JOIN public.org_memberships om ON om.org_id = oca.org_id
      WHERE q.id = p_quiz_id
        AND c.is_published = TRUE
        AND oca.access = 'enabled'
        AND om.user_id = p_user_id
        AND om.status = 'active'
    )
$$;

-- get_invitation_link_id(invitation_id, p_user_id):
-- Supabase resolved the caller via auth.uid()/is_org_admin(); replaced
-- with explicit p_user_id and an inline org-admin membership check.
CREATE OR REPLACE FUNCTION public.get_invitation_link_id(invitation_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT i.link_id
  FROM public.invitations i
  WHERE i.id = invitation_id
    AND i.status = 'pending'
    AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND is_platform_admin = TRUE)
      OR (i.org_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.org_memberships om
            WHERE om.org_id = i.org_id AND om.user_id = p_user_id
              AND om.role = 'org_admin' AND om.status = 'active'))
    )
  LIMIT 1
$$;

-- =====================================================================
-- SECTION 5: TRIGGERS (updated_at maintenance — plain plpgsql)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_course_reviews_updated_at
  BEFORE UPDATE ON public.course_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_community_posts_updated_at
  BEFORE UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_community_comments_updated_at
  BEFORE UPDATE ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_community_resources_updated_at
  BEFORE UPDATE ON public.community_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ideas_updated_at
  BEFORE UPDATE ON public.ideas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_idea_comments_updated_at
  BEFORE UPDATE ON public.idea_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_idea_evaluations_updated_at
  BEFORE UPDATE ON public.idea_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_idea_specifications_updated_at
  BEFORE UPDATE ON public.idea_specifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- invitation token hashing: preserved as a plain trigger (was SECURITY
-- DEFINER in Supabase; no auth.uid() dependency, so kept). Keeps
-- token_hash in sync for lookups.
CREATE OR REPLACE FUNCTION public.hash_invitation_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.token_hash := encode(sha256(NEW.token::bytea), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hash_invitation_token
  BEFORE INSERT OR UPDATE OF token ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.hash_invitation_token();

COMMIT;
