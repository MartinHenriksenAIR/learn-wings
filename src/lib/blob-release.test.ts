import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCallApi = vi.fn();
vi.mock('./api-client', () => ({ callApi: (...args: unknown[]) => mockCallApi(...args) }));

import { mintedUpload, releaseUpload } from './blob-release';

describe('mintedUpload', () => {
  it('keeps a mint that carries both the path and its token', () => {
    expect(mintedUpload({ blobPath: 'avatars/a.png', releaseToken: 'tok' }))
      .toEqual({ blobPath: 'avatars/a.png', releaseToken: 'tok' });
  });

  it.each([
    ['no token — an older backend that cannot authorize a release', { blobPath: 'avatars/a.png' }],
    ['a null token', { blobPath: 'avatars/a.png', releaseToken: null }],
    ['an empty token', { blobPath: 'avatars/a.png', releaseToken: '' }],
    ['no path', { releaseToken: 'tok' }],
  ])('drops a mint with %s', (_label, response) => {
    expect(mintedUpload(response)).toBeNull();
  });
});

describe('releaseUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockResolvedValue({ released: true });
  });

  it('posts the path and token to the release endpoint', () => {
    releaseUpload({ blobPath: 'avatars/a.png', releaseToken: 'tok' });

    expect(mockCallApi).toHaveBeenCalledWith('/api/blob-release', {
      blobPath: 'avatars/a.png',
      releaseToken: 'tok',
    });
  });

  it('does nothing when there is no mint to release', () => {
    releaseUpload(null);
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('swallows a failed release — reclaiming is best-effort, the sweep is the backstop', async () => {
    mockCallApi.mockRejectedValue(new Error('network down'));

    expect(() => releaseUpload({ blobPath: 'avatars/a.png', releaseToken: 'tok' })).not.toThrow();
    await Promise.resolve();
  });
});
