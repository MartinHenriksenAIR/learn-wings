import { describe, it, expect } from 'vitest';
import { buildUpdateSet } from './update-builder';

const ALLOWED = new Set(['title', 'url', 'is_pinned', 'tags']);

describe('buildUpdateSet — shape check', () => {
  it('rejects null updates', () => {
    const r = buildUpdateSet(null, ALLOWED);
    expect(r).toEqual({ ok: false, error: 'updates must be an object' });
  });

  it('rejects undefined updates', () => {
    const r = buildUpdateSet(undefined, ALLOWED);
    expect(r).toEqual({ ok: false, error: 'updates must be an object' });
  });

  it('rejects an array (typeof array is "object")', () => {
    const r = buildUpdateSet(['title'], ALLOWED);
    expect(r).toEqual({ ok: false, error: 'updates must be an object' });
  });

  it('rejects a primitive', () => {
    expect(buildUpdateSet('title', ALLOWED)).toEqual({ ok: false, error: 'updates must be an object' });
    expect(buildUpdateSet(42, ALLOWED)).toEqual({ ok: false, error: 'updates must be an object' });
  });

  it('honors a custom notObjectError message', () => {
    const r = buildUpdateSet(null, ALLOWED, { notObjectError: 'bad shape' });
    expect(r).toEqual({ ok: false, error: 'bad shape' });
  });
});

describe('buildUpdateSet — whitelist enforcement (unknown key → error)', () => {
  it('rejects the first unknown key', () => {
    const r = buildUpdateSet({ user_id: 'evil', org_id: 'other' }, ALLOWED);
    expect(r).toEqual({ ok: false, error: 'Invalid update field: user_id' });
  });

  it('rejects a whitelisted key mixed with an unknown key', () => {
    const r = buildUpdateSet({ title: 'ok', user_id: 'evil' }, ALLOWED);
    expect(r).toEqual({ ok: false, error: 'Invalid update field: user_id' });
  });

  it('honors a custom unknownKeyError factory', () => {
    const r = buildUpdateSet({ nope: 1 }, ALLOWED, {
      unknownKeyError: (k) => `not allowed: ${k}`,
    });
    expect(r).toEqual({ ok: false, error: 'not allowed: nope' });
  });
});

describe('buildUpdateSet — empty after check', () => {
  it('rejects an empty object', () => {
    const r = buildUpdateSet({}, ALLOWED);
    expect(r).toEqual({ ok: false, error: 'No update fields provided' });
  });

  it('honors a custom emptyError message', () => {
    const r = buildUpdateSet({}, ALLOWED, { emptyError: 'No valid update fields provided' });
    expect(r).toEqual({ ok: false, error: 'No valid update fields provided' });
  });
});

describe('buildUpdateSet — SET clause + param indexing', () => {
  it('builds a single clause at $1', () => {
    const r = buildUpdateSet({ title: 'new' }, ALLOWED);
    expect(r).toEqual({ ok: true, setClauses: ['title = $1'], params: ['new'] });
  });

  it('builds multiple clauses in body key order with sequential placeholders', () => {
    const r = buildUpdateSet({ title: 'new', url: 'https://x', is_pinned: true }, ALLOWED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setClauses).toEqual(['title = $1', 'url = $2', 'is_pinned = $3']);
    expect(r.params).toEqual(['new', 'https://x', true]);
  });

  it('preserves null values as params (not dropped)', () => {
    const r = buildUpdateSet({ url: null, title: 'x' }, ALLOWED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setClauses).toEqual(['url = $1', 'title = $2']);
    expect(r.params).toEqual([null, 'x']);
  });

  it('only the whitelisted literal key name is interpolated (injection-safety invariant)', () => {
    // The value carries a SQL-looking string but never reaches the clause text —
    // only the key name (a whitelisted literal) is interpolated.
    const r = buildUpdateSet({ title: "'; DROP TABLE x; --" }, ALLOWED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setClauses).toEqual(['title = $1']);
    expect(r.params).toEqual(["'; DROP TABLE x; --"]);
  });

  it('caller appends the id param: placeholder = params.length after push', () => {
    // Mirrors how all three endpoints build the final UPDATE: they push the id
    // onto params and read params.length for the WHERE placeholder.
    const r = buildUpdateSet({ title: 'a', url: 'b' }, ALLOWED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.params.push('id-123');
    const idIndex = r.params.length;
    expect(idIndex).toBe(3);
    expect(`WHERE id = $${idIndex}`).toBe('WHERE id = $3');
    expect(r.params).toEqual(['a', 'b', 'id-123']);
  });
});

describe('buildUpdateSet — transform hook', () => {
  it('applies the transform to the stored param value, not the key name', () => {
    const r = buildUpdateSet(
      { title: '  Trim Me  ', url: 'https://x' },
      ALLOWED,
      { transform: (key, value) => (key === 'title' ? (value as string).trim() : value) },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Key name unchanged; value transformed.
    expect(r.setClauses).toEqual(['title = $1', 'url = $2']);
    expect(r.params).toEqual(['Trim Me', 'https://x']);
  });

  it('passes untransformed keys through unchanged', () => {
    const r = buildUpdateSet(
      { url: 'https://x' },
      ALLOWED,
      { transform: (key, value) => (key === 'title' ? 'never' : value) },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params).toEqual(['https://x']);
  });
});
