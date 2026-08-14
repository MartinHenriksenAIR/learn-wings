import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockQueryOne: vi.fn() }));
vi.mock('../shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: vi.fn(),
  getDb: vi.fn(),
}));

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import {
  decideSweepNotifications,
  formatBytes,
  recordAndNotify,
  runOutcome,
  type SweepRunRecord,
} from './notify';
import type { OrphanSweepSummary } from './index';

const NOW = Date.parse('2026-07-25T03:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const daysAgo = (days: number) => NOW - days * DAY;

let ids = 0;
const run = (overrides: Partial<SweepRunRecord> = {}): SweepRunRecord => ({
  id: `run-${++ids}`,
  startedAt: daysAgo(1),
  outcome: 'completed',
  reason: null,
  abortDetail: null,
  deleted: 0,
  failed: 0,
  bytesReclaimed: 0,
  deletedSample: [],
  abortNotifiedAt: null,
  deletionsReportedAt: null,
  ...overrides,
});

const aborted = (days: number, overrides: Partial<SweepRunRecord> = {}) =>
  run({ startedAt: daysAgo(days), outcome: 'aborted', reason: 'orphan-count-implausible', ...overrides });
const completed = (days: number, overrides: Partial<SweepRunRecord> = {}) =>
  run({ startedAt: daysAgo(days), outcome: 'completed', ...overrides });
const pastDue = (days: number) =>
  run({ startedAt: daysAgo(days), outcome: 'skipped', reason: 'past-due' });
const deletedRun = (days: number, overrides: Partial<SweepRunRecord> = {}) =>
  run({
    startedAt: daysAgo(days),
    outcome: 'completed',
    deleted: 3,
    bytesReclaimed: 3 * 1024 * 1024,
    deletedSample: ['stranded.mp4', 'avatars/old.jpg'],
    ...overrides,
  });

describe('runOutcome', () => {
  it('maps a clean run to completed', () => {
    expect(runOutcome({ aborted: false, reason: null })).toBe('completed');
  });

  it('maps a past-due catch-up to skipped — it is benign and self-healing', () => {
    expect(runOutcome({ aborted: true, reason: 'past-due' })).toBe('skipped');
  });

  it('maps the disabled kill switch to aborted — "switched off and forgotten" IS the wedge', () => {
    expect(runOutcome({ aborted: true, reason: 'disabled' })).toBe('aborted');
  });

  it('maps every other refusal to aborted', () => {
    for (const reason of [
      'storage-not-configured',
      'reference-read-failed',
      'empty-reference-set',
      'listing-failed',
      'orphan-share-implausible',
      'orphan-bucket-share-implausible',
      'orphan-count-implausible',
    ] as const) {
      expect(runOutcome({ aborted: true, reason })).toBe('aborted');
    }
  });
});

describe('decideSweepNotifications — abort alerting', () => {
  it('sends when a healthy sweep starts refusing (the transition into broken)', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [completed(1), completed(2)],
      now: NOW,
    });
    expect(decision.alert?.kind).toBe('abort');
    expect(decision.alert?.subject).toContain('orphan-count-implausible');
    expect(decision.alert?.html).toContain('deleted nothing');
  });

  it('sends on the very first recorded run when that run refuses', () => {
    const decision = decideSweepNotifications({ thisRun: aborted(0), history: [], now: NOW });
    expect(decision.alert?.kind).toBe('abort');
  });

  it('stays silent on night 2 — a nightly email becomes filterable noise', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [aborted(1, { abortNotifiedAt: daysAgo(1) }), completed(2)],
      now: NOW,
    });
    expect(decision.alert).toBeNull();
  });

  it('stays silent on night 3', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [aborted(1), aborted(2, { abortNotifiedAt: daysAgo(2) }), completed(3)],
      now: NOW,
    });
    expect(decision.alert).toBeNull();
  });

  it('re-announces on day 8 of a sustained refusal', () => {
    const history = [completed(8), ...[1, 2, 3, 4, 5, 6].map((d) => aborted(d))];
    history.push(aborted(7, { abortNotifiedAt: daysAgo(7) }));
    const decision = decideSweepNotifications({ thisRun: aborted(0), history, now: NOW });
    expect(decision.alert?.kind).toBe('abort');
    expect(decision.alert?.subject).toContain('night 8');
    expect(decision.alert?.html).toContain('Nothing has been reclaimed since then');
  });

  it('re-announces a sustained refusal that has never actually emailed (a failed send does not silence it)', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [aborted(1), aborted(2), completed(3)],
      now: NOW,
    });
    expect(decision.alert?.kind).toBe('abort');
  });

  it('sends the recovered note on the transition back to healthy', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ startedAt: NOW, outcome: 'completed', deleted: 4, bytesReclaimed: 2048 }),
      history: [aborted(1, { abortNotifiedAt: daysAgo(1) }), aborted(2), completed(3)],
      now: NOW,
    });
    expect(decision.alert?.kind).toBe('recovered');
    expect(decision.alert?.html).toContain('running again');
    expect(decision.alert?.html).toContain('2 night(s)');
  });

  it('sends nothing at all on an uneventful healthy night', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [completed(1), completed(2)],
      now: NOW,
    });
    expect(decision).toEqual({ alert: null, digest: null });
  });

  it('treats the disabled kill switch as abort-class', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ startedAt: NOW, outcome: 'aborted', reason: 'disabled' }),
      history: [completed(1)],
      now: NOW,
    });
    expect(decision.alert?.kind).toBe('abort');
    expect(decision.alert?.subject).toContain('disabled');
  });

  it('puts the whole refusal in the abort email rather than a pointer to it (#451)', () => {
    const detail =
      '3/4 blobs under org-logos/ (75.0%) look unreferenced, above the 50.0% ceiling — even though ' +
      'the container as a whole is only 46.2% unreferenced. Sample: org-logos/0aebb9ce.jpg. ' +
      'WHAT TO DO: do NOT raise the ceiling first.';
    const decision = decideSweepNotifications({
      thisRun: run({
        startedAt: NOW,
        outcome: 'aborted',
        reason: 'orphan-bucket-share-implausible',
        abortDetail: detail,
      }),
      history: [completed(1)],
      now: NOW,
    });

    expect(decision.alert?.kind).toBe('abort');
    expect(decision.alert?.html).toContain('org-logos/');
    expect(decision.alert?.html).toContain('3/4');
    expect(decision.alert?.html).toContain('WHAT TO DO');
    expect(decision.alert?.html).not.toContain('App Insights');
  });

  it('falls back to the App Insights pointer for a run recorded before abort_detail existed', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ startedAt: NOW, outcome: 'aborted', reason: 'listing-failed', abortDetail: null }),
      history: [completed(1)],
      now: NOW,
    });
    expect(decision.alert?.html).toContain('App Insights');
  });

  it('escapes the refusal detail — blob names carry user-supplied filename fragments', () => {
    const decision = decideSweepNotifications({
      thisRun: run({
        startedAt: NOW,
        outcome: 'aborted',
        reason: 'orphan-bucket-share-implausible',
        abortDetail: 'Sample: avatars/<script>alert(1)</script>.jpg',
      }),
      history: [completed(1)],
      now: NOW,
    });
    expect(decision.alert?.html).not.toContain('<script>');
    expect(decision.alert?.html).toContain('&lt;script&gt;');
  });

  it('never emails a past-due catch-up run, whatever preceded it', () => {
    for (const history of [[completed(1)], [aborted(1, { abortNotifiedAt: daysAgo(1) })], []]) {
      const decision = decideSweepNotifications({ thisRun: pastDue(0), history, now: NOW });
      expect(decision.alert).toBeNull();
    }
  });

  it('does NOT let a past-due night in between reset the escalation clock', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [pastDue(1), aborted(2, { abortNotifiedAt: daysAgo(2) }), aborted(3), completed(4)],
      now: NOW,
    });
    expect(decision.alert).toBeNull();
  });

  it('counts the abort streak ACROSS a past-due night rather than restarting at it', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [aborted(1), pastDue(2), aborted(3), aborted(4, { abortNotifiedAt: daysAgo(9) }), completed(5)],
      now: NOW,
    });
    expect(decision.alert?.subject).toContain('night 4');
  });

  it('does not call a past-due night a recovery', () => {
    const decision = decideSweepNotifications({
      thisRun: pastDue(0),
      history: [aborted(1, { abortNotifiedAt: daysAgo(1) })],
      now: NOW,
    });
    expect(decision.alert).toBeNull();
  });

  it('does not claim "the previous run was healthy" when there was no previous run', () => {
    const decision = decideSweepNotifications({ thisRun: aborted(0), history: [], now: NOW });
    expect(decision.alert?.html).not.toContain('previous run was healthy');
    expect(decision.alert?.html).toContain('no earlier run on record');
  });

  it('says the same for a history that is nothing but past-due catch-ups', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [pastDue(1), pastDue(2)],
      now: NOW,
    });
    expect(decision.alert?.html).not.toContain('previous run was healthy');
    expect(decision.alert?.html).toContain('no earlier run on record');
  });

  it('still calls the previous run healthy when there genuinely was one', () => {
    const decision = decideSweepNotifications({ thisRun: aborted(0), history: [completed(1)], now: NOW });
    expect(decision.alert?.html).toContain('previous run was healthy');
  });

  it('sends the recovered note across an intervening past-due night (abort → past-due → healthy)', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ startedAt: NOW, outcome: 'completed', deleted: 1 }),
      history: [pastDue(1), aborted(2, { abortNotifiedAt: daysAgo(2) }), completed(3)],
      now: NOW,
    });
    expect(decision.alert?.kind).toBe('recovered');
  });

  it('surfaces the failed-delete count inside the abort email rather than as its own signal', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ startedAt: NOW, outcome: 'aborted', reason: 'listing-failed', failed: 2 }),
      history: [completed(1)],
      now: NOW,
    });
    expect(decision.alert?.html).toContain('2 delete(s) were REFUSED by Azure');
  });
});


