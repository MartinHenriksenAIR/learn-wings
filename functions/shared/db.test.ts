import { describe, it, expect, afterAll } from 'vitest';
import { query, queryOne, getDb } from './db';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('db integration', () => {
  afterAll(async () => {
    await getDb().end();
  });

  it('query returns rows', async () => {
    const rows = await query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0]).toEqual({ ok: 1 });
  });

  it('queryOne returns single row', async () => {
    const row = await queryOne<{ ok: number }>('SELECT 1 AS ok');
    expect(row).toEqual({ ok: 1 });
  });

  it('queryOne returns null when no results', async () => {
    const row = await queryOne('SELECT 1 WHERE false');
    expect(row).toBeNull();
  });
});
