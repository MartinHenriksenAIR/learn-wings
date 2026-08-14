import { describe, it, expect } from 'vitest';
import { scanRouteLiterals } from './routes-gate-scanner';

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

    const report = hits.map((h) => `${FIXTURE_FILE}:${h.line}`);
    expect(report).toEqual([
      'src/components/Navigation.tsx:8',
      'src/components/Navigation.tsx:9',
    ]);
  });

  it('ignores routes named in comments and route words embedded mid-string', () => {
    expect(scanRouteLiterals('// go to /login\nconst x = 1;')).toEqual([]);
    expect(scanRouteLiterals('/* /app/dashboard */\nconst x = 1;')).toEqual([]);
    expect(scanRouteLiterals("const a = 'https://login.example.com/app';")).toEqual([]);
    expect(scanRouteLiterals('const l = `${base}/app/x`;')).toEqual([]);
    expect(scanRouteLiterals("const p = '/apple/pie';")).toEqual([]);
  });

  it('respects TS vs TSX parsing via the file extension', () => {
    const tsSource = 'const id = json as Record<string, string>;\nconst r = "/signup";';
    const hits = scanRouteLiterals(tsSource, 'src/lib/thing.ts');
    expect(hits.map((h) => h.text)).toEqual(['/signup']);
  });
});
