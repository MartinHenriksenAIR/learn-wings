import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL not set');
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Azure PostgreSQL Flexible Server requires SSL
      max: 5,
      idleTimeoutMillis: 30000,
    });
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
