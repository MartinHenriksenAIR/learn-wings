import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildPublicUrl } from './storage-url';

describe('buildPublicUrl', () => {
  const originalEnv = import.meta.env.VITE_STORAGE_BASE_URL;

  afterEach(() => {
    vi.stubEnv('VITE_STORAGE_BASE_URL', originalEnv ?? '');
  });

  it('composes base and path with a single separator', () => {
    vi.stubEnv('VITE_STORAGE_BASE_URL', 'https://example.com/storage');
    expect(buildPublicUrl('orgs/123/logo.png')).toBe('https://example.com/storage/orgs/123/logo.png');
  });

  it('strips a trailing slash on the base URL', () => {
    vi.stubEnv('VITE_STORAGE_BASE_URL', 'https://example.com/storage/');
    expect(buildPublicUrl('orgs/123/logo.png')).toBe('https://example.com/storage/orgs/123/logo.png');
  });

  it('strips a leading slash on the path', () => {
    vi.stubEnv('VITE_STORAGE_BASE_URL', 'https://example.com/storage');
    expect(buildPublicUrl('/orgs/123/logo.png')).toBe('https://example.com/storage/orgs/123/logo.png');
  });

  it('strips both slashes when both are present', () => {
    vi.stubEnv('VITE_STORAGE_BASE_URL', 'https://example.com/storage/');
    expect(buildPublicUrl('/orgs/123/logo.png')).toBe('https://example.com/storage/orgs/123/logo.png');
  });

  it('throws when VITE_STORAGE_BASE_URL is empty', () => {
    vi.stubEnv('VITE_STORAGE_BASE_URL', '');
    expect(() => buildPublicUrl('orgs/123/logo.png')).toThrow(/VITE_STORAGE_BASE_URL is not configured/);
  });
});
