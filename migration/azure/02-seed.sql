-- =====================================================================
-- learn-wings (AIR Academy LMS) — synthetic seed (Azure PostgreSQL 15)
-- =====================================================================
-- Minimal but end-to-end usable data set. All FKs are valid. Fixed
-- (literal) UUIDs so the README and manual testing can reference rows.
-- Apply AFTER 01-schema.sql. Wrapped in a single transaction.
--
-- The two real-login profiles have entra_oid / entra_tid = NULL. Real
-- users self-provision via functions/user-context on first Entra login.
-- See README "Elevate yourself to platform admin" to promote your own
-- row after first login.
--
-- FIXED UUID REFERENCE (see README for the full table):
--   Org                 11111111-1111-1111-1111-111111111111
--   Admin profile       22222222-2222-2222-2222-222222222222
--   Learner profile     33333333-3333-3333-3333-333333333333
--   Course              44444444-4444-4444-4444-444444444444
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, slug, seat_limit) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Org', 'test-org', 50);

-- ---------------------------------------------------------------------
-- Profiles (entra_oid/entra_tid NULL — real logins self-provision)
-- ---------------------------------------------------------------------
INSERT INTO public.profiles (id, full_name, first_name, last_name, department, email, is_platform_admin, preferred_language) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Admin User',   'Admin',   'User',   'IT',         'admin@test-org.example',   true,  'en'),
  ('33333333-3333-3333-3333-333333333333', 'Learner User', 'Learner', 'User',   'Operations', 'learner@test-org.example', false, 'en');

-- ---------------------------------------------------------------------
-- Memberships (admin = org_admin, learner = member/learner) — active
-- ---------------------------------------------------------------------
INSERT INTO public.org_memberships (id, org_id, user_id, role, status) VALUES
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'org_admin', 'active'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'learner',   'active');

-- ---------------------------------------------------------------------
-- Org settings (feature overrides; empty {} = inherit platform defaults)
-- ---------------------------------------------------------------------
INSERT INTO public.org_settings (org_id, features) VALUES
  ('11111111-1111-1111-1111-111111111111', '{}'::jsonb);

-- ---------------------------------------------------------------------
-- Course -> 2 modules -> 4 lessons (video / document / quiz / text)
-- ---------------------------------------------------------------------
INSERT INTO public.courses (id, title, description, level, language, is_published, created_by_user_id) VALUES
  ('44444444-4444-4444-4444-444444444444', 'AI Fundamentals',
   'An introductory course covering AI basics and responsible use.',
   'basic', 'da', true, '22222222-2222-2222-2222-222222222222');

