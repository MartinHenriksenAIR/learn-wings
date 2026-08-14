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
    mockQueryOne.mockResolvedValueOnce(null);

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
    mockQueryOne.mockResolvedValueOnce({ full_name: 'Alice Smith' });
    mockQueryOne.mockResolvedValueOnce({ title: 'AI Basics' });
    mockQueryOne.mockResolvedValueOnce({ name: 'Acme Corp' });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect((res.headers as Record<string, string>)['Content-Disposition']).toMatch(/certificate/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

});


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

function expectByteAccurateXref(pdf: Buffer): void {
  const text = pdf.toString('latin1');

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

    expect(pdf.includes(Buffer.from([0xf8]))).toBe(true);
    expect(pdf.includes(Buffer.from([0xc3, 0xb8]))).toBe(false);
    expect([...pdf].filter((b) => b >= 0x80)).toEqual([0xf8, 0xd8, 0xe6, 0xc6, 0xf8]);
  });

  it('declares /Encoding /WinAnsiEncoding on all three Type1 fonts', async () => {
    const pdf = await renderCertificate('Alice Smith', 'AI Basics', 'Acme Corp');
    const text = pdf.toString('latin1');

    expect(text).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).toContain('/BaseFont /Courier /Encoding /WinAnsiEncoding');
  });

  it('substitutes ? for characters outside cp1252 without corrupting the file', async () => {
    const pdf = await renderCertificate('李娜', 'AI Basics', 'Acme Corp');

    expect(pdf.toString('latin1')).toContain('(??) Tj');
    expect([...pdf].every((b) => b <= 0x7f)).toBe(true);
    expectByteAccurateXref(pdf);
    expectAccurateStreamLength(pdf);
  });

  it('still escapes PDF string delimiters in dynamic values (#232)', async () => {
    const pdf = await renderCertificate('Bob (Rob) \\ Ø', 'AI Basics', 'Acme Corp');
    const text = pdf.toString('latin1');

    expect(text).toContain('(Bob \\(Rob\\) \\\\ \xd8) Tj');
    expectByteAccurateXref(pdf);
    expectAccurateStreamLength(pdf);
  });

  it('leaves all-ASCII output byte-for-byte as it was before the #273 refactor', async () => {
    const pdf = await renderCertificate('Alice Smith', 'AI Basics', 'Acme Corp');

    const ENCODING_FRAGMENT = ' /Encoding /WinAnsiEncoding';
    const DELTA = 3 * ENCODING_FRAGMENT.length;
    expect(DELTA).toBe(81);

    expect(pdf.length).toBe(2232);
    expect(pdf.length - DELTA).toBe(2151); // == pre-fix main

    const startxref = Number(/\nstartxref\n(\d+)\n%%EOF$/.exec(pdf.toString('latin1'))![1]);
    expect(startxref).toBe(2009);
    expect(startxref - DELTA).toBe(1928); // == pre-fix main

    const text = pdf.toString('latin1');
    const stream = pdf.subarray(text.indexOf('stream\n') + 'stream\n'.length, text.indexOf('\nendstream'));
    expect(stream.length).toBe(1402);
    expect(createHash('sha256').update(stream).digest('hex')).toBe('c8cdb6ea6702ca98245acb88c832c8928ec5061506bc14fad0740a79eac44908');

    expect(createHash('sha256').update(pdf).digest('hex')).toBe('5993d1fd700836fe28ef3c6465a09049e76ab68dd48bb1764bc89947a2f3fb97');
  });
});


function mockBySql(enrollmentOrgName: string, membershipOrgName: string): void {
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (/FROM enrollments e\s+JOIN profiles p/.test(sql)) {
      return { user_id: 'profile-uuid', status: 'completed', course_id: 'c-1', completed_at: '2026-05-01T00:00:00Z' };
    }
    if (/FROM profiles WHERE entra_oid/.test(sql)) return { full_name: 'Alice Smith' };
    if (/FROM courses WHERE id/.test(sql)) return { title: 'AI Basics' };
    if (/JOIN enrollments e ON e\.org_id = o\.id/.test(sql)) return { name: enrollmentOrgName };
    if (/org_memberships/.test(sql)) return { name: membershipOrgName };
    return null;
  });
}

describe('generate-certificate issuer = enrollment org (#354)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up the issuer org keyed by the enrollment id, not by active membership', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'profile-uuid', status: 'completed', course_id: 'c-1', completed_at: '2026-05-01T00:00:00Z' });
    mockQueryOne.mockResolvedValueOnce({ full_name: 'Alice Smith' });
    mockQueryOne.mockResolvedValueOnce({ title: 'AI Basics' });
    mockQueryOne.mockResolvedValueOnce({ name: 'Acme Corp' });

    await handler(baseReq as any, {} as any);

    const [orgSql, orgParams] = mockQueryOne.mock.calls[3];
    expect(orgSql).toMatch(/JOIN enrollments e ON e\.org_id = o\.id/);
    expect(orgSql).not.toMatch(/org_memberships/);
    expect(orgParams).toEqual(['enroll-uuid']);
  });

  it('prints "AI Uddannelse" for a solo (placeholder-org) enrollment', async () => {
    mockBySql('AI Uddannelse', 'Some Other Company');

    const res = await handler(baseReq as any, {} as any);
    const text = (res.body as Buffer).toString('latin1');

    expect(res.status).toBe(200);
    expect(text).toContain('(Offered by AI Uddannelse) Tj');
    expect(text).not.toContain('Some Other Company');
  });

  it('prints the company name for a company enrollment', async () => {
    mockBySql('Globex Industries', 'Wrong Personal Org');

    const res = await handler(baseReq as any, {} as any);
    const text = (res.body as Buffer).toString('latin1');

    expect(res.status).toBe(200);
    expect(text).toContain('(Offered by Globex Industries) Tj');
    expect(text).not.toContain('Wrong Personal Org');
  });
});
