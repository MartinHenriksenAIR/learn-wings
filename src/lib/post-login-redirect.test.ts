import { describe, it, expect, beforeEach } from 'vitest';
import {
  savePostLoginRedirect,
  consumePostLoginRedirect,
  clearPostLoginRedirect,
} from './post-login-redirect';

// post-login-redirect (sec-4, #244): the stored URL is fed straight into
// react-router's navigate(), so an attacker-controlled value must never be able
// to leave the SPA. react-router 6.x still carries an open-redirect bypass via
// backslash (CVE-2025-68470 / GHSA-wrjc-x8rr-h8h6, fixed only in v7), so this
// guard is our independent line of defence: browsers normalize '\' to '/', so
// '/\evil.com' and '//evil.com' both resolve to an external origin. Only a
// single-slash in-app path with no backslashes or control chars is accepted.
// The guard is exercised through the public save/consume round-trip (the only
// surface that reaches navigate()).

beforeEach(() => {
  sessionStorage.clear();
});

describe('post-login-redirect — accepted in-app paths round-trip', () => {
  it('stores and returns a plain absolute path', () => {
    savePostLoginRedirect('/dashboard');
    expect(consumePostLoginRedirect()).toBe('/dashboard');
  });
  it('stores and returns a path with a query string', () => {
    savePostLoginRedirect('/courses?tab=x');
    expect(consumePostLoginRedirect()).toBe('/courses?tab=x');
  });
  it('stores and returns a path with a hash fragment', () => {
    savePostLoginRedirect('/courses/42#section');
    expect(consumePostLoginRedirect()).toBe('/courses/42#section');
  });
  it('consume clears the stored value (single-use)', () => {
    savePostLoginRedirect('/dashboard');
    expect(consumePostLoginRedirect()).toBe('/dashboard');
    expect(consumePostLoginRedirect()).toBeNull();
  });
});

describe('post-login-redirect — off-SPA / malicious targets are rejected', () => {
  const rejected: Array<[string, string]> = [
    ['protocol-relative //evil.com', '//evil.com'],
    ['backslash after slash /\\evil.com', '/\\evil.com'],
    ['bare backslash \\evil', '\\evil'],
    ['double backslash /\\\\evil.com', '/\\\\evil.com'],
    ['control char (newline) in path', '/foo\nbar'],
    ['control char (tab) in path', '/foo\tbar'],
    ['control char (NUL) in path', '/foo\x00bar'],
    ['relative path (no leading slash)', 'dashboard'],
    ['absolute http URL', 'http://evil.com'],
    ['empty string', ''],
  ];

  it.each(rejected)('does not store %s', (_label, url) => {
    savePostLoginRedirect(url);
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('does not return a value that was somehow stored but is unsafe', () => {
    // Simulate a poisoned sessionStorage entry (guard also runs on read).
    sessionStorage.setItem('postLoginRedirect', '/\\evil.com');
    expect(consumePostLoginRedirect()).toBeNull();
  });
});

describe('post-login-redirect — empty / absent state handled gracefully', () => {
  it('returns null when nothing is stored', () => {
    expect(consumePostLoginRedirect()).toBeNull();
  });
  it('clear removes any stored value', () => {
    savePostLoginRedirect('/dashboard');
    clearPostLoginRedirect();
    expect(consumePostLoginRedirect()).toBeNull();
  });
});
