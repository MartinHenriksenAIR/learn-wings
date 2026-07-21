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

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The owner file (relative to src/), which is allowed to hold the literals.
const OWNER = 'lib/routes.ts';

/**
 * A route path literal: an opening quote (', ", or `) immediately followed by a
 * known route path segment, bounded so `/app` never matches `/apple` and a route
 * word embedded mid-string (after `${...}` or a domain) never matches.
 */
const ROUTE_LITERAL =
  /(['"`])\/(?:app|login|signup|forgot-password|reset-password)(?=[/?#'"`)\s]|\1|$)/;

/**
 * Blank out comments while preserving string contents, tracking string state so a
 * `//` inside a URL string (e.g. `https://...`) is never mistaken for a comment.
 * Runs char-by-char rather than via regex because comment-vs-string cannot be
 * disambiguated line-at-a-time.
 */
export function stripComments(src: string): string {
  let out = '';
  let state:
    | 'code'
    | 'line'
    | 'block'
    | 'single'
    | 'double'
    | 'template' = 'code';

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];

    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i++; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i++; continue; }
      if (c === "'") { state = 'single'; out += c; continue; }
      if (c === '"') { state = 'double'; out += c; continue; }
      if (c === '`') { state = 'template'; out += c; continue; }
      out += c;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      continue;
    }

    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i++; continue; }
      if (c === '\n') out += c; // keep line numbers aligned
      continue;
    }

    // Inside a string literal: keep every char, honour escapes, close on the quote.
    if (c === '\\') { out += c + (c2 ?? ''); i++; continue; }
    out += c;
    const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
    if (c === quote) state = 'code';
  }

  return out;
}

/** Return the offending lines (comment-stripped) that hold a route path literal. */
export function findRouteLiterals(src: string): string[] {
  return stripComments(src)
    .split('\n')
    .map((line, idx) => ({ line: line.trim(), idx }))
    .filter(({ line }) => ROUTE_LITERAL.test(line))
    .map(({ line, idx }) => `${idx + 1}: ${line}`);
}

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
      const hits = findRouteLiterals(readFileSync(file, 'utf8'));
      if (hits.length > 0) {
        const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
        offenders.push(`src/${rel}\n  ${hits.join('\n  ')}`);
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
    expect(findRouteLiterals(`navigate('/app/dashboard');`)).toHaveLength(1);
    expect(findRouteLiterals(`<Navigate to="/login" replace />`)).toHaveLength(1);
    expect(findRouteLiterals('const to = `/app/learn/${id}`;')).toHaveLength(1);
    expect(findRouteLiterals(`const s = '/signup';`)).toHaveLength(1);
  });

  it('does not flag comments, embedded substrings, or composed constants', () => {
    // A path named in a comment is prose, not a live reference.
    expect(findRouteLiterals(`// redirect to "/login" after auth`)).toEqual([]);
    expect(findRouteLiterals(`/* go to /app/dashboard */`)).toEqual([]);
    // The MSAL authority merely contains "login" — it does not start with a route.
    expect(findRouteLiterals(`authority: 'https://login.microsoftonline.com/common'`)).toEqual([]);
    // Invite links compose the constant, so the literal no longer starts the string.
    expect(findRouteLiterals('const l = `${origin}${routes.auth.signup}?invite=${id}`;')).toEqual([]);
    // `/app` must not match a longer word.
    expect(findRouteLiterals(`const x = '/apple/pie';`)).toEqual([]);
  });
});
