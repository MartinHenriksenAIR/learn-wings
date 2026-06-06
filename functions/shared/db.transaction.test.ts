import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for withTransaction. Lives in its own file because vi.mock('pg')
// is file-scoped — mixing it into db.test.ts would break the real-DB
// integration tests there whenever DATABASE_URL is set.
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

import { withTransaction } from './db';

describe('withTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getDb() throws without a connection string; pg is mocked so the value
    // is never dialled.
    process.env.DATABASE_URL = 'postgres://unit-test-mock/never-connects';

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

    expect(mockConnect).toHaveBeenCalledOnce();

    const calls = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');

    expect(callback).toHaveBeenCalledOnce();
    const clientArg = callback.mock.calls[0][0];
    expect(clientArg).toHaveProperty('query');
    expect(clientArg).toHaveProperty('release');

    expect(result).toBe(expectedResult);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('callback throws: ROLLBACK issued, client released, original error rethrown', async () => {
    const originalError = new Error('callback boom');
    const callback = vi.fn().mockRejectedValue(originalError);

    await expect(withTransaction(callback)).rejects.toThrow('callback boom');

    const calls = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
    expect(calls[0]).toBe('BEGIN');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');

    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('ROLLBACK failure does not mask the original callback error', async () => {
    const originalError = new Error('original error');
    const rollbackError = new Error('rollback failed');

    const callback = vi.fn().mockRejectedValue(originalError);

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN succeeds
      .mockRejectedValueOnce(rollbackError); // ROLLBACK throws

    const thrown = await withTransaction(callback).catch((e) => e);

    expect(thrown).toBe(originalError);
    expect(thrown.message).toBe('original error');
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
