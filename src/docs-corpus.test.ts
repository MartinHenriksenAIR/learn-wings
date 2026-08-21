import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..');

// Every prose document this repo is allowed to carry, with the line count it is
// allowed to reach. Budgets sit at the document's current size with no headroom,
// so growing one is a deliberate edit a reviewer sees rather than a side effect
// of a session. Adding a row is how you add a document.
//
// This exists because the repo twice grew a documentation corpus that outran
// anyone's ability to keep it true — a 476KB worklog of 157 entries, and a
// status ledger that reached ~15,800 words while calling itself bounded. Both
// were deleted (#461, #463, #466). Nothing structural had stopped either.
const ALLOWED: ReadonlyArray<readonly [path: string, maxLines: number]> = [
  ['README.md', 115],
  ['AGENTS.md', 57],
  ['CLAUDE.md', 3],
  ['docs/glossary.md', 58],
  ['e2e/README.md', 115],
  ['migration/azure/README.md', 66],
  ['.claude/rules/frontend.md', 15],
  ['.claude/rules/functions.md', 15],
  ['.claude/skills/pickup/SKILL.md', 15],
  ['.claude/skills/handoff/SKILL.md', 19],
  ['.helm/context.md', 16],
];

// `docs/adr/` is exempt from the allowlist: ADRs are append-only by policy
// (AGENTS.md), so the corpus is expected to grow one file per decision. Each ADR
// still carries a size cap, since an ADR is a decision and its rationale, not a
// design document.
// One shared cap rather than a per-file budget, since the set is expected to
// grow: it is a ceiling that catches a design document filed as an ADR, not a
// no-headroom budget like the rows above.
const ADR_DIR = 'docs/adr/';
const ADR_MAX_LINES = 55;

// The Vite entry point, not prose.
const NOT_PROSE = new Set(['index.html']);

function trackedDocs(): string[] {
  return execFileSync('git', ['ls-files', '*.md', '*.html'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => !NOT_PROSE.has(p));
}

function lineCount(path: string): number {
  const text = readFileSync(resolve(REPO_ROOT, path), 'utf8');
  const lines = text.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

describe('documentation corpus', () => {
  const tracked = trackedDocs();
  const allowedPaths = new Set(ALLOWED.map(([p]) => p));

  it('finds tracked documents to check', () => {
    expect(tracked.length).toBeGreaterThan(0);
  });

  it('has no document outside the allowlist', () => {
    const unlisted = tracked.filter((p) => !allowedPaths.has(p) && !p.startsWith(ADR_DIR));

    expect(
      unlisted,
      unlisted.length
        ? `Untracked-by-policy documents: ${unlisted.join(', ')}. A new document is a ` +
            'deliberate act — if it earns its place, add it to ALLOWED in this file in the ' +
            'same PR. Read the documentation policy in AGENTS.md first: most things that ' +
            'feel like a doc are already in git log, gh issue list, or the code.'
        : '',
    ).toEqual([]);
  });

  it('has no missing document', () => {
    const missing = ALLOWED.map(([p]) => p).filter((p) => !tracked.includes(p));

    expect(
      missing,
      missing.length
        ? `Allowlisted but absent: ${missing.join(', ')}. If the document was deleted ` +
            'on purpose, drop its row from ALLOWED in the same PR.'
        : '',
    ).toEqual([]);
  });

  it.each(ALLOWED)('%s stays within %i lines', (path, maxLines) => {
    if (!tracked.includes(path)) return; // reported by the missing-document test
    const actual = lineCount(path);

    expect(
      actual,
      `${path} is ${actual} lines, over its ${maxLines}-line budget. Cut it back, or ` +
        'raise the budget in this file in the same PR if the growth genuinely earns ' +
        'its place. The budget exists so that choice is visible in review.',
    ).toBeLessThanOrEqual(maxLines);
  });

  it('keeps each ADR within its cap', () => {
    const oversized = tracked
      .filter((p) => p.startsWith(ADR_DIR))
      .map((p) => [p, lineCount(p)] as const)
      .filter(([, n]) => n > ADR_MAX_LINES)
      .map(([p, n]) => `${p} (${n})`);

    expect(
      oversized,
      oversized.length
        ? `Over ${ADR_MAX_LINES} lines: ${oversized.join(', ')}. An ADR records a decision ` +
            'and why it was taken — not a design document.'
        : '',
    ).toEqual([]);
  });
});
