---
name: pickup
description: Use at session start when beginning work on learn-wings — reads the ledger, checks claims for file-scope overlap, claims an issue, creates the work branch and draft PR.
---

# Pickup — start-of-session claiming

1. **Read state:** `migration/STATUS.html` (checkpoint, quirks), then:
   - `gh issue list --state open` — the backlog
   - `gh pr list --state open` — draft PRs = active claims (branch names show who/what)
2. **Choose an issue** that is unassigned AND has no associated branch/draft PR. Honor `Depends on:` references and the `blocked` label.
3. **Overlap check (MANDATORY):** compare the issue's "Files touched" against every open draft PR's issue. Overlapping file scope → do NOT claim; pick something else or coordinate with the other developer first. Shared contracts (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `CLAUDE.md`, `.claude/*`) change in small dedicated PRs that merge before dependent work.
4. **Claim:**
   - `gh issue edit <n> --add-assignee <your-github-username>`
   - `git fetch origin && git switch -c <firstname>/<n>-<slug> origin/feature/lovable-migration`
   - Commit something minimal if needed, then open the claim PR immediately:
     `gh pr create --draft --base feature/lovable-migration --title "<type>: <slug> (#<n>)" --body "Claims #<n>. Files: <scope from issue>."`
5. **Stale claims:** an assigned issue with no branch push for 7 days is fair game after a ping to the other developer.
6. **Multiple claims per person are fine** — one branch + draft PR each, worked in separate git worktrees (`git worktree add ..\lw-issue-<n> <branch>` or `claude --worktree`; each needs its own `npm install` + `.env` copy). The overlap check applies between YOUR OWN claims too. Practical ceiling: 2–3 active claims per person — review bandwidth is the bottleneck.
7. For slice work, now invoke the `slice-workflow` skill.
