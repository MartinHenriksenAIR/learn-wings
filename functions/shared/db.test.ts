import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub Pool / PoolClient via vi.hoisted so the mock factory can reference them
// ---------------------------------------------------------------------------
const { mockConnect, mockQuery, mockRelease } = vi.hoisted(() => {
  const mockRelease = vi.fn();
  const mockQuery = vi.fn();
  const mockConnect = vi.fn();
  return { mockConnect, mockQuery, mockRelease };
});

vi.mock('pg', () => {
  class Pool {
    connect = mockConnect;
  }
  return { Pool };
});

// Import AFTER mock registration
import { withTransaction } from './db';

// ---------------------------------------------------------------------------
// Unit tests for withTransaction
// ---------------------------------------------------------------------------
describe('withTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide a dummy DATABASE_URL so getDb() initialises without throwing
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';

    // Default stub client returned by pool.connect()
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('happy path: BEGIN, callback queries, COMMIT, release, returns result', async () => {
    const expectedResult = { id: 'row-1' };
    const callback = vi.fn().mockResolvedValue(expectedResult);

    const result = await withTransaction(callback);

    // Client was acquired
    expect(mockConnect).toHaveBeenCalledOnce();

    // Verify query sequence
    const calls = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');

    // Callback received the client and was called
    expect(callback).toHaveBeenCalledOnce();
    const clientArg = callback.mock.calls[0][0];
    expect(clientArg).toHaveProperty('query');
    expect(clientArg).toHaveProperty('release');

    // Result forwarded
    expect(result).toBe(expectedResult);

    // Client always released
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('callback throws: ROLLBACK issued, client released, original error rethrown', async () => {
    const originalError = new Error('callback boom');
    const callback = vi.fn().mockRejectedValue(originalError);

    await expect(withTransaction(callback)).rejects.toThrow('callback boom');

    const calls = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls[0]).toBe('BEGIN');
    // ROLLBACK must be issued (not COMMIT)
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');

    // Client still released in finally
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('ROLLBACK failure does not mask the original callback error', async () => {
    const originalError = new Error('original error');
    const rollbackError = new Error('rollback failed');

    const callback = vi.fn().mockRejectedValue(originalError);

    // Make the second query call (ROLLBACK) throw
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN succeeds
      .mockRejectedValueOnce(rollbackError); // ROLLBACK throws

    const thrown = await withTransaction(callback).catch((e) => e);

    // Original error must survive — not the rollback error
    expect(thrown).toBe(originalError);
    expect(thrown.message).toBe('original error');

    // Client still released
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Existing integration tests (skipped when DATABASE_URL is not a real server)
// These run against a live DB only in CI / local dev with a real connection
// ---------------------------------------------------------------------------
import { describe as describeInt, it as itInt, afterAll } from 'vitest';
import { query, queryOne, getDb } from './db';

const skip = process.env.DATABASE_URL === 'postgres://test:test@localhost:5432/testdb'
  || !process.env.DATABASE_URL;

describeInt.skipIf(skip)('db integration', () => {
  afterAll(async () => {
    await getDb().end();
  });

  itInt('query returns rows', async () => {
    const rows = await query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0]).toEqual({ ok: 1 });
  });

  itInt('queryOne returns single row', async () => {
    const row = await queryOne<{ ok: number }>('SELECT 1 AS ok');
    expect(row).toEqual({ ok: 1 });
  });

  itInt('queryOne returns null when no results', async () => {
    const row = await queryOne('SELECT 1 WHERE false');
    expect(row).toBeNull();
  });
});
