import { app } from '@azure/functions';
import type { InvocationContext, Timer } from '@azure/functions';
import { query } from '../shared/db';
import { deleteBlob } from '../shared/blob';
import { generateContainerSasToken, SAS_SIGNED_VERSION } from '../shared/sas';

/**
 * ORPHAN SWEEP (#277) — the only unattended, scheduled DELETER of production
 * customer data in this system. Read this header before changing anything below.
 *
 * WHY IT EXISTS
 * Browser uploads go straight to blob storage via a SAS URL BEFORE the form that
 * would reference them is saved. Cancel the dialog and the blob is stranded with
 * nothing pointing at it. `deleteBlob` never throws, so failed cleanups strand
 * blobs too. Nothing has ever reclaimed any of it, so container usage only grows.
 *
 * WHAT IT DOES
 * Nightly at 03:00 UTC — 04:00 or 05:00 Danish local time, because no
 * `WEBSITE_TIME_ZONE` app setting exists and NCRONTAB is therefore evaluated in
 * UTC: list the container, build the set of blob names the database still
 * references, and delete the listed blobs that are in neither the reference set
 * nor the 24-hour grace window.
 *
 * THE DESIGN RULE — asymmetry of errors
 * Deleting a referenced blob destroys a customer's lesson video / thumbnail /
 * logo / avatar with no undo. NOT deleting an orphan costs a few pennies of
 * storage until tomorrow's run. Those are not remotely comparable, so every
 * uncertain branch in this file resolves to "do not delete", and any doubt about
 * the INPUTS (database unreadable, listing incomplete, reference set empty,
 * implausible orphan share) aborts the whole run rather than deleting a subset.
 * There is no partial-confidence mode.
 *
 * THE COMPARISON — the part that would destroy data if it were wrong
 * `List Blobs` returns the FULL blob name including any folder prefix. Stored
 * paths come in BOTH shapes, and NO column is guaranteed to hold one or the
 * other:
 *   - bare       — `azure-upload-url` mints `<uuid>.<ext>` with no prefix for
 *                  lesson videos and course thumbnails (`abc.mp4`)
 *   - prefixed   — `azure-document-upload-url` mints `documents/<uuid>.<ext>`;
 *                  branding uploads mint `avatars/…` and `org-logos/…`
 *                  (BRANDING_ASSET_PREFIXES); seeded and legacy lesson rows also
 *                  carry `videos/…` (see migration/azure/02-seed.sql)
 * Which shape a given row holds does not matter, and no code here may care: the
 * listed name is matched VERBATIM against the union of all six columns, full
 * stop. The listed name is never stripped, never basenamed, never normalized —
 * doing any of those would make every referenced PREFIXED asset look like an
 * orphan, and that includes every document and every branding asset, not just
 * the ones a reader happens to think of as "prefixed".
 * (`lessons.video_url` is a deprecated EXTERNAL url, never a blob path, and is
 * deliberately not a reconciliation target.)
 *
 * The DATABASE side, by contrast, is deliberately EXPANDED (see
 * `referenceVariants`): stored values have historically also held absolute URLs.
 * Widening the reference set can only ever cause the sweep to delete LESS, so it
 * is safe in a way that touching the listed name is not.
 */

/** NCRONTAB — `{second} {minute} {hour} {day} {month} {day-of-week}`; daily 03:00. */
const SCHEDULE = '0 0 3 * * *';

/**
 * A blob younger than this is never touched, however unreferenced it looks.
 * This is what protects an upload that is sitting in a half-filled form: the
 * bytes land in storage minutes (or hours) before the row that references them
 * is written. A blob whose age we cannot establish is treated as brand new.
 */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * TRIPWIRE 1 — the backstop against a reconciliation bug.
 *
 * A broken match does NOT reliably make "almost everything" look orphaned, and
 * assuming it does is how this tripwire would miss the very bug class it exists
 * for. The six columns are independent code paths, so a break confined to one of
 * them produces a MINORITY orphan share. Concretely: production holds roughly a
 * few thousand root-level lesson/thumbnail blobs against a few hundred
 * `avatars/` + `org-logos/`, so a break that only affects branding paths reads as
 * ~11% globally — comfortably under this ceiling AND under the per-run count
 * ceiling. Both tripwires would pass while every avatar and org logo in the
 * system was destroyed in one night.
 *
 * So the share is evaluated TWICE:
 *   - globally, over every eligible blob; and
 *   - per TOP-LEVEL PREFIX BUCKET — `''` (container root), `avatars/`,
 *     `org-logos/`, `documents/`, and any other prefix the listing actually
 *     contains — with ANY bucket over the ceiling aborting the whole run.
 * That turns the 11% global share above into a 100% `avatars/` share.
 *
 * The per-bucket check deliberately has NO minimum-size floor: a bucket holding
 * two blobs, both unreferenced, trips it. A floor is exactly the hole this
 * exists to close, and the asymmetry of errors says a nuisance abort (one night
 * of unreclaimed storage, loudly logged with the bucket named) is the cheap
 * side.
 *
 * A genuine first-run backlog can also trip this. That is the intended outcome:
 * the run logs loudly and a human decides, rather than an unattended job
 * deleting most of the container on its first night.
 *
 * WHAT IT STILL DOES NOT CATCH, stated plainly: a break confined to a column
 * that shares a bucket with a much larger one. `courses.thumbnail_url` and the
 * bare lesson-video paths both live at the container root, so a thumbnail-only
 * break shows up diluted by every root-level video. Bucketing narrows the blind
 * spot to same-bucket columns; it does not eliminate it.
 */
