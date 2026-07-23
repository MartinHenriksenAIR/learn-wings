# Multilingual Course Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin mark two courses as the same course in different languages, so progress analytics combine the editions into one line and a learner can never be enrolled in both.

**Architecture:** A nullable `course_group_id` tag on `courses` groups language editions (NULL = standalone; group key = `COALESCE(course_group_id, id)`). A shared SQL-fragment helper (`functions/shared/course-groups.ts`, mirroring `course-visibility.ts`) supplies the group key, the group-member subquery, and the sibling-enrollment predicate. The three progress-analytics endpoints group by the tag and pick a representative edition by the admin's app language; the two enrollment endpoints reject a sibling-edition enrolment; a new admin endpoint links/unlinks editions; the course editor gets a "Language editions" section.

**Tech Stack:** Azure Functions v4 (Node ~20, raw `pg`), the `endpoint`/`adminEndpoint` factory (ADR-0015), Vitest (db mocked). Frontend: React 18 + TanStack Query v5, shadcn/ui, i18next (en+da).

## Global Constraints

- **Endpoint factory (ADR-0015):** every new/edited endpoint uses `endpoint(name, run)` or `adminEndpoint(name, run)` from `functions/shared/endpoint.ts`. Never hand-roll the HTTP/auth envelope. The factory auto-registers via `app.http`; a new endpoint folder MUST also be imported in `functions/index.ts` (the `functions/registration-names.test.ts` fleet guard fails otherwise).
- **SQL fragment builders interpolate author-supplied ordinals/identifiers only — never user input. Values always travel as bind parameters (`$n`).**
- **No `SELECT *` in analytics endpoints; explicit columns only.** (`courses-admin` is the pre-existing exception and stays as-is.)
- **`org-course-progress` deliberately has NO `is_published` filter** (parity: the pre-migration UI showed all access-enabled courses). Do not add one.
- **Authz:** course authoring is platform-admin-only (`adminEndpoint`). Analytics: `org-course-progress`/`org-course-enrollees` are org-admin (with a platform-admin `'all'` branch); `org-course-org-breakdown` is platform-admin-only. Preserve org-admin isolation exactly.
- **i18n:** en and da locale JSON must keep key parity — every new key is added to BOTH `src/i18n/locales/en.json` and `da.json`.
- **Language values are exactly `'en' | 'da'`** (nullable on `courses`).
- **Verification gates (all exit 0 before PR-ready):** root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/` `npm run build` · `npm test`.
- **Worktree path caution:** this work lives in the git worktree at `/Users/martin/AIR/AIEDU/learn-wings/.claude/worktrees/feat+multilingual-course-identity-213`. Edit files under THAT path (not the repo root) and run all commands from there, or gates go false-green against the wrong checkout.
- **Unit tests mock the DB**, so they validate the SQL a handler emits (fragments + bind params + status), not a live schema. The real schema change (Task 1) is exercised at DB-integration time, which is human-gated (pre-launch, mock data).

---

### Task 1: Schema column + Course type

Add the grouping tag and its indexes to the canonical schema, and surface it on the `Course` type. No behavior yet — this is the foundation Tasks 5–8 emit SQL against. (`courses-admin` already does `SELECT * FROM courses`, so the column flows to the frontend automatically once it exists and the type declares it.)

**Files:**
- Modify: `migration/azure/01-schema.sql` (the `public.courses` table, ~line 149)
- Modify: `src/lib/types.ts` (`Course` interface, ~line 61)

**Interfaces:**
- Produces: `courses.course_group_id uuid NULL`; group key convention `COALESCE(course_group_id, id)`; `Course.course_group_id: string | null`.

- [ ] **Step 1: Add the column to the courses table**

In `migration/azure/01-schema.sql`, add `course_group_id` to `public.courses` (immediately after the `language` column):

```sql
CREATE TABLE public.courses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  description         text,
  level               public.course_level NOT NULL DEFAULT 'basic',
  language            text CHECK (language IN ('en', 'da')),
  course_group_id     uuid,   -- #213: shared tag linking language editions of one course; NULL = standalone
  is_published        boolean NOT NULL DEFAULT false,
  thumbnail_url       text,
  created_by_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Add the indexes**

Immediately after the `CREATE TABLE public.courses (...)` statement (before `course_modules`):

```sql
-- #213: group lookups + at most one edition per language per group
CREATE INDEX idx_courses_course_group_id ON public.courses (course_group_id);
CREATE UNIQUE INDEX uq_courses_group_language
  ON public.courses (course_group_id, language)
  WHERE course_group_id IS NOT NULL;
```

- [ ] **Step 3: Add the field to the Course type**

In `src/lib/types.ts`, add to the `Course` interface (after `language`):

```typescript
export interface Course {
  id: string;
  title: string;
  description: string | null;
  level: CourseLevel;
  language: 'en' | 'da' | null;
  course_group_id: string | null;
  is_published: boolean;
  thumbnail_url: string | null;
  created_by_user_id: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Verify schema text and types compile**

Run:
```bash
grep -n "course_group_id" migration/azure/01-schema.sql
grep -n "uq_courses_group_language" migration/azure/01-schema.sql
npx tsc --noEmit -p tsconfig.app.json
```
Expected: the grep lines print the column + unique index; tsc exits 0 with no errors.

- [ ] **Step 5: Commit**

```bash
git add migration/azure/01-schema.sql src/lib/types.ts
git commit -m "feat(courses): add course_group_id grouping tag + Course type (#213)"
```

---

### Task 2: Shared course-groups SQL helper

Pure SQL-fragment builders (no DB access), mirroring `functions/shared/course-visibility.ts`. Fully unit-testable in isolation.

**Files:**
- Create: `functions/shared/course-groups.ts`
- Test: `functions/shared/course-groups.test.ts`

**Interfaces:**
- Produces:
  - `courseGroupKey(alias: string): string` → `COALESCE(<alias>.course_group_id, <alias>.id)`
  - `courseGroupMemberIds(courseParam: number): string` → subquery selecting every course id in the same group as the course bound at `$courseParam` (includes itself; standalone → just itself)
  - `siblingEnrollmentExists(opts: { orgParam: number; userParam: number; courseParam: number }): string` → boolean `EXISTS(...)` that is true when the user already has an enrolment in a *different* edition of the same group, in that org

- [ ] **Step 1: Write the failing test**

Create `functions/shared/course-groups.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { courseGroupKey, courseGroupMemberIds, siblingEnrollmentExists } from './course-groups';

