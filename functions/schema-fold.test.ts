import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_DIR = resolve(__dirname, '../migration/azure');
const SCHEMA = readFileSync(resolve(MIGRATION_DIR, '01-schema.sql'), 'utf8');

const BASE_FILES = new Set(['01-schema.sql', '02-seed.sql']);

interface Expected {
  file: string;
  kind: 'table' | 'column' | 'index';
  table?: string;
  name: string;
}

function additiveMigrations(): string[] {
  return readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('.sql') && !BASE_FILES.has(f))
    .sort();
}

function objectsCreatedBy(file: string): Expected[] {
  const sql = readFileSync(resolve(MIGRATION_DIR, file), 'utf8');
  const found: Expected[] = [];

  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi)) {
    found.push({ file, kind: 'table', name: m[1] });
  }
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
  )) {
    found.push({ file, kind: 'column', table: m[1], name: m[2] });
  }
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    found.push({ file, kind: 'index', name: m[1] });
  }

  return found;
}

function tableBodyIn(schema: string, table: string): string | null {
  const m = schema.match(
    new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'),
  );
  return m ? m[1] : null;
}

function isFolded(o: Expected): boolean {
  if (o.kind === 'table') {
    return new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.${o.name}\\b`, 'i').test(SCHEMA);
  }
  if (o.kind === 'index') {
    return new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${o.name}\\b`, 'i').test(SCHEMA);
  }
  // A column counts as folded whether it was written into the table body or
  // left as its own ALTER in the schema file.
  const body = tableBodyIn(SCHEMA, o.table!);
  if (body && new RegExp(`^\\s*${o.name}\\s`, 'im').test(body)) return true;
  return new RegExp(
    `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?public\\.${o.table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${o.name}\\b`,
    'i',
  ).test(SCHEMA);
}

function describeObject(o: Expected): string {
  if (o.kind === 'column') return `column ${o.table}.${o.name}`;
  return `${o.kind} ${o.name}`;
}

describe('additive migrations are folded into 01-schema.sql', () => {
  const migrations = additiveMigrations();

  it('finds migration files to check', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it.each(migrations)('%s', (file) => {
    const missing = objectsCreatedBy(file)
      .filter((o) => !isFolded(o))
      .map(describeObject);

    expect(
      missing,
      missing.length
        ? `${file} creates ${missing.join(', ')}, which 01-schema.sql does not. ` +
            'A database built from 01+02 would be incomplete. Fold the migration in — ' +
            'see the standing rule in migration/azure/README.md.'
        : '',
    ).toEqual([]);
  });
});
