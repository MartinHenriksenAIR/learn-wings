import { app } from '@azure/functions';
import type { InvocationContext, Timer } from '@azure/functions';
import { query } from '../shared/db';
import { deleteBlob } from '../shared/blob';
import { generateContainerSasToken, SAS_SIGNED_VERSION } from '../shared/sas';
import { UPLOAD_LIMITS, fileExtension, type UploadAssetKind } from '../shared/upload-limits';
import { recordAndNotify } from './notify';


const SCHEDULE = '0 0 3 * * *';

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MAX_ORPHAN_SHARE = 0.5;

const MIN_ROOT_CLASS_ORPHANS = 5;

const DEFAULT_MAX_DELETIONS_PER_RUN = 500;

const LIST_PAGE_SIZE = 5000;

const MAX_LIST_PAGES = 200;

const DELETE_CONCURRENCY = 8;

const LIST_SAS_MINUTES = 15;

const ABORT_SAMPLE_SIZE = 10;

const SAFE_BLOB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

const AZURE_BLOB_HOST = /\.blob\.core\.windows\.net$/i;

const LEGACY_STORAGE_PREFIXES = [
  '/storage/v1/object/sign/lms-assets/',
  '/storage/v1/object/public/lms-assets/',
];

const REFERENCED_PATHS_SQL = `
      SELECT video_storage_path    AS path FROM lessons       WHERE video_storage_path    IS NOT NULL
UNION SELECT azure_blob_path       AS path FROM lessons       WHERE azure_blob_path       IS NOT NULL
UNION SELECT document_storage_path AS path FROM lessons       WHERE document_storage_path IS NOT NULL
UNION SELECT thumbnail_url         AS path FROM courses       WHERE thumbnail_url         IS NOT NULL
UNION SELECT logo_url              AS path FROM organizations WHERE logo_url              IS NOT NULL
UNION SELECT avatar_url            AS path FROM profiles      WHERE avatar_url            IS NOT NULL
`;

export interface SweepLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ListedBlob {
  name: string;
  contentLength: number | null;
  lastModified: number | null;
  encodedName: boolean;
}

export function blobBucket(name: string): string {
  const slash = name.indexOf('/');
  return slash < 0 ? '' : name.slice(0, slash + 1);
}

export type RootFileClass = UploadAssetKind | 'other';

const ROOT_CLASS_KEY = 'root:';

const UPLOAD_KINDS: readonly UploadAssetKind[] = ['image', 'video', 'document'];

const ROOT_CLASS_LABELS: Readonly<Record<RootFileClass, string>> = {
  image: 'image files at the container root',
  video: 'video files at the container root',
  document: 'document files at the container root',
  other: 'files of no recognised type at the container root',
};

export function rootFileClass(name: string): RootFileClass {
  const ext = fileExtension(name);
  return UPLOAD_KINDS.find((kind) => UPLOAD_LIMITS[kind].extensions.has(ext)) ?? 'other';
}

function rootClassOf(bucket: string): RootFileClass | null {
  if (!bucket.startsWith(ROOT_CLASS_KEY)) return null;
  const cls = bucket.slice(ROOT_CLASS_KEY.length);
  return cls in ROOT_CLASS_LABELS ? (cls as RootFileClass) : null;
}

export function blobBuckets(name: string): string[] {
  const prefix = blobBucket(name);
  if (prefix !== '') return [prefix];
  return ['', `${ROOT_CLASS_KEY}${rootFileClass(name)}`];
}

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
  aborted: boolean;
  reason: SweepAbortReason | null;
  scanned: number;
  referenced: number;
  eligible: number;
  orphaned: number;
  skippedByGrace: number;
  skippedUnsafeName: number;
  skippedByRecheck: number;
  deleted: number;
  failed: number;
  bytesReclaimed: number;
  deletedSample: string[];
}

