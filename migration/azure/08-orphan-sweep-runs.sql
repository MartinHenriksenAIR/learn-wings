-- 08-orphan-sweep-runs.sql
-- #286 orphan-sweep alerting: the run-record table the notification policy reads,
-- plus the ops_alerts recipients row. Idempotent; safe to re-run.
-- MUST run on prod BEFORE the #286 deploy: functions/orphan-sweep writes a row on
-- EVERY nightly run and reads this table to decide what to email, so the objects
-- must exist the moment the new function code goes live. (A missing table only
-- costs the alerting — the write and the send are both best-effort — but then the
-- sweep is unalerted, which is the exact hole #286 exists to close.)
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
BEGIN;

-- One row per nightly run. The sweep is otherwise stateless, so this table IS the
-- memory that makes cross-run statements ("third night in a row", "recovered")
-- expressible at all.
--
-- `outcome` is the summary's abort flag mapped once, here, so the policy never
-- special-cases past-due in three places:
--   aborted: false        -> 'completed'
--   reason: 'past-due'    -> 'skipped'   (a benign, self-healing catch-up run)
--   any other abort       -> 'aborted'   (including the 'disabled' kill switch)
--
-- The two *_notified_at columns ARE the notification state — "time since the last
-- alert email" is max(abort_notified_at) (stamped for the recovered note too, so
-- the rate limit in notify.ts can measure the inbox rather than one email kind),
-- and the digest's working set is `deleted > 0 AND deletions_reported_at IS NULL`.
-- There is no separate store.
CREATE TABLE IF NOT EXISTS public.orphan_sweep_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            timestamptz NOT NULL,
  finished_at           timestamptz NOT NULL DEFAULT now(),
  outcome               text NOT NULL CHECK (outcome IN ('completed', 'aborted', 'skipped')),
  reason                text,
  scanned               integer NOT NULL DEFAULT 0,
  referenced            integer NOT NULL DEFAULT 0,
  eligible              integer NOT NULL DEFAULT 0,
  orphaned              integer NOT NULL DEFAULT 0,
  skipped_by_grace      integer NOT NULL DEFAULT 0,
  skipped_unsafe_name   integer NOT NULL DEFAULT 0,
  skipped_by_recheck    integer NOT NULL DEFAULT 0,
  deleted               integer NOT NULL DEFAULT 0,
  failed                integer NOT NULL DEFAULT 0,
  bytes_reclaimed       bigint NOT NULL DEFAULT 0,
  deleted_sample        text[] NOT NULL DEFAULT '{}',
  abort_notified_at     timestamptz,
  deletions_reported_at timestamptz
);

CREATE INDEX IF NOT EXISTS orphan_sweep_runs_started_at_idx
  ON public.orphan_sweep_runs (started_at DESC);

-- Storage-ops alert recipients. Deliberately NOT seat_pricing.notification_email:
-- storage ops and commercial seat requests are unrelated concerns that will want
-- to diverge. No Platform Settings UI field in this phase — edit via SQL.
INSERT INTO public.platform_settings (key, value)
VALUES ('ops_alerts', '{"recipients": ["ev@ai-raadgivning.dk", "MartinH@ai-raadgivning.dk"], "enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
