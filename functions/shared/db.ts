import { Pool, PoolClient, PoolConfig } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';
import { AZURE_POSTGRES_CA } from './azure-ca';

let pool: Pool | null = null;

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
    }
    throw err;
  } finally {
    client.release();
  }
}