const DELETED_SAMPLE_SIZE = 20;

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
  bytesReclaimed: 0,
  deletedSample: [],
});

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
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) add(segments.slice(1).map(decodeURIComponent).join('/'));
    }
  } catch {
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

export function parseListPage(xml: string): { blobs: ListedBlob[]; nextMarker: string | null } | null {
  if (typeof xml !== 'string') return null;
  if (!xml.includes('<EnumerationResults') || !xml.includes('<Blobs')) return null;

  const blobs: ListedBlob[] = [];
  for (const element of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
    const body = element[1];
    const named = /<Name(\s[^>]*)?>([\s\S]*?)<\/Name>/.exec(body);
    const name = named?.[2];
    if (name === undefined || name === '') return null;
    const encodedName = named?.[1] !== undefined;

    const rawModified = /<Last-Modified>([\s\S]*?)<\/Last-Modified>/.exec(body)?.[1];
    const parsedModified = rawModified ? Date.parse(rawModified) : Number.NaN;

    const rawLength = /<Content-Length>([\s\S]*?)<\/Content-Length>/.exec(body)?.[1];
    const parsedLength = rawLength ? Number(rawLength) : Number.NaN;

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

class ListingError extends Error {}

async function listContainer(
  accountName: string,
  accountKey: string,
  containerName: string,
): Promise<ListedBlob[]> {
  const blobs: ListedBlob[] = [];
  const seenMarkers = new Set<string>();
  let marker: string | null = null;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
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

    if (seenMarkers.has(parsed.nextMarker)) throw new ListingError('NextMarker repeated — listing did not advance');
    seenMarkers.add(parsed.nextMarker);
    marker = parsed.nextMarker;
  }

  throw new ListingError(`listing exceeded ${MAX_LIST_PAGES} pages`);
}

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

export async function runOrphanSweep(log: SweepLogger, now: number = Date.now()): Promise<OrphanSweepSummary> {
  const summary = emptySummary();
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

  if (process.env.ORPHAN_SWEEP_DISABLED === '1') {
    return abort(
      'disabled',
      'ORPHAN_SWEEP_DISABLED=1.',
      'nothing, if the sweep was switched off deliberately. Clear the ORPHAN_SWEEP_DISABLED app setting to arm it again — while it is set, orphaned blobs accrue forever.',
    );
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
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

  const orphans: ListedBlob[] = [];
  const deletable: ListedBlob[] = [];
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
    const buckets = blobBuckets(blob.name);
    for (const bucket of buckets) bucketEligible.set(bucket, (bucketEligible.get(bucket) ?? 0) + 1);
    if (referenced.has(blob.name)) continue;

    orphans.push(blob);
    for (const bucket of buckets) bucketOrphaned.set(bucket, (bucketOrphaned.get(bucket) ?? 0) + 1);
    if (blob.lastModified === null || now - blob.lastModified < GRACE_PERIOD_MS) {
      summary.skippedByGrace++;
      continue;
    }
    deletable.push(blob);
  }
  summary.orphaned = orphans.length;

  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
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

  for (const [bucket, eligible] of bucketEligible) {
    const orphaned = bucketOrphaned.get(bucket) ?? 0;
    const rootClass = rootClassOf(bucket);
    if (rootClass !== null && orphaned < MIN_ROOT_CLASS_ORPHANS) continue;
    const bucketShare = orphaned / eligible;
    if (bucketShare <= maxShare) continue;
    const label = rootClass !== null ? ROOT_CLASS_LABELS[rootClass] : bucket === '' ? 'the container root' : bucket;
    const diagnosis =
      rootClass !== null
        ? 'The root is the one bucket two writers share — courses.thumbnail_url puts images there, the bare lesson paths put videos and documents there — so it is censused per file-type class, by extension. One class going bad like this is what a break confined to one of those columns looks like once the rest of the root has diluted it away.'
        : 'A single prefix going bad like this is what a break confined to one path-writing column looks like.';
    return abort(
      'orphan-bucket-share-implausible',
      `${orphaned}/${eligible} blobs under ${label} (${pct(bucketShare)}) look unreferenced, above the ${pct(maxShare)} ceiling — even though the container as a whole is only ${pct(share)} unreferenced. ${diagnosis} Sample: ${sampleOf(orphans.filter((b) => blobBuckets(b.name).includes(bucket)))}.`,
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
        return { ok, blob };
      }),
    );
    for (const { ok, blob } of outcomes) {
      if (!ok) {
        summary.failed++;
        continue;
      }
      summary.deleted++;
      summary.bytesReclaimed += blob.contentLength ?? 0;
      if (summary.deletedSample.length < DELETED_SAMPLE_SIZE) summary.deletedSample.push(blob.name);
    }
  }

  log.log('[orphan-sweep] run complete', summary);
  return summary;
}

function refusePastDue(log: SweepLogger): OrphanSweepSummary {
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

export async function runScheduledSweep(
  timer: Pick<Timer, 'isPastDue'> | undefined,
  log: SweepLogger,
  now: number = Date.now(),
): Promise<OrphanSweepSummary> {
  const summary = timer?.isPastDue ? refusePastDue(log) : await runOrphanSweep(log, now);
  try {
    await recordAndNotify(summary, { startedAt: now, now, log });
  } catch (err: unknown) {
    log.error('[orphan-sweep] run record / alerting failed — the sweep result above stands', err);
  }
  return summary;
}

app.timer('orphan-sweep', {
  schedule: SCHEDULE,
  runOnStartup: false,
  useMonitor: false,
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    await runScheduledSweep(timer, context);
  },
});
