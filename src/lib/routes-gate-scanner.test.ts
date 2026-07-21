/**
 * Fixture tests for the TypeScript-compiler-API route scanner (#202).
 *
 * These prove the scanner flags a hardcoded route path where it matters — inside a
 * template literal and on a line following comments (the cases the old hand-rolled
 * lexer handled poorly) — and that it reports each offender's file:line from real
 * AST positions, while leaving prose-in-comments and embedded substrings alone.
 */
import { describe, it, expect } from 'vitest';
import { scanRouteLiterals } from './routes-gate-scanner';

// A realistic component-shaped fixture. Line numbers are asserted below, so keep
// this block's layout stable if you edit it.
//   1: line comment mentioning a route (prose — must NOT flag)
//   2: import (string literal, not a route)
//   4-6: block comment mentioning a route (prose — must NOT flag)
//   8: hardcoded route as a plain string literal (MUST flag)
//   9: hardcoded route as a template-literal head before `${id}` (MUST flag)
//  10: MSAL authority containing "login" mid-string (must NOT flag)
const FIXTURE = [
  '// Navigation helper — see /login for the legacy flow (prose only).',
  "import { navigate } from './nav';",
  '',
  '/**',
  ' * Block comment mentioning /app/dashboard should be ignored.',
  ' */',
  'export function goHome(id: string) {',
  "    navigate('/app/dashboard');",
  '    const learn = `/app/learn/${id}`;',
  "    const authority = 'https://login.microsoftonline.com/common';",
  '    return { learn, authority };',
  '}',
  '',
].join('\n');

const FIXTURE_FILE = 'src/components/Navigation.tsx';

describe('routes-gate scanner (compiler-API, #202)', () => {
  it('flags a hardcoded route in both a string and a template literal, and nothing else', () => {
    const hits = scanRouteLiterals(FIXTURE, FIXTURE_FILE);
    expect(hits.map((h) => h.text)).toEqual(['/app/dashboard', '/app/learn/']);
  });

  it('reports file:line from AST positions (route inside a template literal, after comments)', () => {
    const hits = scanRouteLiterals(FIXTURE, FIXTURE_FILE);

    const stringHit = hits.find((h) => h.text === '/app/dashboard');
    expect(stringHit).toBeDefined();
    expect(stringHit!.line).toBe(8);
    expect(stringHit!.column).toBeGreaterThan(0);

    const templateHit = hits.find((h) => h.text === '/app/learn/');
    expect(templateHit).toBeDefined();
    expect(templateHit!.line).toBe(9);
    expect(templateHit!.column).toBeGreaterThan(0);

    // The kind of offender line a gate failure would print: file:line.
    const report = hits.map((h) => `${FIXTURE_FILE}:${h.line}`);
    expect(report).toEqual([
      'src/components/Navigation.tsx:8',
      'src/components/Navigation.tsx:9',
    ]);
  });

  it('ignores routes named in comments and route words embedded mid-string', () => {
    // Prose in a line comment and a block comment — never live references.
    expect(scanRouteLiterals('// go to /login\nconst x = 1;')).toEqual([]);
    expect(scanRouteLiterals('/* /app/dashboard */\nconst x = 1;')).toEqual([]);
    // Domain that merely contains "login".
    expect(scanRouteLiterals("const a = 'https://login.example.com/app';")).toEqual([]);
    // Composed constant: the route word follows a `${…}` so it does not start the string.
    expect(scanRouteLiterals('const l = `${base}/app/x`;')).toEqual([]);
    // Boundary: `/app` must not match a longer word.
    expect(scanRouteLiterals("const p = '/apple/pie';")).toEqual([]);
  });

  it('respects TS vs TSX parsing via the file extension', () => {
    // A .ts file with a type assertion that would be JSX in a .tsx file: the scanner
    // must still parse it and find the planted route literal.
    const tsSource = 'const id = json as Record<string, string>;\nconst r = "/signup";';
    const hits = scanRouteLiterals(tsSource, 'src/lib/thing.ts');
    expect(hits.map((h) => h.text)).toEqual(['/signup']);
  });
});