INSERT INTO public.course_modules (id, course_id, title, sort_order) VALUES
  ('51111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'Getting Started', 0),
  ('52222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', 'Assessment',      1);

INSERT INTO public.lessons (id, module_id, title, lesson_type, content_text, azure_blob_path, document_storage_path, sort_order, duration_minutes) VALUES
  -- video lesson with a fake Azure blob path
  ('61111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', 'Welcome Video',     'video',    NULL, 'videos/welcome-1234abcd.mp4', NULL,                         0, 5),
  -- document lesson
  ('62222222-2222-2222-2222-222222222222', '51111111-1111-1111-1111-111111111111', 'Course Handbook',   'document', NULL, NULL,                          'documents/handbook-5678efgh.pdf', 1, 10),
  -- plain text lesson
  ('63333333-3333-3333-3333-333333333333', '51111111-1111-1111-1111-111111111111', 'Key Concepts',      'document', 'AI augments human work; always keep a human in the loop.', NULL, NULL, 2, 8),
  -- quiz lesson (backs the quiz below)
  ('64444444-4444-4444-4444-444444444444', '52222222-2222-2222-2222-222222222222', 'Knowledge Check',   'quiz',     NULL, NULL,                          NULL,                         0, 5);

-- ---------------------------------------------------------------------
-- Quiz -> 3 questions x 4 options (exactly one is_correct each)
-- ---------------------------------------------------------------------
INSERT INTO public.quizzes (id, lesson_id, passing_score) VALUES
  ('71111111-1111-1111-1111-111111111111', '64444444-4444-4444-4444-444444444444', 70);

INSERT INTO public.quiz_questions (id, quiz_id, question_text, sort_order) VALUES
  ('81111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111', 'What does AI stand for?',                       0),
  ('82222222-2222-2222-2222-222222222222', '71111111-1111-1111-1111-111111111111', 'What is a recommended practice when using AI?', 1),
  ('83333333-3333-3333-3333-333333333333', '71111111-1111-1111-1111-111111111111', 'Which is an example of generative AI?',         2);

-- Q1 options
INSERT INTO public.quiz_options (id, question_id, option_text, is_correct, sort_order) VALUES
  ('91111111-0001-0001-0001-000000000001', '81111111-1111-1111-1111-111111111111', 'Artificial Intelligence',  true,  0),
  ('91111111-0001-0001-0001-000000000002', '81111111-1111-1111-1111-111111111111', 'Automated Input',          false, 1),
  ('91111111-0001-0001-0001-000000000003', '81111111-1111-1111-1111-111111111111', 'Analog Interface',         false, 2),
  ('91111111-0001-0001-0001-000000000004', '81111111-1111-1111-1111-111111111111', 'Active Iteration',         false, 3);
-- Q2 options
INSERT INTO public.quiz_options (id, question_id, option_text, is_correct, sort_order) VALUES
  ('92222222-0002-0002-0002-000000000001', '82222222-2222-2222-2222-222222222222', 'Keep a human in the loop',           true,  0),
  ('92222222-0002-0002-0002-000000000002', '82222222-2222-2222-2222-222222222222', 'Trust every output blindly',         false, 1),
  ('92222222-0002-0002-0002-000000000003', '82222222-2222-2222-2222-222222222222', 'Never review results',               false, 2),
  ('92222222-0002-0002-0002-000000000004', '82222222-2222-2222-2222-222222222222', 'Skip data privacy considerations',   false, 3);
-- Q3 options
INSERT INTO public.quiz_options (id, question_id, option_text, is_correct, sort_order) VALUES
  ('93333333-0003-0003-0003-000000000001', '83333333-3333-3333-3333-333333333333', 'A spreadsheet sum formula',  false, 0),
  ('93333333-0003-0003-0003-000000000002', '83333333-3333-3333-3333-333333333333', 'A large language model',     true,  1),
  ('93333333-0003-0003-0003-000000000003', '83333333-3333-3333-3333-333333333333', 'A barcode scanner',          false, 2),
  ('93333333-0003-0003-0003-000000000004', '83333333-3333-3333-3333-333333333333', 'A calculator',               false, 3);

-- ---------------------------------------------------------------------
-- Org course access (enable the course for the org)
-- ---------------------------------------------------------------------
INSERT INTO public.org_course_access (id, org_id, course_id, access) VALUES
  ('a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'enabled');

-- ---------------------------------------------------------------------
-- Learner enrollment + lesson progress + a quiz attempt
-- ---------------------------------------------------------------------
INSERT INTO public.enrollments (id, org_id, user_id, course_id, status) VALUES
  ('e4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'enrolled');

INSERT INTO public.lesson_progress (id, org_id, user_id, lesson_id, status, completed_at) VALUES
  ('ef111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '61111111-1111-1111-1111-111111111111', 'completed',   now()),
  ('ef222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '62222222-2222-2222-2222-222222222222', 'in_progress', NULL);

INSERT INTO public.quiz_attempts (id, org_id, user_id, quiz_id, score, passed, finished_at) VALUES
  ('a7777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '71111111-1111-1111-1111-111111111111', 67, false, now());

-- ---------------------------------------------------------------------
-- Platform settings — every key the frontend reads, with the full value
-- shapes from src/hooks/usePlatformSettings.tsx and
-- src/pages/platform-admin/PlatformSettings.tsx (superset of the
-- migrations' original defaults).
-- ---------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value) VALUES
  ('branding', '{
     "platform_name": "AIR Academy",
     "primary_color": "#6366f1",
     "accent_color": "#10b981",
     "sidebar_primary_color": "#10b981",
     "sidebar_accent_color": "#1f2937",
     "logo_url": null,
     "favicon_url": null
   }'::jsonb),
  ('user_access', '{
     "default_role": "learner",
     "require_email_verification": false,
     "allow_self_registration": true
   }'::jsonb),
  ('email', '{
     "from_name": "AIR Academy",
     "from_email": null,
     "smtp_configured": false,
     "smtp_host": "",
     "smtp_port": 587,
     "smtp_username": "",
     "smtp_password": "",
     "smtp_encryption": "starttls"
   }'::jsonb),
  ('features', '{
     "certificates_enabled": true,
     "quizzes_enabled": true,
     "analytics_enabled": true,
     "course_reviews_enabled": false,
     "community_enabled": true,
     "exercises_enabled": false
   }'::jsonb);

-- ---------------------------------------------------------------------
-- Seat pricing (issue #127) — price starts unset; platform admin sets it
-- before the request flow is usable.
-- ---------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES ('seat_pricing', '{"annual_price_per_seat": null, "currency": "DKK", "notification_email": "jacob@ai-raadgivning.dk"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Community categories — the migrations' default set, MINUS the two
-- later removed by migration ("ideas-opportunities" and
-- "resources-templates"). These match the final migrated state.
-- ---------------------------------------------------------------------
INSERT INTO public.community_categories (id, name, slug, description, icon, is_restricted, sort_order) VALUES
  ('c1111111-0000-0000-0000-000000000002', 'Challenges / Obstacles', 'challenges-obstacles', 'Discuss challenges you are facing',           'AlertTriangle', false, 2),
  ('c1111111-0000-0000-0000-000000000003', 'Risks & Mitigation',     'risks-mitigation',     'Identify risks and mitigation strategies',    'Shield',        false, 3),
  ('c1111111-0000-0000-0000-000000000004', 'Questions & Help',       'questions-help',       'Ask questions and get help from the community','HelpCircle',    false, 4),
  ('c1111111-0000-0000-0000-000000000005', 'Wins / Learnings',       'wins-learnings',       'Share your successes and lessons learned',    'Trophy',        false, 5),
  ('c1111111-0000-0000-0000-000000000007', 'Announcements',          'announcements',        'Important announcements from admins',          'Megaphone',     true,  7),
  ('c1111111-0000-0000-0000-000000000008', 'Events / Office Hours',  'events',               'Upcoming events, webinars, and office hours',  'Calendar',      true,  8);

-- ---------------------------------------------------------------------
-- Community: 1 org-scoped post + 1 comment
-- ---------------------------------------------------------------------
INSERT INTO public.community_posts (id, scope, org_id, user_id, category_id, title, content, tags) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'org', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 'c1111111-0000-0000-0000-000000000004',
   'How do I get started with the AI Fundamentals course?',
   'I just enrolled — any tips on where to begin?', ARRAY['getting-started','help']);

INSERT INTO public.community_comments (id, post_id, user_id, content) VALUES
  ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'Start with the Welcome Video, then the handbook. Welcome aboard!');

-- ---------------------------------------------------------------------
-- Ideas: 1 idea (+1 vote, +1 comment)
-- ---------------------------------------------------------------------
INSERT INTO public.ideas (id, org_id, user_id, title, description, problem_statement, proposed_solution, status, business_area, tags) VALUES
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333',
   'Automate weekly status reports',
   'Use AI to draft the weekly operations status report from raw data.',
   'Compiling the weekly report by hand takes 2+ hours every Friday.',
   'Generate a first draft automatically and have a human review it.',
   'submitted', 'ops', ARRAY['automation','reporting']);

INSERT INTO public.idea_votes (id, idea_id, org_id, user_id) VALUES
  ('d2222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.idea_comments (id, idea_id, org_id, user_id, content) VALUES
  ('d3333333-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Great idea — we could pilot this next sprint.');

-- ---------------------------------------------------------------------
-- Community resource (org-scoped)
-- ---------------------------------------------------------------------
INSERT INTO public.community_resources (id, org_id, user_id, title, description, resource_type, url, tags) VALUES
  ('f1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'Responsible AI Checklist',
   'A short checklist to review before deploying any AI workflow.',
   'link', 'https://example.com/responsible-ai-checklist', ARRAY['guide','governance']);

-- ---------------------------------------------------------------------
-- Invitation (pending) — org-scoped learner invite
-- token / token_hash / link_id are filled by defaults + trigger.
-- ---------------------------------------------------------------------
INSERT INTO public.invitations (id, org_id, email, role, status, invited_by_user_id, first_name, last_name, department) VALUES
  ('c2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'invitee@test-org.example', 'learner', 'pending',
   '22222222-2222-2222-2222-222222222222', 'New', 'Invitee', 'Sales');

-- ---------------------------------------------------------------------
-- AI Champions: the learner is the org's AI champion
-- ---------------------------------------------------------------------
INSERT INTO public.ai_champions (id, user_id, org_id, assigned_by) VALUES
  ('aac11111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

COMMIT;
