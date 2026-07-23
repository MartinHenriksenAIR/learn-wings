---
id: "ADR-0017"
title: "Exercise interactive lesson family: one lesson type, extensible kind discriminator, JSONB payload"
status: proposed
date: 2026-07-23
deciders: ['MartinHenriksenAIR']
tags: ['frontend', 'backend', 'database', 'lms', 'architecture', 'extensibility']
policy:
  rationales: ['Exercises are one lesson_type (exercise) discriminated by a text exercise_kind column so new kinds need no schema change', 'Exercise payloads are JSONB validated by a per-kind validator in code — the DB does not enforce config shape (parity with the suite-wide no-RLS, all-authz-in-code model)', 'Exercises are ungraded, non-blocking, and store nothing beyond the existing binary lesson_progress completed flag; correctness is checked client-side with no server grading endpoint', 'Every exercise config carries a version integer so config-shape evolution is an explicit, app-level data migration', 'The graded quiz stack (quizzes/quiz_questions/quiz_options, grade-quiz, quiz_attempts) is left untouched — quiz stays the single graded path']
---

## Context

The LMS has three lesson types (`video`, `document`, `quiz`). `quiz` is the **graded** knowledge-check: fully normalised (`quizzes` → `quiz_questions` → `quiz_options`), server-graded (`grade-quiz` recomputes the score), with a `quiz_attempts` record and a `passing_score`.

Issue #227 (decision recorded in #171) adds **Exercises** — an extensible *family* of **ungraded, interactive** practice lessons ("practice, not test"). Phase 1 ships the framework plus two kinds — **Quick-check** (1–3 MCQ, instant feedback, unlimited retries) and **bucket-sort** (drag items into labelled buckets). Later phases add `order`, `match`, hotspot (`spot-the-risk`, `find-the-flaw`), `try-it-and-reflect`, and `Prompt Lab` — each an additive kind on the same framework.

The kinds are **deliberately heterogeneous**: an MCQ, a bucket-sort, a click-the-image hotspot, and a prompt-lab share almost no payload shape. If each kind needed its own tables and endpoints, every future kind would be a schema migration — defeating the point of an extensible family.

## Decision

**One lesson type, extensible kind discriminator, JSONB payload.**

- **`exercise` is added to `lesson_type`** (the Postgres enum, the `LessonType` TS union, and the `LESSON_TYPES` allow-list in `functions/shared/validate.ts`), alongside `video`/`document`/`quiz`.
- **Exercise payloads live in one table** — `exercises(id, lesson_id UNIQUE, exercise_kind text NOT NULL, config jsonb NOT NULL)` — discriminated by a **text** `exercise_kind` (NOT a DB enum: new kinds need zero DDL).
- **`config` is JSONB, validated in code.** A **per-kind validator** (`functions/shared/exercises/`) is the single authority on config shape; the write endpoint rejects unknown kinds and malformed config with a 400. Every `config` embeds a **`version`** integer so shape evolution is an explicit, app-level data migration.
- **Ungraded, non-blocking, stores nothing extra.** Completion is the existing binary `lesson_progress.status = 'completed'` flag, reused as-is. No attempts/answers are persisted; there is no `quiz_attempts` analogue. Completion requires reaching the **correct** end-state, but with unlimited retries + instant feedback it is always reachable, and an incomplete exercise **never hard-blocks course completion**.
- **Correctness is checked client-side.** The learner endpoint returns the **full** config *including answers*; the browser compares locally for instant feedback. There is **no server grading endpoint.** This is acceptable precisely because exercises are ungraded, non-blocking, and persist nothing — the answer key has no value to protect, and local checking gives the instant feedback drag interactions need with zero server round-trips.
- **Endpoints mirror the quiz split:** `exercise-admin` (admin read), `exercise-admin-save` (admin upsert of the `exercises` row), `exercise-by-lesson` (learner read, full config). `lesson-create`/`lesson-update` only learn the new enum value — exercise content is managed by the exercise endpoints, exactly as quiz content is separate from the lesson row today.
- **The drag kinds share one accessible engine** — `dnd-kit` over an input-agnostic **"assignment" state model** (pointer drag, keyboard drag, and click-to-place all drive the same assign function), so keyboard/click operability is built in, not bolted on. This is the reusable foundation for the future `order`/`match` kinds.
- **Rollout is gated by `features.exercises_enabled`** (default **off**), mirroring `features.quizzes_enabled` — the family lands and deploys dark, flipped on per-environment after review. Like the quiz flag, the gate is on **authoring** (the CourseEditor lesson-type option and the "Edit Exercise" affordance) and the Settings toggle; it does **not** retroactively hide already-authored exercises from the learner player. On a fresh system this makes the feature fully dark (nothing can be authored while off, so nothing renders); it is not a kill-switch for content created while the flag was on.

## Consequences

**Positive.** New kinds are purely additive — a validator + a renderer + an authoring sub-editor, **zero schema change**. The graded quiz stack is untouched and remains the single graded path. Client-side checking keeps drag interactions instant and adds no backend load or cost. The feature flag lets the still-growing family merge and auto-deploy to production without exposing it (authoring and the Settings toggle are gated; see the rollout note in Decision for the flag's exact scope — it gates authoring, not already-published content, matching the quiz flag).

**Negative / accepted costs.** (1) The DB does **not** enforce config shape — the per-kind validator must, and config-shape evolution is an app-level data migration keyed on `version` (cheap: authored by a handful of platform admins). (2) The answer key is visible to a learner who inspects the network response — accepted because the stakes are zero (ungraded, non-blocking, nothing stored). (3) "MCQ with a correct option" now exists in two places — the graded quiz tables and the Quick-check config. Deliberate: they are different features (graded vs ungraded) that merely share a visual shape; a shared MCQ *UI widget* may be factored, but their **storage stays separate**. (4) One new frontend dependency (`dnd-kit`) — justified: accessible drag is hard to hand-roll correctly, and the engine is reused across multiple current and future kinds.

## Alternatives

1. **Normalised tables per kind (like quizzes)** — rejected: each of 8+ heterogeneous kinds becomes a new migration + tables + endpoints, defeating the extensibility goal; exercises are ungraded, so the relational queryability that justifies quizzes' normalisation is not needed here.
2. **Reuse the quiz machinery for Quick-check** — rejected: couples an ungraded feature to graded semantics (`passing_score`, `quiz_attempts`, `lesson_type='quiz'` access checks) and makes Quick-check a snowflake living outside the family.
3. **Server-side correctness verification (hide the answer key)** — rejected: it protects a zero-value asset, adds a per-kind server verifier that duplicates the client's correctness logic (worse extensibility), and a per-check round-trip degrades the instant feedback drag needs; granular feedback would let a learner reverse-engineer the answer through unlimited retries anyway.
4. **A new top-level `lesson_type` per kind** (`quick_check`, `bucket_sort`, …) — rejected: enum churn on every kind, and it spreads exercise handling across the `lesson_type` switch everywhere instead of one `exercise` branch that delegates to the kind.
