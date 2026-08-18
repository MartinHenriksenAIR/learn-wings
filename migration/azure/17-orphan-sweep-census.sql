-- 17-orphan-sweep-census.sql
-- #469 orphan-sweep break detection: the census columns the new checks compare
-- against, plus the 'report-only' outcome. Idempotent; safe to re-run.
-- MUST run on prod BEFORE the #469 deploy: functions/orphan-sweep/notify.ts
-- INSERTs these columns on EVERY run, and the sweep reads them back as its
-- baseline. Missing columns mean every run fails to record, and a run with no
-- recorded baseline deliberately deletes nothing.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
BEGIN;

-- The share ceilings this replaces asked "does too much of the container look
-- unreferenced?". That question cannot be answered usefully, because a broken
-- reference match and a genuine backlog of replaced uploads produce the same
-- reading -- so no threshold separates them, and the one that shipped wedged the
-- sweep for 19 consecutive nights (#451).
--
-- These three columns carry the quantities that DO separate them. All are
-- nullable on purpose: NULL means "this run never got as far as a census", which
-- is what every row written before this migration is, and it is distinguishable
-- from a censused zero. The sweep treats "no baseline" as a cold start and runs
-- report-only rather than guessing.

-- Blobs in the container that the reference set DOES point at. A healthy sweep
-- never deletes a matched blob, so this is stable across runs by construction;
-- a reference set that vanished by accident (bad migration, botched restore)
-- collapses it. This is the corroborating check.
ALTER TABLE public.orphan_sweep_runs
  ADD COLUMN IF NOT EXISTS matched integer;

-- References that resolve to no blob at all -- the primary check, and the
-- inverse direction to the one the sweep used to measure. It is the direct form
-- of the invariant "a reference that exists must point at a blob that exists":
-- a broken match (path-format drift, wrong container, wrong storage account)
-- raises it by the whole affected class, while a backlog of replaced uploads and
-- a legitimate bulk content deletion both leave it untouched.
--
-- Counted against the PRE-LISTING reference read only. A reference written after
-- the listing legitimately has no blob in that listing, and counting the union
-- would read every concurrent upload as a break.
ALTER TABLE public.orphan_sweep_runs
  ADD COLUMN IF NOT EXISTS unmatched_references integer;

-- Deletions this run was entitled to make but deferred to keep inside the
-- per-run ceiling. The ceiling used to abort the whole run, which deleted
-- nothing and left the same backlog to trip it identically the next night; it
-- now drains oldest-first and carries the remainder. Non-null because it is an
-- outcome of the run, not a baseline the next run reads.
ALTER TABLE public.orphan_sweep_runs
  ADD COLUMN IF NOT EXISTS deferred integer NOT NULL DEFAULT 0;

-- The operator's lever for "this drop is real, carry on".
--
-- A refusal must never advance the baseline by itself: if it did, a broken night
-- would become the next night's normal and the sweep would delete everything on
-- night two. So a refused run is not a baseline -- which means the refusal
-- repeats until someone acts. That is a legitimate blocking condition rather
-- than the deadlock this issue removes, because the action needed is available
-- to a human and is not the deletion being blocked: either fix the match, or
-- accept the new numbers with
--
--   UPDATE public.orphan_sweep_runs SET baseline_accepted = true WHERE id = '<run id>';
--
-- The alert email carries that statement with the id filled in. It is scoped to
-- one run and leaves no global setting switched off afterwards, which the
-- ceiling's own remedy ("raise ORPHAN_SWEEP_MAX_SHARE for a single run and put
-- it back") did not.
ALTER TABLE public.orphan_sweep_runs
  ADD COLUMN IF NOT EXISTS baseline_accepted boolean NOT NULL DEFAULT false;

-- 'report-only' is the cold-start outcome: a run that censused the container,
-- recorded the numbers and deliberately deleted nothing because it had no
-- baseline to compare against. It is not a refusal -- nothing is wrong -- but it
-- is a night on which nothing was reclaimed, and the whole point of #451 is that
-- such a night must never be silent.
ALTER TABLE public.orphan_sweep_runs
  DROP CONSTRAINT IF EXISTS orphan_sweep_runs_outcome_check;
ALTER TABLE public.orphan_sweep_runs
  ADD CONSTRAINT orphan_sweep_runs_outcome_check
  CHECK (outcome IN ('completed', 'aborted', 'skipped', 'report-only'));

COMMIT;
