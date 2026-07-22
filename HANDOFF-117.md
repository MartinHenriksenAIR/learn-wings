# HANDOFF — Onboarding assessment flow (#117)

> **Throwaway working doc** (per `AGENTS.md` documentation policy: handovers are ephemeral).
> **Worker session: delete this file in the final commit of PR #219, once the spec is consumed.**
> It must not exist on the branch when the PR is undrafted.

**Status: spec locked** (grilled + content-designed + UI-prototyped 2026-07-22). This branch is claimed by PR #219; implementation happens in a fresh worker session against this brief. Nothing below is open for redesign — questions about gaps are fine, re-litigating locked decisions is not.

## What & why

A 7-question self-assessment gauging a learner's AI-usage level, shown at login. Purpose: (1) recommend courses matching the learner's level (`courses.level` already exists: `basic|intermediate|advanced`), (2) give admins an AI-maturity distribution + per-user level dimension in analytics (Martin's spec: correlate user "types" with activity).

## Locked decisions

1. **Authoring:** questionnaire is fixed content shipped in code. Only responses touch the DB.
2. **Audience:** learners only. Org admins and platform admins (including platform admins in learner view-mode) are never prompted and never counted.
3. **Trigger:** full-screen assessment step after login for any learner without a completed assessment. Skippable ("Spring over indtil videre").
4. **Skip cadence:** the full-screen prompt appears **once ever** — skip is recorded server-side. Afterwards only a persistent dashboard banner nudges (no dismiss control on the banner; it stays until completion — the prototype's "Senere" button on the banner is dropped for this reason).
5. **Scoring:** sum of option points (each option carries its ladder position 0–3), total 0–21, mapped server-side: **basic 0–7, intermediate 8–14, advanced 15–21**. Client never computes or submits a level.
6. **Raw answers** stored per attempt (jsonb), for future aggregate analytics.
7. **Content direction — recommend, never hide:** Courses page gets an "Anbefalet til dig" section on top (level-matched courses, "Anbefalet" chip), full catalog below, visibility rules untouched. Result screen lists level-matched courses ("Start her – udvalgt til dit niveau").
8. **Analytics:** org analytics gains a segmented level-distribution bar (basic/intermediate/advanced/not-assessed) + an "AI-niveau" column on the per-user table — org-admin view and platform all-orgs view. **Scope: active members with role `learner` only** (admins are never prompted, so counting them would permanently inflate "not assessed").
9. **Retakes:** "Tag vurderingen igen" in Settings. Every submission is a new attempt row; current level = latest attempt.
10. **Privacy:** admin UI shows computed level only. Raw answers are never exposed by any endpoint or UI. Settings card carries the privacy note (see i18n strings in prototype: "Kun dit niveau er synligt for administratorer – aldrig dine svar").
11. **Naming rule:** the `LevelBadge` chip always speaks the **course scale** (`courses.levels.*` — Begynder/Øvet/Avanceret) everywhere, including the analytics legend/column. The **persona names** (Udforsker / Hverdagsbruger / Superbruger — en: Explorer / Everyday user / Superuser) appear **only** as the friendly headline + blurb on the learner's result screen.
12. **Wizard behavior:** explicit "Næste" button (enabled after selection) — **no auto-advance**. Entrance animation fires only on question change, never on answer selection/re-render.

## Questionnaire content (FINAL — ship verbatim)

Single-choice, 4 options each, option points = ladder position (0/1/2/3). `questionnaire_version: 'v1'`.

| # | question id | option ids (pts 0→3) |
|---|---|---|
| 1 | `usage-frequency` | `never`, `tried-a-few-times`, `weekly`, `daily` |
| 2 | `task-breadth` | `nothing-yet`, `one-task-type`, `a-few-task-types`, `many-task-types` |
| 3 | `tool-range` | `none`, `one`, `two-to-three`, `four-plus` |
| 4 | `iteration-behavior` | `not-there-yet`, `accept-or-do-myself`, `rephrase-and-retry`, `iterate-with-context` |
| 5 | `workflow-integration` | `not-part-of-day`, `now-and-then`, `fixed-part-of-tasks`, `woven-into-most` |
| 6 | `self-sufficiency` | `no-idea-where-to-start`, `need-help-or-guide`, `figure-it-out-myself`, `colleagues-ask-me` |
| 7 | `advanced-features` | `plain-chat-only`, `tried-a-couple`, `use-some-regularly`, `build-my-own` |

**All da+en display strings** (question text, all 28 options, 3 persona names, 3 result blurbs) are final and live in the prototype's `QUESTIONS`, `LEVELS` and `T` data blocks — copy the *strings* from there into i18n keys verbatim (strings yes, code no; see "UI spec" below). Danish is primary.

## Architecture (agreed)

**DB — `migration/azure/04-assessment.sql`** (idempotent, single transaction, pattern of `03-seat-requests.sql`):
- `assessment_attempts(id uuid PK, user_id uuid → profiles, score int, level public.course_level, answers jsonb, questionnaire_version text, created_at timestamptz)`.
- `profiles` gains `assessment_level public.course_level NULL` (denormalized latest, so reads don't join attempts) and `assessment_skipped_at timestamptz NULL`.
- Level is **global per-user**, not per-org.

**Backend — server owns structure and scoring.** Question/option IDs, points, thresholds, version in `functions/shared/assessment-questions.ts`. Endpoints via the ADR-0015 factory:
- `assessment-questions` (any authed): returns question/option ID structure (order included; no points — they're server business).
- `assessment-submit` (any authed): validates the answer set covers **exactly** the expected question IDs with known option IDs (else 400), computes score+level, inserts attempt, updates `profiles.assessment_level`, returns `{score, level}`.
- `assessment-skip` (any authed): sets `assessment_skipped_at` (idempotent).
- `user-context`: additively returns `assessment_level` and `assessment_skipped_at` (drives the routing predicate + Settings card).
- Analytics: extend `org-analytics-data` (and the per-user table's endpoint) **additively** with per-member `assessment_level`. **Do NOT add `assessment_level` to the shared `profileJson()` fragment** — that would leak it to community surfaces; it belongs only in admin analytics payloads.
- Course recommendation needs **no backend change** — the frontend sorts/sections using `assessment_level` (user-context) vs `course.level` (already in `learner-courses`).

**Frontend:**
- Full-screen assessment route via `src/lib/routes.ts` constants, outside the normal `AppLayout` chrome, learner-guarded.
- Login-flow predicate: learner + no completed assessment + `assessment_skipped_at IS NULL` → assessment step before role home. An existing stashed post-login deep link (`src/lib/post-login-redirect.ts`) takes precedence; the assessment then waits for the next plain login (skip is only recorded on an explicit skip click).
- Query keys via the `queryKeys` factory; reads via shared hooks in `src/hooks/`; mutations invalidate factory keys (`.claude/rules/frontend.md`).
- i18n: every string in BOTH `en.json` and `da.json` (parity), new `assessment.*` namespace; persona names/blurbs from the prototype.

## UI spec — chosen variants

⚠️ **The prototype is inspiration only.** `C:\Users\EmilVladinov\Desktop\claude-html\2026-07-22-117-onboarding-assessment-prototype.html` (open from disk; self-contained). Do **not** copy its markup/CSS/JS into the app — rebuild with the repo's real components (shadcn/ui, `LevelBadge`, `StatCard`, Tailwind tokens). String data may be copied verbatim.

**Icons: always import from `lucide-react`** (the library the codebase already uses — see `AppSidebar.tsx`, `Dashboard.tsx`). Never paste inline `<svg>` markup; the prototype's inline SVGs are stand-ins for their lucide equivalents (`Sparkles`, `BookOpen`, `Clock`, `Award`, `TrendingUp`, `Users`, `Play`, …).

- **Flow = variant A "Fokus-wizard":** one question per screen; top row `Spørgsmål N af 7` + `~2 min`; slim progress bar; option cards (radio dot, navy border + accent bg when selected); footer `← Tilbage` / `Næste →` (disabled until selected); last question shows `Se dit resultat`; skip link top-right; logo top-left.
- **Resultat = variant B "Split":** left card — eyebrow `DIN AI-VURDERING`, score ring (score/21, level-colored), persona-name headline, course-scale `LevelBadge`, **left-aligned** blurb, "Gå til dit dashboard →"; right column — "Start her – udvalgt til dit niveau" course rows (thumb, title, `LevelBadge`, lessons, Start button), level-matched first.
- **Dashboard nudge = variant A "Banner":** full-width accent-tinted card above the stat grid; lucide `Sparkles` in a navy 42px rounded tile; title + one-liner; navy CTA "Tag vurderingen · 2 min". Persistent until completed, no dismiss.
- **Kurser = variant A "Section":** "Anbefalet til dig" heading + the learner's `LevelBadge`, grid of level-matched courses with an "Anbefalet" chip (top-right of thumb), then "Alle kurser" grid below.
- **Indstillinger:** "AI-vurdering" card — Sparkles tile, title + current `LevelBadge`, "Senest taget <date>" (or "Ikke taget endnu" + "Tag vurderingen"), privacy note, tint button "Tag vurderingen igen".
- **Analytics = variant A "Segmented bar":** card "AI-niveau i organisationen" / "Baseret på onboarding-vurderingen"; one segmented bar (level colors + gray for not-assessed) + legend with counts using **course-scale names**; members table gains "AI-niveau" column (`LevelBadge` or "—").

## Verification gates (all before undrafting)

- Root: `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/`: `npm run build` · `npm test`.
- Unit tests: threshold boundaries (7/8 and 14/15); submit validation (missing/extra/unknown IDs → 400); skip idempotency; analytics additions keep tenant isolation (org admin can't read another org's levels); a drift guard asserting the frontend's i18n question/option keys exactly cover the server module's IDs.
- **Reach-line e2e (signed-in Playwright):** learner without assessment logs in → wizard appears → answers 7 → result screen shows level + recommended courses → Courses page shows "Anbefalet til dig" → Settings shows level + retake. Skip path: skip → lands on dashboard → banner present → next reload, no full-screen prompt (server-recorded). Admin: org analytics shows distribution + column. Zero app console errors.

## Process requirements

- **Work in a separate git worktree** — other agents are active on this repo (`git worktree add ../lw-117 feat/onboarding-assessment-117`; own `npm install` in root + `functions/`, copy `.env`/`.env.local`).
- Subagent-driven development per `AGENTS.md`; read `.claude/rules/frontend.md`, `.claude/rules/functions.md`, ADR-0015 first.
- **Deploy prerequisite (human-gated):** `04-assessment.sql` must be applied to prod by a human before this PR merges (same ritual as `03-seat-requests.sql` — note it in the PR before undrafting).
- Merged-PR bookkeeping: `migration/WORKLOG.md` entry + `migration/STATUS.html` checkpoint update in this PR.
- **Delete this file (`HANDOFF-117.md`) in the final commit** — it is consumed by then; the docs policy forbids leaving working notes behind.
