# Exercises — Interactive Lesson Family (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the extensible "Exercises" ungraded interactive-lesson family end-to-end, plus its two Phase-1 kinds — Quick-check (MCQ) and bucket-sort (drag) — behind a default-off feature flag.

**Architecture:** One new `exercise` value on the `lesson_type` enum; a single `exercises(lesson_id UNIQUE, exercise_kind text, config jsonb)` table discriminated by a **text** `exercise_kind` so new kinds need no DDL. `config` is JSONB validated by a per-kind validator in code (the DB does not enforce shape); every config carries a `version` integer. Exercises are **ungraded, non-blocking, and store nothing but the existing `lesson_progress` completed flag**; correctness is checked **client-side** (full config incl. answers is shipped to the learner — no server grading endpoint). Endpoints mirror the quiz split (`exercise-admin` / `exercise-admin-save` / `exercise-by-lesson`). Drag kinds share one accessible `dnd-kit` engine over an input-agnostic "assignment" state model (pointer drag + keyboard drag + click-to-place all call one assign function). See `docs/adr/ADR-0017-exercise-interactive-lesson-family.md`.

**Tech Stack:** React 18 + Vite + TypeScript (strict) · shadcn/ui + Radix + Tailwind · TanStack Query v5 · i18next (en+da) · Azure Functions v4 (Node ~20, raw `pg`) · Azure PostgreSQL 15 · **new dep: `@dnd-kit/core`**.

## Global Constraints

- **New endpoints MUST use `endpoint()` / `adminEndpoint()`** from `functions/shared/endpoint.ts` (ADR-0015). Never hand-roll the HTTP envelope.
- **Every new function MUST be imported in `functions/index.ts`** (the barrel) — an unimported function silently never registers (fleet guard `functions/registration-names.test.ts`).
- **Function/route names may NOT start with `admin`/`runtime`/`host`** — use suffix style (`exercise-admin`, `exercise-admin-save` are fine; the reserved-prefix rule is about the *leading* token, and `exercise-` is not reserved).
- **No module-load-time side effects that can throw.** Initialize lazily inside handlers.
- **500 responses stay generic** (ADR-0014) — never put exception text in a 500 body. Deliberate 4xx messages are caller-facing contracts and are fine.
- **Endpoint tests** mock `shared/auth`, `shared/db`, `shared/profile`; NEVER touch a real DB.
- **Frontend data fetching goes through one shared hook per endpoint** in `src/hooks/` (modeled on `useUserProgress.ts`); every query key comes from the `queryKeys` factory (`src/lib/query-keys.ts`); mutations use `useMutation`/`useToastMutation` + `invalidateQueries`. No `useState`/`useEffect`/`callApi` reads in components.
- **Ownership comparisons use `profile?.id`, NOT `user?.id`.**
- **i18n:** every new user-facing string gets keys in BOTH `en.json` and `da.json`.
- **No new state libraries** (per ADRs 0001–0004). `@dnd-kit/core` is a UI interaction lib, not a state lib, and is explicitly sanctioned by ADR-0017.
- **`@azure/functions` stays pinned at exactly `4.5.0`; Node `~20`.** Do not bump.
- **Verification gates (all exit 0 before PR):** root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/` `npm run build` · `npm test`.
- **Feature flag `exercises_enabled` defaults OFF** everywhere (seed, `defaultFeatures`, test mocks).
- **`exercise_kind` values are snake_case strings:** `quick_check`, `bucket_sort`. Config `version` starts at `1`.

---

## Config shapes (version 1) — the contract every task shares

These are the JSONB `config` shapes. Backend validators (Task 2) and frontend types (Task 7) must agree on them byte-for-byte.

**`quick_check`** — 1–3 questions, each with 2+ options and **exactly one** correct (single-select radio; deliberately lighter than a graded quiz):
```jsonc
{
  "version": 1,
  "questions": [
    {
      "id": "q1",
      "text": "Which is a good use of AI?",
      "options": [
        { "id": "o1", "text": "Draft a first version", "correct": true },
        { "id": "o2", "text": "Sign a legal contract unreviewed", "correct": false }
      ]
    }
  ]
}
```

**`bucket_sort`** — 2+ buckets, 1+ items; each item's `bucketId` is its correct bucket (the answer key):
```jsonc
{
  "version": 1,
  "buckets": [
    { "id": "b1", "label": "Let AI draft" },
    { "id": "b2", "label": "Keep human" }
  ],
  "items": [
    { "id": "i1", "text": "Brainstorm email subject lines", "bucketId": "b1" },
    { "id": "i2", "text": "Approve a redundancy decision", "bucketId": "b2" }
  ]
}
```

Completion rule (both kinds): the learner reaches the **correct** end-state — every `quick_check` question's selected option is the correct one; every `bucket_sort` item sits in its `bucketId`. Unlimited retries, instant local feedback. On correct, the client calls the existing `/api/lesson-progress` complete path. Nothing else is stored.

---

## Task 1: Database — enum value, `exercises` table, feature-flag seed

**Files:**
- Modify: `migration/azure/01-schema.sql` (canonical fresh schema)
- Modify: `migration/azure/02-seed.sql` (features seed row)
- Create: `migration/azure/07-exercises.sql` (additive, idempotent prod migration)

**Interfaces:**
- Produces: table `exercises(id uuid pk, lesson_id uuid unique fk→lessons, exercise_kind text, config jsonb)`; enum `lesson_type` gains `'exercise'`; `platform_settings` `features` row gains `"exercises_enabled": false`.

> **No unit test** — SQL is not exercised by the test suites (there is no local DB; see `.claude/rules`/memory). Verification is (a) the `functions` + root builds still pass (they don't touch SQL, but the enum value must match the TS union added later), and (b) a manual parse-consistency review against the existing enum `ADD VALUE` precedent (`01-schema.sql:72`). **Applying `07-exercises.sql` to production is an owner-run step** (like `03-seat-requests.sql`) — do NOT run `az`/prod DDL from the session.

- [ ] **Step 1: Add `'exercise'` to the canonical enum.** In `migration/azure/01-schema.sql:62`, change:
```sql
CREATE TYPE public.lesson_type         AS ENUM ('video', 'document', 'quiz');
```
to:
```sql
CREATE TYPE public.lesson_type         AS ENUM ('video', 'document', 'quiz', 'exercise');
```

- [ ] **Step 2: Add the `exercises` table to the canonical schema.** In `migration/azure/01-schema.sql`, immediately after the `quiz_options` table block (ends at line 238, before the `-- ---- org_course_access ----` comment at line 240), insert:
```sql
-- ---- exercises ----
-- Ungraded interactive lessons (ADR-0017). One row per exercise lesson.
-- exercise_kind is TEXT (not an enum) so new kinds need no DDL; config is a
-- kind-specific JSONB payload validated in code by functions/shared/exercises.
-- Every config embeds an integer "version" for forward migration.
CREATE TABLE public.exercises (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     uuid UNIQUE NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  exercise_kind text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT exercises_config_is_object CHECK (jsonb_typeof(config) = 'object')
);
```

- [ ] **Step 3: Add the feature flag to the seed.** In `migration/azure/02-seed.sql`, the `features` row (lines 150–156) currently ends:
```sql
     "community_enabled": true
   }'::jsonb);
```
Change the `community_enabled` line to add the new key (mind the comma):
```sql
     "community_enabled": true,
     "exercises_enabled": false
   }'::jsonb);
