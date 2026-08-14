import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_DEVIATIONS: Record<string, string> = {};

const RESERVED_PREFIXES = ['admin', 'runtime', 'host'] as const;
const NON_ENDPOINT_DIRS = new Set(['shared', 'node_modules', 'dist']);
const FUNCTIONS_ROOT = dirname(fileURLToPath(import.meta.url));

const REGISTRATION = /^(?:export default (?:adminEndpoint|endpoint)|app\.(?:http|timer))\(\s*['"]([^'"]+)['"]/gm;

const BARREL_IMPORT = /^import '\.\/([^/']+)\/index';$/gm;

const folders = readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NON_ENDPOINT_DIRS.has(e.name))
  .map((e) => e.name);

const foldersMissingIndex = folders.filter((f) => !existsSync(join(FUNCTIONS_ROOT, f, 'index.ts')));

const fleet = folders
  .filter((f) => !foldersMissingIndex.includes(f))
  .map((folder) => {
    const src = readFileSync(join(FUNCTIONS_ROOT, folder, 'index.ts'), 'utf8');
    return { folder, names: [...src.matchAll(REGISTRATION)].map((m) => m[1]) };
  });

const barrelSrc = readFileSync(join(FUNCTIONS_ROOT, 'index.ts'), 'utf8');
const barrelImports = [...barrelSrc.matchAll(BARREL_IMPORT)].map((m) => m[1]);

describe('fleet registration names', () => {
  it('discovers the fleet (guards against the scan going vacuous)', () => {
    expect(fleet.length).toBeGreaterThan(0);
  });

  it('every endpoint folder contains an index.ts (a folder without one can never register)', () => {
    expect(foldersMissingIndex, 'endpoint folders missing index.ts').toEqual([]);
  });

  it('every endpoint folder has exactly one barrel import in index.ts (functions.md rule #1)', () => {
    const offenders = folders
      .map((folder) => ({ folder, count: barrelImports.filter((i) => i === folder).length }))
      .filter(({ count }) => count !== 1)
      .map(({ folder, count }) => `${folder} (imported ${count}×)`);
    expect(offenders, 'folders not imported exactly once by the barrel').toEqual([]);
  });

  it('every barrel import points at an existing endpoint folder', () => {
    const stale = barrelImports.filter((i) => !folders.includes(i));
    expect(stale, 'barrel imports with no matching folder').toEqual([]);
  });

  it.each(fleet)('$folder/index.ts registers exactly one route', ({ names }) => {
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
