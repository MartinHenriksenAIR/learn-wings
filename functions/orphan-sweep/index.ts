import { app } from '@azure/functions';
import type { InvocationContext, Timer } from '@azure/functions';
import { query } from '../shared/db';
import { deleteBlob } from '../shared/blob';
import { generateContainerSasToken, SAS_SIGNED_VERSION } from '../shared/sas';
import { recordAndNotify, readSweepBaseline } from './notify';


const SCHEDULE = '0 0 3 * * *';

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

const MIN_NEW_UNMATCHED_REFERENCES = 5;

const MATCH_COLLAPSE_FRACTION = 0.5;

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

export interface SweepBaseline {
  startedAt: number;
  matched: number;
  unmatchedReferences: number;
}

export type SweepAbortReason =
  | 'disabled'
  | 'past-due'
  | 'storage-not-configured'
  | 'reference-read-failed'
  | 'empty-reference-set'
  | 'listing-failed'
  | 'reference-resolution-broken'
  | 'reference-loss';

export interface OrphanSweepSummary {
  aborted: boolean;
  reportOnly: boolean;
  reason: SweepAbortReason | null;
  abortDetail: string | null;
  scanned: number;
  referenced: number;
  eligible: number;
  orphaned: number;
  matched: number | null;
  unmatchedReferences: number | null;
  skippedByGrace: number;
  skippedUnsafeName: number;
  skippedByRecheck: number;
  deleted: number;
  deferred: number;
  failed: number;
  bytesReclaimed: number;
  deletedSample: string[];
}

const DELETED_SAMPLE_SIZE = 20;

