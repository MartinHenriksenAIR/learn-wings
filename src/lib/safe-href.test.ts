import { describe, it, expect } from 'vitest';
import { safeHref } from './safe-href';

// safeHref (sec-1, #232): guards anchor hrefs against stored-XSS. React 18 does
// not neutralize `javascript:` URLs in href (that shipped in React 19), so a
// stored value like `javascript:...` would execute on click. safeHref returns
// the URL only when its scheme is http/https/mailto, else undefined (so the
// anchor gets no href and cannot navigate). These community links are meant to
// be absolute external URLs, so relative/unparseable input is rejected too.

describe('safeHref — allowed schemes', () => {
  it('returns a plain http URL unchanged', () => {
    expect(safeHref('http://example.com/x')).toBe('http://example.com/x');
  });
  it('returns a plain https URL unchanged', () => {
    expect(safeHref('https://example.com/register?a=1#frag')).toBe(
      'https://example.com/register?a=1#frag',
    );
  });
  it('returns a mailto URL unchanged', () => {
    expect(safeHref('mailto:hello@example.com')).toBe('mailto:hello@example.com');
  });
  it('accepts an uppercase scheme (HTTPS://)', () => {
    expect(safeHref('HTTPS://example.com')).toBe('HTTPS://example.com');
  });
  it('trims surrounding whitespace on an otherwise-valid URL', () => {
    expect(safeHref('  https://example.com  ')).toBe('https://example.com');
  });
});

describe('safeHref — unsafe schemes return undefined', () => {
  it('rejects javascript:', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
  });
  it('rejects whitespace-prefixed javascript:', () => {
    expect(safeHref('  javascript:alert(1)')).toBeUndefined();
  });
  it('rejects javascript: with mixed case and tab padding', () => {
    expect(safeHref('\t JavaScript:alert(1)')).toBeUndefined();
  });
  it('rejects data:', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });
  it('rejects vbscript:', () => {
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
  });
  it('rejects blob:', () => {
    expect(safeHref('blob:https://example.com/uuid')).toBeUndefined();
  });
  it('rejects file:', () => {
    expect(safeHref('file:///etc/passwd')).toBeUndefined();
  });
});

describe('safeHref — invalid / empty input returns undefined', () => {
  it('rejects an empty string', () => {
    expect(safeHref('')).toBeUndefined();
  });
  it('rejects a whitespace-only string', () => {
    expect(safeHref('   ')).toBeUndefined();
  });
  it('rejects null', () => {
    expect(safeHref(null)).toBeUndefined();
  });
  it('rejects undefined', () => {
    expect(safeHref(undefined)).toBeUndefined();
  });
  it('rejects a non-string value', () => {
    expect(safeHref(42 as unknown as string)).toBeUndefined();
  });
  it('rejects a relative path (not an absolute URL)', () => {
    expect(safeHref('/foo/bar')).toBeUndefined();
  });
  it('rejects a bare host without a scheme', () => {
    expect(safeHref('example.com/register')).toBeUndefined();
  });
});
