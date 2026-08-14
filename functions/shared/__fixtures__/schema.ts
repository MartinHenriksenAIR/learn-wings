import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = resolve(__dirname, '../../../migration/azure/01-schema.sql');

let cached: string | undefined;

function readSchema(): string {
  return (cached ??= readFileSync(SCHEMA_PATH, 'utf8'));
}

export function functionBody(name: string, schema: string = readSchema()): string {
  const m = schema.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`),
  );
  if (!m) {
    throw new Error(
      `public.${name} not found in 01-schema.sql (renamed, or AS $$…$$ quoting changed?)`,
    );
  }
  return m[1];
}

export function tableBody(name: string, schema: string = readSchema()): string {
  const m = schema.match(
    new RegExp(`CREATE TABLE public\\.${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) {
    throw new Error(`public.${name} table not found in 01-schema.sql`);
  }
  return m[1];
}