describe('courseGroupKey', () => {
  it('coalesces course_group_id to id for the given alias', () => {
    expect(courseGroupKey('c')).toBe('COALESCE(c.course_group_id, c.id)');
  });
});

describe('courseGroupMemberIds', () => {
  it('selects every course id sharing the group of the course at the given ordinal', () => {
    const sql = courseGroupMemberIds(2);
    expect(sql).toContain('FROM courses gm');
    expect(sql).toContain('COALESCE(gm.course_group_id, gm.id)');
    expect(sql).toContain('WHERE gc.id = $2');
  });
});

describe('siblingEnrollmentExists', () => {
  it('builds an EXISTS predicate over a different edition of the same group', () => {
    const sql = siblingEnrollmentExists({ orgParam: 1, userParam: 2, courseParam: 3 });
    expect(sql.startsWith('EXISTS (')).toBe(true);
    expect(sql).toContain('e.org_id = $1');
    expect(sql).toContain('e.user_id = $2');
    expect(sql).toContain('target.id = $3');
    expect(sql).toContain('target.course_group_id IS NOT NULL');
    expect(sql).toContain('sib.course_group_id = target.course_group_id');
    expect(sql).toContain('sib.id <> target.id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run shared/course-groups.test.ts`
Expected: FAIL — `Cannot find module './course-groups'`.

- [ ] **Step 3: Write the implementation**

Create `functions/shared/course-groups.ts`:

```typescript
/**
 * Shared SQL fragments for course language-edition groups (#213).
 *
 * A "group" is the set of courses sharing a non-null course_group_id; a course
 * with NULL course_group_id is its own group of one. The group key is
 * COALESCE(course_group_id, id).
 *
 * Mirrors the fragment-builder contract of course-visibility.ts: these builders
 * interpolate SQL identifiers/ordinals supplied by the endpoint author — never
 * user input. Values still travel as bind parameters ($n).
 */

/** COALESCE(<alias>.course_group_id, <alias>.id) — the group key for GROUP BY / PARTITION BY. */
export function courseGroupKey(alias: string): string {
  return `COALESCE(${alias}.course_group_id, ${alias}.id)`;
}

/**
 * Subquery selecting every course id in the same group as the course bound at
 * $courseParam (includes that course itself; a standalone course yields just
 * itself). Intended for use inside `... IN ( <this> )`.
 */
export function courseGroupMemberIds(courseParam: number): string {
  return `SELECT gm.id FROM courses gm
           WHERE ${courseGroupKey('gm')} = (
             SELECT ${courseGroupKey('gc')} FROM courses gc WHERE gc.id = $${courseParam}
           )`;
}

/**
 * Boolean EXISTS predicate: the user at $userParam already has an enrolment in a
 * DIFFERENT edition of the same group as the course at $courseParam, within org
 * $orgParam. False for standalone courses (course_group_id IS NULL → no siblings).
 */
export function siblingEnrollmentExists({ orgParam, userParam, courseParam }: {
  orgParam: number;
  userParam: number;
  courseParam: number;
}): string {
  return `EXISTS (
    SELECT 1
      FROM enrollments e
      JOIN courses target ON target.id = $${courseParam}
      JOIN courses sib ON sib.id = e.course_id
     WHERE e.org_id = $${orgParam}
       AND e.user_id = $${userParam}
       AND target.course_group_id IS NOT NULL
       AND sib.course_group_id = target.course_group_id
       AND sib.id <> target.id
  )`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run shared/course-groups.test.ts`
Expected: PASS (all 3 suites green).

- [ ] **Step 5: Commit**

```bash
git add functions/shared/course-groups.ts functions/shared/course-groups.test.ts
git commit -m "feat(functions): shared course-group SQL fragment helpers (#213)"
```

---

### Task 3: Sibling-edition guard in `enroll` (learner self-enroll)

Block a learner self-enrolling into a course when they already hold an enrolment in a sibling edition (same group, same org).

**Files:**
- Modify: `functions/enroll/index.ts`
- Test: `functions/enroll/index.test.ts`

**Interfaces:**
- Consumes: `siblingEnrollmentExists` (Task 2).
- Produces: `enroll` returns `409 { error: 'Already enrolled in this course in another language' }` when a sibling enrolment exists.

- [ ] **Step 1: Write the failing test**

Append to `functions/enroll/index.test.ts` inside the `describe('enroll', ...)` block (the file mocks `queryOne` as `mockQueryOne`; the handler calls `queryOne` first for availability, then — new — for the sibling check, then for the insert):

```typescript
  it('returns 409 when the learner is already enrolled in a sibling edition', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ ok: true })       // availability check
      .mockResolvedValueOnce({ blocked: true }); // sibling-edition check

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-en' }), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'Already enrolled in this course in another language',
    });
    const siblingSql = mockQueryOne.mock.calls[1][0] as string;
    expect(siblingSql).toContain('sib.course_group_id = target.course_group_id');
  });

  it('allows enrolment when no sibling edition is enrolled', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ ok: true })        // availability
      .mockResolvedValueOnce({ blocked: false })  // sibling check
      .mockResolvedValueOnce({ id: 'enr-1', org_id: 'org-1', user_id: 'p1', course_id: 'c-en', status: 'enrolled', enrolled_at: 't', completed_at: null }); // insert

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-en' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).enrollment.id).toBe('enr-1');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run enroll/index.test.ts -t "sibling"`
Expected: FAIL — the 409 test gets 200 (no guard yet); the sibling-SQL assertion has no matching call.

- [ ] **Step 3: Add the guard**

In `functions/enroll/index.ts`, add the import and insert the sibling check between the availability check and the insert:

```typescript
import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate } from '../shared/course-visibility';
import { siblingEnrollmentExists } from '../shared/course-groups';
```

After the `if (!availability?.ok) { return reply(403, ...); }` block and before the insert:

```typescript
  // #213: a learner may hold only one language edition of a course per org.
  const sibling = await queryOne<{ blocked: boolean }>(
    `SELECT ${siblingEnrollmentExists({ orgParam: 1, userParam: 3, courseParam: 2 })} AS blocked`,
    [orgId, courseId, profile.id],
  );
  if (sibling?.blocked) {
    return reply(409, { error: 'Already enrolled in this course in another language' });
  }
```

(Bind order matches the existing `[orgId, courseId]` + `profile.id`: `$1=orgId`, `$2=courseId`, `$3=profile.id`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run enroll/index.test.ts`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add functions/enroll/index.ts functions/enroll/index.test.ts
git commit -m "feat(enroll): block self-enroll into a sibling language edition (#213)"
```

---

### Task 4: Sibling-edition guard in `enrollment-create` (admin enroll)

Same rule for the org-admin "Enroll User" path. Placed after the existing course/access preconditions, before the insert.

**Files:**
- Modify: `functions/enrollment-create/index.ts`
- Test: `functions/enrollment-create/index.test.ts`

**Interfaces:**
- Consumes: `siblingEnrollmentExists` (Task 2).
- Produces: `enrollment-create` returns `409 { error: 'Already enrolled in this course in another language' }` when the target user already holds a sibling edition in that org.

- [ ] **Step 1: Write the failing test**

Open `functions/enrollment-create/index.test.ts` to confirm the mock names (it mocks `queryOne`; check whether as `mockQueryOne` or similar and reuse that name). Add inside the describe block:

```typescript
  it('returns 409 when the target user already holds a sibling edition', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course precondition
      .mockResolvedValueOnce({ ok: true })           // org-access precondition (non-platform-admin)
      .mockResolvedValueOnce({ blocked: true });     // sibling-edition check

    const res = await handler(
      baseReq({ orgId: 'org-1', userId: 'u-9', courseId: 'c-en' }),
      {} as any,
    );

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'Already enrolled in this course in another language',
    });
  });
```

(If the existing test's `beforeEach` sets `is_platform_admin: false`, the access precondition `queryOne` runs — keep the three sequential `mockResolvedValueOnce`s in that order. If a test uses a platform admin, the access check is skipped; mirror the existing tests' setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run enrollment-create/index.test.ts -t "sibling"`
Expected: FAIL — returns 200/insert instead of 409.

- [ ] **Step 3: Add the guard**

In `functions/enrollment-create/index.ts`, add the import:

```typescript
import { siblingEnrollmentExists } from '../shared/course-groups';
```

Immediately before `const effectiveStatus = status ?? 'enrolled';`:

```typescript
  // #213: a learner may hold only one language edition of a course per org.
  const sibling = await queryOne<{ blocked: boolean }>(
    `SELECT ${siblingEnrollmentExists({ orgParam: 1, userParam: 2, courseParam: 3 })} AS blocked`,
    [orgId, userId, courseId],
  );
  if (sibling?.blocked) {
    return reply(409, { error: 'Already enrolled in this course in another language' });
  }
```

(`$1=orgId`, `$2=userId`, `$3=courseId` — matches this endpoint's variable order.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run enrollment-create/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/enrollment-create/index.ts functions/enrollment-create/index.test.ts
git commit -m "feat(enrollment-create): block admin enroll into a sibling language edition (#213)"
```

---

### Task 5: `course-translation-link` endpoint (link / unlink)

New admin-only endpoint that links a candidate course into a course's group, or unlinks a course from its group (collapsing a leftover group-of-one).

**Files:**
- Create: `functions/course-translation-link/index.ts`
- Test: `functions/course-translation-link/index.test.ts`
- Modify: `functions/index.ts` (register the endpoint import)

**Interfaces:**
- Consumes: `adminEndpoint`, `query`, `queryOne`, `isUniqueViolation` (from `../shared/db`).
- Produces: `POST /api/course-translation-link`
  - `{ action: 'link', courseId, otherCourseId }` → `200 { ok: true }`; `otherCourseId` joins `courseId`'s group (a fresh group id is minted if `courseId` is standalone).
  - `{ action: 'unlink', courseId }` → `200 { ok: true }`; clears `courseId`'s tag and, if one edition is left, clears that too.
  - Errors: `400` invalid action / ids / missing language; `404` course not found; `409` candidate already grouped OR same-language edition already in the group.

- [ ] **Step 1: Write the failing test**

Create `functions/course-translation-link/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsUniqueViolation } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsUniqueViolation: vi.fn(() => false),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, isUniqueViolation: mockIsUniqueViolation }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isOrgAdmin: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('course-translation-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsUniqueViolation.mockReturnValue(false);
  });

  it('returns 403 for a non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ action: 'unlink', courseId: 'c1' }), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 for an unknown action', async () => {
    const res = await handler(baseReq({ action: 'merge', courseId: 'c1' }), {} as any);
    expect(res.status).toBe(400);
  });

  it('links a standalone candidate into a standalone course (mints one group id for both)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: null }) // course
      .mockResolvedValueOnce({ id: 'c-en', language: 'en', course_group_id: null }) // other
      .mockResolvedValueOnce({ conflict: false });                                  // language-conflict check
    mockQuery.mockResolvedValueOnce([]); // UPDATE

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-en' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    const updateSql = mockQuery.mock.calls[0][0] as string;
    expect(updateSql).toContain('gen_random_uuid()');
  });

  it('rejects linking a candidate that already belongs to a group (409)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: null })
      .mockResolvedValueOnce({ id: 'c-en', language: 'en', course_group_id: 'g-existing' });

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-en' }), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).error).toMatch(/already linked/i);
  });

  it('rejects a same-language edition already in the group (409)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: 'g1' })
      .mockResolvedValueOnce({ id: 'c-da2', language: 'da', course_group_id: null })
      .mockResolvedValueOnce({ conflict: true }); // a da edition already in g1

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-da2' }), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).error).toMatch(/edition already exists/i);
  });

  it('returns 400 when a course to link has no language set', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-da', language: 'da', course_group_id: null })
      .mockResolvedValueOnce({ id: 'c-x', language: null, course_group_id: null });

    const res = await handler(baseReq({ action: 'link', courseId: 'c-da', otherCourseId: 'c-x' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/language/i);
  });

  it('unlinks a course and collapses a leftover group-of-one', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'c-en', course_group_id: 'g1' }) // load course
      .mockResolvedValueOnce({ remaining: 1 });                     // remaining count after clearing
    mockQuery
      .mockResolvedValueOnce([])  // clear the unlinked course
      .mockResolvedValueOnce([]); // collapse the leftover single edition

    const res = await handler(baseReq({ action: 'unlink', courseId: 'c-en' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('unlink on an already-standalone course is a no-op success', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'c1', course_group_id: null });
    const res = await handler(baseReq({ action: 'unlink', courseId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run course-translation-link/index.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write the endpoint**

Create `functions/course-translation-link/index.ts`:

```typescript
import { query, queryOne, isUniqueViolation } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

interface CourseRow {
  id: string;
  language: 'en' | 'da' | null;
  course_group_id: string | null;
}

export default adminEndpoint('course-translation-link', async ({ req, reply }) => {
  const { action, courseId, otherCourseId } = await req.json() as {
    action?: unknown;
    courseId?: unknown;
    otherCourseId?: unknown;
  };

  if (action !== 'link' && action !== 'unlink') {
    return reply(400, { error: "action must be 'link' or 'unlink'" });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  if (action === 'unlink') {
    const course = await queryOne<{ id: string; course_group_id: string | null }>(
      `SELECT id, course_group_id FROM courses WHERE id = $1`,
      [courseId],
    );
    if (!course) return reply(404, { error: 'Course not found' });
    if (!course.course_group_id) return reply(200, { ok: true }); // already standalone

    const groupId = course.course_group_id;
    await query(`UPDATE courses SET course_group_id = NULL WHERE id = $1`, [courseId]);

    // A group of one is meaningless — collapse the lone remaining edition to standalone.
    const rest = await queryOne<{ remaining: number }>(
      `SELECT COUNT(*)::int AS remaining FROM courses WHERE course_group_id = $1`,
      [groupId],
    );
    if ((rest?.remaining ?? 0) === 1) {
      await query(`UPDATE courses SET course_group_id = NULL WHERE course_group_id = $1`, [groupId]);
    }
    return reply(200, { ok: true });
  }

  // action === 'link'
  if (!otherCourseId || typeof otherCourseId !== 'string') {
    return reply(400, { error: 'otherCourseId is required' });
  }
  if (otherCourseId === courseId) {
    return reply(400, { error: 'A course cannot be linked to itself' });
  }

  const course = await queryOne<CourseRow>(
    `SELECT id, language, course_group_id FROM courses WHERE id = $1`,
    [courseId],
  );
  const other = await queryOne<CourseRow>(
    `SELECT id, language, course_group_id FROM courses WHERE id = $1`,
    [otherCourseId],
  );
  if (!course || !other) return reply(404, { error: 'Course not found' });

  if (!course.language || !other.language) {
    return reply(400, { error: 'Both courses must have a language set before linking' });
  }
  // No group-merging: the candidate must be standalone.
  if (other.course_group_id) {
    return reply(409, { error: 'The other course is already linked; unlink it first' });
  }

  if (course.course_group_id) {
    // Join the existing group — reject if that language already exists in it.
    const conflict = await queryOne<{ conflict: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM courses WHERE course_group_id = $1 AND language = $2
       ) AS conflict`,
      [course.course_group_id, other.language],
    );
    if (conflict?.conflict) {
      return reply(409, { error: `A ${other.language} edition already exists in this group` });
    }
    try {
      await query(`UPDATE courses SET course_group_id = $1 WHERE id = $2`, [course.course_group_id, other.id]);
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return reply(409, { error: `A ${other.language} edition already exists in this group` });
      }
      throw dbErr;
    }
    return reply(200, { ok: true });
  }

  // Both standalone — the two languages must differ, then mint one shared group id.
  if (course.language === other.language) {
    return reply(409, { error: `A ${other.language} edition already exists in this group` });
  }
  try {
    await query(
      `WITH g AS (SELECT gen_random_uuid() AS gid)
       UPDATE courses SET course_group_id = g.gid FROM g WHERE courses.id IN ($1, $2)`,
      [course.id, other.id],
    );
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: `A ${other.language} edition already exists in this group` });
    }
    throw dbErr;
  }
  return reply(200, { ok: true });
});
```

Note: the language-conflict `queryOne` in the existing-group branch is the third `queryOne` the "same-language" test expects (`{ conflict: true }`); the standalone happy-path test provides `{ conflict: false }` as its third `queryOne` but that branch checks `course.language === other.language` in code instead — verify the test's third mock is consumed. If the standalone path does not issue a third `queryOne`, drop the third `mockResolvedValueOnce` from the "links a standalone candidate" test in Step 1 so the mock queue matches the calls. Run the test and align.

- [ ] **Step 4: Register the endpoint**

In `functions/index.ts`, add the import in alphabetical position (near `import './course-update/index';`):

```typescript
import './course-translation-link/index';
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd functions && npx vitest run course-translation-link/index.test.ts registration-names.test.ts
```
Expected: PASS — the endpoint tests are green and the fleet registration guard still passes (new folder is registered).

- [ ] **Step 6: Commit**

```bash
git add functions/course-translation-link/index.ts functions/course-translation-link/index.test.ts functions/index.ts
git commit -m "feat(functions): course-translation-link endpoint to link/unlink editions (#213)"
```

---

### Task 6: `org-course-progress` — group-aware aggregation + representative edition

Rewrite both branches to group by `COALESCE(course_group_id, id)`, sum counts across editions, and pick the representative row (title/level) by the admin's app language with an earliest-created fallback. Thread the admin language through the hook and query key.

**Files:**
- Modify: `functions/org-course-progress/index.ts`
- Modify: `functions/org-course-progress/index.test.ts`
- Modify: `src/hooks/useOrgCourseProgress.ts`
- Modify: `src/lib/query-keys.ts` (`orgCourseProgress.detail`)
- Modify: `src/components/org-admin/analytics/CourseProgressTab.tsx` (pass language)

**Interfaces:**
- Consumes: `courseGroupKey` (Task 2), `orgCourseAccessEnabled` (existing).
- Produces:
  - `org-course-progress` request body gains `adminLang?: 'en' | 'da'` (invalid/missing → `'da'`). Single-org params `[orgId, adminLang]`; all-orgs params `[adminLang]`. Response shape unchanged (`{ courses: [{ id, title, level, enrolled, completed }] }`) — `id`/`title`/`level` are the representative edition's.
  - `useOrgCourseProgress(orgId, adminLang)`; `queryKeys.orgCourseProgress.detail(orgId, adminLang)`.

- [ ] **Step 1: Update the existing tests (write the new expectations first)**

In `functions/org-course-progress/index.test.ts`, replace the SQL/param assertions to reflect grouping + the language param. In the happy-path org-admin test (#5), change the params assertion and add group assertions:

```typescript
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('COALESCE(');
    expect(sql).toContain('course_group_id');
    expect(sql).toContain("(language = $2)");     // representative-by-admin-language
    expect(sql).toContain('oca.access = \'enabled\'');
    expect(sql).not.toContain('is_published');
    expect(sql).not.toContain('SELECT *');
    expect(params).toEqual(['org-1', 'da']);      // default adminLang
```

Update the request bodies in that test and the all-orgs test to pass `adminLang`, and adjust the all-orgs assertions:

```typescript
  // happy path (org admin): baseReq({ orgId: 'org-1', adminLang: 'da' })
  // all-orgs: baseReq({ orgId: 'all', adminLang: 'da' })
```

In the all-orgs "aggregates distinct-user counts" test:

```typescript
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('COUNT(DISTINCT e.user_id)');
    expect(sql).toContain('COALESCE(');
    expect(sql).toContain("(language = $1)");
    expect(params).toEqual(['da']);
```

Add one new grouping test:

```typescript
  it('groups language editions and defaults adminLang to da when omitted', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([{ id: 'c-da', title: 'AI Grundkursus', level: 'basic', enrolled: 20, completed: 20 }]);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any); // no adminLang

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('GROUP BY');
    expect(params).toEqual(['org-1', 'da']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run org-course-progress/index.test.ts`
Expected: FAIL — current SQL has no `COALESCE`/`(language = $2)`, params are `['org-1']` not `['org-1','da']`.

- [ ] **Step 3: Rewrite the endpoint**

Replace `functions/org-course-progress/index.ts` with:

```typescript
import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled } from '../shared/course-visibility';
import { courseGroupKey } from '../shared/course-groups';

const asLang = (v: unknown): 'en' | 'da' => (v === 'en' || v === 'da' ? v : 'da');

export default endpoint('org-course-progress', async ({ req, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const { orgId, adminLang } = await req.json() as { orgId?: string; adminLang?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  const lang = asLang(adminLang);

  // Representative edition per group: prefer the admin's app-language edition,
  // else the earliest-created; NULL languages never win ((x = $n) IS TRUE → false).
  // enrolled/completed are summed over the SAME visible edition set.

  if (orgId === 'all') {
    // All-orgs aggregate (#159) — platform-admin-only. Distinct learners across a group's
    // editions and orgs (a learner in different editions across two orgs counts once).
    requirePlatformAdmin();
    const courses = await query(
      `WITH visible AS (
         SELECT c.id, c.title, c.level, c.language, c.created_at,
                ${courseGroupKey('c')} AS group_key
           FROM courses c
          WHERE EXISTS (SELECT 1 FROM org_course_access oca
                         WHERE oca.course_id = c.id AND oca.access = 'enabled')
       ),
       counts AS (
         SELECT v.group_key,
                COUNT(DISTINCT e.user_id)::int AS enrolled,
                COUNT(DISTINCT e.user_id) FILTER (WHERE e.status = 'completed')::int AS completed
           FROM visible v
           LEFT JOIN enrollments e ON e.course_id = v.id
          GROUP BY v.group_key
       ),
       rep AS (
         SELECT DISTINCT ON (group_key) group_key, id, title, level
           FROM visible
          ORDER BY group_key, (language = $1) IS TRUE DESC, created_at ASC, id ASC
       )
       SELECT rep.id, rep.title, rep.level, counts.enrolled, counts.completed
         FROM rep JOIN counts USING (group_key)
        ORDER BY rep.title`,
      [lang],
    );
    return reply(200, { courses });
  }

  await requireOrgAdmin(orgId);

  const courses = await query(
    `WITH visible AS (
       SELECT c.id, c.title, c.level, c.language, c.created_at,
              ${courseGroupKey('c')} AS group_key
         FROM courses c
        WHERE ${orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 })}
     ),
     counts AS (
       SELECT v.group_key,
              COUNT(e.id)::int AS enrolled,
              COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
         FROM visible v
         LEFT JOIN enrollments e ON e.course_id = v.id AND e.org_id = $1
        GROUP BY v.group_key
     ),
     rep AS (
       SELECT DISTINCT ON (group_key) group_key, id, title, level
         FROM visible
        ORDER BY group_key, (language = $2) IS TRUE DESC, created_at ASC, id ASC
     )
     SELECT rep.id, rep.title, rep.level, counts.enrolled, counts.completed
       FROM rep JOIN counts USING (group_key)
      ORDER BY rep.title`,
    [orgId, lang],
  );
  return reply(200, { courses });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run org-course-progress/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread adminLang through the query key + hook**

In `src/lib/query-keys.ts`, update `orgCourseProgress.detail`:

```typescript
  orgCourseProgress: {
    /**
     * Full key: ['org-course-progress', orgId, adminLang]
     * adminLang is in the key because the representative edition's title/level
     * shown per group depends on the admin's app language (#213).
     */
    detail: (orgId: string | undefined, adminLang: string | undefined) =>
      ['org-course-progress', orgId, adminLang] as const,
  },
```

In `src/hooks/useOrgCourseProgress.ts`:

```typescript
export function useOrgCourseProgress(orgId: string | undefined, adminLang: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgCourseProgress.detail(orgId, adminLang),
    queryFn: async () => {
      const data = await callApi<OrgCourseProgressResult>('/api/org-course-progress', { orgId, adminLang });
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !!orgId,
  });
}
```

- [ ] **Step 6: Pass the admin language from the tab**

In `src/components/org-admin/analytics/CourseProgressTab.tsx`, change the translation hook to also get `i18n` and pass the resolved language:

```typescript
  const { t, i18n } = useTranslation();
  // ...
  const courseProgressQuery = useOrgCourseProgress(orgId, i18n.resolvedLanguage);
```

- [ ] **Step 7: Update the hook test + run frontend gates**

Update `src/hooks/useOrgCourseProgress.test.tsx` calls to pass an `adminLang` argument (e.g. `useOrgCourseProgress('org-1', 'da')`) and assert the request body includes `adminLang`. Then run:

```bash
npx vitest run src/hooks/useOrgCourseProgress.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```
Expected: PASS; tsc clean.

- [ ] **Step 8: Commit**

```bash
git add functions/org-course-progress/ src/hooks/useOrgCourseProgress.ts src/hooks/useOrgCourseProgress.test.tsx src/lib/query-keys.ts src/components/org-admin/analytics/CourseProgressTab.tsx
git commit -m "feat(analytics): combine language editions in org-course-progress (#213)"
```

---

### Task 7: Group-expand the drill-ins (`org-course-enrollees` + `org-course-org-breakdown`)

When the combined line is opened, both drill-ins must cover every edition in the group, keyed off the representative course id the frontend already passes.

**Files:**
- Modify: `functions/org-course-enrollees/index.ts`
- Modify: `functions/org-course-enrollees/index.test.ts`
- Modify: `functions/org-course-org-breakdown/index.ts`
- Modify: `functions/org-course-org-breakdown/index.test.ts`

**Interfaces:**
- Consumes: `courseGroupMemberIds` (Task 2).
- Produces: both endpoints resolve the passed `courseId` to its group's editions; response shapes unchanged.

- [ ] **Step 1: Write the failing tests**

In `functions/org-course-enrollees/index.test.ts`, update the SQL assertions for both branches to expect group expansion, e.g. in the org-admin happy path:

```typescript
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('e.course_id IN (');
    expect(sql).toContain('COALESCE(gm.course_group_id, gm.id)');
    expect(params).toEqual(['org-1', 'c-1']);
```

and in the all-orgs branch:

```typescript
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('e.course_id IN (');
    expect(sql).toContain('COALESCE(gm.course_group_id, gm.id)');
    expect(params).toEqual(['c-1']);
```

In `functions/org-course-org-breakdown/index.test.ts`, update its happy-path SQL assertions:

```typescript
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WITH grp AS');
    expect(sql).toContain('COALESCE(gm.course_group_id, gm.id)');
    expect(sql).toContain('IN (SELECT id FROM grp)');
    expect(params).toEqual(['c-1']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run org-course-enrollees/index.test.ts org-course-org-breakdown/index.test.ts`
Expected: FAIL — current SQL uses `e.course_id = $n`, no group subquery.

- [ ] **Step 3: Rewrite `org-course-enrollees`**

Replace the two queries in `functions/org-course-enrollees/index.ts` (add the import `import { courseGroupMemberIds } from '../shared/course-groups';`).

All-orgs branch:

```typescript
    const enrollees = await query(
      `SELECT e.user_id, p.full_name, e.org_id, o.name AS org_name, e.status, e.enrolled_at, e.completed_at
         FROM enrollments e
         JOIN profiles p ON p.id = e.user_id
         JOIN organizations o ON o.id = e.org_id
        WHERE e.course_id IN (${courseGroupMemberIds(1)})
        ORDER BY p.full_name, o.name`,
      [courseId],
    );
```

Org-scoped branch:

```typescript
    const enrollees = await query(
      `SELECT e.user_id, p.full_name, e.status, e.enrolled_at, e.completed_at
         FROM enrollments e
         JOIN profiles p ON p.id = e.user_id
        WHERE e.org_id = $1 AND e.course_id IN (${courseGroupMemberIds(2)})
        ORDER BY p.full_name`,
      [orgId, courseId],
    );
```

- [ ] **Step 4: Rewrite `org-course-org-breakdown`**

In `functions/org-course-org-breakdown/index.ts` (add `import { courseGroupMemberIds } from '../shared/course-groups';`), wrap the query in a `grp` CTE and swap the three `course_id = $1` references for `course_id IN (SELECT id FROM grp)`:

```typescript
  const orgs = await query(
    `WITH grp AS (${courseGroupMemberIds(1)})
     SELECT o.id AS org_id, o.name AS org_name,
            COUNT(e.id)::int AS enrolled,
            COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
       FROM organizations o
       JOIN (
         SELECT oca.org_id FROM org_course_access oca
          WHERE oca.course_id IN (SELECT id FROM grp) AND oca.access = 'enabled'
         UNION
         SELECT e.org_id FROM enrollments e WHERE e.course_id IN (SELECT id FROM grp)
       ) rel ON rel.org_id = o.id
       LEFT JOIN enrollments e ON e.course_id IN (SELECT id FROM grp) AND e.org_id = o.id
      GROUP BY o.id, o.name
      ORDER BY enrolled DESC, o.name`,
    [courseId],
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx vitest run org-course-enrollees/index.test.ts org-course-org-breakdown/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/org-course-enrollees/ functions/org-course-org-breakdown/
git commit -m "feat(analytics): expand enrollee + org-breakdown drill-ins across editions (#213)"
```

---

### Task 8: Course editor "Language editions" section

Add a section to the course editor to see linked editions, link a candidate, or unlink one. Uses the already-cached `courses-admin` list as the candidate source.

**Files:**
- Modify: `src/pages/platform-admin/CourseEditor.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/da.json`
- Test: `src/pages/platform-admin/CourseEditor.test.tsx` (extend the existing file)

**Interfaces:**
- Consumes: `POST /api/course-translation-link` (Task 5); `POST /api/courses-admin` (existing) via `queryKeys.coursesAdmin.all`; `Course.course_group_id` (Task 1).
- Produces: linking/unlinking UI; invalidates `queryKeys.coursesAdmin.all` on success.

- [ ] **Step 1: Add i18n keys (both locales)**

Add a `courseEditor.editions` block to `src/i18n/locales/en.json`:

```json
"editions": {
  "title": "Language editions",
  "description": "Link this course to its versions in other languages so analytics count them as one course.",
  "linkedHeading": "Linked editions",
  "none": "Not linked to any other language edition.",
  "linkPlaceholder": "Choose a course to link…",
  "linkButton": "Link",
  "unlinkButton": "Unlink",
  "noCandidates": "No eligible courses to link (a course must have a different language and not already be linked)."
}
```

And the Danish equivalents in `src/i18n/locales/da.json`:

```json
"editions": {
  "title": "Sprogudgaver",
  "description": "Sammenkæd dette kursus med dets versioner på andre sprog, så analyser tæller dem som ét kursus.",
  "linkedHeading": "Sammenkædede udgaver",
  "none": "Ikke sammenkædet med en anden sprogudgave.",
  "linkPlaceholder": "Vælg et kursus at sammenkæde…",
  "linkButton": "Sammenkæd",
  "unlinkButton": "Fjern kædning",
  "noCandidates": "Ingen kurser kan sammenkædes (et kursus skal have et andet sprog og må ikke allerede være kædet)."
}
```

Place the block under the existing `courseEditor` object in each file (next to `languageLabel`).

- [ ] **Step 2: Write the failing test**

Extend `src/pages/platform-admin/CourseEditor.test.tsx` with a test that renders the editor with a seeded `courses-admin` cache holding a standalone `en` candidate and asserts the "Language editions" section shows it as linkable. Follow the file's existing render/harness helpers (QueryClient seeding + mocked `callApi`). Minimum assertion:

```typescript
it('shows the Language editions section with an eligible candidate', async () => {
  // seed coursesAdmin cache: current course c-da (language 'da', course_group_id null)
  // + candidate c-en (language 'en', course_group_id null)
  // render CourseEditor for c-da …
  expect(await screen.findByText(/Language editions|Sprogudgaver/)).toBeInTheDocument();
  // the candidate title appears in the link picker
});
```

(Match the existing test file's mocking style — if it stubs `@/lib/api-client`, reuse that; mirror an existing `CourseEditor.test.tsx` case for the render harness.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/pages/platform-admin/CourseEditor.test.tsx -t "Language editions"`
Expected: FAIL — no such section rendered.

- [ ] **Step 4: Implement the section**

In `src/pages/platform-admin/CourseEditor.tsx`:

1. Import the candidate source and query helpers near the existing imports:

```typescript
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
```

2. Load the admin course list (shares the cache CoursesManager already populates):

```typescript
  const coursesAdminQuery = useQuery({
    queryKey: queryKeys.coursesAdmin.all,
    queryFn: async () => (await callApi<{ courses: Course[] }>('/api/courses-admin', {})).courses,
    staleTime: 60 * 1000,
  });
  const allCourses = coursesAdminQuery.data ?? [];
  const thisCourse = allCourses.find((c) => c.id === courseId);
  const siblings = thisCourse?.course_group_id
    ? allCourses.filter((c) => c.id !== courseId && c.course_group_id === thisCourse.course_group_id)
    : [];
  const groupLanguages = new Set(
    [thisCourse, ...siblings].filter(Boolean).map((c) => (c as Course).language),
  );
  const candidates = allCourses.filter(
    (c) =>
      c.id !== courseId &&
      !c.course_group_id &&
      c.language != null &&
      !groupLanguages.has(c.language),
  );
```

3. Add the link/unlink mutations (using the existing `useToastMutation` + `queryClient`):

```typescript
  const [linkTargetId, setLinkTargetId] = useState<string>('');

  const linkEditionMutation = useToastMutation({
    mutationFn: (otherCourseId: string) =>
      callApi('/api/course-translation-link', { action: 'link', courseId, otherCourseId }),
    errorTitle: 'Failed to link edition',
    onSuccess: () => {
      setLinkTargetId('');
      queryClient.invalidateQueries({ queryKey: queryKeys.coursesAdmin.all });
    },
  });

  const unlinkEditionMutation = useToastMutation({
    mutationFn: (targetCourseId: string) =>
      callApi('/api/course-translation-link', { action: 'unlink', courseId: targetCourseId }),
    errorTitle: 'Failed to unlink edition',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.coursesAdmin.all }),
  });
```

4. Render the section beside the language selector (near line ~504, after the language `<Select>` block), using the shadcn `Select`, `Button`, and `LanguageBadge` already imported in the file (add imports if missing):

```tsx
<div className="space-y-2">
  <Label>{t('courseEditor.editions.title')}</Label>
  <p className="text-sm text-muted-foreground">{t('courseEditor.editions.description')}</p>

  {siblings.length > 0 ? (
    <ul className="space-y-1">
      {siblings.map((s) => (
        <li key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="flex items-center gap-2">
            {s.title}
            {s.language && <LanguageBadge language={s.language} />}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => unlinkEditionMutation.mutate(s.id)}
            disabled={unlinkEditionMutation.isPending}
          >
            {t('courseEditor.editions.unlinkButton')}
          </Button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{t('courseEditor.editions.none')}</p>
  )}

  {candidates.length > 0 ? (
    <div className="flex items-center gap-2">
      <Select value={linkTargetId} onValueChange={setLinkTargetId}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder={t('courseEditor.editions.linkPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.title} ({c.language})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        onClick={() => linkTargetId && linkEditionMutation.mutate(linkTargetId)}
        disabled={!linkTargetId || linkEditionMutation.isPending}
      >
        {t('courseEditor.editions.linkButton')}
      </Button>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">{t('courseEditor.editions.noCandidates')}</p>
  )}
</div>
```

(Confirm `LanguageBadge` is imported — it exists at `@/components/ui/language-badge` from #191; add the import if the editor doesn't already have it.)

- [ ] **Step 5: Run test + frontend gates to verify pass**

Run:
```bash
npx vitest run src/pages/platform-admin/CourseEditor.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```
Expected: PASS; tsc + lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/platform-admin/CourseEditor.tsx src/pages/platform-admin/CourseEditor.test.tsx src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(course-editor): Language editions link/unlink section (#213)"
```

---

### Task 9: Full verification sweep

Run every gate across both trees before marking the PR ready.

- [ ] **Step 1: Frontend gates**

```bash
npm run lint && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build
```
Expected: all exit 0.

- [ ] **Step 2: Functions gates**

```bash
cd functions && npm run build && npm test
```
Expected: all exit 0 (includes `registration-names.test.ts`).

- [ ] **Step 3: Verify the feature end-to-end**

Use the `verify` skill (or the cache-seeded harness pattern from memory `verify_gated_ui_harness`) to drive: linking two courses in the editor → the org-admin Course Progress tab shows one combined row → a blocked sibling enrolment returns 409. Capture evidence.

- [ ] **Step 4: Mark PR ready + bookkeeping**

Per AGENTS.md: this is handled at merge time — append a dated `migration/WORKLOG.md` entry and update `migration/STATUS.html`'s checkpoint in the same PR (the `handoff` skill covers the merge/deploy ritual). Flip PR #215 out of draft when green.

---

## Self-Review

**Spec coverage:**
- Model / `course_group_id` + indexes → Task 1. ✅
- Group-key + sibling + member SQL helpers → Task 2. ✅
- Linking system (link/unlink, no-merge, one-per-language, collapse group-of-one, publish-state-independent) → Task 5 (endpoint) + Task 8 (UI). ✅
- Combined report line + representative (admin-language, earliest fallback, NULL-safe) across the three analytics surfaces → Task 6 (progress) + Task 7 (enrollees, breakdown). ✅
- Enrollment guard both paths (per-org) → Task 3 (self) + Task 4 (admin). ✅
- Drill-in shows all editions together; DA/EN tag intentionally omitted → Task 7 (no per-row language column added). ✅
- Non-goals (no content translation, learner catalog/publishing/access unchanged) → nothing in the plan touches `learner-courses`, `org-course-access`, or publishing. ✅
- No data migration → Task 1 column is nullable; existing rows default to standalone. ✅

**Placeholder scan:** No TBD/TODO; every code step carries real code; the one flagged verification (Task 5 Step 3 note about the third `queryOne` in the standalone happy-path) is an explicit align-the-mock instruction, not a placeholder.

**Type consistency:** `course_group_id` (snake_case DB / `Course.course_group_id`) consistent across Tasks 1, 5, 8. Helper names `courseGroupKey` / `courseGroupMemberIds` / `siblingEnrollmentExists` used identically in Tasks 2–7. Hook signature `useOrgCourseProgress(orgId, adminLang)` and key `orgCourseProgress.detail(orgId, adminLang)` consistent across Task 6 steps and call site. Request field `adminLang` consistent between endpoint (Task 6 Step 3), hook (Step 5), and tests (Step 1).