const walkNights = (outcomes: readonly SweepRunRecord['outcome'][]) => {
  const history: SweepRunRecord[] = [];
  const sent: { night: number; kind: string }[] = [];
  outcomes.forEach((outcome, night) => {
    const now = NOW + night * DAY;
    const tonight = run({
      id: `n${night}`,
      startedAt: now,
      outcome,
      reason: outcome === 'aborted' ? 'reference-read-failed' : outcome === 'skipped' ? 'past-due' : null,
    });
    const { alert } = decideSweepNotifications({ thisRun: tonight, history, now });
    if (alert) {
      sent.push({ night, kind: alert.kind });
      tonight.abortNotifiedAt = now;
    }
    history.push(tonight);
  });
  return sent;
};

describe('decideSweepNotifications — a flapping sweep does not email every night', () => {
  it('caps an alternating abort/healthy sequence at one break-and-heal pair per 4 nights', () => {
    const sent = walkNights(Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 'aborted' : 'completed')));

    expect(sent).toEqual([
      { night: 0, kind: 'abort' },
      { night: 1, kind: 'recovered' },
      { night: 4, kind: 'abort' },
      { night: 5, kind: 'recovered' },
      { night: 8, kind: 'abort' },
      { night: 9, kind: 'recovered' },
      { night: 12, kind: 'abort' },
      { night: 13, kind: 'recovered' },
    ]);
  });

  it('never announces a recovery from a refusal nobody was told about', () => {
    const sent = walkNights(['aborted', 'completed', 'aborted', 'completed', 'aborted', 'completed']);
    expect(sent.map((s) => s.night)).not.toContain(3);
  });

  it('still announces a wedge whose opening night was floored, one night later', () => {
    const sent = walkNights(['aborted', 'completed', 'aborted', 'aborted', 'aborted', 'aborted']);
    expect(sent).toEqual([
      { night: 0, kind: 'abort' },
      { night: 1, kind: 'recovered' },
      { night: 3, kind: 'abort' },
    ]);
  });

  it('leaves a plain sustained wedge on its old schedule — the first refused night, then a week later', () => {
    const sent = walkNights(['completed', ...Array.from({ length: 9 }, () => 'aborted' as const)]);
    expect(sent[0]).toEqual({ night: 1, kind: 'abort' });
    expect(sent).toHaveLength(2);
    expect(sent[1].night).toBeGreaterThanOrEqual(8);
  });
});