const emptySummary = (): OrphanSweepSummary => ({
  aborted: false,
  reportOnly: false,
  reason: null,
  abortDetail: null,
  scanned: 0,
  referenced: 0,
  eligible: 0,
  orphaned: 0,
  matched: null,
  unmatchedReferences: null,
  skippedByGrace: 0,
  skippedUnsafeName: 0,
  skippedByRecheck: 0,
  deleted: 0,
  deferred: 0,
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
  add(trimmed.replace(/^\/+/, ''));

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

interface ReferenceRead {
  rows: string[][];
  referenced: Set<string>;
}

async function readReferencedPaths(): Promise<ReferenceRead> {
  const rows = await query<{ path: string | null }>(REFERENCED_PATHS_SQL);
  const referenced = new Set<string>();
  const perRow: string[][] = [];
  for (const row of rows) {
    if (typeof row?.path !== 'string' || row.path === '') continue;
    const variants = referenceVariants(row.path);
    perRow.push(variants);
    for (const variant of variants) referenced.add(variant);
  }
  return { rows: perRow, referenced };
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

export async function runOrphanSweep(
  log: SweepLogger,
  now: number = Date.now(),
  baseline: SweepBaseline | null = null,
): Promise<OrphanSweepSummary> {
  const summary = emptySummary();
  const abort = (reason: SweepAbortReason, message: string, remedy: string): OrphanSweepSummary => {
    summary.aborted = true;
    summary.reason = reason;
    summary.deleted = 0;
    summary.deferred = 0;
    summary.abortDetail = `${message} WHAT TO DO: ${remedy}`;
    log.error(
      `[orphan-sweep] REFUSED TO SWEEP — 0 blobs deleted, nothing in storage was touched. ` +
        `This is NOT a clean run with nothing to do. Reason: ${reason}. ${summary.abortDetail}`,
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
    'treat this as a BROKEN QUERY, not an empty database: a renamed column or a dropped table produces exactly this. Check REFERENCED_PATHS_SQL against migration/azure/01-schema.sql before changing anything else.';
  const listingFailureRemedy =
    'nothing immediately — a listing that could not be completed is never used as a basis for deletion. If it recurs, check the storage account and that the list SAS is still valid.';

  let before: ReferenceRead;
  try {
    before = await readReferencedPaths();
  } catch (err: unknown) {
    return abort('reference-read-failed', err instanceof Error ? err.message : String(err), readFailureRemedy);
  }
  if (before.rows.length === 0) {
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

  let after: ReferenceRead;
  try {
    after = await readReferencedPaths();
  } catch (err: unknown) {
    return abort(
      'reference-read-failed',
      `second read: ${err instanceof Error ? err.message : String(err)}`,
      readFailureRemedy,
    );
  }
  if (after.rows.length === 0) {
    return abort('empty-reference-set', 'the six-column union returned no rows on the second read.', emptySetRemedy);
  }

  const referenced = new Set<string>([...before.referenced, ...after.referenced]);
  summary.referenced = referenced.size;

  const listedNames = new Set<string>(blobs.map((blob) => blob.name));
  const unresolved = before.rows.filter((variants) => !variants.some((variant) => listedNames.has(variant)));
  summary.unmatchedReferences = unresolved.length;
  summary.matched = blobs.filter((blob) => referenced.has(blob.name)).length;

  const orphans: ListedBlob[] = [];
  const deletable: ListedBlob[] = [];
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
    if (referenced.has(blob.name)) continue;

    orphans.push(blob);
    if (blob.lastModified === null || now - blob.lastModified < GRACE_PERIOD_MS) {
      summary.skippedByGrace++;
      continue;
    }
    deletable.push(blob);
  }
  summary.orphaned = orphans.length;

  const sampleOf = (candidates: readonly string[]) => {
    const names = candidates.slice(0, ABORT_SAMPLE_SIZE);
    const rest = candidates.length - names.length;
    return `${names.join(', ')}${rest > 0 ? `, … (+${rest} more)` : ''}`;
  };

  if (baseline === null) {
    summary.reportOnly = true;
    summary.abortDetail =
      `No earlier run carries a census to compare tonight against, so this run counted everything and ` +
      `deleted nothing. It found ${summary.orphaned} unreferenced blob(s) of ${summary.eligible} eligible, ` +
      `${summary.matched} blob(s) that the database does point at, and ${summary.unmatchedReferences} ` +
      `reference(s) that resolve to no blob at all. ` +
      `WHAT TO DO: read those four numbers. They are tonight's baseline and the next run is measured against ` +
      `them, so if they are already wrong this is the night to say so — set ORPHAN_SWEEP_DISABLED=1 and ` +
      `investigate. If they look right, nothing: the next scheduled run sweeps normally.`;
    log.warn(
      `[orphan-sweep] REPORT ONLY — 0 blobs deleted, nothing in storage was touched. ${summary.abortDetail}`,
      summary,
    );
    return summary;
  }

  const newlyUnmatched = summary.unmatchedReferences - baseline.unmatchedReferences;
  if (newlyUnmatched >= MIN_NEW_UNMATCHED_REFERENCES) {
    return abort(
      'reference-resolution-broken',
      `${summary.unmatchedReferences} of ${before.rows.length} reference(s) in the database resolve to no blob in ` +
        `the container, against ${baseline.unmatchedReferences} on the last accepted run — ${newlyUnmatched} more. ` +
        `A reference that exists must point at a blob that exists, so this is the match itself going wrong, not a ` +
        `backlog: a backlog leaves this number alone. The likely causes, in order, are a changed path format that ` +
        `referenceVariants does not normalise, a changed AZURE_STORAGE_CONTAINER_NAME or storage account, and a ` +
        `listing that came back partial. Every unreferenced blob this run found is therefore suspect and none were ` +
        `deleted. Sample of what no longer resolves: ${sampleOf(unresolved.map((variants) => variants[0]))}.`,
      `take the sampled values above and find their blobs by hand. If they exist in the container under a name the ` +
        `sweep did not match, fix the match — do not accept this as the new normal. If the container or account ` +
        `setting changed, put it back. Only if this drop is real and expected, accept it as the baseline with the ` +
        `statement below; until either happens the sweep will refuse every night, which is the intended behaviour.`,
    );
  }

  if (summary.matched < baseline.matched * MATCH_COLLAPSE_FRACTION) {
    return abort(
      'reference-loss',
      `${summary.matched} blob(s) are still pointed at by the database, against ${baseline.matched} on the last ` +
        `accepted run — a fall of more than ${(MATCH_COLLAPSE_FRACTION * 100).toFixed(0)}%. A healthy sweep never ` +
        `deletes a blob the database points at, so this number does not fall on its own. Either a large amount of ` +
        `content was deliberately removed, or references were lost by accident — a part-applied migration or a ` +
        `restore to an older snapshot both look exactly like this, and both would make this run delete live media.`,
      `check whether that much content really was removed on purpose. If it was, accept the new baseline with the ` +
        `statement below and the next run sweeps normally. If it was not, the database is missing rows it should ` +
        `have — restore them before letting this job run again, because the blobs are still there and this is the ` +
        `only thing standing between them and deletion.`,
    );
  }

  const ordered = [...deletable].sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0));
  const capped = ordered.slice(0, maxDeletions);
  summary.deferred = ordered.length - capped.length;
  if (summary.deferred > 0) {
    log.warn(
      `[orphan-sweep] ${ordered.length} blob(s) are deletable, above the per-run ceiling of ${maxDeletions}. ` +
        `Deleting the ${capped.length} oldest and carrying ${summary.deferred} to the next run — the backlog drains ` +
        `at this rate rather than blocking the sweep.`,
    );
  }

  let confirmed = capped;
  if (capped.length > 0) {
    let final: ReferenceRead;
    try {
      final = await readReferencedPaths();
    } catch (err: unknown) {
      return abort(
        'reference-read-failed',
        `pre-delete re-check: ${err instanceof Error ? err.message : String(err)}`,
        readFailureRemedy,
      );
    }
    if (final.rows.length === 0) {
      return abort(
        'empty-reference-set',
        'the six-column union returned no rows on the pre-delete re-check.',
        emptySetRemedy,
      );
    }

    confirmed = capped.filter((blob) => !final.referenced.has(blob.name));
    summary.skippedByRecheck = capped.length - confirmed.length;
    if (summary.skippedByRecheck > 0) {
      log.warn(
        `[orphan-sweep] ${summary.skippedByRecheck} candidate(s) became referenced after the listing and will NOT be deleted:`,
        capped.filter((blob) => final.referenced.has(blob.name)).map((blob) => blob.name),
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
  summary.abortDetail =
    'The host fired this as CATCH-UP for a missed 03:00 UTC occurrence, so it is running at some ' +
    'arbitrary time of day rather than in the maintenance window — and possibly against a reference ' +
    'set the paired frontend/schema deploy has not caught up with. WHAT TO DO: nothing; the next ' +
    'scheduled 03:00 UTC run proceeds normally. If this appears at all, `useMonitor` has been turned ' +
    'back on — see the registration below.';
  log.warn(
    '[orphan-sweep] REFUSED TO SWEEP — 0 blobs deleted, nothing in storage was touched. ' +
      `Reason: past-due. ${summary.abortDetail}`,
    summary,
  );
  return summary;
}

export async function runScheduledSweep(
  timer: Pick<Timer, 'isPastDue'> | undefined,
  log: SweepLogger,
  now: number = Date.now(),
): Promise<OrphanSweepSummary> {
  let summary: OrphanSweepSummary;
  if (timer?.isPastDue) {
    summary = refusePastDue(log);
  } else {
    let baseline: SweepBaseline | null = null;
    try {
      baseline = await readSweepBaseline();
    } catch (err: unknown) {
      log.error(
        '[orphan-sweep] could not read the baseline census from orphan_sweep_runs — this run will report rather ' +
          'than delete, which is the safe direction',
        err,
      );
    }
    summary = await runOrphanSweep(log, now, baseline);
  }

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
