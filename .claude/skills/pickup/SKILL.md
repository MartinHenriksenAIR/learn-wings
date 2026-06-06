---
name: pickup
description: Use at session start when beginning work on learn-wings — reads the ledger, checks claims for file-scope overlap, claims an issue, creates the work branch and draft PR.
---

# Pickup — start-of-session claiming

1. **Read state:** `migration/STATUS.html` (checkpoint, quirks), then:
   - `gh issue list --state open` — the backlog
   - `gh pr list --state open` — draft PRs = active claims (branch names show who/what)
2. **Choose an issue** that is unassigned AND has no associated branch/draft PR. Honor `Depends on:` references and the `blocked` label — AND a filled "Blocked by" field in the issue body (form-created issues may lack labels; the body is authoritative).
3. **Overlap check (MANDATORY):** compare the issue's "Files touched" against every open draft PR's issue — then grade the overlap by KIND:
   - **Disjoint files** → claim freely.
   - **Hub-file appends** — `functions/index.ts` barrel imports, route registration (`src/App.tsx`), i18n key additions (en+da), additive exports, `package.json` dependency ADDITIONS — do NOT block a claim. Both sides append; expect at worst a trivial rebase conflict resolved by keeping both (same philosophy as WORKLOG.md). EXCEPTION within this category: never hand-merge `package-lock.json` — resolve `package.json`, then regenerate the lockfile (`npm install`).
   - **Same logic** — both tasks would edit the same function/component/endpoint behavior, or change a shared contract's semantics (`functions/shared/*` signatures, `src/lib/api-client.ts` behavior, DB schema, `AGENTS.md`/`CLAUDE.md`/`.claude/*`) → do NOT parallelize. Serialize behind the other claim, or land the contract change first as its own small PR.
   - Litmus test: "would the two diffs touch the same LINES for different reasons?" → serialize. "Same file, different regions, both additive?" → go.
4. **Claim:** (`<trunk>` = the `trunk` value in `.claude/collab.json` — the single source of truth for branch topology; read it, don't assume)
   - `gh issue edit <n> --add-assignee @me`
   - `git fetch origin && git switch -c <firstname>/<n>-<slug> origin/<trunk>`
   - Commit something minimal if needed, then open the claim PR immediately:
     `gh pr create --draft --base <trunk> --title "<type>: <slug> (#<n>)" --body "Claims #<n>. Files: <scope from issue>."`
5. **Stale claims:** an assigned issue with no branch push for 7 days is fair game after a ping to the other developer.
6. **Multiple claims per person are fine** — one branch + draft PR each, worked in separate git worktrees (`git worktree add ../lw-issue-<n> <branch>` or `claude --worktree`; each needs its own `npm install` + `.env` copy). The overlap check applies between YOUR OWN claims too. Practical ceiling: 2–3 active claims per person — review bandwidth is the bottleneck.
7. For slice work, now invoke the `slice-workflow` skill.
