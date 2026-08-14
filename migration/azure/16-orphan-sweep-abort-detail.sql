-- 16-orphan-sweep-abort-detail.sql
-- #451 orphan-sweep self-reporting refusals: the full refusal text on the run
-- record, so an abort is actionable from the alert email alone. Idempotent; safe
-- to re-run.
-- MUST run on prod BEFORE the #451 deploy: functions/orphan-sweep/notify.ts
-- INSERTs this column on EVERY nightly run. The write is best-effort and a
-- failure never stops the sweep, but a missing column means every run is
-- unrecorded — and an unrecorded run is invisible to the alerting policy, which
-- is the exact hole #286 closed.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
BEGIN;

-- The refusal in prose: what it refused, the numbers behind it, the sample paths
-- and the remedy. `reason` is the machine code ('orphan-bucket-share-implausible')
-- and stays as it is; on its own it does not say WHICH bucket tripped, and that
-- one fact is the whole difference between a two-minute check and re-deriving the
-- census by hand.
--
-- It previously existed only inside a log.error call, which made acting on any
-- refusal depend on log ingestion working. It silently was not: the App Insights
-- component was workspace-based against a Log Analytics workspace whose resource
-- group no longer exists, so the sweep wedged for 19 consecutive nights while
-- every alert email pointed its reader at a query returning nothing.
--
-- NULL on completed runs, and on every abort recorded before this column existed.
ALTER TABLE public.orphan_sweep_runs
  ADD COLUMN IF NOT EXISTS abort_detail text;

COMMIT;
