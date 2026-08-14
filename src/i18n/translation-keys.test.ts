import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanTranslationKeys } from './translation-key-scanner';
import enJson from './locales/en.json';
import daJson from './locales/da.json';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

type LocaleTree = { [key: string]: string | LocaleTree };

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
