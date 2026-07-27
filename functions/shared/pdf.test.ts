import { describe, it, expect } from 'vitest';

import { pdfString } from './pdf';

// In a PDF content stream, '(' ')' and '\' are delimiters: an unescaped one
// closes the string literal early and lets following bytes be read as PDF
// operators. pdfString() neutralises them. Backslash MUST be escaped first,
// otherwise the backslashes we add for the parens would themselves be doubled.
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
    // input:  a )  \  ( b   →   a \) \\ \( b
    expect(pdfString('a)\\(b')).toBe('a\\)\\\\\\(b');
  });

  it('leaves a plain string unchanged', () => {
    expect(pdfString('Marketing Department')).toBe('Marketing Department');
  });

  it('leaves the empty string unchanged', () => {
    expect(pdfString('')).toBe('');
  });
});
