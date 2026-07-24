import { createHash } from 'node:crypto';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'learner@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ enrollmentId: 'enroll-uuid' }),
};

describe('generate-certificate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if enrollment does not belong to the user', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no enrollment found for this user

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns 400 if course is not completed', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'profile-uuid', status: 'in_progress', course_id: 'c-1' });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(400);
  });

  it('returns a %PDF- Buffer with correct headers when enrollment is completed', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'profile-uuid', status: 'completed', course_id: 'c-1', completed_at: '2026-05-01T00:00:00Z' });
    // Promise.all: profile, course, org
    mockQueryOne.mockResolvedValueOnce({ full_name: 'Alice Smith' });
    mockQueryOne.mockResolvedValueOnce({ title: 'AI Basics' });
    mockQueryOne.mockResolvedValueOnce({ name: 'Acme Corp' });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect((res.headers as Record<string, string>)['Content-Disposition']).toMatch(/certificate/);
    // the body itself, not just the envelope: a raw Buffer (never a latin1 string) of real PDF bytes
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

});

// ---------------------------------------------------------------------------
// #273 — the PDF was assembled as a JS string and measured with String.length
// (UTF-16 code units) but emitted as UTF-8 bytes. Every character >= 0x80 made
// the two diverge, so the xref table, `startxref` and the content-stream
// `/Length` all pointed at the wrong byte positions the moment a Danish `æøå`
// appeared. ASCII hid the bug because there the two counts are equal.
//
// These tests measure the emitted BYTES, never the decoded characters. They
// decode with 'latin1' purely as a byte-inspection convenience: latin1 is the
// one encoding that is always exactly 1 byte -> 1 char, so a string index into
// the decoded text IS the byte offset. Decoding as 'utf8' here would silently
// reintroduce the very confusion under test.
// ---------------------------------------------------------------------------

async function renderCertificate(full_name: string, title: string, name: string): Promise<Buffer> {
  mockQueryOne.mockResolvedValueOnce({ user_id: 'profile-uuid', status: 'completed', course_id: 'c-1', completed_at: '2026-05-01T00:00:00Z' });
  mockQueryOne.mockResolvedValueOnce({ full_name });
  mockQueryOne.mockResolvedValueOnce({ title });
  mockQueryOne.mockResolvedValueOnce({ name });

  const res = await handler(baseReq as any, {} as any);

  expect(res.status).toBe(200);
  expect(Buffer.isBuffer(res.body)).toBe(true);
  return res.body as Buffer;
}

/**
 * Assert the cross-reference table is byte-accurate: the `startxref` the trailer
 * declares must land on the `xref` keyword, and every entry must land on the
 * first byte of the object it indexes. This is the assertion the pre-fix code
 * fails for any non-ASCII name.
 */
