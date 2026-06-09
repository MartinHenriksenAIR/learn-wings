---
name: orient
description: Use anytime (and at session start via pickup) to get a current, plain-English picture of learn-wings — what the project is, where it stands, what each open issue/PR means and whether it matters, who's working on what, what just merged. Regenerates a single local HTML digest from the durable core + live GitHub/git state.
---

# Orient — the comprehension digest

Produces ONE human-readable HTML digest by merging the **durable core** (`docs/orientation/CONTEXT.md` — curated) with **live state** (issues / PRs / branches / recent merges, pulled fresh). This is the effortless, pull-based way for a human to stay oriented; it replaces triangulating `migration/STATUS.html` + `WORKLOG.md` + the issue board.

Output: **`docs/orientation/digest.html`** — a SINGLE file, gitignored, **overwritten in place** each run. Never produce timestamped copies.

## Procedure

1. **Freshness check (skip needless work).** Compute the current *state signature*:
   - `git rev-parse HEAD`
   - a hash of `docs/orientation/CONTEXT.md`
   - the max `updatedAt` across open issues + PRs (`gh issue list --state open --json updatedAt` + `gh pr list --state open --json updatedAt`)

   If `docs/orientation/digest.html` exists and its embedded first-line `<!-- sig: ... -->` matches the current signature → it is current. **Just open it and STOP.** Otherwise regenerate (steps 2–7). This makes pickup cheap when nothing moved and catches remote changes (e.g. the other dev edited an issue) even with no local git change.
2. **Read the durable core** — `docs/orientation/CONTEXT.md`: `current_focus`, the `components` table, the `decisions` log.
3. **Pull live state** — open issues *with bodies* (`gh issue list --state open --json number,title,labels,body`), open PRs (= active claims; branch names show who/what), recent merges (`git log --first-parent -20 --oneline`), branches, and the `migration/STATUS.html` checkpoint line.
4. **Decode every open issue into plain English** — one line of *what it actually means* + *does it matter* (real-user bug / launch-blocker / cleanup / nicety) + a cluster + a rough priority. LIFT the issue's human-summary header when present (the source-side convention); generate it when absent.
5. **Cross-reference** issues → components via the core's `known_issues` column; compute light views (e.g. "fragile components with an open PR touching them"). The **live issue list is the source of truth** for what's open — the core's `known_issues` is only a grouping hint, so a stale core never yields a *wrong* digest.
6. **core-sync — READ-ONLY here.** If you notice core drift (a closed issue still listed, `current_focus` naming a merged PR), surface it as a ⚠ note IN the digest. Do **not** edit `CONTEXT.md` from this skill — writing the core happens at handoff and mid-work (see `core-sync.md` in this folder).
7. **Render** `docs/orientation/digest.html` in the house style (below), with the state signature as the literal first line `<!-- sig: <hash> -->`, overwrite the file, and open it.

## House style for the digest
Self-contained single HTML file, inline `<style>`, no CDNs, opens from disk. Palette: ivory `#FAF9F5` bg, slate `#141413` text, clay `#D97757` accent; serif headings, system-sans body, mono labels. Two parts: **(a) Orientation** — what the project is / where it stands / the road to the next milestone, from the core + checkpoint; **(b) the decoded issue board** — every open issue in plain English, clustered by priority, each linking to GitHub. Skimmable and clickable. (This is the productized form of the 2026-06-09 orientation + triage artifacts.)

## Notes
- Costs tokens per regeneration (it's an agent task) but far cheaper than a Playwright run — and it skips regeneration entirely when state is unchanged (step 1).
- **Comprehension only.** This is NOT the verification system (a separate, later initiative). Do not bolt verification onto it.
