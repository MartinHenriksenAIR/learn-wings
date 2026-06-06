#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks history-writing git commands while the
// checkout is on a protected branch, and pushes that explicitly target one.
// Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
//
// Protected branches are read from .claude/collab.json ("protectedBranches") —
// the single source of truth for branch topology. Cutover day edits that file
// only (see issue #33).
//
// BEST-EFFORT fast feedback only — the actual guarantee is the server-side
// "trunk-pr-only" / "main" rulesets (require PR, block force push). Known,
// accepted gaps: detached HEAD reports "HEAD" (allowed); `git -C <elsewhere>`
// is checked against the session cwd, not the -C target; exotic refspec forms
// may slip through; an unreadable collab.json stands the hook down. All of
// these land on the server-side wall.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let PROTECTED;
try {
  const cfg = JSON.parse(
    readFileSync(new URL("../collab.json", import.meta.url), "utf8")
  );
  PROTECTED = cfg.protectedBranches;
  if (!Array.isArray(PROTECTED) || PROTECTED.length === 0) throw new Error("invalid");
} catch {
  process.exit(0); // config unreadable — stand down; the server ruleset is the guarantee
}
// History-writing subcommands. `pull` is deliberately allowed — the handoff
// flow updates the trunk with `git pull` after a PR merge.
const BLOCKED_SUBCOMMANDS = new Set([
  "commit",
  "push",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "am",
]);

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0); // unparseable input — never block on our own failure
}

const command = input?.tool_input?.command ?? "";

// The verb must be git's SUBCOMMAND — not a substring anywhere in the line.
// (`git stash push`, `git log --grep=push`, `git config commit.template` are
// all legitimate.) Split compound commands, find `git`, skip its global
// flags, read the next token.
function gitSubcommand(segment) {
  const tokens = segment.trim().split(/\s+/);
  const at = tokens.indexOf("git");
  if (at === -1) return null;
  for (let i = at + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-C" || t === "-c") {
      i++; // flag consumes the next token as its value
      continue;
    }
    if (t.startsWith("-")) continue; // --no-pager, --git-dir=…, etc.
    return t;
  }
  return null;
}

// A push that names a protected branch (refspec or bare) is blocked regardless
// of the current branch — `git push origin <trunk>` and
// `git push origin HEAD:<trunk>` are direct-to-trunk attempts from anywhere.
function pushTargetsProtected(segment) {
  return segment
    .trim()
    .split(/\s+/)
    .some((t) => {
      const ref = (t.includes(":") ? t.split(":").pop() : t).replace(/^refs\/heads\//, "");
      return PROTECTED.includes(ref);
    });
}

let hit = false;
for (const segment of command.split(/[|;&\n]+/)) {
  const sub = gitSubcommand(segment);
  if (sub === null || !BLOCKED_SUBCOMMANDS.has(sub)) continue;
  if (sub === "push" && pushTargetsProtected(segment)) {
    console.error(
      `BLOCKED by .claude/hooks/guard-trunk.mjs: that push explicitly targets a protected branch — ` +
        `protected branches receive changes via pull request only (collaboration rules: AGENTS.md).`
    );
    process.exit(2);
  }
  hit = true;
}
if (!hit) process.exit(0);

let branch = "";
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: input.cwd || process.cwd(),
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  process.exit(0); // not a git dir / git unavailable — don't block
}

if (PROTECTED.includes(branch)) {
  console.error(
    `BLOCKED by .claude/hooks/guard-trunk.mjs: '${branch}' receives changes via pull request only. ` +
      `Create a work branch first: git switch -c <firstname>/<issue#>-<slug>  (collaboration rules: AGENTS.md).`
  );
  process.exit(2);
}
process.exit(0);
