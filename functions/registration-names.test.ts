// Fleet-wide static guard over the registration trailer in every functions/*/index.ts
// (endpoint / adminEndpoint / legacy app.http). Route names are load-time string
// literals: a typo'd, duplicated, or missing name passes every per-endpoint test
// (those call the handler directly — registration runs unmocked at import, but its
// route name is never asserted) and fails only at DEPLOY time, when the Functions
// host silently drops or shadows the route.
// Sources are read with fs and matched by regex — deliberately NOT imported, since
// importing would fire the app.http side effects and open DB pools.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Folder name → registered route name, for deliberate deviations ONLY.
// Empty now that admin-user-actions was deleted (callers died in bf1df3b).
const KNOWN_DEVIATIONS: Record<string, string> = {};

const RESERVED_PREFIXES = ['admin', 'runtime', 'host'] as const;
const NON_ENDPOINT_DIRS = new Set(['shared', 'node_modules', 'dist']);
const FUNCTIONS_ROOT = dirname(fileURLToPath(import.meta.url));

// First string argument of the registration statement, whichever form the file
// uses. Line-anchored: registrations in this fleet are only ever
// `export default endpoint(` / `export default adminEndpoint(` / `app.http(` at
// line start — anchoring prevents false positives from comments/strings and
// false negatives from aliased or re-exported forms (which would silently drop
// a file from the scan).
const REGISTRATION = /^(?:export default (?:adminEndpoint|endpoint)|app\.http)\(\s*['"]([^'"]+)['"]/gm;

// Exactly one barrel import per endpoint folder, `import './<folder>/index';`.
const BARREL_IMPORT = /^import '\.\/([^/']+)\/index';$/gm;

const folders = readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NON_ENDPOINT_DIRS.has(e.name))
  .map((e) => e.name);

// Fix-fast, not skip: a folder without index.ts fails the suite below instead of
// silently dropping out of the scan.
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
    // A folder with no index.ts has nothing for the barrel to import — the
    // endpoint silently never registers. FAIL here rather than skip the folder.
    expect(foldersMissingIndex, 'endpoint folders missing index.ts').toEqual([]);
  });

  it('every endpoint folder has exactly one barrel import in index.ts (functions.md rule #1)', () => {
    // An unimported function silently never registers — the barrel is the only
    // thing the host loads (package.json "main": "dist/index.js").
    const offenders = folders
      .map((folder) => ({ folder, count: barrelImports.filter((i) => i === folder).length }))
      .filter(({ count }) => count !== 1)
      .map(({ folder, count }) => `${folder} (imported ${count}×)`);
    expect(offenders, 'folders not imported exactly once by the barrel').toEqual([]);
  });

  it('every barrel import points at an existing endpoint folder', () => {
    // A stale import (folder renamed/deleted) breaks the compiled barrel at load
    // time and deregisters the ENTIRE fleet.
    const stale = barrelImports.filter((i) => !folders.includes(i));
    expect(stale, 'barrel imports with no matching folder').toEqual([]);
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
