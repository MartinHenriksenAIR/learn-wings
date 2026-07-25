/**
 * Blob-path OWNERSHIP — may this caller bind this path to THIS row, and may this
 * row's superseded path actually be deleted?
 *
 * WHY THIS MODULE EXISTS
 * A blob path arrives as a plain string in a request body. Before the
 * superseded-blob cleanup (#275) that string was inert: post a nonsense path and
 * you got a broken image. #275 turned the very same string into an argument to
 * `deleteBlob`, and nothing anywhere checked that the path belonged to the row
 * being written. The paths are not secret either — `course-player-data` returns
 * every lesson path to any active org member, `organizations` returns `logo_url`
 * to plain learners, and `org-memberships` returns other members' `avatar_url` —
 * so "you would have to guess a UUID" was never the protection it looked like.
 *
 * THE TWO QUESTIONS, AND WHY BOTH ARE NEEDED
 *  1. SHAPE — is this value in the namespace this column may bind at all?
 *     (`classifyBlobPath` in `blob.ts`.) This is what stops `profile-update`,
 *     open to every authenticated user, from being handed a lesson video path.
 *  2. CLAIM — does some OTHER row already reference this path? Shape alone
 *     cannot answer that: every user's avatar is `avatars/<uuid>.<ext>`, so one
 *     user's avatar is shape-identical to another's. Without (2), a caller could
 *     bind a victim's avatar to their own profile and then clear it, and the
 *     cleanup would dutifully delete a blob the victim's row still pointed at.
 *
 * THE RULE, in one sentence: a path may be bound only if it is already on this
 * row, or no row references it at all; and a path may be deleted only if, after
 * the write, no row references it at all.
 *
 * FAIL DIRECTIONS ARE OPPOSITE, ON PURPOSE (the same asymmetry `orphan-sweep`
 * is built around — an unnecessary delete is unrecoverable, a skipped delete
 * costs pennies):
 *  - `assertBindablePaths` fails CLOSED. If the reference query throws, the
 *    error propagates and the request 500s. The write needs the database anyway,
 *    so there is no scenario where refusing here breaks something that would
 *    otherwise have worked.
 *  - `isBlobReleasable` fails SAFE. Anything short of a conclusive "nothing
 *    references this" returns false and the blob is left for `orphan-sweep`.
 */

import { query } from './db';
import { classifyBlobPath, type BlobPathFamily } from './blob';
import { pathExtensionAllowed, type UploadCandidate } from './upload-limits';

/**
 * ONE message for every rejection this module produces.
 *
 * Deliberately uniform: distinguishing "wrong namespace" from "someone else
 * already has it" would tell a caller WHICH of the two a given string is, which
 * is free reconnaissance. It does not pretend to close the channel entirely — a
 * 400 rather than a 200 on a well-formed in-kind path still reveals that some
 * row references it, and no wording fixes that. What bounds the damage is that
 * the answer is only obtainable for paths the caller can already read from
 * `/organizations`, `/org-memberships` or `course-player-data`, and that it can
 * no longer be followed by anything destructive. No legitimate client reaches
 * any of these branches, so there is no usability cost to saying little; the
 * specific reason is logged server-side.
 */
const REJECTION = 'Invalid upload path';

/**
 * Every column in the schema that stores a blob path, unioned — the definition
 * of "referenced" for the whole system.
 *
 * These are the same six columns `orphan-sweep` reconciles against (it holds its
 * own copy, deliberately: that job must never import a filtered query, and this
 * one must never be tempted to reuse a full-table scan). If a seventh
 * blob-holding column is ever added, BOTH lists have to grow — miss this one and
 * the new column's blobs become deletable by any caller who can name them; miss
 * that one and the nightly sweep deletes them outright.
 *
 * `= ANY($1::text[])` rather than reading every row: the caller always knows the
 * handful of paths it cares about, and the explicit cast is what lets Postgres
 * type the parameter without a per-column hint.
 */
const REFERENCING_ROWS_SQL = `
      SELECT video_storage_path    AS path FROM lessons       WHERE video_storage_path    = ANY($1::text[])
UNION SELECT azure_blob_path       AS path FROM lessons       WHERE azure_blob_path       = ANY($1::text[])
UNION SELECT document_storage_path AS path FROM lessons       WHERE document_storage_path = ANY($1::text[])
UNION SELECT thumbnail_url         AS path FROM courses       WHERE thumbnail_url         = ANY($1::text[])
UNION SELECT logo_url              AS path FROM organizations WHERE logo_url              = ANY($1::text[])
UNION SELECT avatar_url            AS path FROM profiles      WHERE avatar_url            = ANY($1::text[])
`;

