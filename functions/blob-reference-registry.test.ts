import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCTIONS_ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(FUNCTIONS_ROOT, '../migration/azure/01-schema.sql'), 'utf8');
const SWEEP_SOURCE = readFileSync(resolve(FUNCTIONS_ROOT, 'orphan-sweep/index.ts'), 'utf8');

const TEXTUAL = /^(text|citext|varchar|character\s+varying)/i;

const ASSET_SHAPED = /(url|uri|path|blob|storage|image|thumbnail|avatar|logo|photo|banner|icon|attachment|media|asset|file)/i;

const NOT_BLOB_COLUMNS: Readonly<Record<string, string>> = {
  'lessons.video_url':
    'an external video link (SharePoint, YouTube) typed by an author. No upload path writes it, so a blob is never created for it.',
  'community_posts.event_registration_url':
    'an external link on an event post, validated as an http(s) URL on write. No upload surface targets it.',
  'community_posts.event_recording_url':
    'an external recording link on an event post, validated as an http(s) URL on write. No upload surface targets it.',
  'community_resources.url':
    'an external link on a community resource, gated by validateHttpUrl in resource-create/resource-update. Nothing uploads to it.',
  'community_categories.icon':
    'a lucide icon name, resolved through the iconMap lookup in src/components/community/CategoryBadge.tsx. It names a bundled component, never a file.',
};

function tableBodies(): Array<{ table: string; body: string }> {
  const found: Array<{ table: string; body: string }> = [];
  for (const m of SCHEMA.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi,
  )) {
    found.push({ table: m[1], body: m[2] });
  }
  return found;
}

function textColumns(): string[] {
  const columns: string[] = [];
  for (const { table, body } of tableBodies()) {
    for (const line of body.split(/\r?\n/)) {
      const m = /^\s{2,}(\w+)\s+(.+)$/.exec(line);
      if (!m) continue;
      if (!TEXTUAL.test(m[2].trim())) continue;
      columns.push(`${table}.${m[1]}`);
    }
  }
  for (const m of SCHEMA.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+([a-z\s]+)/gi,
  )) {
    if (TEXTUAL.test(m[3].trim())) columns.push(`${m[1]}.${m[2]}`);
  }
  return [...new Set(columns)];
}

function registeredColumns(): string[] {
  const block = /const REFERENCED_PATHS_SQL = `([\s\S]*?)`;/.exec(SWEEP_SOURCE)?.[1] ?? '';
  const registered = new Set<string>();
  for (const m of block.matchAll(/SELECT\s+(\w+)\s+AS\s+path\s+FROM\s+(\w+)/gi)) {
    registered.add(`${m[2]}.${m[1]}`);
  }
  return [...registered];
}

describe('every column that could hold a blob path is accounted for (#469)', () => {
  const registered = registeredColumns();
  const candidates = textColumns().filter((column) => ASSET_SHAPED.test(column.split('.')[1]));

  it('finds the sweep\'s registered columns (guards against the scan going vacuous)', () => {
    expect(registered.length).toBeGreaterThan(0);
  });

  it('finds asset-shaped text columns to check (guards against the scan going vacuous)', () => {
    expect(candidates.length).toBeGreaterThan(registered.length);
  });

  it('every asset-shaped column is either swept or declared not to be a blob', () => {
    const unaccounted = candidates.filter(
      (column) => !registered.includes(column) && !(column in NOT_BLOB_COLUMNS),
    );

    expect(
      unaccounted,
      unaccounted.length
        ? `${unaccounted.join(', ')} look(s) like it can hold a blob path and the orphan sweep does not know about it. ` +
            'A column the sweep cannot see makes every blob it points at read as unreferenced, which is the one break ' +
            'the runtime checks cannot detect: nothing about it is anomalous, so the sweep would delete live media on ' +
            'the first night the grace period expired. Decide which it is — add it to REFERENCED_PATHS_SQL in ' +
            'functions/orphan-sweep/index.ts if anything uploads to it, or to NOT_BLOB_COLUMNS in this file with the ' +
            'reason it can never hold one.'
        : '',
    ).toEqual([]);
  });

  it('no declared non-blob column is also registered as swept', () => {
    const both = registered.filter((column) => column in NOT_BLOB_COLUMNS);
    expect(both, 'declared not-a-blob and swept at the same time — one of the two is wrong').toEqual([]);
  });

  it('every declared non-blob column still exists in the schema', () => {
    const all = new Set(textColumns());
    const stale = Object.keys(NOT_BLOB_COLUMNS).filter((column) => !all.has(column));
    expect(stale, 'declared not-a-blob but no longer in 01-schema.sql — drop the entry').toEqual([]);
  });

  it('every registered column still exists in the schema', () => {
    const all = new Set(textColumns());
    const stale = registered.filter((column) => !all.has(column));
    expect(stale, 'swept by REFERENCED_PATHS_SQL but not in 01-schema.sql — the union would error at runtime').toEqual(
      [],
    );
  });
});
