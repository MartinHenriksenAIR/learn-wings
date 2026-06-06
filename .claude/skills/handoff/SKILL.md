---
name: handoff
description: Use at session end on learn-wings — pushes state, updates the issue and draft PR so the other developer (and any future session) can pick up cleanly; runs the merge/deploy ritual when work is done.
---

# Handoff — end-of-session

**Every session end (work continues later):**
1. Commit (work branches commit freely) and `git push -u origin HEAD`.
2. Comment on the draft PR: done / in-progress / next steps / any gotchas discovered.
3. Update the issue if scope changed (especially "Files touched" — the other developer's overlap check depends on it).

**When the work is complete (merge ritual):**
1. Verify locally: `cd functions && npm test` (if functions changed), `npm run build`, `npm test`, `npx tsc --noEmit -p tsconfig.app.json`.
2. Append the dated entry to `migration/WORKLOG.md` (append-only; keep both entries on conflict) and update `migration/STATUS.html`'s checkpoint section. Commit.
3. Mark the PR ready: `gh pr ready`. Run `/code-review` on it.
4. Review gate: cross-review by the other developer when available; when solo, self-merge is allowed AFTER the `/code-review` pass is clean.
5. Merge, then `git switch <trunk> && git pull` (`<trunk>` = the `trunk` value in `.claude/collab.json`), delete the branch.
6. **Deploy (only if functions changed, only from fresh trunk):** see the deploy section of `slice-workflow`. Announce on the merged PR: `deploying trunk @<short-sha>` … then `deployed, smoke ok`.
7. Close the issue: `gh issue close <n> --comment "merged in #<pr>"`.
