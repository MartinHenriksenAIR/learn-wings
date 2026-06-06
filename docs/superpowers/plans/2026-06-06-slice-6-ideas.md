# Slice 6 — Ideas (Supabase → Azure cutover) — Implementation Plan

- **Date:** 2026-06-06
- **Branch:** `feature/lovable-migration`
- **Spec:** `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` §"Slice 6" + §7 (untracked, disk-only — this plan is disk-only too, do not commit)
- **Ledger:** `migration/STATUS.html` (live), `migration/WORKLOG.md` (append-only; Slice 5 entry is the model)
- **Execution:** subagent-driven (implementer → spec review → quality review per task)

## Scope

Backend: 12 new Azure Functions over tables `ideas`, `idea_comments`, `idea_votes` (POST-only RPC, Slice 5 naming style). Frontend: rewrite `src/lib/ideas-api.ts` internals over `callApi` (all 4 ideas pages are lib-only consumers — exported signatures preserved). Riders: unenroll-dialog markup+copy fix; Courses.tsx loading-guard alignment. Deploy + 401 smoke + ledger updates.

Fixes the confirmed STATUS.html KNOWN BUG: idea create/draft/vote/comment all fail under MSAL (`supabase.auth.getUser()` gate).

## Endpoint map (POST-only RPC; no route may start with admin/runtime/host)

| Function name | Replaces (spec intent) | Body |
|---|---|---|
| `ideas` | GET /ideas | `{orgId, status?[], businessArea?[], tags?[], search?, userId?}` |
| `idea` | GET /ideas/:id | `{ideaId}` |
| `idea-create` | POST /ideas | `{orgId, title, ...optional whitelisted fields}` |
| `idea-update` | PATCH /ideas/:id | `{ideaId, updates:{...whitelist}}` |
| `idea-submit` | POST /ideas/:id/submit | `{ideaId}` |
| `idea-status-update` | PATCH /ideas/:id/status | `{ideaId, status, adminNotes?, rejectionReason?}` |
| `idea-delete` | DELETE /ideas/:id | `{ideaId}` |
| `idea-vote` | POST /ideas/:id/vote | `{ideaId}` |
| `idea-vote-remove` | DELETE /ideas/:id/vote | `{ideaId}` |
| `idea-comments` | GET /ideas/:id/comments | `{ideaId}` |
| `idea-comment-create` | POST /ideas/:id/comments | `{ideaId, content, parentCommentId?}` |
| `idea-tags` | GET /ideas/tags?orgId= | `{orgId}` |

## Authorization parity table

**Provenance caveat (finding):** the `ideas`/`idea_votes`/`idea_comments` CREATE TABLE and their **base** RLS policies never landed in `supabase/migrations/` (Lovable-managed migration gap; confirmed by `migration/azure/01-schema.sql:391-394` — schema was reconstructed from generated types.ts). Only later amendments are in-repo. Where no in-repo policy exists, authorization below is **reconstructed** from UI behavior + suite conventions, marked `[R]`. In-repo provenance is cited by migration file.

Note: `ideas.org_id` is `NOT NULL` — ideas are never global-scoped, so Slice 5's NULL-org admin-leak lesson does not apply here.

