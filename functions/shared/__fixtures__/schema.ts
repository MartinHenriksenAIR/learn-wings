// Shared test fixture for the schema-drift guards.
//
// Several function unit tests pin a runtime SQL helper against the canonical
// schema (migration/azure/01-schema.sql) so that a change to the DB definition
// the helper mirrors fails loud. They had each re-derived the same readFileSync
// + extraction regexes; this hosts them once. If the schema's dollar-quoting
// (AS $$ → AS $function$) or location ever changes, fix it HERE — not in
// lockstep across every reader.
//
// This is test-support code, not a test: vitest ignores it (no *.test.ts name)
// and tsconfig excludes **/__fixtures__/** from the production build.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = resolve(__dirname, '../../../migration/azure/01-schema.sql');

let cached: string | undefined;

/** The canonical Azure schema as text (read once, reused). */
export function readSchema(): string {
  return (cached ??= readFileSync(SCHEMA_PATH, 'utf8'));
}

/**
 * Body of a `CREATE [OR REPLACE] FUNCTION public.<name>(...) ... AS $$ <body> $$;`
 * block. Anchors on the `CREATE … FUNCTION public.<name>(` definition so it
 * matches neither a prefix-named sibling (`<name>_v2`) nor an `EXECUTE FUNCTION
 * public.<name>()` trigger reference. Throws if the function — or its `$$`
 * dollar-quoting — is not found, so a stale name or changed quote trips the
 * calling guard loudly instead of silently matching nothing.
 *
 * `schema` is injectable for unit-testing the matcher; it defaults to the
 * canonical schema text.
 */
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

/**
 * Column body of a `CREATE TABLE public.<name> ( <body>\n);` block. The ` (`
 * after the name anchors the match to the exact table, not a prefix-named
 * sibling. Throws if the table is not found.
 *
 * `schema` is injectable for unit-testing the matcher; it defaults to the
 * canonical schema text.
 */
export function tableBody(name: string, schema: string = readSchema()): string {
  const m = schema.match(
    new RegExp(`CREATE TABLE public\\.${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) {
    throw new Error(`public.${name} table not found in 01-schema.sql`);
  }
  return m[1];
}
