# Multilingual course identity + combined analytics — design

- **Issue:** #213
- **Date:** 2026-07-22
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Builds on:** #191 / PR #192 (per-course `language` field + language-filtered learner catalog)
- **Out of scope:** #187 (translating course *content*)

## Problem

`courses` carries one `language` per row (`'en' | 'da' | NULL`, added in #191) and no way to
express that two rows are **the same course in two languages**. As a result, org-admin progress
analytics (`org-course-progress` → `CourseProgressTab`) list a Danish and an English edition as
two independent rows. An org with 10 English + 10 Danish learners who have all finished "AI Basics"
shows two "50% complete" lines instead of one "100% complete" line.

## Goal

Let an admin mark two courses as the same course in different languages, and combine linked
editions into a single line in progress analytics. Concretely, for the example above the admin sees
one row: **"AI Basics — 20 enrolled, 20 completed (100%)"**.

## Scope decision (approved)

Merging is a **reporting + enrollment-integrity** concern only — it does **not** change what learners
see or how they take a course.

- **Learners: unchanged.** A Danish learner only sees and enrolls in the Danish edition; the English
  edition stays invisible (this is already #191's behavior). No change to the learner catalog,
  publishing, or `org_course_access` visibility.
- **New for admins:**
  1. A linking system to mark two courses as language editions of one another.
  2. Progress analytics combine linked editions into one line.
  3. Enrolling a learner into one edition is blocked if they are already enrolled in a sibling
     edition. The guard is enforced in **application code** (a per-org `EXISTS` check before
     insert), *not* a DB constraint, so a residual race or a link-after-both-populated edge could
     still leave a learner in two editions. Combined progress analytics therefore count **DISTINCT
     learners**, so such an edge can never inflate the numbers.

### Explicit non-goals

- Translating course **content** (lessons/text) — that is #187.
- Learner-facing collapsing of editions into one card, single sign-up across languages, shared
  progress across languages, or per-group publishing/visibility. None of these are built; each
  edition remains an independent course for everything except analytics and the enrollment guard.
- No data migration: pre-launch mock data; existing courses simply start ungrouped (standalone).

## The model: a shared group tag (approach ①)

Add one nullable column to `courses`:

```
course_group_id uuid NULL
```

- Two courses with the **same** `course_group_id` are editions of the same course. Neither is
  "primary" — editions are equal siblings.
- `course_group_id IS NULL` = standalone course (its own implicit group of one). Every existing
  course starts here, so ungrouped behavior is identical to today.
- No foreign key — the column is a shared grouping tag, not a reference to a course row.

**Indexes**

- `CREATE INDEX ON courses (course_group_id)` — grouping/lookup.
- `CREATE UNIQUE INDEX ON courses (course_group_id, language) WHERE course_group_id IS NOT NULL`
  — enforces **at most one edition per language per group**. (App-level rule additionally requires a
  course to have a non-NULL `language` before it can be linked, since the partial index treats NULL
  languages as distinct.)

**Group key for aggregation:** `COALESCE(course_group_id, id)` — standalone courses group by their
own id (unchanged behavior); linked editions collapse to one key.

Rejected alternatives: a self-referential `translation_of` FK (imposes an unwanted "original"
hierarchy; awkward delete/unpublish of the original; multi-level chains to guard) and a dedicated
`course_groups` table (a first-class group entity with no group-level data to store — approach ①
plus an unused table/join). Both add machinery for no functional gain here.

## Linking system (admin UX)

Lives on the **course edit screen** (`CourseEditor.tsx`), a new **"Language editions"** section
beside the existing language selector.

- Lists the currently-linked editions (title + language badge), each with an **Unlink** button.
- A **"Link another course"** picker attaches an eligible course. Eligibility rules:
  - The candidate must have a `language` set and **different** from every language already in the
    group (a group can't hold two editions of the same language — the picker excludes conflicts).
  - The candidate must not already belong to another group. To keep the model simple there is **no
    group-merging**: a course must be unlinked before it can be re-linked elsewhere.
  - A course can't link to itself.
  - Publish state does **not** gate linking — two drafts, or a draft and a published edition, can be
    linked (linking is an authoring concern, independent of `is_published`).
- **Link** sets a shared `course_group_id` on both courses (generate a fresh uuid if neither is yet
  grouped; otherwise the candidate joins the existing group's id).
- **Unlink** clears `course_group_id` on the selected edition. If unlinking leaves a single edition
  in the group, that remaining course's `course_group_id` is also cleared (a group of one is
  meaningless — it reverts to standalone).

**Endpoint:** a dedicated admin-only `course-translation-link` endpoint handling `link` and `unlink`
actions with the validation above, rather than overloading `course-update` (keeps the whitelist
field-map update path simple and the group-integrity rules in one place). Registered in
`functions/index.ts`.

## Combined analytics

Applies wherever a course row appears in progress analytics:

- `org-course-progress` — the course list (single-org **and** platform-admin "All Organizations"
  branch).
- `org-course-enrollees` — the enrollee drill-in list.
- `org-course-org-breakdown` — the per-org breakdown table in the all-orgs course dialog.

### Combining rule

Rows are grouped by `COALESCE(course_group_id, id)`. Within a group, `enrolled` and `completed`
count **distinct learners** across all editions (`COUNT(DISTINCT user_id)`). Standalone courses
(NULL group) are unaffected — they group by their own id exactly as today.

The enroll guard blocks a learner from holding two editions in one org, but it is enforced in
application code (a per-org `EXISTS` check before insert), not a DB constraint — so a residual race
or a link-after-both-populated edge could still leave that state. Counting distinct learners in
**every** branch (single-org, per-org breakdown, and all-orgs) makes the combined line a true
head-count regardless: an edge-case double-enrollment can never inflate it. (The all-orgs branch
already needed `COUNT(DISTINCT user_id)` independently — a learner enrolled in different editions
across two *different* orgs is one person and must count once.)

### Which edition represents the line (title + level) — Option A

The visible title and level come from **the edition matching the admin's own app language**
(a Danish admin sees the Danish edition's title; an English admin sees the English edition's title).
If the group has no edition in the admin's language *among the editions relevant to this view*
(access-enabled for the org in single-org view; enabled anywhere in all-orgs view), fall back
deterministically to the **earliest-created** edition (`ORDER BY created_at ASC, id ASC`).

Implementation sketch: over the same edition set the view sums (the group's editions included in
this view — access-enabled for the org in single-org, enabled anywhere in all-orgs), rank editions
with
`ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY (language = :adminLang) DESC, created_at ASC, id ASC)`
and take rank 1 for the representative `id`, `title`, `level`, while summing `enrolled`/`completed`
over that same set. `org-course-progress` gains an `adminLang` request field (the caller's
`i18n.resolvedLanguage`, mirroring how `learner-courses` already accepts `language`; invalid/missing
defaults to `'da'`, matching `learner-courses`).

A group appears in a single-org view if **any** of its editions is access-enabled for that org.

### Drill-in

Clicking the combined line lists **all enrollees across every edition of the group** together.
The frontend passes the representative course id; `org-course-enrollees` (and
`org-course-org-breakdown`) resolve that id's group and include all its editions. No learner appears
twice (guaranteed by the enrollment guard within an org; the existing all-orgs de-dup by learner
handles the cross-org case).

The optional per-row "DA / EN" edition tag is **not** included (kept off for cleanliness); it can be
added later if admins want to see which edition each learner took.

## Enrollment guard ("can't enroll in both")

A shared helper (`functions/shared/course-groups.ts`) resolves the sibling course ids for a given
course (the other editions sharing its `course_group_id`; empty for standalone courses).

Enforced in **both** enrollment paths:

- `enroll` (learner self-enroll)
- `enrollment-create` (org-admin "Enroll User" dialog)

Before inserting, if the target learner already has an enrollment in a **sibling edition within the
same org**, reject with `409` and a clear message: *"Already enrolled in this course in another
language."* Standalone courses have no siblings, so their behavior is unchanged. The guard is
per-org, matching how enrolments are scoped (`UNIQUE(org_id, user_id, course_id)`); a learner who
belongs to two orgs and enrolls in different editions across them is one distinct person and is
handled by the all-orgs analytics de-dup.

Note this is an **application-code** guard — a read-then-insert `EXISTS` check, *not* a DB
constraint (`course-translation-link` also does not block linking two already-populated editions).
A small TOCTOU window and the link-after-both-populated edge therefore mean the "enrolled in both"
state is not impossible at the data level. This is acceptable because combined analytics count
**DISTINCT learners** in every branch (single-org, per-org breakdown, and all-orgs), so a residual
race or a link-after-enroll edge can never inflate the numbers.

## Affected surfaces

**Schema**
- `migration/azure/01-schema.sql` — `course_group_id` column + the two indexes.

**Backend (`functions/`)**
- `shared/course-groups.ts` (new) — sibling-resolution + group-key helpers.
- `course-translation-link/` (new) — link/unlink with validation.
- `enroll/`, `enrollment-create/` — sibling-edition guard.
- `org-course-progress/` — group-aware aggregation + representative selection + `adminLang` field.
- `org-course-enrollees/`, `org-course-org-breakdown/` — expand a course id to its group.
- `index.ts` — register the new endpoint.

**Frontend (`src/`)**
- `lib/types.ts` — `Course.course_group_id: string | null`.
- `pages/platform-admin/CourseEditor.tsx` — "Language editions" link/unlink section.
- `hooks/useOrgCourseProgress.ts` — pass the admin's language.
- `hooks/useOrgCourseEnrollees.ts`, `hooks/useOrgCourseOrgBreakdown.ts` — unchanged call shape
  (still keyed by the representative course id); verify query keys.
- `components/org-admin/analytics/CourseProgressTab.tsx` — renders whatever rows the endpoint
  returns; no structural change expected.
- `i18n/locales/en.json`, `da.json` — "Language editions", link/unlink labels, the enroll-blocked
  message.

## Testing

Follows the repo's existing per-endpoint test patterns.

- **Backend**
  - `org-course-progress`: two linked editions collapse to one summed line; standalone courses
    unchanged; representative selection picks the admin-language edition, and falls back to
    earliest-created when the admin-language edition is absent; the example (10 EN + 10 DA, all
    complete → one 20/20 line) holds in both the single-org and all-orgs branches.
  - `course-translation-link`: link sets a shared tag; same-language link rejected; linking an
    already-grouped course rejected; unlink clears the tag and collapses a leftover group-of-one.
  - `enroll` / `enrollment-create`: enrolling into a sibling edition is rejected (409); first
    enrolment and standalone courses still succeed.
  - `org-course-enrollees` / `org-course-org-breakdown`: return enrollees/breakdown across all
    editions of a group.
- **Frontend**
  - `CourseProgressTab` renders one combined row for a linked pair.
  - `CourseEditor` link/unlink flow; same-language candidate is not offered.

## Open questions

None blocking. Deferred/decided:
- Per-row DA/EN tag in the drill-in — decided **off** (can revisit).
- Prod DB apply of the additive schema change is a human-gated follow-up (pre-launch, mock data —
  not blocking; canonical `01-schema.sql` is the source of truth).
- Hard DB-level prevention of the double-enrolled state (e.g. a `course-translation-link` link-time
  check that two already-populated editions can't be linked, or a group-scoped uniqueness guard) is
  a **deferred** item — the enroll guard is app-level and combined analytics count DISTINCT learners,
  so the residual race is harmless pre-launch (mock data).
