// Tests for #80: PLATFORM_BASE_URL must be env-driven with an origin fallback,
// so invite links minted on a preview environment point at the preview, not prod.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolvePlatformBaseUrl } from './config';

describe('resolvePlatformBaseUrl', () => {
  it('falls back to the origin when the env var is unset', () => {
    expect(resolvePlatformBaseUrl(undefined, 'https://preview.example.test')).toBe(
      'https://preview.example.test'
    );
  });

  it('falls back to the origin when the env var is an empty string', () => {
    expect(resolvePlatformBaseUrl('', 'https://preview.example.test')).toBe(
      'https://preview.example.test'
    );
  });

  it('prefers the env var over the origin when set', () => {
    expect(resolvePlatformBaseUrl('https://ai-uddannelse.dk', 'https://preview.example.test')).toBe(
      'https://ai-uddannelse.dk'
    );
  });

  it('strips trailing slashes so link paths concatenate cleanly', () => {
    expect(resolvePlatformBaseUrl('https://ai-uddannelse.dk/', 'unused')).toBe(
      'https://ai-uddannelse.dk'
    );
  });
});

describe('PLATFORM_BASE_URL / getInviteLink (module wiring)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('mints invite links on the current origin when VITE_PLATFORM_BASE_URL is unset', async () => {
    vi.stubEnv('VITE_PLATFORM_BASE_URL', undefined);
    vi.resetModules();

    const { getInviteLink, PLATFORM_BASE_URL } = await import('./config');

    expect(PLATFORM_BASE_URL).toBe(window.location.origin);
    expect(getInviteLink('abc-123')).toBe(`${window.location.origin}/signup?invite=abc-123`);
  });

  it('mints invite links on the pinned env URL when VITE_PLATFORM_BASE_URL is set', async () => {
    vi.stubEnv('VITE_PLATFORM_BASE_URL', 'https://ai-uddannelse.dk');
    vi.resetModules();

    const { getInviteLink } = await import('./config');

    expect(getInviteLink('abc-123')).toBe('https://ai-uddannelse.dk/signup?invite=abc-123');
  });
});
