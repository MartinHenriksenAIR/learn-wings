import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and env before import
vi.mock('../shared/db', () => ({
  queryOne: vi.fn().mockResolvedValue({ is_platform_admin: true }),
}));
process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
process.env.ALLOWED_ORIGINS = 'https://ai-uddannelse.dk';

import { default as handler } from './index';

describe('azure-upload-url', () => {
  it('returns uploadUrl, blobPath, contentType for admin user', async () => {
    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'authorization' ? 'Bearer valid.test.token' : k === 'origin' ? 'https://ai-uddannelse.dk' : null },
      json: async () => ({ fileName: 'test-video.mp4', contentType: 'video/mp4' }),
    };
    // inject mock user — will be replaced by real auth in Task 11
    (req as any)._mockUser = { id: 'user-uuid', email: 'admin@test.com' };
    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toMatch(/https:\/\/testaccount\.blob\.core\.windows\.net/);
    expect(body.blobPath).toMatch(/\.mp4$/);
    expect(body.contentType).toBe('video/mp4');
  });
});
