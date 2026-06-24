import { describe, it, expect, vi } from 'vitest';
import { internalError } from './errors';

describe('internalError', () => {
  it('returns a 500 with the constant generic body', () => {
    const ctx = { error: vi.fn() };
    const res = internalError(ctx, 'https://ai-uddannelse.dk', new Error('relation "profiles" does not exist'));
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  it('never leaks the exception message or stack into the body', () => {
    const ctx = { error: vi.fn() };
    const err = new Error('connection refused at db.internal:5432');
    const res = internalError(ctx, null, err);
    expect(res.body as string).not.toContain('connection refused');
    expect(res.body as string).not.toContain('db.internal');
    expect(res.body as string).not.toContain('at ');
  });

  it('logs the real error message and stack on the invocation context', () => {
    const ctx = { error: vi.fn() };
    const err = new Error('FK violation on enrollments.course_id');
    internalError(ctx, null, err);
    expect(ctx.error).toHaveBeenCalledTimes(1);
    const logged = ctx.error.mock.calls[0][0] as string;
    expect(logged).toContain('FK violation on enrollments.course_id');
    expect(logged).toContain(err.stack as string);
  });

  it('stringifies non-Error throwables for the log, body stays generic', () => {
    const ctx = { error: vi.fn() };
    const res = internalError(ctx, null, 'raw string failure');
    expect(ctx.error).toHaveBeenCalledWith(expect.stringContaining('raw string failure'));
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  it('carries CORS headers for the requesting origin', () => {
    const ctx = { error: vi.fn() };
    const res = internalError(ctx, 'https://ai-uddannelse.dk', new Error('boom'));
    expect(res.headers).toMatchObject({ 'Access-Control-Allow-Origin': 'https://ai-uddannelse.dk' });
  });
});