function expectByteAccurateXref(pdf: Buffer): void {
  const text = pdf.toString('latin1');

  // `\nxref\n` matches only the table itself — the trailer's occurrence is
  // preceded by `start`, not by a newline.
  const actualXrefOffset = text.lastIndexOf('\nxref\n') + 1;
  expect(actualXrefOffset).toBeGreaterThan(0);

  const declared = /\nstartxref\n(\d+)\n%%EOF$/.exec(text);
  expect(declared).not.toBeNull();
  expect(Number(declared![1])).toBe(actualXrefOffset);

  const entries = [...text.slice(actualXrefOffset).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  expect(entries).toHaveLength(7);
  entries.forEach((offset, i) => {
    expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
}

/** Assert the declared `/Length` equals the real byte length of the stream. */
function expectAccurateStreamLength(pdf: Buffer): void {
  const text = pdf.toString('latin1');

  const declared = /\/Length (\d+) >>\nstream\n/.exec(text);
  expect(declared).not.toBeNull();

  const start = text.indexOf('stream\n') + 'stream\n'.length;
  const end = text.indexOf('\nendstream');
  expect(end).toBeGreaterThan(start);
  expect(end - start).toBe(Number(declared![1]));
}

describe('generate-certificate PDF byte accounting (#273)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the xref table byte-accurate for a Danish name, course and org', async () => {
    const pdf = await renderCertificate('Søren Ølsen', 'Grundlæggende AI', 'Ærø Akademi');

    expectByteAccurateXref(pdf);
  });

  it('declares a byte-accurate content-stream /Length for a Danish certificate', async () => {
    const pdf = await renderCertificate('Søren Ølsen', 'Grundlæggende AI', 'Ærø Akademi');

    expectAccurateStreamLength(pdf);
  });

  it('keeps the same invariants for an all-ASCII certificate', async () => {
    const pdf = await renderCertificate('Alice Smith', 'AI Basics', 'Acme Corp');

    expectByteAccurateXref(pdf);
    expectAccurateStreamLength(pdf);
  });

  it('emits Danish characters as single WinAnsi bytes, not UTF-8 pairs', async () => {
    const pdf = await renderCertificate('Søren Ølsen', 'Grundlæggende AI', 'Ærø Akademi');

    // ø = 0xF8 in cp1252/WinAnsi; as UTF-8 it would be the pair 0xC3 0xB8.
    expect(pdf.includes(Buffer.from([0xf8]))).toBe(true);
    expect(pdf.includes(Buffer.from([0xc3, 0xb8]))).toBe(false);
    // Every byte >= 0x80 in the whole document, in order: ø Ø æ Æ ø.
    expect([...pdf].filter((b) => b >= 0x80)).toEqual([0xf8, 0xd8, 0xe6, 0xc6, 0xf8]);
  });

  it('declares /Encoding /WinAnsiEncoding on all three Type1 fonts', async () => {
    const pdf = await renderCertificate('Alice Smith', 'AI Basics', 'Acme Corp');
    const text = pdf.toString('latin1');

    // Without this the fonts fall back to StandardEncoding, which has no glyph
    // at 0xF8 — correct offsets but an unreadable `ø`.
    expect(text).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).toContain('/BaseFont /Courier /Encoding /WinAnsiEncoding');
  });

  it('substitutes ? for characters outside cp1252 without corrupting the file', async () => {
    const pdf = await renderCertificate('李娜', 'AI Basics', 'Acme Corp');

    // Documented degradation: 1 unrepresentable code point -> 1 `?` byte, so
    // the file stays valid and the glyph loss is visible rather than silent.
    expect(pdf.toString('latin1')).toContain('(??) Tj');
    expect([...pdf].every((b) => b <= 0x7f)).toBe(true);
    expectByteAccurateXref(pdf);
    expectAccurateStreamLength(pdf);
  });

  it('still escapes PDF string delimiters in dynamic values (#232)', async () => {
    const pdf = await renderCertificate('Bob (Rob) \\ Ø', 'AI Basics', 'Acme Corp');
    const text = pdf.toString('latin1');

    // Escaping must happen BEFORE the WinAnsi fold, and both before measuring.
    expect(text).toContain('(Bob \\(Rob\\) \\\\ \xd8) Tj');
    expectByteAccurateXref(pdf);
    expectAccurateStreamLength(pdf);
  });

  it('leaves all-ASCII output byte-for-byte as it was before the #273 refactor', async () => {
    const pdf = await renderCertificate('Alice Smith', 'AI Basics', 'Acme Corp');

    // Pre-fix `main` produced, for exactly these inputs: 2151 bytes, startxref
    // 1928, sha256 f4569e16b1e5b3a90c5de28bb2e3cf4e8e194b835384a3620ae5d6932d190ecf.
    // The Buffer/byte-length rewrite reproduced those bytes EXACTLY (verified in
    // isolation before the encoding change landed). The only intentional delta
    // is the `/Encoding /WinAnsiEncoding` added to each of the three font
    // objects: 3 x 27 bytes, which shifts nothing but the trailing offsets.
    const ENCODING_FRAGMENT = ' /Encoding /WinAnsiEncoding';
    const DELTA = 3 * ENCODING_FRAGMENT.length;
    expect(DELTA).toBe(81);

    expect(pdf.length).toBe(2232);
    expect(pdf.length - DELTA).toBe(2151); // == pre-fix main

    const startxref = Number(/\nstartxref\n(\d+)\n%%EOF$/.exec(pdf.toString('latin1'))![1]);
    expect(startxref).toBe(2009);
    expect(startxref - DELTA).toBe(1928); // == pre-fix main

    // The content stream carries every drawn glyph; for ASCII input it is
    // unchanged in both length and content from what main emitted.
    const text = pdf.toString('latin1');
    const stream = pdf.subarray(text.indexOf('stream\n') + 'stream\n'.length, text.indexOf('\nendstream'));
    expect(stream.length).toBe(1402);
    expect(createHash('sha256').update(stream).digest('hex')).toBe('c8cdb6ea6702ca98245acb88c832c8928ec5061506bc14fad0740a79eac44908');

    // Whole-document pin, so any future drift is a deliberate, reviewed edit.
    expect(createHash('sha256').update(pdf).digest('hex')).toBe('5993d1fd700836fe28ef3c6465a09049e76ab68dd48bb1764bc89947a2f3fb97');
  });
});