const DEFAULT_MAX_ORPHAN_SHARE = 0.5;

/**
 * TRIPWIRE 2 — an absolute ceiling, independent of the share.
 *
 * A share alone is not enough: in a container of 200 000 blobs, 49% is 98 000
 * deletions. This caps the blast radius of any single run regardless of ratio.
 * Exceeding it aborts (rather than deleting the first N) because a run that big
 * is itself the anomaly worth looking at.
 */
const DEFAULT_MAX_DELETIONS_PER_RUN = 500;

/** Azure's own maximum page size for List Blobs. */
const LIST_PAGE_SIZE = 5000;

/**
 * Hard stop on pagination — 200 pages x 5000 = 1M blobs. Guards against a
 * pathological or repeating `NextMarker`; hitting it aborts the run, because a
 * listing we could not finish must never be mistaken for the whole container.
 *
 * MEMORY: the whole listing is materialised in memory before any tripwire runs,
 * so this constant is also the memory bound — 1M `ListedBlob` objects is on the
 * order of hundreds of MB and would be the first thing to hit the Function App's
 * memory ceiling. The container currently holds thousands of blobs, so this is
 * headroom rather than a live constraint. If it ever stops being headroom the
 * fix is to classify per page as it streams, NOT to raise the page cap — the
 * tripwires need the whole census before they can mean anything.
 */
const MAX_LIST_PAGES = 200;

/** Simultaneous DELETEs. Deliberately small — this is a background job. */
const DELETE_CONCURRENCY = 8;

/** Lifetime of the container SAS minted for listing. */
const LIST_SAS_MINUTES = 15;

/**
 * How many candidate names an abort quotes. An abort an operator cannot act on
 * recurs forever, and the first thing they need is a handful of names to check
 * against the database by hand — but not all 500 of them.
 */
const ABORT_SAMPLE_SIZE = 10;

/**
 * The only blob names this job will ever DELETE.
 *
 * This is no longer a URL-safety gate. `buildBlobUrl` percent-encodes the name
 * one path segment at a time (`functions/shared/sas.ts`, which still signs the
 * DECODED name — that asymmetry is the Azure Service SAS contract), so a `?`,
 * `#` or `%` can no longer bend the request onto a DIFFERENT blob than the one
 * classified: the DELETE now addresses exactly the name that was listed.
 *
 * What encoding does NOT settle is the RECONCILIATION, which is where this job
 * destroys data. The listed name is matched VERBATIM, while the database side is
 * widened by `referenceVariants` — which DECODES percent-escapes out of stored
 * absolute URLs. For a name that genuinely contains `%`, the two sides of that
 * comparison therefore reach the name through different transforms, and "no row
 * references it" stops being a conclusive answer. Every name this system mints is
 * `[prefix/]<uuid>.<ext>`, for which encoding and decoding are both the identity
 * and the question is answerable; anything else has a provenance nobody here can
 * account for, and an unattended nightly deleter is the wrong thing to settle it.
 * So nothing legitimate is excluded; anything else is counted, logged and left
 * alone. Leading-dot segments are rejected too, which takes `.` and `..` with them.
 */
const SAFE_BLOB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Hostname suffix identifying an Azure Blob Storage URL (see `referenceVariants`). */
const AZURE_BLOB_HOST = /\.blob\.core\.windows\.net$/i;

/** Legacy Supabase storage URL prefixes that stored values may still carry. */
const LEGACY_STORAGE_PREFIXES = [
  '/storage/v1/object/sign/lms-assets/',
  '/storage/v1/object/public/lms-assets/',
];

/**
 * Every blob-path column in the schema, unioned. UNION (not UNION ALL) dedupes.
 *
 * The six columns are listed verbatim with no expression around them — no trim,
 * no substring, no regexp_replace. Any per-row transform here would be applied
 * to the DB side of a comparison whose other side is an untransformed blob name,
 * which is precisely how referenced branding assets would get deleted.
 *
 * Reading this is a plain pooled SELECT, not a transaction: the pool is shared
 * with live traffic (`max: 5`) and the HTTP deletes that follow must never be
 * performed with a connection checked out.
 */
