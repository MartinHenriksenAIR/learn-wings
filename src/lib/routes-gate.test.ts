/**
 * Permanent drift gate for #178.
 *
 * `src/lib/routes.ts` is the single owner of every app route path. This test
 * scans the whole `src/` tree and FAILS if any app route path literal
 * (`/app/...`, `/login`, `/signup`, `/forgot-password`, `/reset-password`)
 * appears as a string literal anywhere else. Adopt a `routes.*` constant instead
 * of re-inlining a path — that is the whole point of the constants, and this gate
 * is what keeps them honest as the app grows.
 *
 * The scan is done with the TypeScript compiler API (`scanRouteLiterals`, see
 * `routes-gate-scanner.ts`), so comments, regex literals, and identifiers are
 * structurally excluded — no hand-rolled comment stripping.
 *
 * What is (intentionally) NOT flagged:
 *  - `src/lib/routes.ts` itself — the owner.
 *  - Test/spec files — they assert against concrete URLs on purpose.
 *  - Comments — a path mentioned in prose is not a live route reference.
 *  - Non-route strings that merely contain a route word (e.g. the MSAL authority
 *    `https://login.microsoftonline.com/...`) — only literals that START with a
 *    route path segment count, so an embedded substring is safe.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRouteLiterals } from './routes-gate-scanner';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The owner file (relative to src/), which is allowed to hold the literals.
const OWNER = 'lib/routes.ts';

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue; // test/spec files opt out
    const rel = path.relative(SRC_ROOT, full).split(path.sep).join('/');
    if (rel === OWNER) continue; // routes.ts is the owner
    files.push(full);
  }
  return files;
}

describe('route-constants gate (#178)', () => {
  it('no app route path literal lives outside src/lib/routes.ts', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      const hits = scanRouteLiterals(readFileSync(file, 'utf8'), `src/${rel}`);
      if (hits.length > 0) {
        const lines = hits.map((h) => `${h.line}:${h.column} ${h.text}`);
        offenders.push(`src/${rel}\n  ${lines.join('\n  ')}`);
      }
    }

    expect(
      offenders,
      offenders.length > 0
        ? `Inline route path literal(s) found — import from '@/lib/routes' instead:\n\n${offenders.join('\n\n')}`
        : undefined,
    ).toEqual([]);
  });

  it('actually detects a planted literal (gate is not vacuous)', () => {
    expect(scanRouteLiterals(`navigate('/app/dashboard');`)).toHaveLength(1);
    expect(scanRouteLiterals(`<Navigate to="/login" replace />`)).toHaveLength(1);
    expect(scanRouteLiterals('const to = `/app/learn/${id}`;')).toHaveLength(1);
    expect(scanRouteLiterals(`const s = '/signup';`)).toHaveLength(1);
  });

  it('does not flag comments, embedded substrings, or composed constants', () => {
    // A path named in a comment is prose, not a live reference.
    expect(scanRouteLiterals(`// redirect to "/login" after auth`)).toEqual([]);
    expect(scanRouteLiterals(`/* go to /app/dashboard */`)).toEqual([]);
    // The MSAL authority merely contains "login" — it does not start with a route.
    expect(scanRouteLiterals(`authority: 'https://login.microsoftonline.com/common'`)).toEqual([]);
    // Invite links compose the constant, so the literal no longer starts the string.
    expect(scanRouteLiterals('const l = `${origin}${routes.auth.signup}?invite=${id}`;')).toEqual([]);
    // `/app` must not match a longer word.
    expect(scanRouteLiterals(`const x = '/apple/pie';`)).toEqual([]);
  });
});
