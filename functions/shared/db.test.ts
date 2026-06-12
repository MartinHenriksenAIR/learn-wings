import { describe, it, expect, afterAll } from 'vitest';
import { query, queryOne, getDb, isUniqueViolation } from './db';

const skip = !process.env.DATABASE_URL;

// Pure unit tests — no DATABASE_URL gate.
describe('isUniqueViolation', () => {
  it('returns true for a Postgres unique_violation (code 23505)', () => {
    expect(isUniqueViolation(Object.assign(new Error('duplicate key value'), { code: '23505' }))).toBe(true);
  });

  it('returns false for other Postgres error codes', () => {
    expect(isUniqueViolation(Object.assign(new Error('fk violation'), { code: '23503' }))).toBe(false);
  });

  it('returns false for plain errors without a code', () => {
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
  });

  it('returns false for null/undefined/non-object values', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

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
