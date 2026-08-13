import { query, queryOne } from '../shared/db';
import { escapeHtml, sendBestEffort } from '../shared/resend';
import type { OrphanSweepSummary, SweepLogger } from './index';

/**
 * ORPHAN-SWEEP ALERTING (#286) — the run record and the exception-only email.
 *
 * WHY IT EXISTS
 * `index.ts` has ~nine refusal paths and every one of them was a `log.error` and
 * nothing else, so the sweep failed SILENTLY in both directions:
 *   1. It wedges. A refusal that does not heal on its own (a genuine backlog
 *      tripping the count ceiling is the likeliest) aborts every single night,
 *      reclaims nothing, and looks EXACTLY like a healthy quiet night from the
 *      outside — storage grows as if the sweep had never been written.
 *   2. It deletes something it shouldn't. Blob soft-delete gives a 7-day
 *      recovery window (verified, #281) — but recovery needs somebody to NOTICE
 *      inside those seven days, and nothing started that clock in anyone's head.
 *
 * THE TWO SIGNALS. A clean, uneventful night sends nothing at all.
 *   - ABORT, on STATE CHANGE (plus a weekly re-announcement, and never more
 *     often than `ALERT_MIN_GAP_MS`). A wedged sweep that emailed nightly would
 *     become filterable noise within a week, which is the same silence by
 *     another route; one that emailed only once could be missed. State-change
 *     alone is not enough to prevent the nightly case either — a FLAPPING sweep
 *     re-transitions every other night — which is what the gap floor is for.
 *   - DELETION DIGEST, weekly BUT DEADLINE-FORCED at 3 days. A plain weekly
 *     digest can report a Tuesday deletion on the following Monday, leaving ~1
 *     day of the 7-day window — a receipt that arrives too late to act on is not
 *     a safety net. Firing at age 3 d leaves 4 days of runway, and the fourth
 *     day is slack rather than generosity: the deadline is only tested once a
 *     night, so it must still hold when a whole night is missed. In practice
 *     most weeks still produce one calm email.
 *
 * WHY THE POLICY IS A PURE FUNCTION. `decideSweepNotifications` takes
 * (thisRun, history, now) and returns which emails to send. Every rule above is
 * a cross-run statement about time, i.e. exactly the kind of thing that is
 * untestable once it is tangled with a DB read and an HTTP send — so the reading
 * and the sending live in `recordAndNotify` and the JUDGEMENT lives here, where
 * `npm test` can pin it night by night.
 *
 * NOTHING HERE MAY BREAK THE SWEEP. The record write, the send and the prune are
 * three independent best-effort steps: each logs its own failure and none of
 * them touches the summary the sweep returns. A notification outage must never
 * become a sweep outage.
 */

/** How a run is classified for policy purposes. See the mapping in `runOutcome`. */
export type SweepRunOutcome = 'completed' | 'aborted' | 'skipped';

const DAY_MS = 86_400_000;

/**
 * Blob soft-delete retention on the storage account (verified #281). This is the
 * whole reason the digest has a deadline: after this window the bytes are gone.
 */
const SOFT_DELETE_WINDOW_MS = 7 * DAY_MS;

/** How often a sustained abort re-announces itself after the first email. */
const ABORT_REANNOUNCE_MS = 7 * DAY_MS;

/**
 * The floor between two alert emails OF ANY KIND (that is why the recovered note
 * stamps `abort_notified_at` too — see `notify`).
 *
 * Without it a FLAPPING sweep emails every single night, forever: on
 * abort/healthy/abort/healthy every abort is a fresh transition and every
 * healthy night closes it. That is not an exotic sequence —
 * `reference-read-failed` (pool exhaustion, PG failover), `listing-failed`
 * (storage 503) and `orphan-count-implausible` with a backlog hovering at the
 * 500-per-run cap all flap by nature.
 *
 * 1.5 days is deliberately OFF the 24 h nightly grid: two consecutive nights are
 * suppressed with 12 h of margin either side, so nothing here turns on timer
 * jitter. It caps a flap at one email every other night. It cannot delay a
 * genuinely new wedge by more than one night, because the "streak never
 * announced" arm in `decideAlert` re-fires the moment the floor lifts.
 */