```

- [ ] **Step 4: Create the additive prod migration** `migration/azure/07-exercises.sql`:
```sql
-- 07-exercises.sql — Exercises interactive lesson family, Phase 1 (#227, ADR-0017).
-- Additive, idempotent. Apply to prod directly (owner-run), like 03-seat-requests.sql.
BEGIN;

-- 1. New lesson_type value (idempotent; PG12+ supports IF NOT EXISTS).
ALTER TYPE public.lesson_type ADD VALUE IF NOT EXISTS 'exercise';

-- 2. Exercise payload table.
CREATE TABLE IF NOT EXISTS public.exercises (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     uuid UNIQUE NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  exercise_kind text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT exercises_config_is_object CHECK (jsonb_typeof(config) = 'object')
);

-- 3. Feature flag (default off) — merge into the existing features row without
--    clobbering other keys. No-op if the key is already present.
UPDATE public.platform_settings
   SET value = value || '{"exercises_enabled": false}'::jsonb
 WHERE key = 'features'
   AND NOT (value ? 'exercises_enabled');

COMMIT;
```
> Note: `ALTER TYPE ... ADD VALUE` and using the value in the same transaction is disallowed by PG, but this migration never *uses* `'exercise'` (the `exercises` table keys off `exercise_kind text`, not the enum), so the single `BEGIN/COMMIT` is safe.

- [ ] **Step 5: Verify builds unaffected + commit.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm run build && cd functions && npm run build
git add migration/azure/01-schema.sql migration/azure/02-seed.sql migration/azure/07-exercises.sql
git commit -m "feat(exercises): DB schema, migration, and feature-flag seed for exercise lessons (#227)"
```
Expected: both builds exit 0.

---

## Task 2: Backend validation — lesson-type allow-list + per-kind config validators

**Files:**
- Modify: `functions/shared/validate.ts` (add `'exercise'` to `LESSON_TYPES`)
- Create: `functions/shared/exercises/config.ts` (kind registry + validators)
- Test: `functions/shared/exercises/config.test.ts`

**Interfaces:**
- Produces: `LESSON_TYPES` includes `'exercise'`; `EXERCISE_KINDS = ['quick_check','bucket_sort'] as const`; `type ExerciseKind = (typeof EXERCISE_KINDS)[number]`; `validateExerciseConfig(kind: string, config: unknown): string | null` (returns null on valid, else an error message).
- Consumed by: Task 3 (`exercise-admin-save`).

- [ ] **Step 1: Write the failing validator tests.** Create `functions/shared/exercises/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateExerciseConfig, EXERCISE_KINDS } from './config';

describe('validateExerciseConfig', () => {
  it('rejects an unknown kind', () => {
    expect(validateExerciseConfig('mystery', { version: 1 })).toMatch(/unknown exercise_kind/i);
  });

  it('exposes exactly the Phase 1 kinds', () => {
    expect([...EXERCISE_KINDS]).toEqual(['quick_check', 'bucket_sort']);
  });

  // ── quick_check ──────────────────────────────────────────────────────────
  const validQuickCheck = {
    version: 1,
    questions: [
      { id: 'q1', text: 'Q?', options: [
        { id: 'o1', text: 'A', correct: true },
        { id: 'o2', text: 'B', correct: false },
      ] },
    ],
  };

  it('accepts a valid quick_check', () => {
    expect(validateExerciseConfig('quick_check', validQuickCheck)).toBeNull();
  });

  it('rejects quick_check with wrong version', () => {
    expect(validateExerciseConfig('quick_check', { ...validQuickCheck, version: 2 })).toMatch(/version/i);
  });

  it('rejects quick_check with zero questions', () => {
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [] })).toMatch(/1.*3 questions/i);
  });

  it('rejects quick_check with more than 3 questions', () => {
    const q = validQuickCheck.questions[0];
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [q, q, q, q] })).toMatch(/1.*3 questions/i);
  });

  it('rejects a question with fewer than 2 options', () => {
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [
      { id: 'q1', text: 'Q?', options: [{ id: 'o1', text: 'A', correct: true }] },
    ] })).toMatch(/at least 2 options/i);
  });

  it('rejects a question without exactly one correct option', () => {
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [
      { id: 'q1', text: 'Q?', options: [
        { id: 'o1', text: 'A', correct: true },
        { id: 'o2', text: 'B', correct: true },
      ] },
    ] })).toMatch(/exactly one correct/i);
  });

  // ── bucket_sort ──────────────────────────────────────────────────────────
  const validBucketSort = {
    version: 1,
    buckets: [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }],
    items: [{ id: 'i1', text: 'thing', bucketId: 'b1' }],
  };

  it('accepts a valid bucket_sort', () => {
    expect(validateExerciseConfig('bucket_sort', validBucketSort)).toBeNull();
  });

  it('rejects bucket_sort with fewer than 2 buckets', () => {
    expect(validateExerciseConfig('bucket_sort', { ...validBucketSort, buckets: [{ id: 'b1', label: 'X' }] }))
      .toMatch(/at least 2 buckets/i);
  });

  it('rejects bucket_sort with zero items', () => {
    expect(validateExerciseConfig('bucket_sort', { ...validBucketSort, items: [] })).toMatch(/at least 1 item/i);
  });

  it('rejects an item whose bucketId is not a real bucket', () => {
    expect(validateExerciseConfig('bucket_sort', {
      ...validBucketSort, items: [{ id: 'i1', text: 'thing', bucketId: 'nope' }],
    })).toMatch(/unknown bucket/i);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run shared/exercises/config.test.ts
```
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement the validators.** Create `functions/shared/exercises/config.ts`:
```ts
/**
 * Per-kind exercise config validators (ADR-0017). The DB does not enforce
 * config shape — this module is the single authority. exercise-admin-save calls
 * validateExerciseConfig() and returns 400 with the message on any failure.
 *
 * Kinds are plain strings (no DB enum) so new kinds add a case here + a renderer,
 * with zero schema change. Every config must carry integer version === 1.
 */
export const EXERCISE_KINDS = ['quick_check', 'bucket_sort'] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function validateQuickCheck(config: Record<string, unknown>): string | null {
  if (config.version !== 1) return 'quick_check config version must be 1';
  const { questions } = config;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    return 'quick_check must have 1–3 questions';
  }
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    if (!isObj(q)) return `question ${qi}: must be an object`;
    if (!isNonEmptyString(q.id)) return `question ${qi}: id is required`;
    if (!isNonEmptyString(q.text)) return `question ${qi}: text is required`;
    const opts = q.options;
    if (!Array.isArray(opts) || opts.length < 2) return `question ${qi}: at least 2 options required`;
    let correctCount = 0;
    for (let oi = 0; oi < opts.length; oi++) {
      const o = opts[oi];
      if (!isObj(o)) return `question ${qi} option ${oi}: must be an object`;
      if (!isNonEmptyString(o.id)) return `question ${qi} option ${oi}: id is required`;
      if (!isNonEmptyString(o.text)) return `question ${qi} option ${oi}: text is required`;
      if (typeof o.correct !== 'boolean') return `question ${qi} option ${oi}: correct must be boolean`;
      if (o.correct) correctCount++;
    }
    if (correctCount !== 1) return `question ${qi}: exactly one correct option is required`;
  }
  return null;
}

function validateBucketSort(config: Record<string, unknown>): string | null {
  if (config.version !== 1) return 'bucket_sort config version must be 1';
  const { buckets, items } = config;
  if (!Array.isArray(buckets) || buckets.length < 2) return 'bucket_sort needs at least 2 buckets';
  const bucketIds = new Set<string>();
  for (let bi = 0; bi < buckets.length; bi++) {
    const b = buckets[bi];
    if (!isObj(b)) return `bucket ${bi}: must be an object`;
    if (!isNonEmptyString(b.id)) return `bucket ${bi}: id is required`;
    if (!isNonEmptyString(b.label)) return `bucket ${bi}: label is required`;
    if (bucketIds.has(b.id)) return `bucket ${bi}: duplicate id`;
    bucketIds.add(b.id);
  }
  if (!Array.isArray(items) || items.length < 1) return 'bucket_sort needs at least 1 item';
  for (let ii = 0; ii < items.length; ii++) {
    const it = items[ii];
    if (!isObj(it)) return `item ${ii}: must be an object`;
    if (!isNonEmptyString(it.id)) return `item ${ii}: id is required`;
    if (!isNonEmptyString(it.text)) return `item ${ii}: text is required`;
    if (!isNonEmptyString(it.bucketId) || !bucketIds.has(it.bucketId)) {
      return `item ${ii}: bucketId references an unknown bucket`;
    }
  }
  return null;
}

export function validateExerciseConfig(kind: string, config: unknown): string | null {
  if (!EXERCISE_KINDS.includes(kind as ExerciseKind)) {
    return `unknown exercise_kind: ${kind}`;
  }
  if (!isObj(config)) return 'config must be an object';
  switch (kind as ExerciseKind) {
    case 'quick_check': return validateQuickCheck(config);
    case 'bucket_sort': return validateBucketSort(config);
  }
}
```

- [ ] **Step 4: Add `'exercise'` to `LESSON_TYPES`.** In `functions/shared/validate.ts:28`:
```ts
const LESSON_TYPES = ['video', 'document', 'quiz', 'exercise'] as const;
```
and the error message at line 61:
```ts
    return "lessonType must be 'video', 'document', 'quiz', or 'exercise'";
```

- [ ] **Step 5: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run shared/exercises/config.test.ts && npm test
```
Expected: config tests PASS; full `functions` suite PASS (validate.ts change must not break `validate.test.ts` — if that file asserts the old error string, update it to the new message in the same commit).

- [ ] **Step 6: Commit.**
```bash
git add functions/shared/validate.ts functions/shared/exercises/config.ts functions/shared/exercises/config.test.ts
git commit -m "feat(exercises): exercise-kind config validators + lesson-type allow-list (#227)"
```

---

## Task 3: Backend — `exercise-admin-save` endpoint (author upsert)

**Files:**
- Create: `functions/exercise-admin-save/index.ts`
- Test: `functions/exercise-admin-save/index.test.ts`
- Modify: `functions/index.ts` (barrel import)

**Interfaces:**
- Consumes: `validateExerciseConfig` (Task 2), `adminEndpoint`, `withTransaction`.
- Request: `{ lessonId: string, exerciseKind: string, config: object }`. Response: `{ exercise: { id, lesson_id, exercise_kind, config } }`. Upserts by `lesson_id` (UNIQUE).
- Produces: route `exercise-admin-save`.

- [ ] **Step 1: Write the failing contract test.** Create `functions/exercise-admin-save/index.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockWithTransaction: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: mockWithTransaction, getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const validBody = {
  lessonId: 'lesson-1',
  exerciseKind: 'bucket_sort',
  config: { version: 1, buckets: [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }], items: [{ id: 'i1', text: 't', bucketId: 'b1' }] },
};

