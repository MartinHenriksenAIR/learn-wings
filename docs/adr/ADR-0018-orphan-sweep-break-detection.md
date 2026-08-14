---
id: "ADR-0018"
title: "Orphan Sweep Break Detection Measures References, Not Orphan Share"
status: accepted
date: 2026-08-14
deciders: ['emkataumre']
tags: ['backend', 'azure-functions', 'blob-storage', 'safety', 'operations']
policy:
  rationales: ['No orphan-sweep safety check may gate on a quantity that only the blocked deletion can reduce', 'Break detection measures unresolved references and matched blobs against a persisted baseline, never the orphan share of the container or of a name prefix', 'A per-run deletion ceiling drains oldest-first and carries the remainder; it never refuses the run', 'A run with no baseline censuses and reports rather than guessing, and says so by email']
approval_date: 2026-08-14
approval_notes: "Introduced by #469 after #451: the shipped share ceilings had aborted every run since the job was armed, 19 consecutive nights, 0 blobs ever reclaimed."

---

## Context

The sweep decides "delete" from absence of evidence, so it needs to know when its reference match is broken. It asked that question as `orphaned / eligible > 0.5`, per container and per name prefix. Both worlds it must separate produce a high reading: a broken match makes live blobs read as unreferenced, and a genuine backlog of replaced avatars and logos is unreferenced. No threshold separates them, so the ceiling refused on a real backlog and — because refusing deletes nothing — met the identical backlog the next night. It wedged from its first armed night (#451) and only ever survived by a `MIN_BUCKET_ORPHANS` floor fitted to the census that had wedged it. The prefix and root-file-class taxonomy underneath it existed to infer which writer produced a blob from its name, a fact the database holds exactly.

## Decision

**No safety check may gate on a quantity that only the blocked action can reduce.** A check that fails this is a fixed point: the refusal preserves its own input.

Break detection therefore measures the reference side, against a census persisted on `orphan_sweep_runs`:

- **Unresolved references** (primary) — references that point at no blob, counted against the *pre-listing* read only so a concurrent upload is not a break. A broken match raises it by the whole affected class; a backlog and a legitimate bulk deletion both leave it untouched. Refuses at 5 or more newly unresolved than the baseline.
- **Matched blobs** (corroborator) — blobs the database does point at. A healthy sweep never deletes one, so it is stable by construction; it catches references lost by accident, which the primary check cannot see. Refuses at a fall of more than half.
- **Registered writers** — a CI guard (`functions/blob-reference-registry.test.ts`) requiring every asset-shaped text column in `01-schema.sql` to be swept or declared not a blob. This is the one break with no runtime signature, so it is caught before it ships rather than after.

The per-run deletion ceiling drains oldest-first and carries the remainder. A run with no baseline is `report-only`: it censuses, records, emails and deletes nothing. A refusal never advances the baseline on its own — otherwise a broken night becomes the next night's normal — so it repeats until a human fixes the match or accepts the census with a single statement, quoted with its run id in the alert email.

The container/prefix/root-class share ceilings, `ORPHAN_SWEEP_MAX_SHARE`, `MIN_BUCKET_ORPHANS` and the bucket taxonomy are removed.

## Consequences

Positive: the sweep can no longer wedge on its own backlog, and every refusal names a cause rather than a suspicious percentage. A refusal that repeats now means a human must act, which is a true statement rather than an artefact. Deletion is bounded per run and reversible for 7 days by blob soft-delete, and the digest reports it — the ceilings were calibrated as though the reverse were true. The removal is a net deletion of code. Negative: the checks depend on `orphan_sweep_runs` being readable and on the census columns existing, so migration 17 must reach prod before the deploy; an unreadable baseline degrades to report-only, which is safe but reclaims nothing that night. The matched-blob check will refuse after a deliberate bulk content removal, which is a real cost paid for catching an accidental one — the operator clears it with the accept statement, scoped to that run.

## Alternatives

1. Raise or re-tune `ORPHAN_SWEEP_MAX_SHARE` — rejected: the metric has no separating power at any threshold, and the abort's own remedy text warned against raising it. 2. Keep the per-prefix ceilings with a larger floor — rejected: the floor moves the wedge threshold rather than removing the fixed point, and any multi-night outage of the sweep re-arms it. 3. An `uploads` ledger written at upload time, making an orphan an exact fact instead of a reconciliation against six scattered columns — deferred, not rejected: it is the stronger design and would make all three checks above unnecessary, but it is a much larger change and this one should not wait for it.
