import { describe, it, expect } from 'vitest';

import { pdfString } from './pdf';

describe('pdfString', () => {
  it('escapes a closing paren', () => {
    expect(pdfString('a)b')).toBe('a\\)b');
  });

  it('escapes an opening paren', () => {
    expect(pdfString('a(b')).toBe('a\\(b');
  });

  it('escapes a backslash', () => {
    expect(pdfString('a\\b')).toBe('a\\\\b');
  });

  it('escapes a combined value without double-escaping the backslash', () => {
    expect(pdfString('a)\\(b')).toBe('a\\)\\\\\\(b');
  });

  it('leaves a plain string unchanged', () => {
    expect(pdfString('Marketing Department')).toBe('Marketing Department');
  });

  it('leaves the empty string unchanged', () => {
    expect(pdfString('')).toBe('');
  });
});
