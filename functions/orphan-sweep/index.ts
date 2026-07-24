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
 * Nightly at 03:00: list the container, build the set of blob names the database
 * still references, and delete the listed blobs that are in neither the reference
 * set nor the 24-hour grace window.
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
 * `List Blobs` returns the FULL blob name including any folder prefix. Paths are
 * stored in the database in two shapes:
 *   - bare names   — lessons.video_storage_path / azure_blob_path /
 *                    document_storage_path, courses.thumbnail_url  (`abc.mp4`)
 *   - prefixed     — organizations.logo_url, profiles.avatar_url
 *                    (`org-logos/x.png`, `avatars/y.jpg` — BRANDING_ASSET_PREFIXES)
 * So the listed name is matched VERBATIM against the union of all six columns.
 * The listed name is never stripped, never basenamed, never normalized — doing
 * any of those would make every referenced branding asset look like an orphan.
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
 * If a schema rename, a JOIN mistake or a path-format change broke the match,
 * the symptom is the same every time: almost everything in the container looks
 * orphaned. No healthy container is ever majority-garbage, so an orphan share
 * above this fraction is treated as evidence that the COMPARISON is broken —
 * not as a big cleanup — and the run deletes nothing at all.
 *
 * A genuine first-run backlog can also trip this. That is the intended outcome:
 * the run logs loudly and a human decides, rather than an unattended job
 * deleting most of the container on its first night.
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
 */
const MAX_LIST_PAGES = 200;

/** Simultaneous DELETEs. Deliberately small — this is a background job. */
const DELETE_CONCURRENCY = 8;

/** Lifetime of the container SAS minted for listing. */
const LIST_SAS_MINUTES = 15;

/**
 * The only blob names this job will ever DELETE.
 *
 * `buildBlobUrl` interpolates the name into a URL without percent-encoding, so a
 * name containing `?`, `#` or `%` would produce a request that targets a
 * DIFFERENT blob than the one we classified. Every name this system mints is
 * `[prefix/]<uuid>.<ext>`, so nothing legitimate is excluded; anything else is
 * counted, logged and left alone. Leading-dot segments are rejected too, which
 * takes `.` and `..` with them.
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
}

/** Why a run refused to delete anything. Every value means "nothing was deleted". */
export type SweepAbortReason =
  | 'disabled'
  | 'storage-not-configured'
  | 'reference-read-failed'
  | 'empty-reference-set'
  | 'listing-failed'
  | 'orphan-share-implausible'
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
  /** Blobs skipped because their name is not URL-safe. */
  skippedUnsafeName: number;
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
    const name = /<Name>([\s\S]*?)<\/Name>/.exec(body)?.[1];
    // A <Blob> we cannot name is a payload we do not understand — abort rather
    // than silently drop it (a dropped entry is a blob we never protect).
    if (name === undefined || name === '') return null;

    const rawModified = /<Last-Modified>([\s\S]*?)<\/Last-Modified>/.exec(body)?.[1];
    const parsedModified = rawModified ? Date.parse(rawModified) : Number.NaN;

    const rawLength = /<Content-Length>([\s\S]*?)<\/Content-Length>/.exec(body)?.[1];
    const parsedLength = rawLength ? Number(rawLength) : Number.NaN;

    blobs.push({
      name,
      contentLength: Number.isFinite(parsedLength) ? parsedLength : null,
      lastModified: Number.isFinite(parsedModified) ? parsedModified : null,
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
  const abort = (reason: SweepAbortReason, message: string): OrphanSweepSummary => {
    summary.aborted = true;
    summary.reason = reason;
    summary.deleted = 0;
    log.error(`[orphan-sweep] ABORTED (${reason}) — nothing deleted: ${message}`, summary);
    return summary;
  };

  // Kill switch: flip an app setting to stop the sweep without a redeploy.
  if (process.env.ORPHAN_SWEEP_DISABLED === '1') {
    return abort('disabled', 'ORPHAN_SWEEP_DISABLED=1');
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  // Same env var and same default as `deleteBlob`, so the container we list is
  // always the container we delete from.
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';
  if (!accountName || !accountKey) {
    return abort('storage-not-configured', 'AZURE_STORAGE_ACCOUNT_NAME/KEY missing');
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
  let before: { rows: number; referenced: Set<string> };
  try {
    before = await readReferencedPaths();
  } catch (err: unknown) {
    return abort('reference-read-failed', err instanceof Error ? err.message : String(err));
  }
  if (before.rows === 0) {
    return abort('empty-reference-set', 'the six-column union returned no rows (far likelier a query bug than an empty database)');
  }

  let blobs: ListedBlob[];
  try {
    blobs = await listContainer(accountName, accountKey, containerName);
  } catch (err: unknown) {
    return abort('listing-failed', err instanceof Error ? err.message : String(err));
  }
  summary.scanned = blobs.length;

  let after: { rows: number; referenced: Set<string> };
  try {
    after = await readReferencedPaths();
  } catch (err: unknown) {
    return abort('reference-read-failed', `second read: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (after.rows === 0) {
    return abort('empty-reference-set', 'the six-column union returned no rows on the second read');
  }

  const referenced = new Set<string>([...before.referenced, ...after.referenced]);
  summary.referenced = referenced.size;

  // ── Classification ───────────────────────────────────────────────────────
  // `blob.name` is used exactly as Azure returned it. Do not trim it, do not
  // strip its prefix, do not lower-case it.
  const orphans: ListedBlob[] = [];
  const deletable: ListedBlob[] = [];
  for (const blob of blobs) {
    if (!SAFE_BLOB_NAME.test(blob.name)) {
      summary.skippedUnsafeName++;
      log.warn('[orphan-sweep] skipping blob with a name this job will not delete:', blob.name);
      continue;
    }
    summary.eligible++;
    if (referenced.has(blob.name)) continue;

    orphans.push(blob);
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
  const share = summary.eligible === 0 ? 0 : summary.orphaned / summary.eligible;
  if (share > maxShare) {
    return abort(
      'orphan-share-implausible',
      `${summary.orphaned}/${summary.eligible} blobs (${(share * 100).toFixed(1)}%) look unreferenced, above the ${(maxShare * 100).toFixed(1)}% ceiling — treating this as a broken reconciliation, not a big cleanup`,
    );
  }
  if (deletable.length > maxDeletions) {
    return abort(
      'orphan-count-implausible',
      `${deletable.length} deletions requested, above the per-run ceiling of ${maxDeletions}`,
    );
  }

  // ── Deletion ─────────────────────────────────────────────────────────────
  // No DB connection is held here. `deleteBlob` never throws; a failure is
  // counted and the next run will try again.
  for (let i = 0; i < deletable.length; i += DELETE_CONCURRENCY) {
    const chunk = deletable.slice(i, i + DELETE_CONCURRENCY);
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

// Registration trailer. Line-anchored `app.timer('orphan-sweep'` so the fleet
// guard (functions/registration-names.test.ts) can read the name statically and
// check it against this folder, exactly as it does for the HTTP fleet.
app.timer('orphan-sweep', {
  schedule: SCHEDULE,
  // Never true in production: a restart, a scale-out or a deploy would each fire
  // an unattended deletion run outside the maintenance window.
  runOnStartup: false,
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    await runOrphanSweep(context);
  },
});
