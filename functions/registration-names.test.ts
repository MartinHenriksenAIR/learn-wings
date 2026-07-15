// Fleet-wide static guard over the registration trailer in every functions/*/index.ts
// (endpoint / adminEndpoint / legacy app.http). Route names are load-time string
// literals: a typo'd, duplicated, or missing name passes every per-endpoint test
// (those call the handler directly with app.http mocked) and fails only at DEPLOY
// time, when the Functions host silently drops or shadows the route.
// Sources are read with fs and matched by regex — deliberately NOT imported, since
// importing would fire the app.http side effects and open DB pools.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Folder name → registered route name, for deliberate deviations ONLY.
const KNOWN_DEVIATIONS: Record<string, string> = {
  // Route names may not start with the reserved prefixes admin/runtime/host
  // (.claude/rules/functions.md), so this folder registers suffix-style.
  'admin-user-actions': 'user-actions-admin',
};

const RESERVED_PREFIXES = ['admin', 'runtime', 'host'] as const;
const NON_ENDPOINT_DIRS = new Set(['shared', 'node_modules', 'dist']);
const FUNCTIONS_ROOT = dirname(fileURLToPath(import.meta.url));

// First string argument of the registration call, whichever form the file uses.
const REGISTRATION = /\b(?:app\.http|adminEndpoint|endpoint)\(\s*['"]([^'"]+)['"]/g;

const fleet = readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NON_ENDPOINT_DIRS.has(e.name))
  .filter((e) => existsSync(join(FUNCTIONS_ROOT, e.name, 'index.ts')))
  .map((e) => {
    const src = readFileSync(join(FUNCTIONS_ROOT, e.name, 'index.ts'), 'utf8');
    return { folder: e.name, names: [...src.matchAll(REGISTRATION)].map((m) => m[1]) };
  });

describe('fleet registration names', () => {
  it('discovers the fleet (guards against the scan going vacuous)', () => {
    expect(fleet.length).toBeGreaterThan(0);
  });

  it.each(fleet)('$folder/index.ts registers exactly one route', ({ names }) => {
    // 0 = imported-but-never-registers landmine; >1 = duplicate trailer in one file.
    expect(names).toHaveLength(1);
  });

  it.each(fleet)('$folder/index.ts route name matches its folder', ({ folder, names }) => {
    expect(names[0]).toBe(KNOWN_DEVIATIONS[folder] ?? folder);
  });

  it('registered names are unique across the fleet', () => {
    const all = fleet.flatMap((f) => f.names);
    const dupes = all.filter((name, i) => all.indexOf(name) !== i);
    expect(dupes).toEqual([]);
  });

  it('no registered name starts with a reserved prefix (admin/runtime/host)', () => {
    const offenders = fleet
      .filter((f) => f.names.some((n) => RESERVED_PREFIXES.some((p) => n.startsWith(p))))
      .map((f) => `${f.folder} → ${f.names.join(', ')}`);
    expect(offenders).toEqual([]);
  });
});