const REFERENCED_PATHS_SQL = `
      SELECT video_storage_path    AS path FROM lessons       WHERE video_storage_path    IS NOT NULL
UNION SELECT azure_blob_path       AS path FROM lessons       WHERE azure_blob_path       IS NOT NULL
UNION SELECT document_storage_path AS path FROM lessons       WHERE document_storage_path IS NOT NULL
UNION SELECT thumbnail_url         AS path FROM courses       WHERE thumbnail_url         IS NOT NULL
UNION SELECT logo_url              AS path FROM organizations WHERE logo_url              IS NOT NULL
UNION SELECT avatar_url            AS path FROM profiles      WHERE avatar_url            IS NOT NULL
`;

/** The slice of `InvocationContext` the sweep logs through. Keeps the run testable. */
export interface SweepLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** One blob as returned by List Blobs. */
export interface ListedBlob {
  /** The full name including any folder prefix, exactly as Azure returned it. */
  name: string;
  /** Content-Length in bytes, or null when absent/unparseable. */
  contentLength: number | null;
  /** Last-Modified as epoch ms, or null when absent/unparseable (→ treated as brand new). */
  lastModified: number | null;
  /**
   * True when Azure qualified the name with an attribute — in practice
   * `<Name Encoded="true">`, which it emits when the real name contains a
   * character that cannot appear in XML. The text between the tags is then NOT
   * the literal blob name, so it is neither safe to compare nor safe to delete.
   * Such a blob is counted and skipped; it never aborts the run (one permanently
   * odd name must not wedge the sweep forever).
   */
  encodedName: boolean;
}

/**
 * The top-level prefix a listed blob sits under, INCLUDING its trailing slash —
 * `avatars/`, `org-logos/`, `documents/`, `videos/`, or `''` for a name at the
 * container root. Nested names bucket by their first segment only.
 *
 * Derived from the raw listed name, the same string the comparison uses, so a
 * normalisation applied at the comparison site cannot also launder the bucket.
 * (A normalisation applied further upstream — in `parseListPage` itself — WOULD
 * collapse every bucket into the root; see TRIPWIRE 1 for what remains uncaught.)
 */
export function blobBucket(name: string): string {
  const slash = name.indexOf('/');
  return slash < 0 ? '' : name.slice(0, slash + 1);
}

/** Why a run refused to delete anything. Every value means "nothing was deleted". */
export type SweepAbortReason =
  | 'disabled'
  | 'past-due'
  | 'storage-not-configured'
  | 'reference-read-failed'
  | 'empty-reference-set'
  | 'listing-failed'
  | 'orphan-share-implausible'
  | 'orphan-bucket-share-implausible'
  | 'orphan-count-implausible';

export interface OrphanSweepSummary {
  /** True when the run refused to delete. `deleted` is always 0 in that case. */
  aborted: boolean;
  reason: SweepAbortReason | null;
  /** Blobs returned by the listing. */
  scanned: number;
  /** Distinct blob names the database still references (after variant expansion). */
  referenced: number;
  /** Scanned blobs with a name safe enough to delete (see SAFE_BLOB_NAME). */
  eligible: number;
  /** Eligible blobs the database does not reference. */
  orphaned: number;
  /** Orphans left alone because they are younger than the grace window. */
  skippedByGrace: number;
  /** Blobs skipped because their name is not URL-safe, or was not returned literally. */
  skippedUnsafeName: number;
  /**
   * Deletion candidates dropped by the pre-delete re-check — i.e. blobs that
   * became referenced after the listing. A non-zero value here is the sweep
   * working exactly as intended, not an anomaly.
   */
  skippedByRecheck: number;
  deleted: number;
  failed: number;
}

const emptySummary = (): OrphanSweepSummary => ({
  aborted: false,
  reason: null,
  scanned: 0,
  referenced: 0,
  eligible: 0,
  orphaned: 0,
  skippedByGrace: 0,
  skippedUnsafeName: 0,
  skippedByRecheck: 0,
  deleted: 0,
  failed: 0,
});

/**
 * Every blob name a stored column value could plausibly denote.
 *
 * ONE-WAY WIDENING. This expands the DB side of the comparison only. A variant
 * that matches nothing is harmless; a variant that matches wrongly can only ever
 * SPARE a blob. The listed blob name is never passed through this.
 *
 * The verbatim value comes first and is what we actually expect to match. The
 * rest exist because `thumbnail_url` / `logo_url` / `avatar_url` have always been
 * allowed to hold absolute URLs (see `src/lib/storage.ts` `extractLmsAssetPath`,
 * which resolves exactly these shapes on the read path) — a stored
 * `https://acct.blob.core.windows.net/lms-videos/abc.png` refers to a LIVE blob
 * named `abc.png`, and matching only the verbatim string would delete it.
 */