describe('exercise-admin-save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 403 for a non-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'u1', is_platform_admin: false });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(baseReq({ ...validBody, lessonId: undefined }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 on an unknown exerciseKind', async () => {
    const res = await handler(baseReq({ ...validBody, exerciseKind: 'mystery' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/unknown exercise_kind/i);
  });

  it('returns 400 on malformed config', async () => {
    const res = await handler(baseReq({ ...validBody, config: { version: 1, buckets: [], items: [] } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('upserts and returns the saved exercise on the happy path', async () => {
    const saved = { id: 'ex-1', lesson_id: 'lesson-1', exercise_kind: 'bucket_sort', config: validBody.config };
    mockWithTransaction.mockImplementation(async (fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [saved] }) }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).exercise).toEqual(saved);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run exercise-admin-save/index.test.ts
```
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement the endpoint.** Create `functions/exercise-admin-save/index.ts`:
```ts
import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { validateExerciseConfig } from '../shared/exercises/config';
import { PoolClient } from 'pg';

export default adminEndpoint('exercise-admin-save', async ({ req, reply }) => {
  const body = await req.json() as { lessonId?: unknown; exerciseKind?: unknown; config?: unknown };
  const { lessonId, exerciseKind, config } = body;

  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }
  if (!exerciseKind || typeof exerciseKind !== 'string') {
    return reply(400, { error: 'exerciseKind is required' });
  }

  const configError = validateExerciseConfig(exerciseKind, config);
  if (configError) {
    return reply(400, { error: configError });
  }

  const exercise = await withTransaction(async (client: PoolClient) => {
    const result = await client.query(
      `INSERT INTO exercises (lesson_id, exercise_kind, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (lesson_id)
       DO UPDATE SET exercise_kind = EXCLUDED.exercise_kind, config = EXCLUDED.config
       RETURNING id, lesson_id, exercise_kind, config`,
      [lessonId, exerciseKind, JSON.stringify(config)],
    );
    return result.rows[0];
  });

  return reply(200, { exercise });
});
```

- [ ] **Step 4: Register in the barrel.** In `functions/index.ts`, add alongside the other exercise/quiz imports (keep alphabetical grouping — insert before `import './grade-quiz/index';` at line 48 is wrong; add near the `e*` group). Add:
```ts
import './exercise-admin-save/index';
```

- [ ] **Step 5: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run exercise-admin-save/index.test.ts && npm test
```
Expected: PASS, including the fleet guard `registration-names.test.ts` (barrel ↔ folder parity).

- [ ] **Step 6: Commit.**
```bash
git add functions/exercise-admin-save functions/index.ts
git commit -m "feat(exercises): exercise-admin-save endpoint (author upsert) (#227)"
```

---

## Task 4: Backend — `exercise-admin` endpoint (author read)

**Files:**
- Create: `functions/exercise-admin/index.ts`
- Test: `functions/exercise-admin/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Request: `{ lessonId: string }`. Response: `{ exercise: { id, lesson_id, exercise_kind, config } | null }` (null = no exercise yet; NOT 404, mirrors `quiz-admin`).
- Produces: route `exercise-admin`.

- [ ] **Step 1: Write the failing test.** Create `functions/exercise-admin/index.test.ts` (mirror the auth/preflight scaffold from Task 3; assert: OPTIONS→204, non-admin→403, missing lessonId→400, `{exercise:null}` when none, and the row when present):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne, getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') }, json: async () => body }) as any;

describe('exercise-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'admin-1', is_platform_admin: true });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any, {} as any);
    expect(res.status).toBe(204);
  });
  it('returns 403 for a non-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'u1', is_platform_admin: false });
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(403);
  });
  it('returns 400 when lessonId is missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });
  it('returns {exercise:null} when none exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ lessonId: 'l1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ exercise: null });
  });
  it('returns the exercise when present', async () => {
    const ex = { id: 'ex1', lesson_id: 'l1', exercise_kind: 'quick_check', config: { version: 1, questions: [] } };
    mockQueryOne.mockResolvedValueOnce(ex);
    const res = await handler(baseReq({ lessonId: 'l1' }), {} as any);
    expect(JSON.parse(res.body as string)).toEqual({ exercise: ex });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run exercise-admin/index.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `functions/exercise-admin/index.ts`:
```ts
import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('exercise-admin', async ({ req, reply }) => {
  const { lessonId } = await req.json() as { lessonId?: unknown };
  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }
  const exercise = await queryOne<{ id: string; lesson_id: string; exercise_kind: string; config: unknown }>(
    'SELECT id, lesson_id, exercise_kind, config FROM exercises WHERE lesson_id = $1',
    [lessonId],
  );
  // No exercise yet — empty editor state (maybeSingle parity; NOT 404)
  return reply(200, { exercise: exercise ?? null });
});
```

- [ ] **Step 4: Register in the barrel.** In `functions/index.ts` add:
```ts
import './exercise-admin/index';
```

- [ ] **Step 5: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run exercise-admin/index.test.ts && npm test
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add functions/exercise-admin functions/index.ts
git commit -m "feat(exercises): exercise-admin endpoint (author read) (#227)"
```

---

## Task 5: Backend — `exercise-by-lesson` endpoint (learner read, full config)

**Files:**
- Create: `functions/exercise-by-lesson/index.ts`
- Test: `functions/exercise-by-lesson/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Request: `{ lessonId: string }`. Response: `{ exercise: { id, lesson_id, exercise_kind, config } | null }`. Config is returned IN FULL (answers included) — correctness is checked client-side (ADR-0017). Access check mirrors `quiz-by-lesson` (platform admins skip; others need an active membership in an org with the course enabled+published).
- Produces: route `exercise-by-lesson`.

- [ ] **Step 1: Write the failing test.** Create `functions/exercise-by-lesson/index.test.ts` (mirror `quiz-by-lesson`'s scaffold: 401 invalid token, 401 no profile, 400 missing lessonId, 403 access denied for non-member, 200 full config for member, `{exercise:null}` when none):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') }, json: async () => body }) as any;

describe('exercise-by-lesson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(401);
  });
  it('returns 400 when lessonId missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });
  it('returns 403 when a non-member has no access', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // access check
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(403);
  });
  it('returns the FULL config (answers included) for an entitled learner', async () => {
    const ex = { id: 'ex1', lesson_id: 'l1', exercise_kind: 'bucket_sort',
      config: { version: 1, buckets: [{ id: 'b1', label: 'X' }], items: [{ id: 'i1', text: 't', bucketId: 'b1' }] } };
    mockQueryOne
      .mockResolvedValueOnce({ ok: true }) // access check
      .mockResolvedValueOnce(ex);           // exercise fetch
    const res = await handler(baseReq({ lessonId: 'l1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).exercise.config.items[0].bucketId).toBe('b1'); // answer present
  });
  it('platform admin skips the access check', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'admin', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'ex1', lesson_id: 'l1', exercise_kind: 'quick_check', config: { version: 1, questions: [] } });
    expect((await handler(baseReq({ lessonId: 'l1' }), {} as any)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run exercise-by-lesson/index.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (access-check SQL copied verbatim from `quiz-by-lesson/index.ts:15-23`). Create `functions/exercise-by-lesson/index.ts`:
```ts
import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('exercise-by-lesson', async ({ req, profile, reply }) => {
  const { lessonId } = await req.json() as { lessonId?: unknown };
  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }

  // Access check — skip entirely for platform admins (parity with quiz-by-lesson)
  if (!profile.is_platform_admin) {
    const access = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS(
        SELECT 1
          FROM lessons l
          JOIN course_modules cm ON cm.id = l.module_id
          JOIN courses c ON c.id = cm.course_id
          JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
          JOIN org_memberships om ON om.org_id = oca.org_id
         WHERE l.id = $2 AND c.is_published = TRUE AND om.user_id = $1 AND om.status = 'active'
      ) AS ok`,
      [profile.id, lessonId],
    );
    if (!access?.ok) return reply(403, { error: 'Exercise access denied' });
  }

  // Full config incl. answers — correctness is checked client-side (ADR-0017).
  const exercise = await queryOne<{ id: string; lesson_id: string; exercise_kind: string; config: unknown }>(
    'SELECT id, lesson_id, exercise_kind, config FROM exercises WHERE lesson_id = $1',
    [lessonId],
  );
  return reply(200, { exercise: exercise ?? null });
});
```

- [ ] **Step 4: Register in the barrel.** In `functions/index.ts` add:
```ts
import './exercise-by-lesson/index';
```

- [ ] **Step 5: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings/functions && npx vitest run exercise-by-lesson/index.test.ts && npm test && npm run build
```
Expected: PASS + build exits 0.

- [ ] **Step 6: Commit.**
```bash
git add functions/exercise-by-lesson functions/index.ts
git commit -m "feat(exercises): exercise-by-lesson endpoint (learner read, full config) (#227)"
```

---

## Task 6: Frontend — `exercises_enabled` feature flag

**Files:**
- Modify: `src/hooks/usePlatformSettings.tsx` (interface + defaults + effective-features object)
- Modify: `src/pages/platform-admin/PlatformSettings.tsx` (interface + defaults + `featureKeys` array)
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/da.json` (toggle label + hint)
- Modify: `src/pages/platform-admin/CourseEditor.test.tsx`, `src/pages/learner/CoursePlayer.test.tsx` (mock feature objects)

**Interfaces:**
- Produces: `features.exercises_enabled: boolean` (default false), a Settings toggle, and i18n keys `platformSettings.features.exercises_enabled` / `..._enabled_hint`.

- [ ] **Step 1: Add the flag to `usePlatformSettings.tsx`.**
  - `FeatureSettings` interface (after `community_enabled`, ~line 10): add `exercises_enabled: boolean;`
  - `defaultFeatures` (after `community_enabled: true`, ~line 37): add `exercises_enabled: false,`
  - effective `features` object (after the `community_enabled` line ~151): add:
```ts
    exercises_enabled: platformFeatures.exercises_enabled && (orgFeatures?.exercises_enabled ?? true),
```

- [ ] **Step 2: Add the flag to `PlatformSettings.tsx`.**
  - `FeatureSettings` interface (lines 59–63): add `exercises_enabled: boolean;`
  - defaults object (lines 103–107): add `exercises_enabled: false,`
  - `featureKeys` array (lines 116–122): add `'exercises_enabled'` (the toggle renders automatically via the `featureKeys.map` at lines 572–591).

- [ ] **Step 3: Add i18n keys.** In `src/i18n/locales/en.json`, in the `platformSettings.features` block (near `quizzes_enabled` at line 779):
```json
    "exercises_enabled": "Exercises",
    "exercises_enabled_hint": "Interactive practice lessons (Quick-check, drag-and-drop). Ungraded.",
```
In `src/i18n/locales/da.json`, the same keys:
```json
    "exercises_enabled": "Øvelser",
    "exercises_enabled_hint": "Interaktive øvelseslektioner (Quick-check, træk-og-slip). Uden karakter.",
```

- [ ] **Step 4: Update existing test mocks so they still typecheck.**
  - `src/pages/platform-admin/CourseEditor.test.tsx:35` — extend the mocked features object to include `exercises_enabled: false` (leave `quizzes_enabled: false` as-is).
  - `src/pages/learner/CoursePlayer.test.tsx` — add `exercises_enabled: false,` to BOTH feature objects (lines ~84–90 and ~231–237).

- [ ] **Step 5: Verify + commit.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npx tsc --noEmit -p tsconfig.app.json && npm test -- src/pages/platform-admin/PlatformSettings.test.tsx src/pages/platform-admin/CourseEditor.test.tsx src/pages/learner/CoursePlayer.test.tsx
git add src/hooks/usePlatformSettings.tsx src/pages/platform-admin/PlatformSettings.tsx src/i18n/locales/en.json src/i18n/locales/da.json src/pages/platform-admin/CourseEditor.test.tsx src/pages/learner/CoursePlayer.test.tsx
git commit -m "feat(exercises): exercises_enabled feature flag (default off) (#227)"
```
Expected: tsc exits 0; named tests PASS.

---

## Task 7: Frontend — types, query keys, and data hooks

**Files:**
- Modify: `src/lib/types.ts` (`LessonType` + exercise config types + `Exercise`)
- Modify: `src/lib/query-keys.ts` (`exerciseAdmin` + `exerciseByLesson` families)
- Modify: `src/lib/query-keys.test.ts` (if present — add the two families' key-shape assertions)
- Create: `src/hooks/useExerciseAdmin.ts`
- Create: `src/hooks/useExerciseByLesson.ts`

**Interfaces:**
- Produces:
  - `type ExerciseKind = 'quick_check' | 'bucket_sort'`
  - `interface QuickCheckConfig`, `interface BucketSortConfig`, `type ExerciseConfig = QuickCheckConfig | BucketSortConfig`
  - `interface Exercise { id; lesson_id; exercise_kind: ExerciseKind; config: ExerciseConfig }`
  - `queryKeys.exerciseAdmin.detail(lessonId)` → `['exercise-admin', lessonId]`
  - `queryKeys.exerciseByLesson.detail(lessonId)` → `['exercise-by-lesson', lessonId]`
  - `useExerciseAdmin(lessonId, { enabled })` and `useExerciseByLesson(lessonId, { enabled })` → `{ data: { exercise: Exercise | null }, ... }`
- Consumed by: Tasks 8–12.

- [ ] **Step 1: Add types to `src/lib/types.ts`.** Change line 7:
```ts
export type LessonType = 'video' | 'document' | 'quiz' | 'exercise';
```
Then, after the `QuizOption` interface (line 120), add:
```ts
// ── Exercises (ADR-0017) — ungraded interactive lessons ──────────────────────
export type ExerciseKind = 'quick_check' | 'bucket_sort';

export interface QuickCheckOption { id: string; text: string; correct: boolean; }
export interface QuickCheckQuestion { id: string; text: string; options: QuickCheckOption[]; }
export interface QuickCheckConfig { version: 1; questions: QuickCheckQuestion[]; }

export interface BucketSortBucket { id: string; label: string; }
export interface BucketSortItem { id: string; text: string; bucketId: string; }
export interface BucketSortConfig { version: 1; buckets: BucketSortBucket[]; items: BucketSortItem[]; }

export type ExerciseConfig = QuickCheckConfig | BucketSortConfig;

export interface Exercise {
  id: string;
  lesson_id: string;
  exercise_kind: ExerciseKind;
  config: ExerciseConfig;
}
```

- [ ] **Step 2: Add query-key families to `src/lib/query-keys.ts`.** After the `quizAdmin` family (line 311), add:
```ts
  exerciseAdmin: {
    /**
     * Full key: ['exercise-admin', lessonId]
     * Used by ExerciseEditorDialog.tsx (author read via /api/exercise-admin).
     */
    detail: (lessonId: string) => ['exercise-admin', lessonId] as const,
  },

  exerciseByLesson: {
    /**
     * Full key: ['exercise-by-lesson', lessonId]
     * Used by useExerciseByLesson / CoursePlayer.tsx (learner read, full config).
     */
    detail: (lessonId: string | undefined) => ['exercise-by-lesson', lessonId] as const,
  },
```
If `src/lib/query-keys.test.ts` exists, add assertions mirroring the `quizAdmin` case:
```ts
  expect(queryKeys.exerciseAdmin.detail('l1')).toEqual(['exercise-admin', 'l1']);
  expect(queryKeys.exerciseByLesson.detail('l1')).toEqual(['exercise-by-lesson', 'l1']);
```

- [ ] **Step 3: Create `src/hooks/useExerciseByLesson.ts`** (modeled on `useUserProgress.ts`):
```ts
import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Exercise } from '@/lib/types';

interface ExerciseByLessonResult { exercise: Exercise | null; }
interface Options { enabled?: boolean; }

/** The one way to fetch /api/exercise-by-lesson (learner, full config incl. answers). */
export function useExerciseByLesson(lessonId: string | undefined, options: Options = {}) {
  return useQuery({
    queryKey: queryKeys.exerciseByLesson.detail(lessonId),
    queryFn: () => callApi<ExerciseByLessonResult>('/api/exercise-by-lesson', { lessonId }),
    enabled: (options.enabled ?? true) && !!lessonId,
    staleTime: 60 * 1000,
  });
}
```

- [ ] **Step 4: Create `src/hooks/useExerciseAdmin.ts`:**
```ts
import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Exercise } from '@/lib/types';

interface ExerciseAdminResult { exercise: Exercise | null; }
interface Options { enabled?: boolean; }

/** The one way to fetch /api/exercise-admin (author editor state). */
export function useExerciseAdmin(lessonId: string | undefined, options: Options = {}) {
  return useQuery({
    queryKey: queryKeys.exerciseAdmin.detail(lessonId ?? ''),
    queryFn: () => callApi<ExerciseAdminResult>('/api/exercise-admin', { lessonId }),
    enabled: (options.enabled ?? true) && !!lessonId,
  });
}
```

- [ ] **Step 5: Verify + commit.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npx tsc --noEmit -p tsconfig.app.json && npm test -- src/lib/query-keys.test.ts
git add src/lib/types.ts src/lib/query-keys.ts src/hooks/useExerciseAdmin.ts src/hooks/useExerciseByLesson.ts src/lib/query-keys.test.ts
git commit -m "feat(exercises): frontend types, query keys, and data hooks (#227)"
```
Expected: tsc exits 0; query-keys tests PASS (skip the `--` file arg if the test file doesn't exist).

---

## Task 8: Frontend — `@dnd-kit/core` + `BucketSortPlayer` (accessible drag)

**Files:**
- Modify: `package.json` (add `@dnd-kit/core`)
- Create: `src/components/exercises/useBucketAssignments.ts` (input-agnostic assignment state)
- Create: `src/components/exercises/BucketSortPlayer.tsx`
- Test: `src/components/exercises/BucketSortPlayer.test.tsx`

**Interfaces:**
- Consumes: `BucketSortConfig` (Task 7).
- Produces: `<BucketSortPlayer config={BucketSortConfig} onComplete={() => void} />`. Renders an unassigned tray + one drop zone per bucket; supports pointer drag, keyboard drag (dnd-kit `KeyboardSensor`), and click-to-place; a "Check" button compares to the answer key, shows per-item correct/incorrect feedback, and calls `onComplete` exactly once when every item is in its `bucketId`.
- `useBucketAssignments(config)` returns `{ assignments, assign(itemId, bucketId|null), reset, isAllCorrect }`.

- [ ] **Step 1: Add the dependency.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm install @dnd-kit/core@^6
```
Verify it landed in `package.json` dependencies.

- [ ] **Step 2: Write the failing assignment-state test.** Create `src/components/exercises/BucketSortPlayer.test.tsx` (the input-agnostic model is testable without simulating drag — assert click-to-place drives completion):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BucketSortPlayer } from './BucketSortPlayer';
import type { BucketSortConfig } from '@/lib/types';

const config: BucketSortConfig = {
  version: 1,
  buckets: [{ id: 'b1', label: 'Draft' }, { id: 'b2', label: 'Human' }],
  items: [
    { id: 'i1', text: 'Brainstorm', bucketId: 'b1' },
    { id: 'i2', text: 'Approve firing', bucketId: 'b2' },
  ],
};

describe('BucketSortPlayer', () => {
  it('calls onComplete when every item is placed correctly (click-to-place path)', () => {
    const onComplete = vi.fn();
    render(<BucketSortPlayer config={config} onComplete={onComplete} />);

    // Click-to-place: select item, then click target bucket.
    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Draft/i }));
    fireEvent.click(screen.getByRole('button', { name: /Approve firing/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Human/i }));

    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onComplete when an item is in the wrong bucket', () => {
    const onComplete = vi.fn();
    render(<BucketSortPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Human/i })); // wrong
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm test -- src/components/exercises/BucketSortPlayer.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the assignment hook.** Create `src/components/exercises/useBucketAssignments.ts`:
```ts
import { useMemo, useState } from 'react';
import type { BucketSortConfig } from '@/lib/types';

/** Input-agnostic state: itemId -> bucketId | null (null = unassigned tray). */
export type Assignments = Record<string, string | null>;

export function useBucketAssignments(config: BucketSortConfig) {
  const [assignments, setAssignments] = useState<Assignments>(
    () => Object.fromEntries(config.items.map((it) => [it.id, null])),
  );

  const assign = (itemId: string, bucketId: string | null) =>
    setAssignments((prev) => ({ ...prev, [itemId]: bucketId }));

  const reset = () => setAssignments(Object.fromEntries(config.items.map((it) => [it.id, null])));

  const isAllCorrect = useMemo(
    () => config.items.every((it) => assignments[it.id] === it.bucketId),
    [assignments, config.items],
  );

  return { assignments, assign, reset, isAllCorrect };
}
```

- [ ] **Step 5: Implement `BucketSortPlayer.tsx`.** Create `src/components/exercises/BucketSortPlayer.tsx`:
```tsx
import { useState } from 'react';
import {
  DndContext, DragEndEvent, KeyboardSensor, PointerSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BucketSortConfig } from '@/lib/types';
import { useBucketAssignments } from './useBucketAssignments';

interface Props { config: BucketSortConfig; onComplete: () => void; }

const TRAY = '__tray__';

export function BucketSortPlayer({ config, onComplete }: Props) {
  const { t } = useTranslation();
  const { assignments, assign, isAllCorrect } = useBucketAssignments(config);
  const [selected, setSelected] = useState<string | null>(null);   // click-to-place selection
  const [checked, setChecked] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const place = (itemId: string, bucketId: string | null) => { assign(itemId, bucketId); setSelected(null); setChecked(false); };
  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over?.id as string | undefined;
    if (over) place(e.active.id as string, over === TRAY ? null : over);
  };
  const handleCheck = () => { setChecked(true); if (isAllCorrect) onComplete(); };

  const itemsIn = (bucketId: string | null) => config.items.filter((it) => (assignments[it.id] ?? null) === bucketId);
  const itemById = (id: string) => config.items.find((it) => it.id === id)!;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {/* Tray of unassigned items */}
      <Tray bucketId={null} selected={selected}>
        {itemsIn(null).map((it) => (
          <Item key={it.id} id={it.id} text={it.text} isSelected={selected === it.id}
            onSelect={() => setSelected(selected === it.id ? null : it.id)} />
        ))}
      </Tray>

      {/* One drop zone per bucket */}
      <div className="grid gap-4 sm:grid-cols-2 mt-4">
        {config.buckets.map((b) => (
          <Bucket key={b.id} id={b.id} label={b.label}
            canPlace={!!selected}
            onPlaceClick={() => selected && place(selected, b.id)}>
            {itemsIn(b.id).map((it) => {
              const correct = itemById(it.id).bucketId === b.id;
              return (
                <Item key={it.id} id={it.id} text={it.text} isSelected={selected === it.id}
                  feedback={checked ? (correct ? 'correct' : 'incorrect') : undefined}
                  onSelect={() => setSelected(selected === it.id ? null : it.id)} />
              );
            })}
          </Bucket>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={handleCheck}>{t('exercise.check')}</Button>
        {checked && (
          <span role="status" className={cn('text-sm', isAllCorrect ? 'text-green-600' : 'text-destructive')}>
            {isAllCorrect ? t('exercise.allCorrect') : t('exercise.tryAgain')}
          </span>
        )}
      </div>
    </DndContext>
  );
}

// Draggable + click-selectable item (button => keyboard/click operable by default)
function Item({ id, text, isSelected, feedback, onSelect }: {
  id: string; text: string; isSelected: boolean; feedback?: 'correct' | 'incorrect'; onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} type="button" onClick={onSelect}
      aria-pressed={isSelected}
      className={cn('block w-full text-left rounded-md border px-3 py-2 text-sm',
        isSelected && 'ring-2 ring-primary', isDragging && 'opacity-50',
        feedback === 'correct' && 'border-green-600 bg-green-50',
        feedback === 'incorrect' && 'border-destructive bg-destructive/10')}>
      {text}
    </button>
  );
}

function Bucket({ id, label, canPlace, onPlaceClick, children }: {
  id: string; label: string; canPlace: boolean; onPlaceClick: () => void; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn('rounded-lg border-2 border-dashed p-3', isOver && 'border-primary bg-accent')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {canPlace && (
          <button type="button" onClick={onPlaceClick} className="text-xs underline"
            aria-label={`place in ${label}`}>place here</button>
        )}
      </div>
      <div className="space-y-2 min-h-[3rem]">{children}</div>
    </div>
  );
}

function Tray({ children }: { bucketId: null; selected: string | null; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY });
  return <div ref={setNodeRef} className={cn('rounded-lg border p-3 space-y-2 min-h-[3rem]', isOver && 'bg-accent')}>{children}</div>;
}
```
> Accessibility note: items are `<button>`s (focusable, Enter/Space activatable) — the click-to-place path (`onSelect` then the bucket's "place here" button) is the keyboard/AT fallback; dnd-kit's `KeyboardSensor` additionally enables keyboard *drag*. Both drive the same `place()` function.

- [ ] **Step 6: Add the i18n keys used above** to `en.json` and `da.json` (a new top-level `exercise` block — full set added in Task 13; add these three now so the test/render resolve):
  - en: `"exercise": { "check": "Check", "allCorrect": "Correct!", "tryAgain": "Not quite — try again" }`
  - da: `"exercise": { "check": "Tjek", "allCorrect": "Rigtigt!", "tryAgain": "Ikke helt — prøv igen" }`

- [ ] **Step 7: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm test -- src/components/exercises/BucketSortPlayer.test.tsx && npx tsc --noEmit -p tsconfig.app.json
```
Expected: PASS; tsc exits 0.

- [ ] **Step 8: Commit.**
```bash
git add package.json package-lock.json src/components/exercises/useBucketAssignments.ts src/components/exercises/BucketSortPlayer.tsx src/components/exercises/BucketSortPlayer.test.tsx src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(exercises): dnd-kit BucketSortPlayer with accessible click/keyboard/drag placement (#227)"
```

---

## Task 9: Frontend — `QuickCheckPlayer` (MCQ, instant feedback)

**Files:**
- Create: `src/components/exercises/QuickCheckPlayer.tsx`
- Test: `src/components/exercises/QuickCheckPlayer.test.tsx`

**Interfaces:**
- Consumes: `QuickCheckConfig` (Task 7).
- Produces: `<QuickCheckPlayer config={QuickCheckConfig} onComplete={() => void} />`. Renders each question as a radio group; a "Check" button gives instant per-question feedback; unlimited retries; calls `onComplete` once when every question's selected option is the correct one.

- [ ] **Step 1: Write the failing test.** Create `src/components/exercises/QuickCheckPlayer.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickCheckPlayer } from './QuickCheckPlayer';
import type { QuickCheckConfig } from '@/lib/types';

const config: QuickCheckConfig = {
  version: 1,
  questions: [{
    id: 'q1', text: 'Good use of AI?',
    options: [
      { id: 'o1', text: 'Draft a first version', correct: true },
      { id: 'o2', text: 'Sign a contract unread', correct: false },
    ],
  }],
};

describe('QuickCheckPlayer', () => {
  it('completes when the correct option is chosen', () => {
    const onComplete = vi.fn();
    render(<QuickCheckPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('radio', { name: /Draft a first version/ }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not complete on a wrong choice, and allows retry', () => {
    const onComplete = vi.fn();
    render(<QuickCheckPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('radio', { name: /Sign a contract unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).not.toHaveBeenCalled();
    // retry with the right one
    fireEvent.click(screen.getByRole('radio', { name: /Draft a first version/ }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm test -- src/components/exercises/QuickCheckPlayer.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `QuickCheckPlayer.tsx`.** Create `src/components/exercises/QuickCheckPlayer.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { QuickCheckConfig } from '@/lib/types';

interface Props { config: QuickCheckConfig; onComplete: () => void; }

export function QuickCheckPlayer({ config, onComplete }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Record<string, string>>({}); // questionId -> optionId
  const [checked, setChecked] = useState(false);

  const isQuestionCorrect = (qId: string) => {
    const q = config.questions.find((x) => x.id === qId)!;
    const chosen = selected[qId];
    return !!chosen && q.options.find((o) => o.id === chosen)?.correct === true;
  };
  const allCorrect = config.questions.every((q) => isQuestionCorrect(q.id));

  const handleCheck = () => { setChecked(true); if (allCorrect) onComplete(); };

  return (
    <div className="space-y-6">
      {config.questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <p className="font-medium">{q.text}</p>
          <RadioGroup
            value={selected[q.id] ?? ''}
            onValueChange={(v) => { setSelected((p) => ({ ...p, [q.id]: v })); setChecked(false); }}
          >
            {q.options.map((o) => (
              <div key={o.id} className="flex items-center gap-2">
                <RadioGroupItem id={`${q.id}-${o.id}`} value={o.id} />
                <Label htmlFor={`${q.id}-${o.id}`}>{o.text}</Label>
              </div>
            ))}
          </RadioGroup>
          {checked && (
            <span role="status" className={cn('text-sm', isQuestionCorrect(q.id) ? 'text-green-600' : 'text-destructive')}>
              {isQuestionCorrect(q.id) ? t('exercise.allCorrect') : t('exercise.tryAgain')}
            </span>
          )}
        </div>
      ))}
      <Button onClick={handleCheck}>{t('exercise.check')}</Button>
    </div>
  );
}
```
> If `src/components/ui/radio-group.tsx` does not exist, add it via `npx shadcn@latest add radio-group` in Step 3a before implementing; verify with `ls src/components/ui/radio-group.tsx`.

- [ ] **Step 4: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm test -- src/components/exercises/QuickCheckPlayer.test.tsx && npx tsc --noEmit -p tsconfig.app.json
```
Expected: PASS; tsc exits 0.

- [ ] **Step 5: Commit.**
```bash
git add src/components/exercises/QuickCheckPlayer.tsx src/components/exercises/QuickCheckPlayer.test.tsx src/components/ui/radio-group.tsx
git commit -m "feat(exercises): QuickCheckPlayer (MCQ, instant feedback, unlimited retries) (#227)"
```

---

## Task 10: Frontend — `ExercisePlayer` dispatcher + CoursePlayer integration

**Files:**
- Create: `src/components/exercises/ExercisePlayer.tsx`
- Modify: `src/pages/learner/CoursePlayer.tsx` (fetch + render branch + completion)
- Modify: `src/pages/learner/CoursePlayer.test.tsx` (exercise render case)

**Interfaces:**
- Consumes: `useExerciseByLesson` (Task 7), `BucketSortPlayer` (Task 8), `QuickCheckPlayer` (Task 9).
- Produces: `<ExercisePlayer exercise={Exercise} onComplete={() => void} />` — switches on `exercise.exercise_kind`.
- In CoursePlayer, an `exercise` lesson renders `<ExercisePlayer>`; `onComplete` calls the existing `handleCompleteLesson()` (lines 221–265, reused unchanged — it posts `/api/lesson-progress` and then `/api/enrollment-complete` when the course is fully done).

- [ ] **Step 1: Implement the dispatcher.** Create `src/components/exercises/ExercisePlayer.tsx`:
```tsx
import type { Exercise, QuickCheckConfig, BucketSortConfig } from '@/lib/types';
import { QuickCheckPlayer } from './QuickCheckPlayer';
import { BucketSortPlayer } from './BucketSortPlayer';

interface Props { exercise: Exercise; onComplete: () => void; }

export function ExercisePlayer({ exercise, onComplete }: Props) {
  switch (exercise.exercise_kind) {
    case 'quick_check':
      return <QuickCheckPlayer config={exercise.config as QuickCheckConfig} onComplete={onComplete} />;
    case 'bucket_sort':
      return <BucketSortPlayer config={exercise.config as BucketSortConfig} onComplete={onComplete} />;
    default:
      return null; // unknown kind (future) — render nothing rather than crash
  }
}
```

- [ ] **Step 2: Wire the fetch in CoursePlayer.** In `src/pages/learner/CoursePlayer.tsx`, add the import near the other hook imports:
```ts
import { useExerciseByLesson } from '@/hooks/useExerciseByLesson';
import { ExercisePlayer } from '@/components/exercises/ExercisePlayer';
```
Below where `currentLesson` is derived, add a gated fetch (the hook self-gates on lessonId + enabled):
```ts
const { data: exerciseData } = useExerciseByLesson(
  currentLesson?.id,
  { enabled: currentLesson?.lesson_type === 'exercise' },
);
```

- [ ] **Step 3: Add the render branch.** In `CoursePlayer.tsx`, immediately after the quiz branch (ends after line 531's block), add:
```tsx
{currentLesson.lesson_type === 'exercise' && exerciseData?.exercise && (
  <div className="mt-4">
    <ExercisePlayer exercise={exerciseData.exercise} onComplete={() => handleCompleteLesson()} />
  </div>
)}
```

- [ ] **Step 4: Allow the footer complete-button gate to include exercises** — but keep it OPTIONAL (exercises complete via their own onComplete, so we do NOT want a redundant always-enabled "Mark complete"). Leave the line-696 gate `lesson_type !== 'quiz'` as-is ONLY IF it should still show for exercises; per ADR-0017 completion is correctness-gated, so the manual footer button must NOT bypass the exercise. Change the footer gate at line 696 from:
```tsx
{currentLesson.lesson_type !== 'quiz' && (
```
to also exclude exercise:
```tsx
{currentLesson.lesson_type !== 'quiz' && currentLesson.lesson_type !== 'exercise' && (
```
This ensures an exercise is only completable by getting it right (no manual override), honoring the correctness-gated rule — while still never *hard-blocking* the course (the learner can navigate to other lessons freely; course-completion simply won't include an unfinished exercise, which is acceptable per Q3).

- [ ] **Step 5: Add the player lesson-type label.** In `src/i18n/locales/en.json` `coursePlayer.lessonTypes` (lines 185–189) add `"exercise": "Exercise"`; in `da.json` add `"exercise": "Øvelse"`.

- [ ] **Step 6: Add a CoursePlayer test case.** In `src/pages/learner/CoursePlayer.test.tsx`, mock `useExerciseByLesson` to return a bucket_sort exercise and assert the player renders (a bucket label appears) when `currentLesson.lesson_type === 'exercise'`. Follow the file's existing mocking style (hoisted mock factory). Minimal add:
```tsx
vi.mock('@/hooks/useExerciseByLesson', () => ({
  useExerciseByLesson: () => ({ data: { exercise: {
    id: 'ex1', lesson_id: 'l-ex', exercise_kind: 'bucket_sort',
    config: { version: 1, buckets: [{ id: 'b1', label: 'Draft' }, { id: 'b2', label: 'Human' }],
      items: [{ id: 'i1', text: 'Brainstorm', bucketId: 'b1' }] },
  } } }),
}));
```
(Place a lesson of type `'exercise'` in the mocked course data for the relevant test, then assert `screen.getByText('Draft')` is present.)

- [ ] **Step 7: Verify + commit.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npx tsc --noEmit -p tsconfig.app.json && npm test -- src/pages/learner/CoursePlayer.test.tsx
git add src/components/exercises/ExercisePlayer.tsx src/pages/learner/CoursePlayer.tsx src/pages/learner/CoursePlayer.test.tsx src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(exercises): ExercisePlayer dispatcher + CoursePlayer rendering & completion (#227)"
```
Expected: tsc exits 0; CoursePlayer tests PASS.

---

## Task 11: Frontend — authoring sub-editors (`QuickCheckEditor`, `BucketSortEditor`) + `validateExercise`

**Files:**
- Create: `src/components/platform-admin/exercise-editors/validateExercise.ts` (client-side mirror of the server validator, for pre-submit UX)
- Create: `src/components/platform-admin/exercise-editors/QuickCheckEditor.tsx`
- Create: `src/components/platform-admin/exercise-editors/BucketSortEditor.tsx`
- Test: `src/components/platform-admin/exercise-editors/validateExercise.test.ts`

**Interfaces:**
- Produces:
  - `validateExercise(kind: ExerciseKind, config: ExerciseConfig): string | null` — same rules as `functions/shared/exercises/config.ts` (client-side pre-submit check; server remains the authority).
  - `<QuickCheckEditor value={QuickCheckConfig} onChange={(c: QuickCheckConfig) => void} />`
  - `<BucketSortEditor value={BucketSortConfig} onChange={(c: BucketSortConfig) => void} />`
  - Exported empty defaults: `emptyQuickCheck(): QuickCheckConfig`, `emptyBucketSort(): BucketSortConfig`.
- Consumed by: Task 12 (`ExerciseEditorDialog`).

- [ ] **Step 1: Write the failing validator test.** Create `validateExercise.test.ts` mirroring the server validator's key cases (unknown-kind handled by the dialog; here test shape rules):
```ts
import { describe, it, expect } from 'vitest';
import { validateExercise, emptyQuickCheck, emptyBucketSort } from './validateExercise';

describe('validateExercise', () => {
  it('flags an empty quick_check (needs 1–3 questions with content)', () => {
    expect(validateExercise('quick_check', emptyQuickCheck())).toMatch(/question/i);
  });
  it('flags a bucket_sort with an item assigned to no bucket', () => {
    const c = emptyBucketSort();
    c.buckets = [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }];
    c.items = [{ id: 'i1', text: 't', bucketId: '' }];
    expect(validateExercise('bucket_sort', c)).toMatch(/bucket/i);
  });
  it('passes a well-formed bucket_sort', () => {
    expect(validateExercise('bucket_sort', {
      version: 1, buckets: [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }],
      items: [{ id: 'i1', text: 't', bucketId: 'b1' }],
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm test -- src/components/platform-admin/exercise-editors/validateExercise.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `validateExercise.ts`** (mirror of the server rules; also provides empty defaults + an id generator):
```ts
import type { ExerciseKind, ExerciseConfig, QuickCheckConfig, BucketSortConfig } from '@/lib/types';

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const emptyQuickCheck = (): QuickCheckConfig => ({
  version: 1,
  questions: [{ id: newId('q'), text: '', options: [
    { id: newId('o'), text: '', correct: true },
    { id: newId('o'), text: '', correct: false },
  ] }],
});

export const emptyBucketSort = (): BucketSortConfig => ({
  version: 1,
  buckets: [{ id: newId('b'), label: '' }, { id: newId('b'), label: '' }],
  items: [{ id: newId('i'), text: '', bucketId: '' }],
});

export function validateExercise(kind: ExerciseKind, config: ExerciseConfig): string | null {
  if (kind === 'quick_check') {
    const c = config as QuickCheckConfig;
    if (c.questions.length < 1 || c.questions.length > 3) return 'Add 1–3 questions';
    for (const q of c.questions) {
      if (!q.text.trim()) return 'Every question needs text';
      if (q.options.length < 2) return 'Every question needs at least 2 options';
      if (q.options.some((o) => !o.text.trim())) return 'Every option needs text';
      if (q.options.filter((o) => o.correct).length !== 1) return 'Mark exactly one correct option per question';
    }
    return null;
  }
  const c = config as BucketSortConfig;
  if (c.buckets.length < 2) return 'Add at least 2 buckets';
  if (c.buckets.some((b) => !b.label.trim())) return 'Every bucket needs a label';
  if (c.items.length < 1) return 'Add at least 1 item';
  const ids = new Set(c.buckets.map((b) => b.id));
  for (const it of c.items) {
    if (!it.text.trim()) return 'Every item needs text';
    if (!it.bucketId || !ids.has(it.bucketId)) return 'Assign every item to a bucket';
  }
  return null;
}
```

- [ ] **Step 4: Implement `BucketSortEditor.tsx`** (add/remove buckets & items; each item has a bucket `<Select>`):
```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BucketSortConfig } from '@/lib/types';
import { newId } from './validateExercise';

interface Props { value: BucketSortConfig; onChange: (c: BucketSortConfig) => void; }

export function BucketSortEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<BucketSortConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-6">
      <section>
        <h4 className="font-medium mb-2">{t('exercise.editor.buckets')}</h4>
        {value.buckets.map((b, i) => (
          <div key={b.id} className="flex gap-2 mb-2">
            <Input value={b.label} placeholder={t('exercise.editor.bucketLabel')}
              onChange={(e) => set({ buckets: value.buckets.map((x) => x.id === b.id ? { ...x, label: e.target.value } : x) })} />
            <Button variant="ghost" onClick={() => set({
              buckets: value.buckets.filter((x) => x.id !== b.id),
              items: value.items.map((it) => it.bucketId === b.id ? { ...it, bucketId: '' } : it),
            })} disabled={value.buckets.length <= 2}>✕</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set({ buckets: [...value.buckets, { id: newId('b'), label: '' }] })}>
          {t('exercise.editor.addBucket')}
        </Button>
      </section>

      <section>
        <h4 className="font-medium mb-2">{t('exercise.editor.items')}</h4>
        {value.items.map((it) => (
          <div key={it.id} className="flex gap-2 mb-2">
            <Input value={it.text} placeholder={t('exercise.editor.itemText')}
              onChange={(e) => set({ items: value.items.map((x) => x.id === it.id ? { ...x, text: e.target.value } : x) })} />
            <Select value={it.bucketId || undefined}
              onValueChange={(v) => set({ items: value.items.map((x) => x.id === it.id ? { ...x, bucketId: v } : x) })}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t('exercise.editor.correctBucket')} /></SelectTrigger>
              <SelectContent>
                {value.buckets.map((b) => <SelectItem key={b.id} value={b.id}>{b.label || '—'}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={() => set({ items: value.items.filter((x) => x.id !== it.id) })}
              disabled={value.items.length <= 1}>✕</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set({ items: [...value.items, { id: newId('i'), text: '', bucketId: '' }] })}>
          {t('exercise.editor.addItem')}
        </Button>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Implement `QuickCheckEditor.tsx`** (add/remove questions & options; a single "correct" radio per question):
```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { QuickCheckConfig } from '@/lib/types';
import { newId } from './validateExercise';

interface Props { value: QuickCheckConfig; onChange: (c: QuickCheckConfig) => void; }

export function QuickCheckEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const setQuestions = (questions: QuickCheckConfig['questions']) => onChange({ ...value, questions });

  return (
    <div className="space-y-6">
      {value.questions.map((q, qi) => (
        <div key={q.id} className="rounded-md border p-3 space-y-2">
          <div className="flex gap-2">
            <Input value={q.text} placeholder={t('exercise.editor.questionText')}
              onChange={(e) => setQuestions(value.questions.map((x) => x.id === q.id ? { ...x, text: e.target.value } : x))} />
            <Button variant="ghost" onClick={() => setQuestions(value.questions.filter((x) => x.id !== q.id))}
              disabled={value.questions.length <= 1}>✕</Button>
          </div>
          {q.options.map((o) => (
            <div key={o.id} className="flex items-center gap-2 pl-4">
              <input type="radio" name={`correct-${q.id}`} checked={o.correct}
                aria-label={t('exercise.editor.markCorrect')}
                onChange={() => setQuestions(value.questions.map((x) => x.id === q.id
                  ? { ...x, options: x.options.map((oo) => ({ ...oo, correct: oo.id === o.id })) } : x))} />
              <Input value={o.text} placeholder={t('exercise.editor.optionText')}
                onChange={(e) => setQuestions(value.questions.map((x) => x.id === q.id
                  ? { ...x, options: x.options.map((oo) => oo.id === o.id ? { ...oo, text: e.target.value } : oo) } : x))} />
              <Button variant="ghost" size="sm" disabled={q.options.length <= 2}
                onClick={() => setQuestions(value.questions.map((x) => x.id === q.id
                  ? { ...x, options: x.options.filter((oo) => oo.id !== o.id) } : x))}>✕</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setQuestions(value.questions.map((x) => x.id === q.id
            ? { ...x, options: [...x.options, { id: newId('o'), text: '', correct: false }] } : x))}>
            {t('exercise.editor.addOption')}
          </Button>
        </div>
      ))}
      {value.questions.length < 3 && (
        <Button variant="outline" size="sm" onClick={() => setQuestions([...value.questions, {
          id: newId('q'), text: '', options: [
            { id: newId('o'), text: '', correct: true }, { id: newId('o'), text: '', correct: false },
          ],
        }])}>{t('exercise.editor.addQuestion')}</Button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests, confirm pass.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm test -- src/components/platform-admin/exercise-editors/validateExercise.test.ts && npx tsc --noEmit -p tsconfig.app.json
```
Expected: PASS; tsc exits 0.

- [ ] **Step 7: Commit.**
```bash
git add src/components/platform-admin/exercise-editors
git commit -m "feat(exercises): authoring sub-editors + client-side validateExercise (#227)"
```

---

## Task 12: Frontend — `ExerciseEditorDialog` + CourseEditor integration

**Files:**
- Create: `src/components/platform-admin/ExerciseEditorDialog.tsx`
- Modify: `src/pages/platform-admin/CourseEditor.tsx` (SelectItem, Edit button, state, dialog mount, in-dialog hint)
- Modify: `src/pages/platform-admin/CourseEditor.test.tsx` (mock `ExerciseEditorDialog`; exercise-enabled variant)

**Interfaces:**
- Consumes: `useExerciseAdmin` (Task 7), the sub-editors + `validateExercise` (Task 11), `queryKeys.exerciseAdmin` (Task 7).
- Produces: `<ExerciseEditorDialog lessonId lessonTitle open onOpenChange />` (mirrors `QuizEditorDialog`'s prop shape). Inside: a kind picker (`quick_check` / `bucket_sort`), the matching sub-editor, and a save that posts `/api/exercise-admin-save` and invalidates `queryKeys.exerciseAdmin.detail(lessonId)`. Changing the kind after content exists prompts a confirm and resets config.

- [ ] **Step 1: Implement `ExerciseEditorDialog.tsx`** (mirror `QuizEditorDialog.tsx:58-244`):
```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { toast } from '@/components/ui/sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ExerciseKind, ExerciseConfig, QuickCheckConfig, BucketSortConfig } from '@/lib/types';
import { useExerciseAdmin } from '@/hooks/useExerciseAdmin';
import { QuickCheckEditor } from './exercise-editors/QuickCheckEditor';
import { BucketSortEditor } from './exercise-editors/BucketSortEditor';
import { validateExercise, emptyQuickCheck, emptyBucketSort } from './exercise-editors/validateExercise';

interface Props { lessonId: string; lessonTitle: string; open: boolean; onOpenChange: (open: boolean) => void; }

const emptyFor = (kind: ExerciseKind): ExerciseConfig =>
  kind === 'quick_check' ? emptyQuickCheck() : emptyBucketSort();

export function ExerciseEditorDialog({ lessonId, lessonTitle, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ExerciseKind>('quick_check');
  const [config, setConfig] = useState<ExerciseConfig>(() => emptyQuickCheck());

  const { data } = useExerciseAdmin(lessonId, { enabled: open && !!lessonId });

  // Seed the form from the fetched exercise (or empty for a fresh lesson).
  useEffect(() => {
    if (!open) return;
    if (data?.exercise) { setKind(data.exercise.exercise_kind); setConfig(data.exercise.config); }
    else { setKind('quick_check'); setConfig(emptyQuickCheck()); }
  }, [open, data]);

  // Kind switch = confirmed destructive reset (config shapes are incompatible).
  const changeKind = (next: ExerciseKind) => {
    if (next === kind) return;
    if (!window.confirm(t('exercise.editor.switchKindConfirm'))) return;
    setKind(next); setConfig(emptyFor(next));
  };

  const save = useMutation({
    mutationFn: () => callApi('/api/exercise-admin-save', { lessonId, exerciseKind: kind, config }),
    onSuccess: () => {
      toast.success(t('exercise.editor.saved'));
      qc.invalidateQueries({ queryKey: queryKeys.exerciseAdmin.detail(lessonId), refetchType: 'none' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    const err = validateExercise(kind, config);
    if (err) { toast.error(err); return; }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('exercise.editor.title', { title: lessonTitle })}</DialogTitle></DialogHeader>

        <div className="mb-4">
          <Select value={kind} onValueChange={(v) => changeKind(v as ExerciseKind)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quick_check">{t('exercise.kind.quick_check')}</SelectItem>
              <SelectItem value="bucket_sort">{t('exercise.kind.bucket_sort')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === 'quick_check'
          ? <QuickCheckEditor value={config as QuickCheckConfig} onChange={setConfig} />
          : <BucketSortEditor value={config as BucketSortConfig} onChange={setConfig} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={save.isPending}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
> Reuse the app's existing `common.cancel`/`common.save` keys if present; if not, add them in Task 13. Verify with `grep -n '"cancel"\|"save"' src/i18n/locales/en.json`.

- [ ] **Step 2: CourseEditor — add the state.** In `src/pages/platform-admin/CourseEditor.tsx`, next to the quiz-dialog state (lines 103–104), add:
```ts
const [exerciseEditorOpen, setExerciseEditorOpen] = useState(false);
const [exerciseLessonId, setExerciseLessonId] = useState<string | null>(null);
const [exerciseLessonTitle, setExerciseLessonTitle] = useState('');
```

- [ ] **Step 3: CourseEditor — add the SelectItem.** In the lesson-type `<Select>` (after line 846's quiz item), add:
```tsx
{features.exercises_enabled && <SelectItem value="exercise">{t('courseEditor.lessonTypeExercise')}</SelectItem>}
```

- [ ] **Step 4: CourseEditor — add the "Edit Exercise" button.** Mirror the quiz button (lines 726–738); place it adjacent, gated on exercise:
```tsx
{lesson.lesson_type === 'exercise' && features.exercises_enabled && (
  <Button variant="outline" size="sm" onClick={() => {
    setExerciseLessonId(lesson.id);
    setExerciseLessonTitle(lesson.title);
    setExerciseEditorOpen(true);
  }}>{t('courseEditor.editExercise')}</Button>
)}
```

- [ ] **Step 5: CourseEditor — mount the dialog.** Mirror the QuizEditorDialog mount (lines 941–949); after it, add:
```tsx
{exerciseLessonId && (
  <ExerciseEditorDialog
    key={exerciseLessonId}
    lessonId={exerciseLessonId}
    lessonTitle={exerciseLessonTitle}
    open={exerciseEditorOpen}
    onOpenChange={setExerciseEditorOpen}
  />
)}
```
And import at the top (near line 27's `QuizEditorDialog` import):
```ts
import { ExerciseEditorDialog } from '@/components/platform-admin/ExerciseEditorDialog';
```

- [ ] **Step 6: CourseEditor — in-dialog hint.** Mirror the quiz hint block (lines 904–916); add a parallel `lessonType === 'exercise'` block telling the author to save the lesson, then use "Edit Exercise":
```tsx
{lessonType === 'exercise' && (
  <p className="text-sm text-muted-foreground">{t('courseEditor.exerciseSetupHint')}</p>
)}
```

- [ ] **Step 7: Update `CourseEditor.test.tsx`.** Add an `ExerciseEditorDialog` mock alongside the `QuizEditorDialog` mock (line 48):
```tsx
vi.mock('@/components/platform-admin/ExerciseEditorDialog', () => ({ ExerciseEditorDialog: () => null }));
```
(The existing feature mock has `quizzes_enabled: false`; if you add an assertion that the exercise SelectItem appears, use a local mock override with `exercises_enabled: true`.)

- [ ] **Step 8: Verify + commit.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npx tsc --noEmit -p tsconfig.app.json && npm test -- src/pages/platform-admin/CourseEditor.test.tsx
git add src/components/platform-admin/ExerciseEditorDialog.tsx src/pages/platform-admin/CourseEditor.tsx src/pages/platform-admin/CourseEditor.test.tsx
git commit -m "feat(exercises): ExerciseEditorDialog + CourseEditor authoring integration (#227)"
```
Expected: tsc exits 0; CourseEditor tests PASS.

---

## Task 13: i18n completeness + full verification gates

**Files:**
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/da.json` (complete the `exercise.*` block + `courseEditor.*` additions)

**Interfaces:**
- Produces: full, parallel `en`/`da` key coverage for every string introduced in Tasks 6–12.

- [ ] **Step 1: Complete the i18n keys.** Ensure BOTH `en.json` and `da.json` contain (with Danish translations in `da.json`), consolidating the partial keys added earlier:
```jsonc
// top-level "exercise" block
"exercise": {
  "check": "Check",
  "allCorrect": "Correct!",
  "tryAgain": "Not quite — try again",
  "kind": { "quick_check": "Quick-check", "bucket_sort": "Sort into buckets" },
  "editor": {
    "title": "Edit exercise — {{title}}",
    "saved": "Exercise saved",
    "switchKindConfirm": "Switching the exercise type will clear the current content. Continue?",
    "buckets": "Buckets", "bucketLabel": "Bucket label", "addBucket": "Add bucket",
    "items": "Items", "itemText": "Item text", "correctBucket": "Correct bucket", "addItem": "Add item",
    "questionText": "Question", "optionText": "Option", "markCorrect": "Mark correct",
    "addOption": "Add option", "addQuestion": "Add question"
  }
},
// within "coursePlayer.lessonTypes": add "exercise": "Exercise"
// within "courseEditor": add
"lessonTypeExercise": "Exercise",
"editExercise": "Edit Exercise",
"exerciseSetupHint": "Save the lesson first, then use \"Edit Exercise\" to build it."
// within "platformSettings.features": exercises_enabled + exercises_enabled_hint (added in Task 6)
```
Confirm `common.cancel` / `common.save` exist (grep); add if missing.

- [ ] **Step 2: Guard against missing/asymmetric keys.** Run a quick parity check:
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && node -e "const a=require('./src/i18n/locales/en.json'),b=require('./src/i18n/locales/da.json');const keys=o=>Object.keys(o).flatMap(k=>typeof o[k]==='object'&&o[k]?keys(o[k]).map(s=>k+'.'+s):[k]);const ea=new Set(keys(a)),eb=new Set(keys(b));const miss=[...ea].filter(k=>!eb.has(k)).concat([...eb].filter(k=>!ea.has(k)));console.log(miss.length?('ASYMMETRIC: '+miss.join(', ')):'i18n keys symmetric');"
```
Expected: `i18n keys symmetric`.

- [ ] **Step 3: Run the FULL gate suite.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings && npm run lint && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build
cd functions && npm run build && npm test
```
Expected: every command exits 0.

- [ ] **Step 4: Commit.**
```bash
cd /Users/martin/AIR/AIEDU/learn-wings
git add src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(exercises): complete en/da i18n coverage for exercises (#227)"
```

---

## Post-implementation (handoff, not part of the build)

- Flip ADR-0017 `status: proposed` → `status: accepted` with an `approval_date`/`approval_notes` once merged (append-only rule: edit only the status/approval fields at merge time).
- Append a dated `migration/WORKLOG.md` entry and update `migration/STATUS.html`'s checkpoint (per the merge ritual).
- **Owner action:** apply `migration/azure/07-exercises.sql` to production (owner-run — classifier blocks prod DDL from the session), then flip `features.exercises_enabled` on when ready to expose the family.

---

## Self-Review

**1. Spec coverage** (against the shared understanding + issue #227 Phase-1 checklist):
- `exercise` enum + `LessonType` union + `validate.ts` allow-list → Tasks 1, 2, 7. ✅
- Extensible `exercise_kind` discriminator + JSONB data model → Tasks 1, 2 (guardrails: text discriminator, `version` field, per-kind validator). ✅
- Quick-check MCQ kind → Tasks 2 (validator), 9 (player), 11 (editor). ✅
- Bucket-sort drag kind → Tasks 2, 8 (dnd-kit player), 11 (editor). ✅
- Foundation/Material + Instructions reuse existing lesson fields → existing lesson dialog fields are unchanged; exercise content is separate (Task 12 hint directs authors to save the lesson first). ✅
- Completion rules (ungraded, correctness-gated, non-blocking, no storage) → Task 10 (reuses `lesson-progress`; footer manual-complete excluded for exercise). ✅
- CourseEditor authoring → Task 12. CoursePlayer rendering → Task 10. ✅
- Accessibility (keyboard/click fallback for drag) → Task 8 (input-agnostic assignment model; buttons + click-to-place + dnd-kit KeyboardSensor). ✅
- ADR → written (`ADR-0017`). ✅
- i18n en+da, tests, gates green → Tasks throughout + Task 13. ✅
- Feature flag `exercises_enabled` (default off) → Tasks 1, 6. ✅
- Client-side correctness, no server grading, mirrored endpoints → Tasks 3, 4, 5, 8, 9. ✅

**2. Placeholder scan:** No "TBD"/"add validation"/"similar to Task N" — every code step carries full code; integration steps carry exact line anchors + the code to insert.

**3. Type consistency:** `ExerciseKind`, `QuickCheckConfig`, `BucketSortConfig`, `Exercise`, `validateExerciseConfig` (backend) / `validateExercise` (frontend), `useExerciseByLesson`/`useExerciseAdmin`, `queryKeys.exerciseAdmin.detail`/`exerciseByLesson.detail` are used consistently across tasks. Backend config validation (`functions/shared/exercises/config.ts`) and frontend validation (`validateExercise.ts`) are deliberate mirrors — the server remains the authority (ADR-0017).
