/**
 * Permanent drift gate for #300.
 *
 * Scans `src/` for every statically-known `t('some.key')` call site and FAILS if
 * the key is missing from `en.json` or `da.json`. This is the gate that catches
 * the #300 bug class at its root: `auth.signInWithMicrosoft` existed in neither
 * locale file, and an inline i18next default (`t(key, 'Sign in with Microsoft')`)
 * kept the English string rendering on a Danish page with no missing-key warning.
 * The lint rule in `eslint.config.js` blocks that masking default; this test
 * blocks the missing key it was hiding.
 *
 * It enforces the `.claude/rules/frontend.md` rule directly — "every new
 * user-facing string gets keys in BOTH `en` and `da`" — so a one-locale string
 * can no longer reach prod on the English fallback.
 *
 * What is (intentionally) NOT checked:
 *  - Runtime-assembled keys (`t(\`level.${x}\`)`, `t(item.labelKey)`) — they are
 *    unknowable statically, so the scanner skips them (see the scanner header).
 *  - Test/spec files — they pass throwaway keys to assert i18n behaviour itself.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanTranslationKeys } from './translation-key-scanner';
import enJson from './locales/en.json';
import daJson from './locales/da.json';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * i18next resolves a `{ count }` call to a suffixed sibling (`key_one`,
 * `key_other`, …) via Intl.PluralRules, so the bare key legitimately does not
 * exist for plurals. Accept a key when any CLDR plural form is present.
 */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

type LocaleTree = { [key: string]: string | LocaleTree };

/** Walk a dotted path through a locale tree; undefined if any segment is absent. */
function lookup(tree: LocaleTree, key: string): string | LocaleTree | undefined {
  let node: string | LocaleTree | undefined = tree;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[segment];
  }
  return node;
}

function resolves(tree: LocaleTree, key: string): boolean {
  if (typeof lookup(tree, key) === 'string') return true;
  return PLURAL_SUFFIXES.some(
    (suffix) => typeof lookup(tree, `${key}_${suffix}`) === 'string',
  );
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
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue; // tests opt out
    files.push(full);
  }
  return files;
}

interface Offender {
  key: string;
  where: string;
  missingIn: string[];
}

function findOffenders(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
    const source = readFileSync(file, 'utf8');
    for (const hit of scanTranslationKeys(source, `src/${rel}`)) {
      const missingIn = [
        ...(resolves(enJson as LocaleTree, hit.key) ? [] : ['en']),
        ...(resolves(daJson as LocaleTree, hit.key) ? [] : ['da']),
      ];
      if (missingIn.length > 0) {
        offenders.push({
          key: hit.key,
          where: `src/${rel}:${hit.line}:${hit.column}`,
          missingIn,
        });
      }
    }
  }
  return offenders;
}

describe('translation-key drift gate (#300)', () => {
  it('every static t() key exists in both en.json and da.json', () => {
    const offenders = findOffenders();
    const report = offenders
      .map((o) => `${o.where}  t('${o.key}') — missing in ${o.missingIn.join(' + ')}`)
      .join('\n  ');

    expect(
      offenders,
      `Translation keys used in src/ but absent from a locale file:\n  ${report}\n\n` +
        'Add the key to BOTH src/i18n/locales/en.json and da.json ' +
        '(.claude/rules/frontend.md). Never paper over it with an inline ' +
        "t(key, 'English default') — that is what masked #300.",
    ).toEqual([]);
  });

  it('scans a meaningful number of call sites (guards against a silently broken scan)', () => {
    // A scanner regression that returned nothing would make the gate above pass
    // vacuously. The app had ~950 static keys when this gate landed; assert the
    // scan still finds a large population rather than an exact, churn-prone count.
    const total = collectSourceFiles(SRC_ROOT).reduce(
      (sum, file) =>
        sum +
        scanTranslationKeys(
          readFileSync(file, 'utf8'),
          path.relative(SRC_ROOT, file),
        ).length,
      0,
    );
    expect(total).toBeGreaterThan(500);
  });
});
