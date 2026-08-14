import { query, queryOne } from '../shared/db';
import { escapeHtml, sendBestEffort } from '../shared/resend';
import type { OrphanSweepSummary, SweepLogger } from './index';


export type SweepRunOutcome = 'completed' | 'aborted' | 'skipped';

const DAY_MS = 86_400_000;

const SOFT_DELETE_WINDOW_MS = 7 * DAY_MS;

const ABORT_REANNOUNCE_MS = 7 * DAY_MS;

const ALERT_MIN_GAP_MS = 1.5 * DAY_MS;

const DELETION_REPORT_DEADLINE_MS = 3 * DAY_MS;

const DIGEST_CADENCE_MS = 7 * DAY_MS;

const RETENTION_DAYS = 180;

const HISTORY_WINDOW_DAYS = 30;

const DIGEST_SAMPLE_SIZE = 20;

export interface SweepRunRecord {
  id: string | null;
  startedAt: number;
  outcome: SweepRunOutcome;
  reason: string | null;
  abortDetail: string | null;
  deleted: number;
  failed: number;
  bytesReclaimed: number;
  deletedSample: string[];
  abortNotifiedAt: number | null;
  deletionsReportedAt: number | null;
}

export interface SweepNotifyInput {
  thisRun: SweepRunRecord;
  history: readonly SweepRunRecord[];
  now: number;
}

export interface DigestRun {
  id: string | null;
  startedAt: number;
  deleted: number;
  failed: number;
  bytesReclaimed: number;
  deletedSample: string[];
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
  runs: DigestRun[];
  runIds: string[];
}

export interface SweepNotifyDecision {
  alert: SweepAlertEmail | null;
  digest: SweepDigestEmail | null;
}

export function runOutcome(summary: Pick<OrphanSweepSummary, 'aborted' | 'reason'>): SweepRunOutcome {
  if (!summary.aborted) return 'completed';
  return summary.reason === 'past-due' ? 'skipped' : 'aborted';
}

const latest = (values: readonly (number | null)[]): number | null =>
  values.reduce<number | null>((best, value) => (value !== null && (best === null || value > best) ? value : best), null);

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
  previous: SweepRunRecord | null,
  nights: number,
  since: number,
): SweepAlertEmail {
  const reason = escapeHtml(run.reason ?? 'unknown');
  const streak =
    nights > 1
      ? `<p>This is night <strong>${nights}</strong> of a run of refusals that began <strong>${utcStamp(since)}</strong>. Nothing has been reclaimed since then, and nothing will be until this is cleared.</p>`
      : previous === null
        ? '<p>There is no earlier run on record, so there is nothing to compare this against — either the sweep has never completed a run, or its records have aged out.</p>'
        : '<p>The previous run was healthy, so this is the first refused night.</p>';
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

export function decideSweepNotifications({ thisRun, history, now }: SweepNotifyInput): SweepNotifyDecision {
  const ordered = [...history]
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
  const previous = ordered.find((run) => run.outcome !== 'skipped') ?? null;
  const streak = abortStreak(ordered);
  const lastEmail = latest(ordered.map((run) => run.abortNotifiedAt));
  const tooSoon = lastEmail !== null && now - lastEmail < ALERT_MIN_GAP_MS;

  if (thisRun.outcome === 'aborted') {
    const isTransition = previous === null || previous.outcome === 'completed';
    const overdue = lastEmail === null || now - lastEmail >= ABORT_REANNOUNCE_MS;
    const unannounced = !streak.announced;
    if (!isTransition && !overdue && !unannounced) return null;
    if (tooSoon) return null;
    return renderAbortEmail(thisRun, previous, streak.nights + 1, streak.since ?? thisRun.startedAt);
  }

  if (thisRun.outcome === 'completed' && previous?.outcome === 'aborted') {
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
  const unreported = [
    ...(thisRun.deleted > 0 ? [thisRun] : []),
    ...ordered.filter((run) => run.deleted > 0 && run.deletionsReportedAt === null),
  ].sort((a, b) => a.startedAt - b.startedAt);
  if (unreported.length === 0) return null;

  const lastDigest = latest(ordered.map((run) => run.deletionsReportedAt));
  const deadlineForced = now - unreported[0].startedAt >= DELETION_REPORT_DEADLINE_MS;
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
  startedAt: number;
  now: number;
  log: SweepLogger;
}

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
