import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileJson } from './profile-json';

describe('profileJson', () => {
  it('emits the canonical author-profile fragment for a given alias', () => {
    expect(profileJson('pr')).toBe(
      "json_build_object('id', pr.id, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url)",
    );
  });

  it('parameterizes the alias', () => {
    expect(profileJson('rep')).toBe(
      "json_build_object('id', rep.id, 'full_name', rep.full_name, 'avatar_url', rep.avatar_url)",
    );
  });

  it('pins the exact key set (id, full_name, avatar_url) in order', () => {
    const keys = [...profileJson('x').matchAll(/'(\w+)',/g)].map((m) => m[1]);
    expect(keys).toEqual(['id', 'full_name', 'avatar_url']);
  });
});

// Fleet-wide guard: no endpoint may hand-roll the canonical author-profile fragment —
// it must come from profileJson(). Mirrors registration-names.test.ts: sources are read
// with fs and matched by regex, deliberately NOT imported (importing fires the app.http
// side effects and opens DB pools).
describe('no endpoint hand-rolls the author-profile json_build_object', () => {
  const FUNCTIONS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const NON_ENDPOINT_DIRS = new Set(['shared', 'node_modules', 'dist']);

  // The exact hand-rolled form profileJson() replaces:
  //   json_build_object('id', <a>.id, 'full_name', <a>.full_name, 'avatar_url', <a>.avatar_url)
  // The \1 backreference ties all three columns to one alias, so a deliberately richer
  // superset that interleaves other keys (e.g. ai-champions' 'department') is NOT matched —
  // that projection is a distinct shape the frontend consumes, not this canonical fragment.
  const HAND_ROLLED =
    /json_build_object\(\s*'id',\s*(\w+)\.id,\s*'full_name',\s*\1\.full_name,\s*'avatar_url',\s*\1\.avatar_url\s*\)/;

  const folders = readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NON_ENDPOINT_DIRS.has(e.name))
    .map((e) => e.name)
    .filter((f) => existsSync(join(FUNCTIONS_ROOT, f, 'index.ts')));

  it('has endpoint folders to scan', () => {
    expect(folders.length).toBeGreaterThan(0);
  });

  it.each(folders)('%s/index.ts uses profileJson() instead of a hand-rolled fragment', (folder) => {
    const src = readFileSync(join(FUNCTIONS_ROOT, folder, 'index.ts'), 'utf8');
    expect(src).not.toMatch(HAND_ROLLED);
  });
});