export function referenceVariants(stored: string): string[] {
  const variants = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (typeof value === 'string' && value !== '') variants.add(value);
  };

  add(stored);
  const trimmed = stored.trim();
  add(trimmed);
  add(trimmed.replace(/^\/+/, '')); // a stray leading slash

  if (!/^https?:\/\//i.test(trimmed)) return [...variants];

  try {
    const parsed = new URL(trimmed);
    if (AZURE_BLOB_HOST.test(parsed.hostname)) {
      // pathname is `/<container>/<blobPath>` — drop the container, keep the rest.
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) add(segments.slice(1).map(decodeURIComponent).join('/'));
    }
  } catch {
    // Malformed URL or undecodable escape — the verbatim variants still stand.
  }

  for (const prefix of LEGACY_STORAGE_PREFIXES) {
    const at = trimmed.indexOf(prefix);
    if (at < 0) continue;
    const tail = trimmed.slice(at + prefix.length).split('?')[0];
    if (!tail) continue;
    try {
      add(decodeURIComponent(tail));
    } catch {
      add(tail);
    }
  }

  return [...variants];
}

/**
 * Parses one List Blobs page, or returns null when the payload is not a shape we
 * fully understand.
 *
 * null means ABORT, never "no blobs": a response we misread could omit blobs that
 * are actually referenced, and every omission is a candidate for deletion. There
 * is no XML parser in this package, so this is regex over a schema Azure pins to
 * the `sv` we sign with — hence the structural assertions before any extraction.
 */
export function parseListPage(xml: string): { blobs: ListedBlob[]; nextMarker: string | null } | null {
  if (typeof xml !== 'string') return null;
  // `<Blobs />` (self-closing, empty container) is legitimate, so match the
  // opening tag name only.
  if (!xml.includes('<EnumerationResults') || !xml.includes('<Blobs')) return null;

  const blobs: ListedBlob[] = [];
  // `<BlobPrefix>` cannot match this — the literal `>` is part of the pattern.
  for (const element of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
    const body = element[1];
    // Attributes are ACCEPTED, not required: Azure returns `<Name Encoded="true">`
    // whenever the real name holds a character XML cannot carry. Demanding a bare
    // `<Name>` made a single such blob unparseable, and an unparseable page aborts
    // — so one permanently odd name anywhere in the container wedged every future
    // run of the sweep, visible only as a log line. The blob is now skipped
    // instead (see `encodedName`), which costs one unreclaimed blob rather than
    // the entire job.
    const named = /<Name(\s[^>]*)?>([\s\S]*?)<\/Name>/.exec(body);
    const name = named?.[2];
    // A <Blob> we cannot name is a payload we do not understand — abort rather
    // than silently drop it (a dropped entry is a blob we never protect).
    if (name === undefined || name === '') return null;
    // ANY attribute, not just `Encoded="true"`: an attribute we do not model is
    // an attribute that could requalify what the text between the tags means, and
    // "we are not certain this is the literal name" resolves to "do not delete".
    const encodedName = named?.[1] !== undefined;

    const rawModified = /<Last-Modified>([\s\S]*?)<\/Last-Modified>/.exec(body)?.[1];
    const parsedModified = rawModified ? Date.parse(rawModified) : Number.NaN;

    const rawLength = /<Content-Length>([\s\S]*?)<\/Content-Length>/.exec(body)?.[1];
    const parsedLength = rawLength ? Number(rawLength) : Number.NaN;

    // XML entity references (`a&amp;b.mp4`) are deliberately NOT decoded here.
    // Every character that gets entity-encoded (`& < > " '`) is outside
    // SAFE_BLOB_NAME, so such a name is skipped either way — but leaving the text
    // exactly as Azure sent it keeps the rule "the listed name is used verbatim"
    // literally true, with no decode step for a future edit to get wrong.
    blobs.push({
      name,
      contentLength: Number.isFinite(parsedLength) ? parsedLength : null,
      lastModified: Number.isFinite(parsedModified) ? parsedModified : null,
      encodedName,
    });
  }

  const marker = /<NextMarker>([\s\S]*?)<\/NextMarker>/.exec(xml)?.[1]?.trim();
  return { blobs, nextMarker: marker ? marker : null };
}

/** Thrown internally when the listing could not be completed. Always aborts the run. */
class ListingError extends Error {}

/**
 * Walks EVERY page of List Blobs.
 *
 * Pagination here is a safety property, not a completeness nicety: an unread page
 * is a set of blobs whose DB references we never consulted. Any failed page, any
 * unparseable page, a repeating marker or an implausible page count throws — the
 * caller aborts, and a partial listing is never used as a basis for deletion.
 */
