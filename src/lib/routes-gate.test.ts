import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRouteLiterals } from './routes-gate-scanner';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    expect(scanRouteLiterals(`// redirect to "/login" after auth`)).toEqual([]);
    expect(scanRouteLiterals(`/* go to /app/dashboard */`)).toEqual([]);
    expect(scanRouteLiterals(`authority: 'https://login.microsoftonline.com/common'`)).toEqual([]);
    expect(scanRouteLiterals('const l = `${origin}${routes.auth.signup}?invite=${id}`;')).toEqual([]);
    expect(scanRouteLiterals(`const x = '/apple/pie';`)).toEqual([]);
  });
});
