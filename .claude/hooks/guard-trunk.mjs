#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks `git commit` / `git push` while the
// checkout is on a protected branch — trunk receives changes via PR only.
// Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
import { execFileSync } from "node:child_process";

const PROTECTED = ["feature/lovable-migration", "main"];

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0); // unparseable input — never block on our own failure
}

const command = input?.tool_input?.command ?? "";
if (!/\bgit\b[^\n|;&]*\b(commit|push)\b/.test(command)) process.exit(0);

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
      `Create a work branch first: git switch -c <firstname>/<issue#>-<slug>  (collaboration rules: CLAUDE.md).`
  );
  process.exit(2);
}
process.exit(0);