const ALERT_MIN_GAP_MS = 1.5 * DAY_MS;

/**
 * The age at which an unreported deletion FORCES a digest, whatever the cadence
 * says. 3 d against a 7 d window leaves 4 days to act, and the fourth day is
 * SLACK, not generosity: the comparison runs once a night, so at 4 d it decided
 * on sub-millisecond timer jitter and slipped to night 5 about half the time —
 * and because `useMonitor: false` means a missed 03:00 is skipped rather than
 * caught up (see the registration in `index.ts`), one missed night dropped it to
 * night 5 deterministically, i.e. to 2 days of runway. At 3 d a missed night
 * still lands inside the promised >= 3 days. Raising it eats that runway again.
 */
const DELETION_REPORT_DEADLINE_MS = 3 * DAY_MS;

/** The calm arm: at most one digest a week when nothing is near its deadline. */
const DIGEST_CADENCE_MS = 7 * DAY_MS;

/** Run records older than this are pruned, in the same run that writes one. */
const RETENTION_DAYS = 180;

/**
 * How far back the policy reads. 30 nightly rows is far more than the 7-day
 * windows need; unreported deletions are pulled in regardless of age so a run
 * whose receipt never went out can never fall out of the working set.
 *
 * It does cap the abort streak: a wedge that has run 35 nights reads as 30, so
 * the email says "night 30" and dates the streak from the window edge. Left as
 * is deliberately — every decision this module makes is inside a 7-day horizon,
 * so the only casualty is one number in the prose of an email that has by then
 * been re-announced four times.
 */
const HISTORY_WINDOW_DAYS = 30;

/** Deleted names quoted per run in the digest. `index.ts` caps the stored sample. */
const DIGEST_SAMPLE_SIZE = 20;

/** One persisted run, as the policy reads it. */
export interface SweepRunRecord {
  /** null only for a run whose record write failed — it can be reported, not stamped. */
  id: string | null;
  startedAt: number;
  outcome: SweepRunOutcome;
  reason: string | null;
  /**
   * The refusal in full (#451) — see `OrphanSweepSummary.abortDetail`. Null on a
   * completed run, and on any abort recorded before the column existed.
   */
  abortDetail: string | null;
  deleted: number;
  failed: number;
  bytesReclaimed: number;
  deletedSample: string[];
  /** When an alert email was sent FOR this run — abort or recovered, see `STAMP_ABORT_SQL`. */
  abortNotifiedAt: number | null;
  deletionsReportedAt: number | null;
}

export interface SweepNotifyInput {
  /** The run that just finished. Never present in `history`. */
  thisRun: SweepRunRecord;
  /** Previously recorded runs, any order (sorted here). */
  history: readonly SweepRunRecord[];
  now: number;
}

/** A run the digest reports, with the deadline that makes the report actionable. */
export interface DigestRun {
  id: string | null;
  startedAt: number;
  deleted: number;
  failed: number;
  bytesReclaimed: number;
  deletedSample: string[];
  /** Epoch ms after which blob soft-delete can no longer restore this run's deletions. */
  restorableUntil: number;
}

export interface SweepAlertEmail {
  kind: 'abort' | 'recovered';
  subject: string;
  html: string;
}

export interface SweepDigestEmail {
  subject: string;
  html: string;
  /** The runs reported, oldest first — the one closest to expiry leads. */
  runs: DigestRun[];
  /** The persisted subset of `runs`, i.e. what a successful send can stamp. */
  runIds: string[];
}

export interface SweepNotifyDecision {
  alert: SweepAlertEmail | null;
  digest: SweepDigestEmail | null;
}