describe('decideSweepNotifications — deletion digest', () => {
  it('forces a digest at age 4 days even though the weekly cadence is not due', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [deletedRun(4), completed(5, { deletionsReportedAt: daysAgo(5) })],
      now: NOW,
    });
    expect(decision.digest).not.toBeNull();
    expect(decision.digest?.runs).toHaveLength(1);
  });

  it('waits when the only unreported deletion is 1 day old and the cadence is not due', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [deletedRun(1), completed(2, { deletionsReportedAt: daysAgo(2) })],
      now: NOW,
    });
    expect(decision.digest).toBeNull();
  });

  it('fires on cadence when 7 days have passed since the last digest', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ startedAt: NOW, outcome: 'completed', deleted: 1, deletedSample: ['x.mp4'] }),
      history: [completed(7, { deletionsReportedAt: daysAgo(7) })],
      now: NOW,
    });
    expect(decision.digest).not.toBeNull();
  });

  it('sends no digest when nothing was deleted', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [completed(1), completed(9, { deletionsReportedAt: daysAgo(9) })],
      now: NOW,
    });
    expect(decision.digest).toBeNull();
  });

  it('never re-reports a deletion whose receipt already went out', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [
        deletedRun(6, { deletionsReportedAt: daysAgo(5) }),
        deletedRun(4, { id: 'unreported' }),
      ],
      now: NOW,
    });
    expect(decision.digest?.runIds).toEqual(['unreported']);
  });

  it('reports what an earlier night deleted even though THIS run aborted', () => {
    const decision = decideSweepNotifications({
      thisRun: aborted(0),
      history: [deletedRun(4), completed(5, { deletionsReportedAt: daysAgo(5) })],
      now: NOW,
    });
    expect(decision.digest).not.toBeNull();
    expect(decision.alert?.kind).toBe('abort');
  });

  it('reports every deletion while at least 3 days of the soft-delete window remain', () => {
    const deletionAt = daysAgo(4);
    const unreported = deletedRun(4, { id: 'd' });
    const priorDigest = completed(5, { deletionsReportedAt: deletionAt - DAY });
    let firedAt: number | null = null;

    for (let hours = 0; hours <= 4 * 24; hours++) {
      const now = deletionAt + hours * HOUR;
      const decision = decideSweepNotifications({
        thisRun: run({ id: 'tonight', startedAt: now, outcome: 'completed' }),
        history: [unreported, priorDigest],
        now,
      });
      if (!decision.digest) continue;
      firedAt = now;
      for (const reported of decision.digest.runs) {
        expect(reported.restorableUntil - now).toBeGreaterThanOrEqual(3 * DAY);
      }
      break;
    }

    expect(firedAt).not.toBeNull();
    expect((firedAt as number) - deletionAt).toBeLessThanOrEqual(4 * DAY);
  });

  describe('the deadline has a whole night of slack on either side', () => {
    const probe = (ageOfDeletion: number) =>
      decideSweepNotifications({
        thisRun: run({ id: 'tonight', startedAt: NOW, outcome: 'completed' }),
        history: [
          deletedRun(0, { id: 'd', startedAt: NOW - ageOfDeletion }),
          completed(0, { id: 'prior', startedAt: NOW - ageOfDeletion - DAY, deletionsReportedAt: NOW - ageOfDeletion - DAY }),
        ],
        now: NOW,
      });

    it('does not fire a second before the deadline', () => {
      expect(probe(3 * DAY - 1_000).digest).toBeNull();
    });

    it('does not fire the night before the deadline', () => {
      expect(probe(2 * DAY).digest).toBeNull();
    });

    it('fires a second after the deadline, with 4 days of the window still to run', () => {
      const digest = probe(3 * DAY + 1_000).digest;
      expect(digest).not.toBeNull();
      expect((digest?.runs[0].restorableUntil ?? 0) - NOW).toBeGreaterThan(3 * DAY);
    });

    it('still leaves the promised 3 days when a whole night is missed', () => {
      const digest = probe(4 * DAY).digest;
      expect(digest).not.toBeNull();
      expect((digest?.runs[0].restorableUntil ?? 0) - NOW).toBeGreaterThanOrEqual(3 * DAY);
    });
  });

  it('carries per-run counts, bytes, a sample and an explicit restorable-until date', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [
        deletedRun(4, { deleted: 12, bytesReclaimed: 356_515_840, deletedSample: ['clip.mp4', 'documents/old.pdf'] }),
      ],
      now: NOW,
    });
    const html = decision.digest?.html ?? '';
    expect(html).toContain('12 blob(s)');
    expect(html).toContain('340.0 MB');
    expect(html).toContain('clip.mp4');
    expect(html).toContain('documents/old.pdf');
    expect(html).toContain('Restorable until 2026-07-28');
    expect(html).toContain('3 day(s) left');
    expect(html).toContain('and 10 more');
    expect(decision.digest?.runs[0].restorableUntil).toBe(daysAgo(4) + 7 * DAY);
  });

  it('HTML-escapes blob names — they carry user-supplied filename fragments (#195)', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [deletedRun(4, { deletedSample: ['<img src=x onerror="alert(1)">.mp4', 'a&b.mp4'] })],
      now: NOW,
    });
    const html = decision.digest?.html ?? '';
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('a&amp;b.mp4');
    expect(html).not.toContain('onerror="');
  });

  it('orders the digest oldest-first so the deletion closest to expiry leads', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ id: 'tonight', startedAt: NOW, outcome: 'completed', deleted: 1, deletedSample: ['new.mp4'] }),
      history: [deletedRun(2, { id: 'mid' }), deletedRun(5, { id: 'oldest' })],
      now: NOW,
    });
    expect(decision.digest?.runIds).toEqual(['oldest', 'mid', 'tonight']);
  });

  it('reports a run whose record write failed but cannot stamp it', () => {
    const decision = decideSweepNotifications({
      thisRun: run({ id: null, startedAt: NOW, outcome: 'completed', deleted: 2, deletedSample: ['x.mp4'] }),
      history: [deletedRun(5, { id: 'persisted' })],
      now: NOW,
    });
    expect(decision.digest?.runs).toHaveLength(2);
    expect(decision.digest?.runIds).toEqual(['persisted']);
  });

  it('surfaces the failed-delete count inside the digest rather than as its own signal', () => {
    const decision = decideSweepNotifications({
      thisRun: completed(0),
      history: [deletedRun(4, { failed: 3 })],
      now: NOW,
    });
    expect(decision.digest?.html).toContain('3 delete(s) were REFUSED by Azure');
  });

  it('ignores an accidental copy of this run inside the history', () => {
    const tonight = run({ id: 'tonight', startedAt: NOW, outcome: 'completed', deleted: 2, deletedSample: ['x.mp4'] });
    const decision = decideSweepNotifications({
      thisRun: tonight,
      history: [tonight, completed(8, { deletionsReportedAt: daysAgo(8) })],
      now: NOW,
    });
    expect(decision.digest?.runs).toHaveLength(1);
  });
});