| Endpoint | Authorization | Provenance |
|---|---|---|
| `ideas` (list) | Caller must be platform admin or active member of `orgId`, else 403. Row rule: org's ideas where `status != 'draft' OR user_id = caller`. **Drafts are author-private for every role** (no org/platform-admin visibility bypass). | `[R]` — IdeaLibrary.tsx:95-99 (drafts tab self-filtered), OrgIdeasManagement.tsx:89 (drafts excluded), IdeaSubmit.tsx:120 (author-gated draft load). Membership gate mirrors `community-posts` org scope. Draft privacy: the admin-bypass convention covers org-membership checks, not author privacy of unpublished content; no UI path views another's draft. |
| `idea` (single) | Missing / non-member / other-author's-draft → **200 `{idea: null}`** (Supabase `.maybeSingle()` + RLS no-row parity, exactly like `community-post`). | `[R]` — old `fetchIdea` returned `null` on PGRST116; RLS made invisible rows look missing. |
| `idea-create` | Platform admin or active member of body `orgId`. Server sets `user_id = profile.id`, `status = 'draft'` always. | `[R]` — old client hardcoded `status:'draft'`, user_id from auth. Membership mirrors community INSERT (`is_org_member`). |
| `idea-update` | Author only, and only while `status = 'draft'` → else 403/409. Invisible/missing → `{idea:null}`-style 404. Field whitelist (below). | `[R]` — IdeaSubmit.tsx:120 guard; old lib comment "draft only for authors"; the superseded policy name "Users can delete their own **draft** ideas" (20260202140817) shows the original author policies were draft-scoped. Org-admin full UPDATE (20260401095857) is served by `idea-status-update`, not here. |
| `idea-submit` | Author only; `draft → submitted`, server sets `submitted_at = now()`. Not draft → 409. | `[R]` — old `submitIdea` ran under the author-draft UPDATE policy. |
| `idea-status-update` | Org admin of the idea's org OR platform admin. Any valid `idea_status` value allowed (incl. back to draft). `admin_notes` updated only when provided (supabase-js strips `undefined` — parity); `rejection_reason = status === 'rejected' ? value ?? null : null`. | **In-repo:** 20260401095857 "Org admins can update ideas in their org" (`is_org_admin(org_id)` USING+WITH CHECK, no column restriction). Platform admin: suite convention + `can_view_idea_admin_fields` (20260130181300) = `is_platform_admin() OR is_org_admin()`. |
| `idea-delete` | Author (ANY status) OR org admin of the idea's org OR platform admin. | **In-repo:** 20260202140817 — "Users can delete their own ideas" (`user_id = auth.uid()`, any status; explicitly replaced the draft-only policy) + "Org admins can delete ideas in their org" (`is_org_admin(org_id)`). Platform admin: suite convention. Matches IdeaCard.tsx:46 `canDelete = effectiveIsOrgAdmin || author`. |
| `idea-vote` | Platform admin or active member of the **idea's** org (org derived from the idea row — client `orgId` not trusted). Other-author's draft → 404 (visibility-consistent). One vote per user per idea: check-then-insert → 409 "You have already voted for this idea.", `UNIQUE(idea_id, user_id)` backstop (accepted TOCTOU pattern, same as enroll/reports). `idea_votes.org_id` set from the idea row. | `[R]` membership + own-uid mirrors community INSERT policies; UNIQUE constraint is in-repo schema (01-schema.sql:434). Draft-404 is a deliberate tightening (old RLS likely allowed blind inserts) — UI-neutral, documented. |
| `idea-vote-remove` | Deletes caller's own vote only (`idea_id + user_id = caller`). Idempotent 200 (Supabase delete-no-match parity). | `[R]` — old lib deleted by `idea_id + user_id` of caller. |
| `idea-comments` | Platform admin or active member of the idea's org. Missing idea / other-author's draft / non-member → **200 `{comments: []}`** (zero-rows RLS parity, mirrors `community-comments` — corrected 2026-06-06 from this plan's original 404 wording after the final integration review). Order `created_at ASC`, embed `profile(id, full_name)`. | `[R]` — member-scope read mirrors community; embed shape = old `profiles!idea_comments_user_id_fkey(id, full_name)`. |
| `idea-comment-create` | Platform admin or active member of the idea's org; `user_id = profile.id`, `org_id` from the idea row; `parentCommentId` (optional) must reference a comment on the same idea → else 400. Other-author's draft → 404. Returns the comment with profile embed. | `[R]` — membership + own-uid mirrors community comment INSERT. Same-idea parent check is a cheap-correctness tightening, documented. |
| `idea-tags` | Platform admin or active member of `orgId`. Distinct non-empty tags over rows visible to the caller (`status != 'draft' OR user_id = caller`), sorted (localeCompare in lib was client-side; server `ORDER BY` is fine — lib re-sorts anyway or trusts server order). | `[R]` — old client aggregated over RLS-visible rows. |

### `idea-create` / `idea-update` field whitelist
`title` (required for create), `business_area`, `tags`, `current_process`, `pain_points`, `affected_roles`, `frequency_volume`, `proposed_improvement`, `desired_process`, `data_inputs`, `systems_involved`, `constraints_risks`, `success_metrics`, `description`, `problem_statement`, `proposed_solution`, `expected_impact`.
NOT updatable: `org_id` (no idea moves between orgs — old `Partial<CreateIdeaInput>` technically allowed it; deliberate tightening), `status`, `user_id`, `submitted_at`, `admin_notes`, `rejection_reason`.

### Status enum (validation list for `idea-status-update`)
`draft, submitted, under_review, in_review, approved, accepted, rejected, in_progress, completed, done, archived` (matches `IdeaStatusExtended` + DB `idea_status` after the Phase-1A ALTERs).

### Server-side counts (replaces client N+1)
- list: `(SELECT count(*)::int FROM idea_comments c WHERE c.idea_id = i.id) AS comment_count`, same for `idea_votes` → `vote_count`; embed `json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile`.
- single: both counts + `organization(id, name)` embed + `EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.user_id = $caller) AS user_has_voted`.
- list parity: NO `user_has_voted` in list (old client didn't compute it there).
- Search parity: `title ILIKE OR description ILIKE OR pain_points ILIKE` (old `.or()` triple). Tags filter: `tags && $::text[]`. Status/business_area: `= ANY($)`.

## Conventions (each has burned us — non-negotiable)
- Function names suffix-style, never admin/runtime/host prefix. POST+OPTIONS only, `authLevel: 'anonymous'`, handler shape exactly like `community-post-create` (OPTIONS preflight → authenticate → getProfile → 401 'Profile not found' → validate 400s → authz 403s → query → `corsResponse`).
- Every new function imported in `functions/index.ts` barrel (verify barrel intact first — see STATUS.html anomaly 2026-06-05).
- No module-load side effects that throw; `@azure/functions` stays pinned exactly `4.5.0`; 204s carry no body; 500 bodies propagate `err.message` (suite convention, do NOT change).
- Tests: vitest, `vi.hoisted` mocks for `../shared/auth`, `../shared/db`, `../shared/profile` (mock module shape must include `isOrgAdminOfAny`), import handler default export, never a real DB. Model: `functions/community-post-create/index.test.ts`.
- TDD per endpoint: write the contract test, watch it fail, implement, watch it pass.

## Tasks

1. **Read endpoints:** `ideas`, `idea`, `idea-tags` (+tests, +barrel) — templates: `community-posts`, `community-post`.
2. **Author writes:** `idea-create`, `idea-update`, `idea-submit` (+tests, +barrel) — template: `community-post-create`, `community-post-update`.
3. **Admin/destructive:** `idea-status-update`, `idea-delete` (+tests, +barrel) — template: `community-post-moderate`, `community-post-delete`.
4. **Votes & comments:** `idea-vote`, `idea-vote-remove`, `idea-comments`, `idea-comment-create` (+tests, +barrel) — templates: `community-comments`, `community-comment-create`, `community-report-create` (409 dedupe pattern).
5. **Frontend:** rewrite `src/lib/ideas-api.ts` over `callApi`; zero `supabase` references; exported signatures preserved (`voteForIdea(ideaId, orgId)` keeps its arity); `fetchIdea` returns `res.idea` (`{idea:null}` server parity); typecheck + build + tests green.
6. **Rider — unenroll dialog:** replace the raw-markup i18n string with manual JSX emphasis (codebase pattern: OrgMembersTab-style `<strong>` JSX — no `<Trans>` in this codebase) + correct the copy in en AND da to say progress is retained (unenroll deletes only the enrollment row — `functions/unenroll/index.ts`). Do NOT make unenroll destructive.
7. **Rider — Courses.tsx loading guard:** adopt Dashboard's profile-gated three-way guard (Dashboard.tsx:30-43; needs `profile` from `useAuth`); keep behavior for the org-selected path; mirror Dashboard.test.tsx coverage if a Courses test exists or add a minimal one.
8. **Deploy + smoke + docs:** functions test+build; check `gh api repos/Azure/functions-action`; CI or manual `func publish` (user-run); 401 smoke all 12 endpoints on the regionalized hostname; WORKLOG Slice 6 entry appended; STATUS.html items moved/refreshed; commit + push.

## Risks / notes
- Base-RLS gap means parity is partly reconstructed — every `[R]` decision above is deliberate and recorded; reviewers should challenge them against the cited UI lines.
- `idea_status` DB enum vs TS union mismatch risk: TS has 11 values; Phase-1A ALTERs added `in_review/accepted/rejected/done` to an enum whose base values we only see via types.ts. The 11-value validation list matches types.ts exactly.
- Working tree has pre-existing uncommitted changes NOT from this slice: 3 workflow YAMLs (action version bumps) and the WORKLOG/STATUS split. Slice commits must stage explicit paths only; the docs task commits the split (STATUS.html is the live ledger and must land); workflow YAMLs are left alone for the user.