/** The subset of `paths` that at least one row in the database still references. */
async function referencedSubset(paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const rows = await query<{ path: string | null }>(REFERENCING_ROWS_SQL, [[...paths]]);
  const referenced = new Set<string>();
  for (const row of rows) {
    if (typeof row?.path === 'string' && row.path !== '') referenced.add(row.path);
  }
  return referenced;
}

/** Narrows to a non-empty string. */
function isStoredPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * The bind gate. Returns null when every candidate path may be persisted, or a
 * caller-facing message the endpoint must return as a 400.
 *
 * MUST be awaited BEFORE `enforceUploadLimits` on the same candidate array: a
 * path that fails here has to be refused before `headBlob` ever sees it, or the
 * 413-vs-200 split becomes an existence oracle for other rows' blobs.
 *
 * `previousPaths` is this row's own current values, exactly as passed to
 * `enforceUploadLimits`. A path already on the row is skipped entirely — that is
 * what makes re-saving an unchanged row free, and it is also why "referenced by
 * any row" is a sound test for the rest: anything left is either brand new or
 * somebody else's.
 */
export async function assertBindablePaths(
  candidates: readonly UploadCandidate[],
  previousPaths: readonly (string | null | undefined)[] = [],
): Promise<string | null> {
  const alreadyOnRow = new Set(previousPaths.filter(isStoredPath));

  const fresh: string[] = [];
  const seen = new Set<string>();
  for (const { path, kind, family } of candidates) {
    if (!isStoredPath(path)) continue;
    if (alreadyOnRow.has(path)) continue;

    const verdict = classifyBlobPath(path, family);
    if (verdict === 'foreign') {
      // A branding path in a column that does not own that prefix, or vice versa.
      // Nothing a real client does produces this; what does is aiming one
      // endpoint's cleanup at another feature's blob.
      console.warn(`[blob-ownership] refusing a ${family} write of an out-of-family path: ${JSON.stringify(path)}`);
      return REJECTION;
    }
    // 'external' — an absolute http(s) URL, always permitted in these columns.
    // Not reference-checked (two rows may legitimately point at the same public
    // image) and not deletable: `isBlobReleasable` refuses it, and `buildBlobUrl`
    // could not address it as a blob even if something tried.
    if (verdict === 'external') continue;

    if (!pathExtensionAllowed(path, kind)) {
      // In-family but the wrong sort of asset — the only thing that separates a
      // course thumbnail from a lesson video, which share one flat namespace.
      console.warn(`[blob-ownership] refusing a ${kind} write of path: ${JSON.stringify(path)}`);
      return REJECTION;
    }

    if (seen.has(path)) continue;
    seen.add(path);
    fresh.push(path);
  }

  if (fresh.length === 0) return null;

  // Not atomic with the write that follows, so two concurrent requests can both
  // see "unreferenced" and both bind the same fresh path. Left as-is
  // deliberately: closing it means holding a transaction across an Azure HEAD,
  // and the window needs an unguessable UUID plus precise timing to hit. The
  // consequence is a shared path, which `isBlobReleasable` then refuses to
  // delete — so the failure mode is a stranded blob, not a destroyed one.
  const claimed = await referencedSubset(fresh);
  if (claimed.size > 0) {
    console.warn('[blob-ownership] refusing to bind path(s) another row references:', [...claimed]);
    return REJECTION;
  }
  return null;
}

/**
 * May this superseded path be deleted? Call it immediately before `deleteBlob`,
 * and only AFTER the row write has landed — at that point the row no longer
 * references the old path, so "referenced by nobody" is the right question.
 *
 * Two ways to answer no, both meaning "leave it for `orphan-sweep`":
 *  - the value is not a path in this column's family (an absolute external URL,
 *    a legacy multi-segment name) — we cannot establish that it names a blob we
 *    own, and rows written before the bind gate existed can still hold one;
 *  - some other row still references it, or the database could not tell us.
 */
export async function isBlobReleasable(path: string, family: BlobPathFamily): Promise<boolean> {
  if (!isStoredPath(path)) return false;
  if (classifyBlobPath(path, family) !== 'own') return false;

  try {
    return (await referencedSubset([path])).size === 0;
  } catch (err: unknown) {
    // Post-write cleanup must never turn a successful update into a 500, and an
    // unanswered question must never resolve to "delete it".
    console.warn(
      '[blob-ownership] could not confirm the path is unreferenced; leaving it:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