/**
 * Map a finished sweep onto the three outcomes.
 *
 * `past-due` is the ONLY abort that is not abort-class: the host fired a
 * catch-up run outside the maintenance window and the next 03:00 UTC run
 * proceeds normally, so it is recorded and never emailed. `disabled` IS
 * abort-class — "someone turned it off and forgot" is precisely the wedge the
 * weekly re-announcement exists for.
 */
export function runOutcome(summary: Pick<OrphanSweepSummary, 'aborted' | 'reason'>): SweepRunOutcome {
  if (!summary.aborted) return 'completed';
  return summary.reason === 'past-due' ? 'skipped' : 'aborted';
}

const latest = (values: readonly (number | null)[]): number | null =>
  values.reduce<number | null>((best, value) => (value !== null && (best === null || value > best) ? value : best), null);

/**
 * The run of the abort streak that `ordered` opens with: how many consecutive
 * non-skipped runs aborted, when the streak began, and whether ANY night of it
 * has actually put an email in someone's inbox.
 *
 * `skipped` runs are STEPPED OVER rather than ending the streak. A single
 * catch-up night must not read as "the sweep was fine in between" — otherwise
 * one past-due run silently resets the escalation clock on a genuinely stuck
 * sweep, which is the failure this whole module exists to prevent.
 *
 * `nights` is bounded by `HISTORY_WINDOW_DAYS` — see the note there.
 */
