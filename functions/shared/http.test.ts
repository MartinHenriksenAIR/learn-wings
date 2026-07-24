import { describe, it, expect } from 'vitest';
import { pdfResponse } from './http';

// A minimal PDF-shaped payload with a byte >= 0x80 (0xE6 = 'æ' in latin1) —
// exactly the byte class the old `.toString('binary')` body silently corrupted.
const BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0xe6, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);

const headersOf = (res: { headers?: unknown }) => res.headers as Record<string, string>;

describe('pdfResponse', () => {
  it('returns 200 with the PDF content type', () => {
    const res = pdfResponse('https://ai-uddannelse.dk', 'report.pdf', BYTES);
    expect(res.status).toBe(200);
    expect(headersOf(res)['Content-Type']).toBe('application/pdf');
  });

  it('passes the filename through to Content-Disposition', () => {
    const res = pdfResponse(null, 'certificate-AI-Basics.pdf', BYTES);
    expect(headersOf(res)['Content-Disposition']).toBe('attachment; filename="certificate-AI-Basics.pdf"');
  });

  it('leaves an already-safe filename byte-identical (no double-sanitizing)', () => {
    // what generate-compliance-report produces: `ai-act-compliance-report-${Date.now()}.pdf`
    const res = pdfResponse(null, 'ai-act-compliance-report-1753300000000.pdf', BYTES);
    expect(headersOf(res)['Content-Disposition']).toBe('attachment; filename="ai-act-compliance-report-1753300000000.pdf"');
  });

  it('sanitizes a filename that would break or inject into Content-Disposition', () => {
    // a raw course title is the trap: quotes escape the quoted value, CRLF forges a header
    const res = pdfResponse(null, 'AI "Grundkursus" æøå\r\nX-Injected: 1.pdf', BYTES);
    // anchored: proves no CR/LF, no embedded quote and no non-ASCII byte survived
    expect(headersOf(res)['Content-Disposition']).toMatch(/^attachment; filename="[A-Za-z0-9._-]*"$/);
  });

  it('merges the CORS headers for the request origin', () => {
    const res = pdfResponse('https://ai-uddannelse.dk', 'report.pdf', BYTES);
    expect(headersOf(res)['Access-Control-Allow-Origin']).toBe('https://ai-uddannelse.dk');
    expect(headersOf(res)['Access-Control-Allow-Headers']).toBe('authorization, content-type');
  });

  it('does not echo an unknown origin', () => {
    const res = pdfResponse('https://attacker.com', 'report.pdf', BYTES);
    expect(headersOf(res)['Access-Control-Allow-Origin']).not.toBe('https://attacker.com');
  });

  it('round-trips a Buffer body byte-for-byte (magic bytes survive)', () => {
    const res = pdfResponse(null, 'report.pdf', BYTES);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.equals(BYTES)).toBe(true);
  });

  it('round-trips a Uint8Array body byte-for-byte (no latin1 re-encode)', () => {
    const res = pdfResponse(null, 'report.pdf', new Uint8Array(BYTES));
    expect(Buffer.isBuffer(res.body)).toBe(true);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.equals(BYTES)).toBe(true);
    // the high byte is still one byte — the corruption the old string body caused
    expect(body.length).toBe(BYTES.length);
    expect(body[8]).toBe(0xe6);
  });
});
