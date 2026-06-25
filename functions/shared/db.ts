import { Pool, PoolClient, PoolConfig } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import { AZURE_POSTGRES_CA } from './azure-ca';

let pool: Pool | null = null;

/**
 * SSL config for the pg Pool. Default is verify-full: the chain is verified
 * against the embedded Azure PostgreSQL root CA bundle (see azure-ca.ts) and
 * Node verifies the hostname when rejectUnauthorized is true.
 *
 * Escape hatch (operational rollback only): set DATABASE_SSL_INSECURE=1 to
 * fall back to the old unverified TLS ({ rejectUnauthorized: false }). This
 * disables certificate AND hostname verification — a loud warning is logged.
 */
export function buildSslConfig(env: NodeJS.ProcessEnv = process.env): {
  ca?: string;
  rejectUnauthorized: boolean;
} {
  if (env.DATABASE_SSL_INSECURE === '1') {
    console.warn(
      'WARNING: DATABASE_SSL_INSECURE=1 — TLS certificate and hostname verification is DISABLED for the database connection. ' +
        'This is an operational rollback hatch only; unset it as soon as possible.'
    );
    return { rejectUnauthorized: false };
  }
  return { ca: AZURE_POSTGRES_CA, rejectUnauthorized: true };
}

/**
 * Build the pg Pool config from a connection string, parsing the URL into
 * discrete fields and merging our SSL config LAST so it stays authoritative.
 *
 * Why not `{ connectionString, ssl }`: pg's ConnectionParameters does
 * `Object.assign({}, config, parse(connectionString))`, so a `?sslmode=require`
 * URL (the documented prod DATABASE_URL) re-derives `ssl` → `{}` and overwrites
 * our explicit `ssl` — silently discarding the pinned-CA verify-full setup AND
 * the DATABASE_SSL_INSECURE rollback hatch (issue #103). Passing the
 * already-parsed fields (no `connectionString` key) removes that clobber vector.
 */
export function buildPoolConfig(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  return {
    ...parseIntoClientConfig(connectionString),
    ssl: buildSslConfig(env), // Azure PostgreSQL Flexible Server requires SSL
    max: 5,
    idleTimeoutMillis: 30000,
  };
}

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL not set');
    pool = new Pool(buildPoolConfig(connectionString));
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const db = getDb();
  const { rows } = await db.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * True when `err` is a Postgres unique_violation (SQLSTATE 23505) — e.g. an
 * INSERT/UPDATE hitting a UNIQUE constraint. Use this instead of hand-checking
 * `(err as { code?: string })?.code === '23505'` at call sites.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null | undefined)?.code === '23505';
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow rollback errors — original error takes precedence
    }
    throw err;
  } finally {
    client.release();
  }
}