function abortStreak(ordered: readonly SweepRunRecord[]): {
  nights: number;
  since: number | null;
  announced: boolean;
} {
  let nights = 0;
  let since: number | null = null;
  let announced = false;
  for (const run of ordered) {
    if (run.outcome === 'skipped') continue;
    if (run.outcome !== 'aborted') break;
    nights++;
    since = run.startedAt;
    if (run.abortNotifiedAt !== null) announced = true;
  }
  return { nights, since, announced };
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcStamp = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit]}`;
}

const failedLine = (failed: number): string =>
  failed > 0
    ? `<p>${failed} delete(s) were REFUSED by Azure — nothing was lost, and the next run retries them.</p>`
    : '';

function renderAbortEmail(
  run: SweepRunRecord,
  /** The last non-skipped run before this one, or null when there is no such run. */
  previous: SweepRunRecord | null,
  nights: number,
  since: number,
): SweepAlertEmail {
  const reason = escapeHtml(run.reason ?? 'unknown');
  // `previous === null` is the first run the alerting has ever seen (and the
  // all-past-due history that reads the same way). Claiming "the previous run
  // was healthy" there would be an assertion about a run that does not exist.
  const streak =
    nights > 1
      ? `<p>This is night <strong>${nights}</strong> of a run of refusals that began <strong>${utcStamp(since)}</strong>. Nothing has been reclaimed since then, and nothing will be until this is cleared.</p>`
      : previous === null
        ? '<p>There is no earlier run on record, so there is nothing to compare this against — either the sweep has never completed a run, or its records have aged out.</p>'
        : '<p>The previous run was healthy, so this is the first refused night.</p>';
  // THE REFUSAL ITSELF, IN THE EMAIL (#451). This used to be a pointer at an App
  // Insights query and nothing else, which made acting on a refusal depend on log
  // ingestion working — and when it silently was not, the sweep wedged for 19
  // nights while every one of those emails sent its reader to an empty result set.
  // The reason code alone never named the bucket, so there was nothing else in the
  // message to act on. `abort_detail` is null only for aborts recorded before the
  // column existed, so the old pointer stays as the fallback for those.
  const detail = run.abortDetail
    ? `<p><strong>What it refused, and what to do about it:</strong></p>
       <p style="background:#f5f4f0;border-left:3px solid #d97757;padding:10px 14px;white-space:pre-wrap">${escapeHtml(run.abortDetail)}</p>`
    : `<p><strong>What to do:</strong> read the full refusal, which names what it refused and the remedy, in App Insights:<br>
       <code>traces | where message contains 'REFUSED TO SWEEP' | order by timestamp desc | take 20</code></p>`;
  return {
    kind: 'abort',
    subject: `[orphan-sweep] refused to sweep — ${run.reason ?? 'unknown'}${nights > 1 ? ` (night ${nights})` : ''}`,
    html: `
    <h2>Orphan sweep refused to run</h2>
    <p>The nightly blob sweep <strong>deleted nothing</strong> and left storage untouched. This is NOT a clean run with nothing to do.</p>
    <p><strong>Reason:</strong> <code>${reason}</code> · run started ${utcStamp(run.startedAt)}</p>
    ${streak}
    ${failedLine(run.failed)}
    ${detail}
    <p style="color:#777;font-size:12px">You will not hear about this again for 7 days unless it changes state.</p>
  `,
  };
}

function renderRecoveredEmail(run: SweepRunRecord, nights: number, since: number | null): SweepAlertEmail {
  const context =
    since === null
      ? ''
      : `<p>It had refused ${nights} night(s), starting ${utcStamp(since)}.</p>`;
  return {
    kind: 'recovered',
    subject: '[orphan-sweep] recovered — sweeping again',
    html: `
    <h2>Orphan sweep is running again</h2>
    <p>The run that started ${utcStamp(run.startedAt)} completed and deleted ${run.deleted} blob(s) (${formatBytes(run.bytesReclaimed)}).</p>
    ${context}
    ${failedLine(run.failed)}
    <p style="color:#777;font-size:12px">Nothing further is needed — this closes the earlier refusal notice.</p>
  `,
  };
}

function renderDigestEmail(runs: readonly DigestRun[], now: number): { subject: string; html: string } {
  const totalDeleted = runs.reduce((sum, run) => sum + run.deleted, 0);
  const totalBytes = runs.reduce((sum, run) => sum + run.bytesReclaimed, 0);
  const totalFailed = runs.reduce((sum, run) => sum + run.failed, 0);
  const sections = runs
    .map((run) => {
      // Blob names carry user-supplied filename fragments — escaped, same
      // reasoning as #195.
      const sample = run.deletedSample
        .slice(0, DIGEST_SAMPLE_SIZE)
        .map((name) => `<li><code>${escapeHtml(name)}</code></li>`)
        .join('');
      const rest = run.deleted - Math.min(run.deletedSample.length, DIGEST_SAMPLE_SIZE);
      const daysLeft = Math.floor((run.restorableUntil - now) / DAY_MS);
      return `
    <h3>${utcStamp(run.startedAt)} — ${run.deleted} blob(s), ${formatBytes(run.bytesReclaimed)}</h3>
    <p><strong>Restorable until ${utcDate(run.restorableUntil)}</strong> (${daysLeft} day(s) left of the 7-day blob soft-delete window). After that the bytes are gone for good.</p>
    ${failedLine(run.failed)}
    <ul>${sample}${rest > 0 ? `<li>… and ${rest} more</li>` : ''}</ul>`;
    })
    .join('');
  return {
    subject: `[orphan-sweep] ${totalDeleted} blob(s) deleted — restore window closing`,
    html: `
    <h2>Orphan sweep — deleted blobs</h2>
    <p>${totalDeleted} blob(s) across ${runs.length} run(s), ${formatBytes(totalBytes)} reclaimed${totalFailed > 0 ? `, ${totalFailed} delete(s) refused by Azure` : ''}.</p>
    <p>Check that nothing here should still exist. To restore:<br>
       <code>az storage blob list --include d --auth-mode key --query "[?deleted]"</code> then
       <code>az storage blob undelete</code>.</p>
    ${sections}
    <p style="color:#777;font-size:12px">Sent because a deletion is approaching the end of its restore window, or because a week has passed since the last of these.</p>
  `,
  };
}

/**
 * THE POLICY. Pure: no clock, no DB, no network — every input is an argument.
 *
 * `history` is every OTHER recorded run (this one is passed separately, because
 * on the night its own record write fails it still has to be judged and
 * reported). Order does not matter; it is sorted here.
 */
export function decideSweepNotifications({ thisRun, history, now }: SweepNotifyInput): SweepNotifyDecision {
  const ordered = [...history]
    // Two dedup keys, because the id can be missing on the one path that most
    // needs it: if the INSERT commits but the response is lost (statement
    // timeout, connection reset after commit) the run has no id here and IS
    // read back by the history query, so an id-only filter would count tonight
    // twice — doubled counts and bytes, its section rendered twice. `started_at`
    // is this run's own clock reading, so the readback matches on it exactly.
    .filter((run) => (thisRun.id === null || run.id !== thisRun.id) && run.startedAt !== thisRun.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);
  return {
    alert: decideAlert(thisRun, ordered, now),
    digest: decideDigest(thisRun, ordered, now),
  };
}

function decideAlert(
  thisRun: SweepRunRecord,
  ordered: readonly SweepRunRecord[],
  now: number,
): SweepAlertEmail | null {
  // "The previous run" deliberately skips past-due catch-ups — see `abortStreak`.
  const previous = ordered.find((run) => run.outcome !== 'skipped') ?? null;
  const streak = abortStreak(ordered);
  // Every alert email stamps `abort_notified_at`, recovered ones included, so
  // this reads "when did we last write to their inbox" rather than "when did we
  // last report an abort" — which is the only thing a rate limit can measure.
  const lastEmail = latest(ordered.map((run) => run.abortNotifiedAt));
  const tooSoon = lastEmail !== null && now - lastEmail < ALERT_MIN_GAP_MS;

  if (thisRun.outcome === 'aborted') {
    // No arm alone is sufficient. Without the transition a first abort waits a
    // week to be heard; without the re-announcement a sustained abort is
    // announced once and then forgotten; and without `unannounced` a wedge whose
    // opening night was suppressed by the floor below would wait out that whole
    // week in silence, which is precisely the failure this module exists for.
    const isTransition = previous === null || previous.outcome === 'completed';
    const overdue = lastEmail === null || now - lastEmail >= ABORT_REANNOUNCE_MS;
    const unannounced = !streak.announced;
    if (!isTransition && !overdue && !unannounced) return null;
    // The gap floor. `overdue` cannot coexist with it (7 d > 1.5 d), so it only
    // ever bites the two arms a flap re-triggers night after night.
    if (tooSoon) return null;
    return renderAbortEmail(thisRun, previous, streak.nights + 1, streak.since ?? thisRun.startedAt);
  }

  // Only a genuinely COMPLETED run closes the loop. A past-due catch-up is not
  // evidence the sweep works, so it never sends the recovered note either.
  if (thisRun.outcome === 'completed' && previous?.outcome === 'aborted') {
    // JUDGEMENT (#286 review). The recovered note is suppressed when the streak
    // it would close never actually produced an email: there is no notice to
    // close, and sending anyway is the other half of the flapping loop — a
    // healthy night announcing recovery from a refusal nobody was ever told
    // about. Suppressing by STREAK LENGTH instead ("was it only one night?") was
    // the other candidate and is worse: a one-night abort that DID email is both
    // the commonest case and the one where the reader is actively waiting to
    // hear it healed, so that rule would silence the note exactly where it earns
    // its keep. Length is a proxy; "was anyone told" is the actual question.
    if (!streak.announced) return null;
    return renderRecoveredEmail(thisRun, streak.nights, streak.since);
  }
  return null;
}

function decideDigest(
  thisRun: SweepRunRecord,
  ordered: readonly SweepRunRecord[],
  now: number,
): SweepDigestEmail | null {
  // The working set is the TABLE's unreported deletions, not this run's — a
  // night that deleted followed by a week of wedged nights must still produce
  // the receipt for what was deleted.
  const unreported = [
    ...(thisRun.deleted > 0 ? [thisRun] : []),
    ...ordered.filter((run) => run.deleted > 0 && run.deletionsReportedAt === null),
  ].sort((a, b) => a.startedAt - b.startedAt);
  if (unreported.length === 0) return null;

  const lastDigest = latest(ordered.map((run) => run.deletionsReportedAt));
  const deadlineForced = now - unreported[0].startedAt >= DELETION_REPORT_DEADLINE_MS;
  // A table that has never produced a digest has no cadence to be due: the
  // deadline arm alone decides, so the first-ever deletion is reported at age
  // 4 d like any other rather than the same night.
  const cadenceDue = lastDigest !== null && now - lastDigest >= DIGEST_CADENCE_MS;
  if (!deadlineForced && !cadenceDue) return null;

  const runs: DigestRun[] = unreported.map((run) => ({
    id: run.id,
    startedAt: run.startedAt,
    deleted: run.deleted,
    failed: run.failed,
    bytesReclaimed: run.bytesReclaimed,
    deletedSample: run.deletedSample,
    restorableUntil: run.startedAt + SOFT_DELETE_WINDOW_MS,
  }));
  return {
    ...renderDigestEmail(runs, now),
    runs,
    runIds: runs.map((run) => run.id).filter((id): id is string => id !== null),
  };
}

// ── The impure half ──────────────────────────────────────────────────────────

const INSERT_RUN_SQL = `
  INSERT INTO orphan_sweep_runs (
    started_at, outcome, reason, scanned, referenced, eligible, orphaned,
    skipped_by_grace, skipped_unsafe_name, skipped_by_recheck, deleted, failed,
    bytes_reclaimed, deleted_sample, abort_detail
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  RETURNING id
`;

const HISTORY_SQL = `
  SELECT id, started_at, outcome, reason, abort_detail, deleted, failed, bytes_reclaimed,
         deleted_sample, abort_notified_at, deletions_reported_at
  FROM orphan_sweep_runs
  WHERE started_at > now() - interval '${HISTORY_WINDOW_DAYS} days'
     OR (deleted > 0 AND deletions_reported_at IS NULL)
  ORDER BY started_at DESC
`;

// Stamped for EVERY alert email, recovered notes included — the gap floor in
// `decideAlert` measures against the last email of any kind, not the last abort.
const STAMP_ABORT_SQL = `UPDATE orphan_sweep_runs SET abort_notified_at = now() WHERE id = $1`;
const STAMP_DIGEST_SQL = `UPDATE orphan_sweep_runs SET deletions_reported_at = now() WHERE id = ANY($1::uuid[])`;
const PRUNE_SQL = `DELETE FROM orphan_sweep_runs WHERE started_at < now() - interval '${RETENTION_DAYS} days'`;
const OPS_ALERTS_SQL = `SELECT value FROM platform_settings WHERE key = 'ops_alerts'`;

interface RunRow {
  id: string;
  started_at: unknown;
  outcome: unknown;
  reason: string | null;
  abort_detail: string | null;
  deleted: unknown;
  failed: unknown;
  /** bigint — node-pg hands int8 back as a string. */
  bytes_reclaimed: unknown;
  deleted_sample: unknown;
  abort_notified_at: unknown;
  deletions_reported_at: unknown;
}

const toMillis = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function toRecord(row: RunRow): SweepRunRecord {
  return {
    id: row.id,
    // A row whose timestamp we cannot read reads as very old, which can only
    // make the digest fire SOONER — the safe direction for a restore deadline.
    startedAt: toMillis(row.started_at) ?? 0,
    outcome: row.outcome === 'completed' ? 'completed' : row.outcome === 'skipped' ? 'skipped' : 'aborted',
    reason: typeof row.reason === 'string' ? row.reason : null,
    abortDetail: typeof row.abort_detail === 'string' ? row.abort_detail : null,
    deleted: toCount(row.deleted),
    failed: toCount(row.failed),
    bytesReclaimed: toCount(row.bytes_reclaimed),
    deletedSample: Array.isArray(row.deleted_sample) ? row.deleted_sample.map(String) : [],
    abortNotifiedAt: toMillis(row.abort_notified_at),
    deletionsReportedAt: toMillis(row.deletions_reported_at),
  };
}

interface OpsAlertsValue {
  recipients?: unknown;
  enabled?: unknown;
}

/**
 * The recipients, or an empty list. Missing key, `enabled: false` and an empty
 * list are all LOUD — an unread alert address is the same silence the whole
 * feature exists to remove — but none of them is ever an error the sweep sees.
 * Only read when there is actually something to send, so a quiet night is quiet.
 */
async function readOpsAlertRecipients(log: SweepLogger): Promise<string[]> {
  const row = await queryOne<{ value: OpsAlertsValue | null }>(OPS_ALERTS_SQL);
  const value = row?.value ?? null;
  const remedy =
    "set it with: UPDATE platform_settings SET value = '{\"recipients\": [\"you@example.com\"], \"enabled\": true}'::jsonb WHERE key = 'ops_alerts';";
  if (!value || typeof value !== 'object') {
    log.error(`[orphan-sweep] NOT SENDING an alert — no ops_alerts row in platform_settings. ${remedy}`);
    return [];
  }
  if (value.enabled !== true) {
    log.error(`[orphan-sweep] NOT SENDING an alert — ops_alerts.enabled is not true, so sweep alerting is OFF. ${remedy}`);
    return [];
  }
  const recipients = (Array.isArray(value.recipients) ? value.recipients : [])
    .filter((address): address is string => typeof address === 'string' && address.trim() !== '')
    .map((address) => address.trim());
  if (recipients.length === 0) {
    log.error(`[orphan-sweep] NOT SENDING an alert — ops_alerts.recipients is empty. ${remedy}`);
    return [];
  }
  return recipients;
}

export interface SweepNotifyContext {
  /** When the run began — the record's `started_at` and the restore deadline's anchor. */
  startedAt: number;
  now: number;
  log: SweepLogger;
}

/**
 * Record this run and send whatever the policy asks for. Never throws.
 *
 * Three independent best-effort steps. A failed send still leaves the record; a
 * failed prune costs nothing but disk. A failed RECORD WRITE is the one with a
 * lasting cost: tonight's digest can still report this run from memory, but only
 * if it fires tonight — and with no row written, no LATER digest can ever see
 * these deletions. That is why the catch below prints the whole receipt.
 */
export async function recordAndNotify(summary: OrphanSweepSummary, ctx: SweepNotifyContext): Promise<void> {
  const { startedAt, log } = ctx;

  let runId: string | null = null;
  try {
    const row = await queryOne<{ id: string }>(INSERT_RUN_SQL, [
      new Date(startedAt),
      runOutcome(summary),
      summary.reason,
      summary.scanned,
      summary.referenced,
      summary.eligible,
      summary.orphaned,
      summary.skippedByGrace,
      summary.skippedUnsafeName,
      summary.skippedByRecheck,
      summary.deleted,
      summary.failed,
      summary.bytesReclaimed,
      summary.deletedSample,
      summary.abortDetail,
    ]);
    runId = row?.id ?? null;
  } catch (err) {
    log.error(
      '[orphan-sweep] could not record this run in orphan_sweep_runs — the sweep itself is unaffected, but this night is invisible to the alerting policy',
      err,
    );
    // The receipt of last resort. With no row, the digest's working set will
    // never contain these deletions again, so unless tonight's digest happens to
    // fire this is the ONLY place the names survive — and the 7-day soft-delete
    // window is running from `startedAt` either way. Retrying the INSERT was the
    // alternative and was not taken: a second attempt against a pool that just
    // refused the first mostly fails too, and it would put a retry loop on the
    // tail of the one job that must never be slowed into the working day.
    if (summary.deleted > 0) {
      log.error(
        `[orphan-sweep] THESE DELETIONS ARE NOT RECORDED AND WILL NOT BE DIGESTED — this log line is the only receipt. ` +
          `${summary.deleted} blob(s), ${summary.bytesReclaimed} byte(s), deleted by the run that started ` +
          `${utcStamp(startedAt)}; restorable via blob soft-delete until ${utcDate(startedAt + SOFT_DELETE_WINDOW_MS)}. ` +
          `Sample: ${summary.deletedSample.join(', ') || '(none captured)'}`,
      );
    }
  }

  try {
    await notify(summary, ctx, runId);
  } catch (err) {
    log.error('[orphan-sweep] alerting failed — the sweep result stands', err);
  }

  try {
    await query(PRUNE_SQL);
  } catch (err) {
    log.error('[orphan-sweep] could not prune old orphan_sweep_runs rows', err);
  }
}

async function notify(summary: OrphanSweepSummary, ctx: SweepNotifyContext, runId: string | null): Promise<void> {
  const { startedAt, now, log } = ctx;
  const rows = await query<RunRow>(HISTORY_SQL);
  const thisRun: SweepRunRecord = {
    id: runId,
    startedAt,
    outcome: runOutcome(summary),
    reason: summary.reason,
    abortDetail: summary.abortDetail,
    deleted: summary.deleted,
    failed: summary.failed,
    bytesReclaimed: summary.bytesReclaimed,
    deletedSample: summary.deletedSample,
    abortNotifiedAt: null,
    deletionsReportedAt: null,
  };
  // Same two dedup keys as the policy's own filter, applied at the source: a
  // committed INSERT whose response was lost leaves this run in `rows` with an
  // id we never saw, and only `started_at` identifies it.
  const history = rows
    .map(toRecord)
    .filter((run) => (runId === null || run.id !== runId) && run.startedAt !== startedAt);

  const decision = decideSweepNotifications({ thisRun, history, now });
  if (!decision.alert && !decision.digest) return;

  const recipients = await readOpsAlertRecipients(log);
  if (recipients.length === 0) return;

  if (decision.alert) {
    const sent = await sendBestEffort(log, {
      recipient: recipients,
      subject: decision.alert.subject,
      html: decision.alert.html,
      skipLog: '[orphan-sweep] alert email skipped — no recipients',
      failLog: '[orphan-sweep] alert email failed',
    });
    // Stamped only on a real send: stamping an attempt would silence the next
    // seven nights on the strength of an email nobody received. RECOVERED notes
    // stamp too — `decideAlert` measures the gap floor against "the last email
    // of any kind", so a recovered note that did not stamp would let the next
    // night's abort transition straight through the floor.
    //
    // Its own try/catch, like every other step here: unwrapped, a failed UPDATE
    // returned before the digest below and pushed the receipt a night later,
    // eating a day of the restore window on exactly the deadline-forced night
    // that could least afford it.
    if (sent && runId !== null) {
      try {
        await query(STAMP_ABORT_SQL, [runId]);
      } catch (err) {
        log.error(
          '[orphan-sweep] alert email sent but could not stamp abort_notified_at — the next run may repeat it',
          err,
        );
      }
    }
  }

  if (decision.digest) {
    const sent = await sendBestEffort(log, {
      recipient: recipients,
      subject: decision.digest.subject,
      html: decision.digest.html,
      skipLog: '[orphan-sweep] deletion digest skipped — no recipients',
      failLog: '[orphan-sweep] deletion digest failed',
    });
    if (sent && decision.digest.runIds.length > 0) {
      try {
        await query(STAMP_DIGEST_SQL, [decision.digest.runIds]);
      } catch (err) {
        log.error(
          '[orphan-sweep] deletion digest sent but could not stamp deletions_reported_at — the next digest may repeat these runs',
          err,
        );
      }
    }
  }
}
