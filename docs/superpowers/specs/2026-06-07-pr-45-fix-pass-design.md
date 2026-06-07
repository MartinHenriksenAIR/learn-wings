# PR #45 fix-pass — tactical patches

**Date:** 2026-06-07
**Author:** Martin (via Claude)
**Status:** Approved, ready for implementation plan
**Target branch:** `martin/9-organizations-cutover` (PR #45, open)

## Context

The `/code-review --max` pass over PR #45 ("feat: organizations cutover (#9)") surfaced 15 findings ranging from a behavior regression to maintenance debt. Nothing blocks the release, but five findings are user-visible bugs that should not ship behind a "no release blockers" judgment. This document specs the tactical fix-pass that resolves them in this PR; cross-cutting refactors get filed as follow-up issues instead.

## Goals

1. Resolve all five Fix-this-slice findings (sort regression, frontend/backend validation drift, two silent fetch-error UX paths, post-create partial-failure silent path).
2. Add a small, well-bounded helper for the logo URL composition pattern that has bitten us three times already.
3. Add the partial index needed before `member_count` becomes a hot query.
4. File the architectural improvements (structured error codes, shared validation, helper cleanup) as separate GitHub issues so they get the attention they deserve in their own PRs.

## Non-goals

- No backend error-code scheme in this PR (filed as a follow-up issue).
- No shared org-validation module in this PR (filed as a follow-up issue).
- No corsResponse return-type fix or cast cleanup in this PR (filed as a follow-up issue — touches ~20 unrelated function files).
- No "Try again" button on the OrganizationDetail empty state (filed as a follow-up issue).
- No `supabase.from('profiles' | 'org_memberships' | 'invitations')` removal in cut-over files (filed as a follow-up issue — scope-clarification for Slice 3b/4).

## Cluster A — Surgical fixes

### A.1 Restore "newest first" ordering on the Organizations list

`functions/organizations/index.ts` (both LIST branches): `ORDER BY o.name` → `ORDER BY o.created_at DESC`.

Tests in `functions/organizations/index.test.ts` do not assert ordering today; no test changes required.

### A.2 Align edit-dialog validation with backend

`src/pages/platform-admin/OrganizationDetail.tsx:88-92` `editOrgSchema`:
- `name`: `.min(1, 'Name is required')` → `.min(2, 'Name must be at least 2 characters')`
- `slug`: `.min(1, 'Slug is required')` → `.min(2, 'Slug must be at least 2 characters')`

Mirrors `OrganizationsManager.orgSchema` and the backend validators in `functions/organization-create/index.ts` and `functions/organization-update/index.ts`.

### A.3 Collapse organization-update SELECT+UPDATE into a single statement

`functions/organization-update/index.ts`: remove the existence-check SELECT. Rely on `UPDATE ... RETURNING ...` returning null when the `WHERE id = $N` matches no rows, then 404.

```ts
// before
const existing = await queryOne<OrgRow>(`SELECT id FROM organizations WHERE id = $1`, [orgId]);
if (!existing) return corsResponse(origin, 404, { error: 'Organization not found' });
// ... build setClauses ...
const organization = await queryOne(`UPDATE organizations SET ${...} WHERE id = $${idIndex} RETURNING ...`, params);
return corsResponse(origin, 200, { organization });

// after
// ... build setClauses ...
const organization = await queryOne(`UPDATE organizations SET ${...} WHERE id = $${idIndex} RETURNING ...`, params);
if (!organization) return corsResponse(origin, 404, { error: 'Organization not found' });
return corsResponse(origin, 200, { organization });
```

Authz still happens before the UPDATE (no enumeration through 404 vs 403 for non-admins, since they hit 403 first). 23505 duplicate-slug handling unchanged.

Tests: `functions/organization-update/index.test.ts` chains two `mockQueryOne.mockResolvedValueOnce(...)` calls (SELECT then UPDATE). Collapse to a single `mockResolvedValueOnce(...)` for the UPDATE result. The 404 test changes from "SELECT returns null" to "UPDATE returns null".

### A.4 Collapse organization-delete SELECT+DELETE into a single statement

`functions/organization-delete/index.ts`: same pattern. `DELETE FROM organizations WHERE id = $1 RETURNING id`. Null → 404. Non-null → 200 with `{ ok: true }`.

Tests: same shape of change — one mocked call (`mockQueryOne` for DELETE RETURNING) instead of two. Drop the `mockQuery` plumbing; only `queryOne` is used now.

### A.5 Add `member_count` to the `Organization` type

`src/lib/types.ts` `Organization` interface gains `member_count?: number` (snake_case, matching backend).

Removes the `Organization & { member_count: number }` intersection at `OrganizationsManager.fetchOrgs:73`. `OrgSelector.tsx:27`'s `Organization[]` annotation is now accurate (extra field is harmless and typed).

`OrganizationsManager`'s `orgs` state currently uses `(Organization & { memberCount: number })[]`. Since we're keeping the snake→camel translation at the fetch boundary in this PR (changing it across pages is out of scope), the state stays the way it is. Only the API-response type gets the new field.

## Cluster B — Stop swallowing failures

### B.1 `OrganizationsManager.fetchOrgs` — surface fetch errors

Add a destructive toast before `console.error`:

```ts
} catch (err) {
  toast({
    title: 'Failed to load organizations',
    description: err instanceof Error ? err.message : 'Unknown error',
    variant: 'destructive',
  });
  console.error('OrganizationsManager: failed to load organizations', err);
}
```

Empty-state UI still renders if the fetch failed (since `orgs` stays `[]`), but the toast now disambiguates "load failed" from "genuinely zero orgs".

### B.2 `OrganizationDetail.fetchData` — surface org-fetch errors

Same pattern around the `callApi('/api/organizations', { orgId })` call: destructive toast `'Failed to load organization'` before `console.error`. The `!org` empty-state branch still renders behind the toast (see Follow-up issue #4 for the deferred "Try again" button).

### B.3 `OrganizationsManager.handleCreate` — surface post-create failures

**Scope note:** the post-create steps (`supabase.from('org_memberships').insert(...)`, `supabase.from('invitations').insert(...)`, `supabase.rpc('get_invitation_link_id', ...)`, `sendInvitationEmail`) still call Supabase directly. This violates `.claude/rules/frontend.md`'s "no `supabase.*` in cut-over files" rule, but PR #45's description explicitly defers memberships/invitations to **Slice 3b**. B.3 does NOT migrate those calls — it only adds error capture around them so the failure isn't silent in the interim. The full migration is tracked in Follow-up Issue #5; that issue is what removes the Supabase usage entirely.

Inline comment in the code should make this explicit, e.g. `// TODO(slice-3b): replace with callApi('/api/org-membership-create') once that endpoint exists` next to each remaining `supabase.*` call in this handler, so the next slice author finds them without grepping.

The post-create supabase calls return error objects without throwing. Capture them, and on the first failure replace the success toast with a destructive warning toast.

Concrete change inside the outer `try` after `newOrg` is set:

```ts
let postCreateError: string | null = null;

if (adminTab === 'existing' && selectedUserId) {
  const { error } = await supabase.from('org_memberships').insert({...});
  if (error) postCreateError = `admin assignment failed: ${error.message}`;
} else if (adminTab === 'invite' && inviteEmail.trim() && !postCreateError) {
  const { data: insertedInvitation, error: inviteErr } = await supabase
    .from('invitations')
    .insert({...})
    .select('id')
    .single();
  if (inviteErr) {
    postCreateError = `invitation creation failed: ${inviteErr.message}`;
  } else if (insertedInvitation?.id) {
    const { data: linkId, error: linkErr } = await supabase
      .rpc('get_invitation_link_id', { invitation_id: insertedInvitation.id });
    if (linkErr) {
      postCreateError = `invitation link generation failed: ${linkErr.message}`;
    } else if (linkId) {
      const emailResult = await sendInvitationEmail({...});
      if (!emailResult.success) {
        postCreateError = `invitation email failed: ${emailResult.error ?? 'unknown'}`;
      }
    }
  }
}

if (postCreateError) {
  toast({
    title: 'Organization created, but follow-up step failed',
    description: postCreateError,
    variant: 'destructive',
  });
} else {
  toast({
    title: 'Organization created!',
    description: `${name} is now ready.`,
  });
}
setCreateOpen(false);
resetForm();
fetchOrgs();
```

Dialog still closes; list still refreshes. The org exists either way — the user can open it and finish the missing step manually.

## Cluster C — `buildPublicUrl` helper

New file `src/lib/storage-url.ts`:

```ts
/**
 * Compose a public asset URL from VITE_STORAGE_BASE_URL + storage path.
 * Throws if VITE_STORAGE_BASE_URL is not configured — caller should let the
 * error bubble so the failure is visible in the upload UI rather than
 * silently writing a broken URL into the database.
 */
export function buildPublicUrl(storagePath: string): string {
  const base = import.meta.env.VITE_STORAGE_BASE_URL as string | undefined;
  if (!base) {
    throw new Error('VITE_STORAGE_BASE_URL is not configured');
  }
  return `${base.replace(/\/$/, '')}/${storagePath.replace(/^\//, '')}`;
}
```

Replaces the inline `${import.meta.env.VITE_STORAGE_BASE_URL ?? ''}/${storagePath}` in:

- `src/pages/platform-admin/OrganizationsManager.tsx:253` (logo upload onChange)
- `src/pages/platform-admin/OrganizationDetail.tsx:997` (edit-dialog logo onChange)
- `src/pages/org-admin/OrgAnalytics.tsx:194` (org-admin logo onChange)

Three replacements. The `OrgAnalytics.tsx` callsite is technically outside this slice's nominal scope but lives on the same line as the same bug — fixing it here costs nothing and reduces drift risk. Call this out in the PR description so reviewers don't trip on it.

Add `src/lib/storage-url.test.ts` covering:
- Happy path: base without trailing slash + path without leading slash.
- Trailing slash on base is stripped.
- Leading slash on path is stripped.
- Both slashes present → single slash in result (no double).
- Missing env → throws.

## Cluster G — `(org_id) WHERE status = 'active'` partial index

New migration `supabase/migrations/<timestamp>_org_memberships_active_index.sql`:

```sql
-- Partial index for member_count correlated subquery and isActiveMember lookups.
-- Only indexes active rows (the only status the subquery filters by), keeping
-- the index small. UNIQUE(org_id, user_id) already covers exact-membership
-- lookups; this adds the org-wide active-count lookup.
CREATE INDEX IF NOT EXISTS org_memberships_org_id_active_idx
  ON public.org_memberships (org_id)
  WHERE status = 'active';
```

`IF NOT EXISTS` so re-running against an environment that already has the index is a no-op.

Use a fresh timestamp from `migration/STATUS.html`'s clock convention (`date -u +%Y%m%d%H%M%S` at apply time) plus a short suffix. Apply locally first, verify the `member_count` query plan switches to an index scan via `EXPLAIN ANALYZE`.

## Follow-up GitHub issues to file (post-merge)

To be created at the end of this PR's work, before pushing:

1. **`feat(backend): structured error codes for 4xx responses`** — issues #6 + #14 from the review. Backend error responses gain an optional `code` field; introduce `'DUPLICATE_SLUG'` first, frontend `OrganizationsManager.handleCreate` matches on code instead of message text. Also extract `isUniqueViolation(err)` shared helper in `functions/shared/db.ts` to dedupe the 23505 mapping.

2. **`refactor: shared org-validation module`** — issue #13. Single source of truth for slug regex, name length, slug length. Both backend handlers and frontend zod schemas import from it. Prevents the kind of drift that caused #2 in this PR.

3. **`refactor: corsResponse return type + cast cleanup`** — issue #12. Change `functions/shared/cors.ts` `corsResponse` and `corsPreflightResponse` return types to `HttpResponseInit`; remove all `as HttpResponseInit` casts across the function tree (~20 files, ~100 sites). Touches files outside any one slice's scope, deserves its own focused PR.

4. **`ux: 'Try again' button on OrganizationDetail empty state`** — when the org fetch fails (not when it's genuinely missing), the empty state should offer a retry without requiring a full page reload.

5. **`scope: clarify which slice owns the remaining supabase.from(...) calls in cut-over files`** — issue #11. `OrganizationsManager.fetchProfiles` and `OrganizationDetail.fetchData`'s membership/invitation/profile fetches still use the Supabase client. PR description names memberships/invitations as Slice 3b; profiles isn't explicitly assigned. File scope clarification so each remaining call has an owner.

## Test plan

- `cd functions && npm test` — expect updates to `organization-update/index.test.ts` and `organization-delete/index.test.ts` for the collapsed SELECT+UPDATE / SELECT+DELETE flows. All other suites should remain green (839 → 839+ tests).
- Root `npm test` — should remain at 27/27 plus the new `storage-url.test.ts` tests.
- `npx tsc --noEmit -p tsconfig.app.json` — exit 0.
- `npm run build` — green.
- Migration: apply locally, `EXPLAIN ANALYZE` the `member_count` query, confirm partial-index usage.
- Manual smoke (dev server):
  - Org list page loads with newest org at top.
  - Edit dialog rejects 1-character name/slug client-side with the new min(2) message.
  - Block `/api/organizations` with browser devtools → toast appears + console.error fires.
  - Block `/api/organization-update` → handleSaveEdit shows destructive toast.
  - Simulate `org_memberships.insert` failure via Supabase Studio (e.g. temporarily revoke insert on the table) → warning toast on create with "admin assignment failed".
  - Logo upload writes the correct URL with VITE_STORAGE_BASE_URL set, no double slashes; unset env → upload throws with a clear message in the dialog.

## Risk assessment

- **Behavior change visible to users** — sort order revert (intended). Communicate in PR description.
- **Test churn** — update-and-delete suites need restructuring; mechanical.
- **New migration** — partial index is safe to add online (Postgres `CREATE INDEX IF NOT EXISTS` is non-blocking at the table level when no concurrent DDL; CONCURRENTLY isn't needed for small `org_memberships`).
- **`storage-url.ts` throw-on-missing-env** — staging or local environments missing the var will now error visibly in the upload dialog. Net positive (fail fast vs. silent broken URL), but verify Azure App Service Static Web Apps environment has `VITE_STORAGE_BASE_URL` set before merge.

## Acceptance

All 5 Definition-of-Done gates from `slice-workflow` remain green:
1. ✅ Contract tests pass.
2. ⏳ Deploy & reachable post-merge.
3. ✅ Frontend cutover proof — no new `supabase.*` introduced (the helper avoids touching new Supabase calls); zero `getPublicUrl` left.
4. ⏳ Gate 4 user e2e on PR-6 preview after merge.
5. ✅ Parity preserved — sort restored, validation aligned, error UX surfaced.
