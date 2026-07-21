// Fleet-wide hygiene guard on test-file PLACEMENT (issue #199).
//
// Per-endpoint payload assertions belong INSIDE that endpoint's sibling index.test.ts
// (.claude/rules/functions.md — "mock contract tests per endpoint: */index.test.ts"),
// not in a standalone `avatar-payload.test.ts` (or any other orphan `*-payload.test.ts`)
// next to it. Standalone payload files re-duplicate the whole mock scaffold (vi.hoisted /
// vi.mock / baseReq) already present in index.test.ts and drift from it over time; #199
// folded the seven that had accreted back into their index.test.ts. This guard fails the
// build if one reappears, so the convention self-enforces instead of relying on review.
//
// Sources are discovered with fs (never imported) — importing an endpoint test would fire
// its module-load side effects; here we only care about which files exist on disk.
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCTIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const NON_ENDPOINT_DIRS = new Set(['shared', 'node_modules', 'dist']);

// An orphan payload test: a `*-payload.test.ts` sitting beside an endpoint's index.test.ts
// instead of being folded into it. `index.test.ts` is the sanctioned home and is exempt.
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
