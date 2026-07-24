import { queryOne } from './db';

/**
 * Domain-scoped shared module for the idea endpoints (precedent: shared/resources.ts).
 *
 * The idea endpoints all re-derived the same two things: the "load the idea's
 * gate columns" preamble and the draft-privacy visibility rule. A missed copy of
 * the visibility rule is a privacy LEAK (an author-private draft becomes visible
 * to non-authors), so the rule lives here exactly once (#254).
 *
 * Deliberately NOT centralized: each endpoint keeps its own not-found / not-visible
 * RESPONSE SHAPE (404 vs `{ comments: [] }` vs `{ idea: null }`) — those differ by
 * design for RLS parity and stay per-endpoint. This module owns only the shared
 * SQL, the visibility PREDICATE, and the author+draft PREDICATE.
 */

/** The gate columns every idea endpoint loads to make an authz decision. */
export interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

/**
 * The shared idea-gate load: projects exactly the columns the authz checks need.
 * Endpoints that need a wider projection (e.g. functions/idea/index.ts, which
 * embeds profile/organization/counts) keep their own query — do NOT force those
 * through here.
 */
export async function loadIdea(ideaId: string): Promise<IdeaRow | null> {
  return queryOne<IdeaRow>(
    `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
    [ideaId],
  );
}

/**
 * Draft-privacy rule (CRITICAL): a `draft` idea is visible ONLY to its author —
 * for EVERY role, with NO platform-admin bypass. Non-draft ideas pass this gate
 * (org-membership access is a separate, later check the endpoints still run).
 *
 * Provenance: mirrors the RLS-era draft filter `(i.status <> 'draft' OR i.user_id = <caller>)`
 * that functions/ideas (the list endpoint) still applies at the SQL level; the
 * per-row endpoints share it here so a missed copy can't leak an author-private draft.
 * This is a deliberate, documented security invariant — do not add an admin bypass.
 */
export function isIdeaVisibleTo(
  idea: Pick<IdeaRow, 'status' | 'user_id'>,
  profile: { id: string },
): boolean {
  return !(idea.status === 'draft' && idea.user_id !== profile.id);
}

/**
 * Failure of {@link assertAuthorDraft}: a status + body the caller returns
 * verbatim as `reply(status, body)` — keeping each endpoint's own 409 wording.
 */
export interface AuthorDraftError {
  ok: false;
  status: 403 | 409;
  body: { error: string };
}

export type AuthorDraftResult = { ok: true } | AuthorDraftError;

/**
 * The author-only-403 + draft-only-409 predicate pair that idea-submit and
 * idea-update duplicated verbatim (only the 409 message differs). Returns a
 * discriminated union (precedent: buildUpdateSet) so each endpoint keeps its
 * `return reply(status, body)` style and its own not-draft wording:
 *
 *   1. author-only — NO admin bypass (submitting/editing someone else's idea is
 *      meaningless; org-admin status writes go through idea-status-update) → 403.
 *   2. draft-only — non-draft ideas are frozen to the author → 409 with the
 *      caller-supplied `notDraftError`.
 */
export function assertAuthorDraft(
  idea: Pick<IdeaRow, 'status' | 'user_id'>,
  profile: { id: string },
  opts: { notDraftError: string },
): AuthorDraftResult {
  // Author-only: no admin bypass.
  if (idea.user_id !== profile.id) {
    return { ok: false, status: 403, body: { error: 'Forbidden' } };
  }
  // Draft-only.
  if (idea.status !== 'draft') {
    return { ok: false, status: 409, body: { error: opts.notDraftError } };
  }
  return { ok: true };
}
