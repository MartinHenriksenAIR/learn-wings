#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks history-writing git commands while the
// checkout is on a protected branch — trunk receives changes via PR only.
// Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
import { execFileSync } from "node:child_process";

const PROTECTED = ["feature/lovable-migration", "main"];
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

const hit = command
  .split(/[|;&\n]+/)
  .map(gitSubcommand)
  .some((sub) => sub !== null && BLOCKED_SUBCOMMANDS.has(sub));
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
