import { describe, it, expect } from 'vitest';
import { getCorsHeaders } from './cors';

describe('getCorsHeaders', () => {
  it('returns allowed origin for known origin', () => {
    const headers = getCorsHeaders('https://ai-uddannelse.dk');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://ai-uddannelse.dk');
  });

  it('returns first allowed origin for unknown origin', () => {
    const headers = getCorsHeaders('https://attacker.com');
    expect(headers['Access-Control-Allow-Origin']).not.toBe('https://attacker.com');
  });

  it('handles null origin', () => {
    const headers = getCorsHeaders(null);
    expect(headers['Access-Control-Allow-Origin']).toBeDefined();
  });
});