describe('formatBytes', () => {
  it('scales to the largest sensible unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(356_515_840)).toBe('340.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('never renders a negative or unusable size', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

const makeLog = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

const summaryOf = (overrides: Partial<OrphanSweepSummary> = {}): OrphanSweepSummary => ({
  aborted: false,
  reason: null,
  abortDetail: null,
  scanned: 40,
  referenced: 30,
  eligible: 40,
  orphaned: 2,
  skippedByGrace: 1,
  skippedUnsafeName: 0,
  skippedByRecheck: 0,
  deleted: 0,
  failed: 0,
  bytesReclaimed: 0,
  deletedSample: [],
  ...overrides,
});

const historyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  started_at: new Date(daysAgo(1)),
  outcome: 'completed',
  reason: null,
  abort_detail: null,
  deleted: 0,
  failed: 0,
  bytes_reclaimed: '0',
  deleted_sample: [],
  abort_notified_at: null,
  deletions_reported_at: null,
  ...overrides,
});

const sqlOf = (call: unknown[]) => String(call[0]);
const callsMatching = (mock: typeof mockQuery, needle: string) =>
  mock.mock.calls.filter((call) => sqlOf(call).includes(needle));

describe('recordAndNotify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO orphan_sweep_runs')) return { id: 'run-new' };
      if (sql.includes('platform_settings')) return { value: { recipients: ['ev@x.dk', 'martin@x.dk'], enabled: true } };
      return null;
    });
    mockQuery.mockResolvedValue([]);
    mockSend.mockResolvedValue({ id: 'e1' });
  });

  it('records the run with the summary, the mapped outcome and the deleted sample', async () => {
    await recordAndNotify(summaryOf({ deleted: 2, failed: 1, bytesReclaimed: 4096, deletedSample: ['a.mp4', 'b.mp4'] }), {
      startedAt: NOW,
      now: NOW,
      log: makeLog(),
    });

    const insert = callsMatching(mockQueryOne, 'INSERT INTO orphan_sweep_runs')[0];
    expect(insert).toBeDefined();
    const params = insert[1] as unknown[];
    expect(params[0]).toEqual(new Date(NOW));
    expect(params[1]).toBe('completed');
    expect(params[10]).toBe(2); // deleted
    expect(params[11]).toBe(1); // failed
    expect(params[12]).toBe(4096); // bytes_reclaimed
    expect(params[13]).toEqual(['a.mp4', 'b.mp4']);
    expect(params[14]).toBeNull(); // abort_detail — a completed run has none
  });

  it('persists the refusal detail so a later night can still quote it (#451)', async () => {
    const detail = '3/4 blobs under org-logos/ (75.0%) look unreferenced. WHAT TO DO: do NOT raise the ceiling first.';
    await recordAndNotify(
      summaryOf({ aborted: true, reason: 'orphan-bucket-share-implausible', abortDetail: detail }),
      { startedAt: NOW, now: NOW, log: makeLog() },
    );

    const params = callsMatching(mockQueryOne, 'INSERT INTO orphan_sweep_runs')[0][1] as unknown[];
    expect(params[1]).toBe('aborted');
    expect(params[14]).toBe(detail);
  });

  it('records a past-due catch-up as skipped and a kill-switched run as aborted', async () => {
    await recordAndNotify(summaryOf({ aborted: true, reason: 'past-due' }), { startedAt: NOW, now: NOW, log: makeLog() });
    expect((callsMatching(mockQueryOne, 'INSERT')[0][1] as unknown[])[1]).toBe('skipped');

    vi.clearAllMocks();
    mockQueryOne.mockResolvedValue({ id: 'run-new' });
    mockQuery.mockResolvedValue([]);
    await recordAndNotify(summaryOf({ aborted: true, reason: 'disabled' }), { startedAt: NOW, now: NOW, log: makeLog() });
    expect((callsMatching(mockQueryOne, 'INSERT')[0][1] as unknown[])[1]).toBe('aborted');
  });

  it('leaves the summary untouched and never throws when the record write fails', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO orphan_sweep_runs')) throw new Error('pool exhausted');
      if (sql.includes('platform_settings')) return { value: { recipients: ['ev@x.dk'], enabled: true } };
      return null;
    });
    const log = makeLog();
    const summary = summaryOf({ deleted: 3, deletedSample: ['a.mp4'] });
    const before = JSON.parse(JSON.stringify(summary));

    await expect(recordAndNotify(summary, { startedAt: NOW, now: NOW, log })).resolves.toBeUndefined();

    expect(summary).toEqual(before);
    expect(log.error).toHaveBeenCalled();
  });

  it('leaves the summary untouched and never throws when Resend fails', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT') ? [historyRow({ outcome: 'completed' })] : [],
    );
    mockSend.mockRejectedValue(new Error('resend down'));
    const log = makeLog();
    const summary = summaryOf({ aborted: true, reason: 'listing-failed' });
    const before = JSON.parse(JSON.stringify(summary));

    await expect(recordAndNotify(summary, { startedAt: NOW, now: NOW, log })).resolves.toBeUndefined();

    expect(summary).toEqual(before);
    expect(log.error).toHaveBeenCalled();
    expect(callsMatching(mockQuery, 'SET abort_notified_at')).toHaveLength(0);
  });

  it('treats a Resend `{ error }` payload as a failed send and stamps nothing', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT') ? [historyRow({ outcome: 'completed' })] : [],
    );
    mockSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'domain not verified' } });
    const log = makeLog();
    const summary = summaryOf({ aborted: true, reason: 'listing-failed' });
    const before = JSON.parse(JSON.stringify(summary));

    await expect(recordAndNotify(summary, { startedAt: NOW, now: NOW, log })).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(before);
    expect(log.error).toHaveBeenCalled();
    expect(callsMatching(mockQuery, 'SET abort_notified_at')).toHaveLength(0);
  });

  it('does not mark deletions reported when the digest send returns a Resend error', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT')
        ? [historyRow({ id: 'old-deletion', started_at: new Date(daysAgo(5)), deleted: 4, bytes_reclaimed: '2048' })]
        : [],
    );
    mockSend.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'too many requests' } });
    const log = makeLog();

    await recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(callsMatching(mockQuery, 'deletions_reported_at = now()')).toHaveLength(0);
    expect(log.error).toHaveBeenCalled();
  });

  it('stamps the recovered note too — the gap floor measures the last email of ANY kind', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT')
        ? [historyRow({ id: 'wedged', started_at: new Date(daysAgo(1)), outcome: 'aborted', reason: 'listing-failed', abort_notified_at: new Date(daysAgo(1)) })]
        : [],
    );

    await recordAndNotify(summaryOf({ deleted: 1, deletedSample: ['x.mp4'] }), {
      startedAt: NOW,
      now: NOW,
      log: makeLog(),
    });

    expect(mockSend.mock.calls[0][0].subject).toContain('recovered');
    expect(callsMatching(mockQuery, 'SET abort_notified_at')).toHaveLength(1);
  });

  it('still ships the digest when the abort stamp fails', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SET abort_notified_at')) throw new Error('deadlock detected');
      if (sql.includes('SELECT')) {
        return [historyRow({ id: 'old-deletion', started_at: new Date(daysAgo(5)), deleted: 4, bytes_reclaimed: '2048' })];
      }
      return [];
    });
    const log = makeLog();

    await expect(
      recordAndNotify(summaryOf({ aborted: true, reason: 'orphan-count-implausible' }), {
        startedAt: NOW,
        now: NOW,
        log,
      }),
    ).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(callsMatching(mockQuery, 'deletions_reported_at = now()')).toHaveLength(1);
    expect(log.error).toHaveBeenCalled();
  });

  it('never throws when the digest stamp fails', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('deletions_reported_at = now()')) throw new Error('deadlock detected');
      if (sql.includes('SELECT')) {
        return [historyRow({ id: 'old-deletion', started_at: new Date(daysAgo(5)), deleted: 4, bytes_reclaimed: '2048' })];
      }
      return [];
    });
    const log = makeLog();

    await expect(recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log })).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });

  it('prints the whole receipt when the record write loses deletions', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO orphan_sweep_runs')) throw new Error('pool exhausted');
      if (sql.includes('platform_settings')) return { value: { recipients: ['ev@x.dk'], enabled: true } };
      return null;
    });
    const log = makeLog();

    await recordAndNotify(summaryOf({ deleted: 3, bytesReclaimed: 4096, deletedSample: ['a.mp4', 'b.mp4'] }), {
      startedAt: NOW,
      now: NOW,
      log,
    });

    const banner = log.error.mock.calls.map((call) => String(call[0])).find((line) => line.includes('NOT RECORDED'));
    expect(banner).toBeDefined();
    expect(banner).toContain('WILL NOT BE DIGESTED');
    expect(banner).toContain('a.mp4');
    expect(banner).toContain('b.mp4');
    expect(banner).toContain('4096');
    expect(banner).toContain('2026-08-01'); // restorable until: NOW + 7 days
  });

  it('does not print the receipt banner when the failed record write lost no deletions', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO orphan_sweep_runs')) throw new Error('pool exhausted');
      return null;
    });
    const log = makeLog();

    await recordAndNotify(summaryOf({ deleted: 0 }), { startedAt: NOW, now: NOW, log });

    expect(log.error.mock.calls.map((call) => String(call[0])).some((line) => line.includes('NOT RECORDED'))).toBe(false);
  });

  it('counts a run whose INSERT committed but whose response was lost only once', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO orphan_sweep_runs')) return null;
      if (sql.includes('platform_settings')) return { value: { recipients: ['ev@x.dk'], enabled: true } };
      return null;
    });
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT')
        ? [
            historyRow({ id: 'lost-response', started_at: new Date(NOW), deleted: 5, bytes_reclaimed: '1024' }),
            historyRow({ id: 'prior', started_at: new Date(daysAgo(8)), deletions_reported_at: new Date(daysAgo(8)) }),
          ]
        : [],
    );

    await recordAndNotify(summaryOf({ deleted: 5, bytesReclaimed: 1024, deletedSample: ['x.mp4'] }), {
      startedAt: NOW,
      now: NOW,
      log: makeLog(),
    });

    const { html } = mockSend.mock.calls[0][0];
    expect(html).toContain('5 blob(s) across 1 run(s)');
    expect(html).not.toContain('10 blob(s)');
  });

  it('never throws when the history read fails', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT')) throw new Error('connection terminated');
      return [];
    });
    const log = makeLog();
    await expect(
      recordAndNotify(summaryOf({ aborted: true, reason: 'listing-failed' }), { startedAt: NOW, now: NOW, log }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });

  it('sends the abort email to every configured recipient and stamps the run', async () => {
    mockQuery.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? [historyRow()] : []));

    await recordAndNotify(summaryOf({ aborted: true, reason: 'orphan-count-implausible' }), {
      startedAt: NOW,
      now: NOW,
      log: makeLog(),
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toEqual(['ev@x.dk', 'martin@x.dk']);
    expect(mockSend.mock.calls[0][0].from).toBe('AI Uddannelse <no-reply@ai-uddannelse.dk>');
    const stamp = callsMatching(mockQuery, 'SET abort_notified_at');
    expect(stamp).toHaveLength(1);
    expect(stamp[0][1]).toEqual(['run-new']);
  });

  it('stamps deletions_reported_at for exactly the runs the digest covered', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT')
        ? [historyRow({ id: 'old-deletion', started_at: new Date(daysAgo(5)), deleted: 4, bytes_reclaimed: '2048' })]
        : [],
    );

    await recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log: makeLog() });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const stamp = callsMatching(mockQuery, 'deletions_reported_at = now()');
    expect(stamp).toHaveLength(1);
    expect(stamp[0][1]).toEqual([['old-deletion']]);
  });

  it('reads bytes_reclaimed back as a number — node-pg hands bigint back as a string', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT')
        ? [historyRow({ id: 'big', started_at: new Date(daysAgo(5)), deleted: 1, bytes_reclaimed: '3221225472' })]
        : [],
    );

    await recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log: makeLog() });

    expect(mockSend.mock.calls[0][0].html).toContain('3.0 GB');
  });

  it('sends nothing — and does not even look up the recipients — on a quiet night', async () => {
    mockQuery.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? [historyRow()] : []));

    await recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log: makeLog() });

    expect(mockSend).not.toHaveBeenCalled();
    expect(callsMatching(mockQueryOne, 'platform_settings')).toHaveLength(0);
  });

  it.each([
    ['the ops_alerts row is missing', null],
    ['alerting is disabled', { value: { recipients: ['ev@x.dk'], enabled: false } }],
    ['the recipient list is empty', { value: { recipients: [], enabled: true } }],
    ['the recipient list is blank strings', { value: { recipients: ['   '], enabled: true } }],
  ])('logs loudly and skips the send when %s', async (_label, settings) => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO orphan_sweep_runs')) return { id: 'run-new' };
      if (sql.includes('platform_settings')) return settings;
      return null;
    });
    mockQuery.mockImplementation(async (sql: string) => (sql.includes('SELECT') ? [historyRow()] : []));
    const log = makeLog();

    await recordAndNotify(summaryOf({ aborted: true, reason: 'listing-failed' }), {
      startedAt: NOW,
      now: NOW,
      log,
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('NOT SENDING an alert'));
  });

  it('ships the receipt for an earlier deletion even on a night that refused to sweep', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT')
        ? [
            historyRow({ id: 'deletion', started_at: new Date(daysAgo(5)), deleted: 6, bytes_reclaimed: '1024' }),
            historyRow({ id: 'yesterday', started_at: new Date(daysAgo(1)) }),
          ]
        : [],
    );

    await recordAndNotify(summaryOf({ aborted: true, reason: 'orphan-count-implausible' }), {
      startedAt: NOW,
      now: NOW,
      log: makeLog(),
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    const subjects = mockSend.mock.calls.map((call) => call[0].subject);
    expect(subjects.some((s: string) => s.includes('refused to sweep'))).toBe(true);
    expect(subjects.some((s: string) => s.includes('deleted'))).toBe(true);
  });

  it('prunes run records older than 180 days in the same run', async () => {
    await recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log: makeLog() });
    const prune = callsMatching(mockQuery, 'DELETE FROM orphan_sweep_runs');
    expect(prune).toHaveLength(1);
    expect(sqlOf(prune[0])).toContain("180 days");
  });

  it('logs but survives a failed prune', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM orphan_sweep_runs')) throw new Error('deadlock');
      return [];
    });
    const log = makeLog();
    await expect(recordAndNotify(summaryOf(), { startedAt: NOW, now: NOW, log })).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
