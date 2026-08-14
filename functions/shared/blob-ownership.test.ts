import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('./db', () => ({ query: mockQuery }));

import { assertBindablePaths, isBlobReleasable, releasablePaths } from './blob-ownership';
import type { UploadCandidate } from './upload-limits';

const REJECTION = 'Invalid upload path';

const referencedByNobody = () => mockQuery.mockResolvedValue([]);
const referencedBySomeone = (...paths: string[]) =>
  mockQuery.mockResolvedValue(paths.map((path) => ({ path })));

const avatar = (path: string | null | undefined): UploadCandidate =>
  ({ path, kind: 'image', family: 'avatar' });
const orgLogo = (path: string | null | undefined): UploadCandidate =>
  ({ path, kind: 'image', family: 'org-logo' });
const thumbnail = (path: string | null | undefined): UploadCandidate =>
  ({ path, kind: 'image', family: 'lms' });
const video = (path: string | null | undefined): UploadCandidate =>
  ({ path, kind: 'video', family: 'lms' });
const document = (path: string | null | undefined): UploadCandidate =>
  ({ path, kind: 'document', family: 'lms' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  referencedByNobody();
});

describe('assertBindablePaths — the shape gate', () => {
  it('accepts a freshly minted path in the column own family', async () => {
    await expect(assertBindablePaths([avatar('avatars/abc.png')])).resolves.toBeNull();
    await expect(assertBindablePaths([orgLogo('org-logos/abc.png')])).resolves.toBeNull();
    await expect(assertBindablePaths([thumbnail('abc.png')])).resolves.toBeNull();
    await expect(assertBindablePaths([video('abc.mp4')])).resolves.toBeNull();
    await expect(assertBindablePaths([document('documents/abc.pdf')])).resolves.toBeNull();
  });

  it('refuses a lesson video path posted to avatar_url', async () => {
    await expect(assertBindablePaths([avatar('someone-elses-lesson.mp4')])).resolves.toBe(REJECTION);
  });

  it('refuses an org logo path posted to avatar_url, and an avatar posted to logo_url', async () => {
    await expect(assertBindablePaths([avatar('org-logos/acme.png')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([orgLogo('avatars/victim.png')])).resolves.toBe(REJECTION);
  });

  it('refuses a branding path posted to a lesson or course column', async () => {
    await expect(assertBindablePaths([thumbnail('avatars/victim.png')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([video('org-logos/acme.png')])).resolves.toBe(REJECTION);
  });

  it('refuses an out-of-family path without a database round trip', async () => {
    await expect(assertBindablePaths([avatar('someone-elses-lesson.mp4')])).resolves.toBe(REJECTION);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('reference-checks a LEGACY multi-segment name instead of waving it through', async () => {
    referencedBySomeone('videos/victim.mp4');
    await expect(assertBindablePaths([video('videos/victim.mp4')])).resolves.toBe(REJECTION);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('accepts a legacy multi-segment name that no row references', async () => {
    referencedByNobody();
    await expect(assertBindablePaths([thumbnail('thumbnails/legacy.png')])).resolves.toBeNull();
    await expect(assertBindablePaths([thumbnail('lms-assets/legacy thumb.png')])).resolves.toBeNull();
  });

  it('refuses traversal and nested shapes', async () => {
    await expect(assertBindablePaths([avatar('avatars/../lessons/secret.mp4')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([avatar('avatars/..')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([avatar('avatars/sub/deep.png')])).resolves.toBe(REJECTION);
  });

  it('refuses a path whose extension does not match the column kind', async () => {
    await expect(assertBindablePaths([thumbnail('abc.mp4')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([video('abc.png')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([document('documents/abc.mp4')])).resolves.toBe(REJECTION);
  });

  it('refuses an .svg avatar even though the shape is perfect', async () => {
    await expect(assertBindablePaths([avatar('avatars/evil.svg')])).resolves.toBe(REJECTION);
  });

  it('gives every rejection the SAME message, whatever the reason', async () => {
    const outOfFamily = await assertBindablePaths([avatar('someone-elses-lesson.mp4')]);
    const wrongKind = await assertBindablePaths([thumbnail('abc.mp4')]);
    referencedBySomeone('avatars/victim.png');
    const claimed = await assertBindablePaths([avatar('avatars/victim.png')]);
    expect([outOfFamily, wrongKind, claimed]).toEqual([REJECTION, REJECTION, REJECTION]);
  });

  it('allows an absolute external URL without reference-checking it', async () => {
    await expect(assertBindablePaths([orgLogo('https://example.com/logo.png')])).resolves.toBeNull();
    await expect(assertBindablePaths([thumbnail('https://cdn.example.com/x')])).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lets a row keep the value it already holds without any check at all', async () => {
    await expect(
      assertBindablePaths(
        [thumbnail('lms-assets/legacy thumb.png')],
        ['lms-assets/legacy thumb.png'],
      ),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('exempts a stored value even when a rule added later would refuse its shape', async () => {
    await expect(
      assertBindablePaths([avatar('avatars/sub/deep.png')], ['avatars/sub/deep.png']),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignores null, undefined and empty candidates entirely', async () => {
    await expect(
      assertBindablePaths([avatar(null), thumbnail(undefined), video('')]),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('assertBindablePaths — the cross-row claim gate', () => {
  it('refuses a path another row already references', async () => {
    referencedBySomeone('avatars/victim.png');
    await expect(assertBindablePaths([avatar('avatars/victim.png')])).resolves.toBe(REJECTION);
  });

  it('refuses another org live logo (readable by any learner via /organizations)', async () => {
    referencedBySomeone('org-logos/other-org.png');
    await expect(assertBindablePaths([orgLogo('org-logos/other-org.png')])).resolves.toBe(REJECTION);
  });

  it('refuses another course live thumbnail within the flat namespace', async () => {
    referencedBySomeone('other-course-thumb.png');
    await expect(assertBindablePaths([thumbnail('other-course-thumb.png')])).resolves.toBe(REJECTION);
  });

  it('accepts a path no row references (a genuinely fresh upload)', async () => {
    referencedByNobody();
    await expect(assertBindablePaths([avatar('avatars/fresh.png')])).resolves.toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('asks the database about EVERY column that can hold a blob path', async () => {
    await assertBindablePaths([avatar('avatars/fresh.png')]);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    for (const column of [
      'video_storage_path', 'azure_blob_path', 'document_storage_path',
      'thumbnail_url', 'logo_url', 'avatar_url',
    ]) {
      expect(sql).toContain(column);
    }
    expect(params).toEqual([['avatars/fresh.png']]);
  });

  it('skips a path already on THIS row — re-saving is free and never refused', async () => {
    await expect(
      assertBindablePaths([avatar('avatars/keep.png')], ['avatars/keep.png']),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('skips a path that merely MOVED between columns of the same row', async () => {
    await expect(
      assertBindablePaths([video('same.mp4')], [null, 'same.mp4', null]),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('asks about each distinct path once, in a single query', async () => {
    await assertBindablePaths([video('a.mp4'), video('a.mp4'), document('documents/b.pdf')]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual([['a.mp4', 'documents/b.pdf']]);
  });

  it('fails CLOSED when the reference query throws', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    await expect(assertBindablePaths([avatar('avatars/fresh.png')])).rejects.toThrow('connection refused');
  });
});

describe('isBlobReleasable', () => {
  it('releases a path in its own family that no row references', async () => {
    referencedByNobody();
    await expect(isBlobReleasable('avatars/old.png', 'avatar')).resolves.toBe(true);
  });

  it('refuses to release a path some row still references', async () => {
    referencedBySomeone('avatars/shared.png');
    await expect(isBlobReleasable('avatars/shared.png', 'avatar')).resolves.toBe(false);
  });

  it('refuses to release an out-of-family path', async () => {
    await expect(isBlobReleasable('someone-elses-lesson.mp4', 'avatar')).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses to release an absolute external URL, without asking the database', async () => {
    await expect(isBlobReleasable('https://example.com/logo.png', 'org-logo')).resolves.toBe(false);
    await expect(isBlobReleasable('https://acct.blob.core.windows.net/lms-videos/x.mp4', 'lms')).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('releases a legacy multi-segment path only when no row references it', async () => {
    referencedBySomeone('videos/shared.mp4');
    await expect(isBlobReleasable('videos/shared.mp4', 'lms')).resolves.toBe(false);
    referencedByNobody();
    await expect(isBlobReleasable('thumbnails/superseded.png', 'lms')).resolves.toBe(true);
  });

  it('refuses to release an empty value', async () => {
    await expect(isBlobReleasable('', 'avatar')).resolves.toBe(false);
  });

  it('fails SAFE when the reference query throws — an unanswered question is not a delete', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    await expect(isBlobReleasable('avatars/old.png', 'avatar')).resolves.toBe(false);
  });
});

describe('releasablePaths — the batched release gate the cascade deletes use', () => {
  it('returns the unreferenced paths in first-occurrence order', async () => {
    referencedByNobody();
    await expect(releasablePaths(['a.mp4', 'documents/b.pdf', 'c.png'], 'lms'))
      .resolves.toEqual(['a.mp4', 'documents/b.pdf', 'c.png']);
  });

  it('drops ONLY the paths another row still references', async () => {
    referencedBySomeone('shared.mp4');
    await expect(releasablePaths(['shared.mp4', 'own.mp4'], 'lms'))
      .resolves.toEqual(['own.mp4']);
  });

  it('asks about the whole batch in ONE query, each distinct path once', async () => {
    referencedByNobody();
    await expect(releasablePaths(['a.mp4', 'a.mp4', 'b.mp4'], 'lms'))
      .resolves.toEqual(['a.mp4', 'b.mp4']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual([['a.mp4', 'b.mp4']]);
  });

  it('drops nulls, undefined and empty strings without asking anything', async () => {
    await expect(releasablePaths([null, undefined, ''], 'lms')).resolves.toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('drops out-of-family values and absolute URLs before the query', async () => {
    referencedByNobody();
    await expect(
      releasablePaths(['https://cdn.example.com/x.png', 'avatars/victim.png', 'keep.png'], 'lms'),
    ).resolves.toEqual(['keep.png']);
    expect(mockQuery.mock.calls[0][1]).toEqual([['keep.png']]);
  });

  it('fails SAFE as a UNIT — one unanswered query releases nothing at all', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    await expect(releasablePaths(['a.mp4', 'b.mp4'], 'lms')).resolves.toEqual([]);
  });
});

describe('the two-step attack of #275 (bind a victim path, then clear it)', () => {
  it('cannot get past step 1, so step 2 never has anything to delete', async () => {
    const victimPath = 'avatars/victim.png';

    referencedBySomeone(victimPath);
    await expect(assertBindablePaths([avatar(victimPath)], [null])).resolves.toBe(REJECTION);

    await expect(isBlobReleasable(victimPath, 'avatar')).resolves.toBe(false);
  });
});
