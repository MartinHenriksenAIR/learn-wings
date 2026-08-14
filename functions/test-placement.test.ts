import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCTIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const NON_ENDPOINT_DIRS = new Set(['shared', 'node_modules', 'dist']);

const ORPHAN_PAYLOAD_TEST = /-payload\.test\.ts$/;

const endpointFolders = readdirSync(FUNCTIONS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NON_ENDPOINT_DIRS.has(e.name))
  .map((e) => e.name)
  .filter((f) => existsSync(join(FUNCTIONS_ROOT, f, 'index.ts')));

describe('test placement hygiene (#199)', () => {
  it('discovers endpoint folders (guards against the scan going vacuous)', () => {
    expect(endpointFolders.length).toBeGreaterThan(0);
  });

  it('no endpoint has a standalone *-payload.test.ts — fold assertions into index.test.ts', () => {
    const offenders = endpointFolders.flatMap((folder) =>
      readdirSync(join(FUNCTIONS_ROOT, folder))
        .filter((name) => ORPHAN_PAYLOAD_TEST.test(name))
        .map((name) => `${folder}/${name}`),
    );
    expect(offenders, 'standalone payload test files (fold them into the sibling index.test.ts)').toEqual([]);
  });
});