async function listContainer(
  accountName: string,
  accountKey: string,
  containerName: string,
): Promise<ListedBlob[]> {
  const blobs: ListedBlob[] = [];
  const seenMarkers = new Set<string>();
  let marker: string | null = null;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    // Minted per page so a long listing cannot outlive its own SAS.
    const sasToken = generateContainerSasToken(accountName, accountKey, containerName, 'l', LIST_SAS_MINUTES);
    const params = new URLSearchParams({
      restype: 'container',
      comp: 'list',
      maxresults: String(LIST_PAGE_SIZE),
    });
    if (marker) params.set('marker', marker);
    const url = `https://${accountName}.blob.core.windows.net/${containerName}?${params.toString()}&${sasToken}`;

    let xml: string;
    try {
      // x-ms-version must match the `sv` we signed with — the response schema is
      // versioned, and this parser is written against that schema.
      const res = await fetch(url, { method: 'GET', headers: { 'x-ms-version': SAS_SIGNED_VERSION } });
      if (!res.ok) throw new ListingError(`storage returned ${res.status} on page ${page + 1}`);
      xml = await res.text();
    } catch (err: unknown) {
      if (err instanceof ListingError) throw err;
      throw new ListingError(`page ${page + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const parsed = parseListPage(xml);
    if (!parsed) throw new ListingError(`page ${page + 1} was not a parseable List Blobs response`);

    blobs.push(...parsed.blobs);
    if (!parsed.nextMarker) return blobs;

    // A marker that repeats would loop forever and, worse, silently duplicate work.
    if (seenMarkers.has(parsed.nextMarker)) throw new ListingError('NextMarker repeated — listing did not advance');
    seenMarkers.add(parsed.nextMarker);
    marker = parsed.nextMarker;
  }

  throw new ListingError(`listing exceeded ${MAX_LIST_PAGES} pages`);
}

/**
 * Reads the six-column union and expands each stored value into its variants.
 * Rejects (does not return an empty set) when the query fails; returns an empty
 * set only when the query genuinely produced no rows — which the caller treats
 * as an abort, not as "everything is an orphan".
 */
async function readReferencedPaths(): Promise<{ rows: number; referenced: Set<string> }> {
  const rows = await query<{ path: string | null }>(REFERENCED_PATHS_SQL);
  const referenced = new Set<string>();
  let counted = 0;
  for (const row of rows) {
    if (typeof row?.path !== 'string' || row.path === '') continue;
    counted++;
    for (const variant of referenceVariants(row.path)) referenced.add(variant);
  }
  return { rows: counted, referenced };
}

/** Parses a positive-number env override, falling back to `fallback` when unusable. */
function numericEnv(
  raw: string | undefined,
  fallback: number,
  isValid: (value: number) => boolean,
  log: SweepLogger,
  name: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !isValid(value)) {
    log.warn(`[orphan-sweep] ignoring unusable ${name}=${raw}; using ${fallback}`);
    return fallback;
  }
  return value;
}

/**
 * One sweep. Returns a summary; never throws (a timer failure would just be
 * retried by the host against the same container).
 *
 * Env is read HERE, not at module load: a module-level read that threw would
 * crash the worker entry and deregister the ENTIRE function fleet
 * (`.claude/rules/functions.md`). No new app setting is required — the overrides
 * below all have working defaults.
 */
export async function runOrphanSweep(log: SweepLogger, now: number = Date.now()): Promise<OrphanSweepSummary> {
  const summary = emptySummary();
  /**
   * Refuse the run.
   *
   * Every abort is a refusal to do the job, and a refusal that repeats means
   * storage is NEVER being reclaimed — which is indistinguishable, from the
   * outside, from a healthy container with nothing to clean up. So the log line
   * says so in words: what it refused, why, and what a human is expected to do
   * about it. `remedy` is not optional decoration; an abort nobody can act on is
   * an abort that recurs nightly forever.
   */
  const abort = (reason: SweepAbortReason, message: string, remedy: string): OrphanSweepSummary => {
    summary.aborted = true;
    summary.reason = reason;
    summary.deleted = 0;
    log.error(
      `[orphan-sweep] REFUSED TO SWEEP — 0 blobs deleted, nothing in storage was touched. ` +
        `This is NOT a clean run with nothing to do. Reason: ${reason}. ${message} ` +
        `WHAT TO DO: ${remedy}`,
      summary,
    );
    return summary;
  };

  // Kill switch: flip an app setting to stop the sweep without a redeploy.
  if (process.env.ORPHAN_SWEEP_DISABLED === '1') {
    return abort(
      'disabled',
      'ORPHAN_SWEEP_DISABLED=1.',
      'nothing, if the sweep was switched off deliberately. Clear the ORPHAN_SWEEP_DISABLED app setting to arm it again — while it is set, orphaned blobs accrue forever.',
    );
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  // Same env var and same default as `deleteBlob`, so the container we list is
  // always the container we delete from.
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';
  if (!accountName || !accountKey) {
    return abort(
      'storage-not-configured',
      'AZURE_STORAGE_ACCOUNT_NAME/KEY missing.',
      'set both on the function app. Until then this job can neither list nor delete, so nothing is ever reclaimed.',
    );
  }

  const maxShare = numericEnv(
    process.env.ORPHAN_SWEEP_MAX_SHARE,
    DEFAULT_MAX_ORPHAN_SHARE,
    (v) => v > 0 && v <= 1,
    log,
    'ORPHAN_SWEEP_MAX_SHARE',
  );
  const maxDeletions = numericEnv(
    process.env.ORPHAN_SWEEP_MAX_DELETIONS,
    DEFAULT_MAX_DELETIONS_PER_RUN,
    (v) => Number.isInteger(v) && v > 0,
    log,
    'ORPHAN_SWEEP_MAX_DELETIONS',
  );

  // ── The reference set ────────────────────────────────────────────────────
  // Read BEFORE and AFTER the listing, and unioned. A row written while we were
  // listing would otherwise be invisible to the first read while its (possibly
  // old) blob is already in the listing — a moved or re-attached path would be
  // classified as an orphan and destroyed. Both reads must succeed and both must
  // be non-empty; either failing aborts.
  //
  // WHAT THIS PAIR DOES AND DOES NOT BUY: it closes the LISTING window, and only
  // that. It says nothing whatever about a row written AFTER the second read, so
  // on its own it does not make the sweep race-free — a third read immediately
  // before the delete loop narrows what remains (see `Pre-delete re-check`).
  const readFailureRemedy =
    'nothing immediately — a database the sweep cannot read makes it refuse, which is the safe direction, and it retries tomorrow. If it recurs, check the function app can reach Postgres (DATABASE_URL, pool exhaustion, firewall).';
  const emptySetRemedy =
    'treat this as a BROKEN QUERY, not an empty database: a renamed column or a dropped table produces exactly this. Check REFERENCED_PATHS_SQL against migration/azure/01-schema.sql before changing anything else, and do not raise any ceiling to work around it.';
  const listingFailureRemedy =
    'nothing immediately — a listing that could not be completed is never used as a basis for deletion. If it recurs, check the storage account and that the list SAS is still valid.';

  let before: { rows: number; referenced: Set<string> };
  try {
    before = await readReferencedPaths();
  } catch (err: unknown) {
    return abort('reference-read-failed', err instanceof Error ? err.message : String(err), readFailureRemedy);
  }
  if (before.rows === 0) {
    return abort(
      'empty-reference-set',
      'the six-column union returned no rows (far likelier a query bug than an empty database).',
      emptySetRemedy,
    );
  }

  let blobs: ListedBlob[];
  try {
    blobs = await listContainer(accountName, accountKey, containerName);
  } catch (err: unknown) {
    return abort('listing-failed', err instanceof Error ? err.message : String(err), listingFailureRemedy);
  }
  summary.scanned = blobs.length;

  let after: { rows: number; referenced: Set<string> };
  try {
    after = await readReferencedPaths();
  } catch (err: unknown) {
    return abort(
      'reference-read-failed',
      `second read: ${err instanceof Error ? err.message : String(err)}`,
      readFailureRemedy,
    );
  }
  if (after.rows === 0) {
    return abort('empty-reference-set', 'the six-column union returned no rows on the second read.', emptySetRemedy);
  }

  const referenced = new Set<string>([...before.referenced, ...after.referenced]);
  summary.referenced = referenced.size;

  // ── Classification ───────────────────────────────────────────────────────
  // `blob.name` is used exactly as Azure returned it. Do not trim it, do not
  // strip its prefix, do not lower-case it.
  const orphans: ListedBlob[] = [];
  const deletable: ListedBlob[] = [];
  // Per-bucket census for TRIPWIRE 1, keyed by top-level prefix. Counted off the
  // raw listed name — the same string the `referenced.has` comparison below uses.
  const bucketEligible = new Map<string, number>();
  const bucketOrphaned = new Map<string, number>();
  for (const blob of blobs) {
    if (blob.encodedName) {
      summary.skippedUnsafeName++;
      log.warn(
        '[orphan-sweep] skipping blob whose name Azure did not return literally (<Name Encoded="true">) — this job will not delete a name it could not read:',
        blob.name,
      );
      continue;
    }
    if (!SAFE_BLOB_NAME.test(blob.name)) {
      summary.skippedUnsafeName++;
      log.warn('[orphan-sweep] skipping blob with a name this job will not delete:', blob.name);
      continue;
    }
    summary.eligible++;
    const bucket = blobBucket(blob.name);
    bucketEligible.set(bucket, (bucketEligible.get(bucket) ?? 0) + 1);
    if (referenced.has(blob.name)) continue;

    orphans.push(blob);
    bucketOrphaned.set(bucket, (bucketOrphaned.get(bucket) ?? 0) + 1);
    // Unknown age counts as brand new — an upload we cannot date is exactly the
    // one that might still be sitting in an open form.
    if (blob.lastModified === null || now - blob.lastModified < GRACE_PERIOD_MS) {
      summary.skippedByGrace++;
      continue;
    }
    deletable.push(blob);
  }
  summary.orphaned = orphans.length;

  // ── Tripwires ────────────────────────────────────────────────────────────
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  /** A few names an operator can spot-check by hand, rather than a wall of them. */
  const sampleOf = (candidates: ListedBlob[]) => {
    const names = candidates.slice(0, ABORT_SAMPLE_SIZE).map((b) => b.name);
    const rest = candidates.length - names.length;
    return `${names.join(', ')}${rest > 0 ? `, … (+${rest} more)` : ''}`;
  };
  const brokenMatchRemedy =
    'do NOT raise the ceiling first. Take the sampled names above and check by hand whether the database really references none of them (the six columns in REFERENCED_PATHS_SQL). If any IS referenced, the match is broken — fix the match. Only once the backlog is confirmed genuine, raise ORPHAN_SWEEP_MAX_SHARE for a single run and put it back afterwards.';

  const share = summary.eligible === 0 ? 0 : summary.orphaned / summary.eligible;
  if (share > maxShare) {
    return abort(
      'orphan-share-implausible',
      `${summary.orphaned}/${summary.eligible} blobs (${pct(share)}) look unreferenced across the whole container, above the ${pct(maxShare)} ceiling — treating this as a broken reconciliation, not a big cleanup. Sample: ${sampleOf(orphans)}.`,
      brokenMatchRemedy,
    );
  }

  // The per-bucket pass. The global share above can sit comfortably under the
  // ceiling while one prefix is 100% false-orphaned — that is the whole point of
  // this loop, and it is the difference between "11% of the container looks odd"
  // and "every avatar in the system is about to be deleted".
  for (const [bucket, eligible] of bucketEligible) {
    const orphaned = bucketOrphaned.get(bucket) ?? 0;
    const bucketShare = orphaned / eligible;
    if (bucketShare <= maxShare) continue;
    const label = bucket === '' ? 'the container root' : bucket;
    return abort(
      'orphan-bucket-share-implausible',
      `${orphaned}/${eligible} blobs under ${label} (${pct(bucketShare)}) look unreferenced, above the ${pct(maxShare)} ceiling — even though the container as a whole is only ${pct(share)} unreferenced. A single prefix going bad like this is what a break confined to one path-writing column looks like. Sample: ${sampleOf(orphans.filter((b) => blobBucket(b.name) === bucket))}.`,
      brokenMatchRemedy,
    );
  }

  if (deletable.length > maxDeletions) {
    return abort(
      'orphan-count-implausible',
      `${deletable.length} deletions requested, above the per-run ceiling of ${maxDeletions}. Sample: ${sampleOf(deletable)}.`,
      `this needs a DECISION, not patience — it will repeat identically every night until someone acts, and until then nothing is ever reclaimed. A long-accrued backlog trips this on the first armed night, which is expected. Spot-check the sampled names, then either raise ORPHAN_SWEEP_MAX_DELETIONS above ${deletable.length} for one run (and restore ${DEFAULT_MAX_DELETIONS_PER_RUN} afterwards) or work the backlog down in stages.`,
    );
  }

  // ── Pre-delete re-check ──────────────────────────────────────────────────
  // Both reads above happened BEFORE classification. Between them and the DELETE
  // of any given blob, a save can attach a blob that is already older than the
  // grace window — precisely the "form left open since yesterday" case the grace
  // window exists for. That blob is referenced now, and deleting it would leave a
  // freshly written row pointing at bytes that no longer exist.
  //
  // So the reference set is read once more, immediately before the loop, and any
  // candidate that has become referenced in the meantime is dropped. This is the
  // FULL read rather than a bounded `WHERE path = ANY($1)` over the candidate
  // names: the widening in `referenceVariants` (absolute Azure URLs, legacy
  // Supabase URLs) lives in JS, so a name-equality predicate in SQL would not see
  // a row that stores an absolute URL denoting one of these candidates — and the
  // whole point of this read is to catch the row nobody expected.
  //
  // WHAT IS STILL EXPOSED, stated plainly: a row written DURING the delete loop
  // itself. That window is bounded by the loop (at most `maxDeletions` blobs at
  // DELETE_CONCURRENCY, i.e. seconds) rather than by the listing (minutes), but
  // it is not zero. No placement of a read can make it zero without a lock that
  // the rest of the system does not take.
  let confirmed = deletable;
  if (deletable.length > 0) {
    let final: { rows: number; referenced: Set<string> };
    try {
      final = await readReferencedPaths();
    } catch (err: unknown) {
      return abort(
        'reference-read-failed',
        `pre-delete re-check: ${err instanceof Error ? err.message : String(err)}`,
        readFailureRemedy,
      );
    }
    if (final.rows === 0) {
      return abort(
        'empty-reference-set',
        'the six-column union returned no rows on the pre-delete re-check.',
        emptySetRemedy,
      );
    }

    confirmed = deletable.filter((blob) => !final.referenced.has(blob.name));
    summary.skippedByRecheck = deletable.length - confirmed.length;
    if (summary.skippedByRecheck > 0) {
      log.warn(
        `[orphan-sweep] ${summary.skippedByRecheck} candidate(s) became referenced after the listing and will NOT be deleted:`,
        deletable.filter((blob) => final.referenced.has(blob.name)).map((blob) => blob.name),
      );
    }
  }

  // ── Deletion ─────────────────────────────────────────────────────────────
  // No DB connection is held here. `deleteBlob` never throws; a failure is
  // counted and the next run will try again. `confirmed`, not `deletable` — the
  // re-check above is the last word on what gets deleted.
  for (let i = 0; i < confirmed.length; i += DELETE_CONCURRENCY) {
    const chunk = confirmed.slice(i, i + DELETE_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map(async (blob) => {
        const ok = await deleteBlob(blob.name);
        const ageHours = blob.lastModified === null ? 'unknown' : ((now - blob.lastModified) / 3_600_000).toFixed(1);
        if (ok) {
          log.log(
            `[orphan-sweep] deleted ${blob.name} (${blob.contentLength ?? 'unknown'} bytes, age ${ageHours}h)`,
          );
        } else {
          log.warn(
            `[orphan-sweep] FAILED to delete ${blob.name} (${blob.contentLength ?? 'unknown'} bytes, age ${ageHours}h)`,
          );
        }
        return ok;
      }),
    );
    summary.deleted += outcomes.filter(Boolean).length;
    summary.failed += outcomes.filter((ok) => !ok).length;
  }

  log.log('[orphan-sweep] run complete', summary);
  return summary;
}

/**
 * The scheduled entry point: the past-due gate, then the sweep.
 *
 * Split out from the registration trailer purely so the refusal is testable —
 * an `InvocationContext` cannot reasonably be fabricated, a `SweepLogger` can.
 */
export async function runScheduledSweep(
  timer: Pick<Timer, 'isPastDue'> | undefined,
  log: SweepLogger,
  now: number = Date.now(),
): Promise<OrphanSweepSummary> {
  if (timer?.isPastDue) {
    const summary = emptySummary();
    summary.aborted = true;
    summary.reason = 'past-due';
    log.warn(
      '[orphan-sweep] REFUSED TO SWEEP — 0 blobs deleted, nothing in storage was touched. ' +
        'Reason: past-due. The host fired this as CATCH-UP for a missed 03:00 UTC occurrence, ' +
        'so it is running at some arbitrary time of day rather than in the maintenance window — ' +
        'and possibly against a reference set the paired frontend/schema deploy has not caught up ' +
        'with. WHAT TO DO: nothing; the next scheduled 03:00 UTC run proceeds normally. If this ' +
        'appears at all, `useMonitor` has been turned back on — see the registration below.',
      summary,
    );
    return summary;
  }
  return runOrphanSweep(log, now);
}

// Registration trailer. Line-anchored `app.timer('orphan-sweep'` so the fleet
// guard (functions/registration-names.test.ts) can read the name statically and
// check it against this folder, exactly as it does for the HTTP fleet.
app.timer('orphan-sweep', {
  schedule: SCHEDULE,
  // Never true in production: a restart, a scale-out or a deploy would each fire
  // an unattended deletion run outside the maintenance window.
  runOnStartup: false,
  // `useMonitor` DEFAULTS TO TRUE for every schedule with an interval >= 1 minute,
  // and `runOnStartup: false` does NOT suppress what it enables — the two are
  // unrelated switches. With the schedule persisted, a host that was stopped,
  // failed or idle across 03:00 UTC (a redeploy re-run in the morning, an app
  // setting changed at 02:59, a storage blip) fires a CATCH-UP run the moment it
  // comes back: the only unattended deleter in this system, running mid-business
  // day. Turning the monitor off means a missed 03:00 is simply skipped until
  // tomorrow — the correct outcome for a job whose only action is deletion, and
  // one night of unreclaimed storage is the entire cost.
  useMonitor: false,
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    // Belt and braces: with `useMonitor: false` above, `isPastDue` should never
    // be true. The check is what makes that a claim the code enforces rather
    // than one it merely assumes, and it survives someone flipping the monitor
    // back on without reading this comment.
    await runScheduledSweep(timer, context);
  },
});
