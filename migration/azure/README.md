# Azure PostgreSQL 15 migration — learn-wings (AIR Academy LMS)

This folder contains a plain PostgreSQL 15 port of the app's database,
derived from the Supabase migration history (`supabase/migrations/*.sql`,
42 files, final state), reconciled against the generated DB types
(`src/integrations/supabase/types.ts`, the authoritative final column
sets) and the Azure Functions in `functions/*/index.ts` (the runtime
consumers).

| File | Purpose |
|------|---------|
| `01-schema.sql` | Types, tables, indexes, ported functions, triggers. Single `BEGIN/COMMIT`. |
| `02-seed.sql`   | Synthetic, FK-valid, end-to-end-usable seed data. Single `BEGIN/COMMIT`. |
| `03-seat-requests.sql` | Additive, idempotent migration for #127 (seat-request flow) — apply to prod directly. |
| `README.md`     | This file. |

Plain SQL only — no `psql` meta-commands (`\i`, `\dt`, …). PG15-compatible.
No Supabase schemas (`auth` / `storage` / `realtime`).

---

## What was stripped (and why)

| Stripped | Reason / replacement |
|----------|----------------------|
| **RLS** — every `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `DROP POLICY` | Authorization is enforced in app code by the Azure Functions. No RLS in this schema. |
| **`auth` schema** — `profiles.id REFERENCES auth.users`, `handle_new_user()` trigger on `auth.users`, `on_auth_user_created` | `profiles.id` is now `uuid PRIMARY KEY DEFAULT gen_random_uuid()`. Profiles are provisioned by `functions/user-context` on first Entra login. |
| **`auth.uid()` / `auth.role()` / `auth.jwt()`** | Dropped, or (for a few helpers) re-parameterized with an explicit `p_user_id uuid`. |
| **`storage.*`** — buckets, objects, storage policies (`lms-assets`, `org-logos`, `email-assets`) | Files live in Azure Blob Storage, accessed via SAS tokens by the `azure-*` functions. |
| **`supabase_realtime` publication, `GRANT`/`REVOKE` to `anon`/`authenticated`/`service_role`** | Not applicable to a plain Azure PG + app-tier-auth model. |
| **`uuid_generate_v4()` / `extensions.gen_random_bytes()`** | Replaced with `gen_random_uuid()` (built-in PG13+) and `gen_random_bytes()` (pgcrypto). |
| **`moddatetime` extension** | Never used; `updated_at` maintenance uses a plain plpgsql trigger (`set_updated_at`). |

### Extensions

Only **`pgcrypto`** is created (`CREATE EXTENSION IF NOT EXISTS pgcrypto`).
It is required for `gen_random_bytes()` (the `invitations.token` /
`link_id` defaults) and `sha256()` (the `hash_invitation_token` trigger),
and it is on the Azure Database for PostgreSQL Flexible Server
allow-list. `gen_random_uuid()` needs no extension on PG15. If your
server pre-allow-lists pgcrypto via `azure.extensions`, this statement is
a no-op.

---

## Added columns (the Entra delta + function-required columns)

These are not in the Supabase migrations but are required by the
consuming functions, so they were added to `profiles` / `quiz_options`:

| Column | Why |
|--------|-----|
| `profiles.entra_oid text` (nullable) | Entra object id. `functions/user-context` looks up / inserts by it; several functions resolve the caller via `WHERE entra_oid = $1`. |
| `profiles.entra_tid text` (nullable) | Entra tenant id. Used together with `entra_oid` in `user-context`. |
| `idx_profiles_entra` — `UNIQUE (entra_oid, entra_tid) WHERE entra_oid IS NOT NULL` | Partial unique so many not-yet-provisioned (NULL) rows can coexist; enforces one profile per Entra identity. |
| `profiles.email text` | Selected and inserted by `user-context`; selected by `org-analytics-data`. |
| `profiles.avatar_url text` | Selected and inserted by `user-context`. |
| `quiz_options.sort_order integer DEFAULT 0` | Selected/ordered by `quiz-options` and `quiz-options-admin`. |

> The exact `user-context` INSERT/SELECT was matched:
> `INSERT INTO profiles (full_name, email, entra_oid, entra_tid) … RETURNING id, full_name, email, is_platform_admin, avatar_url`
> and `SELECT id, full_name, email, is_platform_admin, avatar_url FROM profiles WHERE entra_oid = $1 AND entra_tid = $2`.
> All five returned columns plus the two lookup columns exist in the schema.

---

## Ported vs. omitted Supabase RPCs / triggers

### Ported (auth.uid() → explicit `p_user_id uuid`)

| Function | Note |
|----------|------|
| `can_user_access_lms_asset(file_path, p_user_id)` | Already parameter-based in Supabase; kept (minus `search_path`/`SECURITY DEFINER`). Covers video/document/azure_blob paths and course thumbnails. |
| `user_can_access_quiz(p_quiz_id, p_user_id)` | Supabase used implicit `auth.uid()` + `current_org_ids_for_user()`; replaced with explicit `p_user_id` and an inline membership join. |
| `get_invitation_link_id(invitation_id, p_user_id)` | Supabase resolved the caller via `auth.uid()`/`is_org_admin()`; replaced with explicit `p_user_id` + inline org-admin check. |

> These are convenience predicates. The functions in `functions/` mostly
> re-implement the same logic inline in their SQL, so the ported helpers
> are optional but kept because the port is trivial and they may be useful.

### Omitted (re-implemented in app code; not ported)

Dropped because they depend on `auth.uid()`/RLS and the Azure Functions
already perform the equivalent checks inline:

- `is_platform_admin()`, `is_org_admin(check_org_id)`, `is_org_member(check_org_id)`, `current_org_ids_for_user()`
- `can_access_lms_asset(file_path)` (implicit-`auth.uid()` variant; the parameterized `can_user_access_lms_asset` is kept)
- `can_access_community_post(p_post_id)`, `get_post_org_id(p_post_id)`, `can_post_restricted_category(scope, org_id)`, `can_view_idea_admin_fields(p_org_id)`
- `get_invitation_by_token(lookup_token)`, `accept_invitation(link_id, user_id)`
- `get_org_invitations_safe(p_org_id)`, `get_platform_invitations_safe(p_org_id)`
- `get_quiz_options_for_learner(p_question_id)`, `get_quiz_options_with_answers(p_question_id)`
- `hash_invitation_token()` — **kept** (no `auth.uid()`; plain trigger)
- `handle_new_user()` / `on_auth_user_created` — dropped (was on `auth.users`; replaced by `user-context` first-login provisioning)
- `quiz_options_public` view — dropped (was a learner-safe view; `quiz-options` excludes `is_correct` in app code)

---

## Completeness check: functions → tables/columns

Every table/column referenced in `functions/*/index.ts` SQL was verified
against `01-schema.sql`.

| Function | Tables / columns consumed | OK? |
|----------|---------------------------|-----|
| `user-context` | `profiles(id, full_name, email, is_platform_admin, avatar_url, entra_oid, entra_tid)`; `org_memberships(*, user_id, org_id, status)`; `organizations(*)` | ✅ |
| `admin-user-actions` | `profiles(is_platform_admin, id, entra_oid)`; `org_memberships(role, id, org_id, user_id, status)` | ✅ |
| `course-player-data` | `courses(*)`; `course_modules(course_id, sort_order)`; `lessons(module_id, sort_order)`; `lesson_progress(lesson_id, status, completed_at, user_id, org_id)`; `course_reviews(id, rating, comment, user_id, org_id, course_id)` | ✅ |
| `enrollment-complete` | `enrollments(status, completed_at, user_id, org_id, course_id)` | ✅ |
| `lesson-progress` | `lesson_progress(org_id, user_id, lesson_id, status, completed_at)` + `ON CONFLICT (org_id,user_id,lesson_id)` | ✅ (unique constraint present) |
| `grade-quiz` | `profiles(id, is_platform_admin)`; `quizzes(id, lesson_id, passing_score)`; `lessons(id, module_id)`; `course_modules(id, course_id)`; `courses(id, is_published)`; `org_course_access(course_id, access)`; `org_memberships(org_id, user_id, status)`; `quiz_questions(id, quiz_id, sort_order)`; `quiz_options(id, is_correct, question_id)`; `quiz_attempts(org_id, user_id, quiz_id, score, passed, finished_at)` | ✅ |
| `quiz-options` | `quiz_options(id, option_text, sort_order, question_id)` | ✅ (`sort_order` added) |
| `quiz-options-admin` | `profiles(is_platform_admin, entra_oid)`; `quiz_options(id, option_text, is_correct, sort_order, question_id)`; `quiz_questions(id, quiz_id, sort_order)` | ✅ (`sort_order` added) |
| `generate-certificate` | `enrollments(id, user_id, status, course_id, completed_at)`; `profiles(id, full_name, entra_oid)`; `courses(id, title)`; `organizations(id, name)`; `org_memberships(org_id, user_id, status)` | ✅ |
| `generate-compliance-report` | `profiles(entra_oid, is_platform_admin, id, department)`; `org_memberships(org_id, user_id, role, status)`; `organizations(id, name)`; `enrollments(status, org_id, user_id, course_id)`; `quiz_attempts(score, org_id, user_id)`; `org_course_access(course_id, org_id, access)`; `courses(id, title)` | ✅ |
| `org-analytics-data` | `profiles(entra_oid, is_platform_admin, id, full_name, email)`; `org_memberships(*, org_id, user_id, role, status)`; `enrollments(*, org_id, user_id)`; `quiz_attempts(*, user_id)`; `organizations(*)` | ✅ |
| `send-invitation-email` | `profiles(is_platform_admin, id, entra_oid)`; `org_memberships(user_id, role, status)` | ✅ |
| `test-smtp-connection` | `profiles(is_platform_admin, entra_oid)` | ✅ |
| `azure-upload-url` / `azure-document-upload-url` / `azure-delete-blob` | `profiles(is_platform_admin, id)` | ✅ |
| `azure-view-url` | `profiles(id, is_platform_admin)`; `lessons(module_id, video_storage_path, document_storage_path)`; `course_modules(id, course_id)`; `courses(id, is_published)`; `org_course_access(course_id, access, org_id)`; `org_memberships(org_id, user_id, status)` | ✅ |
| `invitation-link` | **`invitation_links(id, org_id, expires_at, created_at)`** | ⚠️ **FLAGGED — see below** |

### ⚠️ Flags from the completeness check

1. **`functions/invitation-link` references a table `invitation_links`
   that no migration ever creates** (and it is absent from the generated
   `types.ts`). The migrated schema models invitations in a single
   `invitations` table with a shareable `link_id` column — there is no
   separate `invitation_links` table. This function appears to query a
   non-existent table and would fail at runtime as written. **It is NOT
   created in `01-schema.sql`** — creating a speculative table would be
   guessing at columns the app never defined. Resolution options for the
   team: (a) fix the function to query `invitations` (e.g.
   `SELECT link_id AS id FROM invitations WHERE org_id = $1 AND status='pending' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`),
   or (b) define the intended `invitation_links` table. This is left to
   the app owners; it is a function bug, not a schema-port omission.

2. **Profile-id vs. entra-oid inconsistency in some functions.** Several
   functions resolve the caller via `profiles.entra_oid = $1` (correct:
   `$1` is the Entra `oid`), but `grade-quiz`, `azure-upload-url`,
   `azure-document-upload-url`, `azure-delete-blob`, and `azure-view-url`
   use `WHERE profiles.id = $1` / `om.user_id = $1` with the same Entra
   `oid` value. The schema supports both columns; whether those functions
   behave correctly is an app-logic concern, not a schema gap. Noted so
   the team is aware before go-live.

### Tables with no current function consumer (frontend-only)

Included for completeness (frontend uses them via the data layer):
`platform_settings`, `org_settings`, `community_categories`,
`community_posts`, `community_comments`, `community_reports`,
`community_resources`, `ai_champions`, `ai_conversations`,
`idea_categories`, `ideas`, `idea_votes`, `idea_comments`,
`idea_evaluations`, `idea_specifications`, `invitations`, `course_reviews`.

> `idea_categories`, `idea_evaluations`, `idea_specifications`, and
> `ai_conversations` exist in the generated `types.ts` but are **never
> created by any migration** (Supabase project drift). They were
> reconstructed here from `types.ts` so the frontend's references resolve.

---

## How to apply

### Option A — `psql`

```bash
# Order matters: schema first, then seed.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/01-schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/02-seed.sql
```

`DATABASE_URL` should be the Azure Flexible Server connection string the
functions already use, e.g.
`postgres://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/DBNAME?sslmode=require`.

### Option B — Node runner (same `pg` client the functions use)

```bash
node -e '
  const fs = require("fs");
  const { Client } = require("pg");
  (async () => {
    const c = new Client({
      connectionString: process.env.DATABASE_URL,
      // Mirrors functions/shared/db.ts. For production, prefer verifying
      // the Azure CA: ssl: { ca: fs.readFileSync("DigiCertGlobalRootCA.crt.pem") }
      ssl: { rejectUnauthorized: false },
    });
    await c.connect();
    for (const f of ["migration/azure/01-schema.sql", "migration/azure/02-seed.sql"]) {
      console.log("Applying", f);
      await c.query(fs.readFileSync(f, "utf8"));
    }
    await c.end();
    console.log("Done.");
  })().catch(e => { console.error(e); process.exit(1); });
'
```

Each file is a single transaction, so a failure rolls the whole file
back. Re-running on a populated DB will fail on duplicate keys — drop and
recreate the schema (or a fresh database) for a clean re-apply.

---

## Elevate your own profile to platform admin (after first Entra login)

The seed admin/learner have `entra_oid = NULL`. When **you** log in via
Entra for the first time, `functions/user-context` creates a *new*
profile row for your identity with `is_platform_admin = false`. To
promote yourself:

```sql
-- Replace with your real email (what user-context stored), or use entra_oid.
UPDATE public.profiles
SET is_platform_admin = true
WHERE email = 'you@yourcompany.com';

-- Alternatively, by Entra identity:
-- UPDATE public.profiles SET is_platform_admin = true
-- WHERE entra_oid = '<your-oid>' AND entra_tid = '<your-tid>';
```

To also make yourself an org admin of the seeded Test Org:

```sql
INSERT INTO public.org_memberships (org_id, user_id, role, status)
SELECT '11111111-1111-1111-1111-111111111111', id, 'org_admin', 'active'
FROM public.profiles WHERE email = 'you@yourcompany.com'
ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'org_admin', status = 'active';
```

---

## Fixed seed UUIDs

| Entity | UUID |
|--------|------|
| Organization (Test Org) | `11111111-1111-1111-1111-111111111111` |
| Profile — admin (platform admin) | `22222222-2222-2222-2222-222222222222` |
| Profile — learner | `33333333-3333-3333-3333-333333333333` |
| Membership — admin (org_admin) | `a1111111-1111-1111-1111-111111111111` |
| Membership — learner | `a2222222-2222-2222-2222-222222222222` |
| Course (AI Fundamentals, published) | `44444444-4444-4444-4444-444444444444` |
| Module — Getting Started | `51111111-1111-1111-1111-111111111111` |
| Module — Assessment | `52222222-2222-2222-2222-222222222222` |
| Lesson — Welcome Video (video, fake blob) | `61111111-1111-1111-1111-111111111111` |
| Lesson — Course Handbook (document) | `62222222-2222-2222-2222-222222222222` |
| Lesson — Key Concepts (text) | `63333333-3333-3333-3333-333333333333` |
| Lesson — Knowledge Check (quiz) | `64444444-4444-4444-4444-444444444444` |
| Quiz | `71111111-1111-1111-1111-111111111111` |
| Question 1 / 2 / 3 | `81111111-…` / `82222222-…` / `83333333-…` |
| Org course access | `a4444444-4444-4444-4444-444444444444` |
| Enrollment (learner) | `e4444444-4444-4444-4444-444444444444` |
| Quiz attempt (learner, 67%, failed) | `a7777777-7777-7777-7777-777777777777` |
| Community post | `b1111111-1111-1111-1111-111111111111` |
| Community comment | `b2222222-2222-2222-2222-222222222222` |
| Idea | `d1111111-1111-1111-1111-111111111111` |
| Idea vote / comment | `d2222222-…` / `d3333333-…` |
| Community resource | `f1111111-1111-1111-1111-111111111111` |
| Invitation (pending) | `c2222222-2222-2222-2222-222222222222` |
| AI champion (learner) | `aac11111-1111-1111-1111-111111111111` |

---

## Summary

- **Tables:** 31 (`organizations, profiles, org_memberships, invitations,
  courses, course_modules, lessons, quizzes, quiz_questions, quiz_options,
  org_course_access, enrollments, lesson_progress, quiz_attempts,
  course_reviews, platform_settings, org_settings, community_categories,
  community_posts, community_comments, community_reports,
  community_resources, ai_champions, ai_conversations, idea_categories,
  ideas, idea_votes, idea_comments, idea_evaluations,
  idea_specifications, seat_requests`).
- **Enums:** 13 (incl. the fully-expanded `idea_status` and `seat_request_status`).
- **Ported RPCs:** 3 (`can_user_access_lms_asset`, `user_can_access_quiz`,
  `get_invitation_link_id`) — all auth.uid() → `p_user_id`.
- **Kept trigger fn:** `set_updated_at` (11 triggers) + `hash_invitation_token`.
- **Dropped:** all RLS/policies, all `auth.*`, all `storage.*`,
  realtime/grants, ~15 auth-only RPCs, `handle_new_user`,
  `quiz_options_public` view.
- **Flag:** `functions/invitation-link` queries a non-existent
  `invitation_links` table (function bug; table intentionally not
  fabricated). Minor profile-id-vs-entra_oid inconsistencies noted in a
  few functions.
