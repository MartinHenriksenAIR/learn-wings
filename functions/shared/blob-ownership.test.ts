import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

// Only the database is mocked — the classification logic under test is the real
// thing, as is `classifyBlobPath` from ./blob.
vi.mock('./db', () => ({ query: mockQuery }));

import { assertBindablePaths, isBlobReleasable } from './blob-ownership';
import type { UploadCandidate } from './upload-limits';

const REJECTION = 'Invalid upload path';

/** No row references anything we ask about. */
const referencedByNobody = () => mockQuery.mockResolvedValue([]);
/** Some other row references every path we ask about. */
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

  // BLOCKER 1, at its root: profile-update is `endpoint()`, so ANY authenticated
  // user reaches it, and `course-player-data` hands every lesson path to any
  // active org member. Posting one here used to be enough to aim the storage
  // probe — and then the refused-upload delete — at a course video.
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
    // The refusal is a pure string check: it costs nothing, and it lands before
    // the endpoint reaches either the reference query or storage.
    await expect(assertBindablePaths([avatar('someone-elses-lesson.mp4')])).resolves.toBe(REJECTION);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('reference-checks a LEGACY multi-segment name instead of waving it through', async () => {
    // The hole an earlier cut of this left open: `videos/<uuid>.mp4` is a name
    // `deleteBlob` resolves perfectly well, so treating it as
    // unrecognized-and-therefore-harmless would let it be bound to a second row
    // and then destroyed by a cascade delete. It must reach the claim check.
    referencedBySomeone('videos/victim.mp4');
    await expect(assertBindablePaths([video('videos/victim.mp4')])).resolves.toBe(REJECTION);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('accepts a legacy multi-segment name that no row references', async () => {
    // The other half: refusing these on shape bricked real rows. `CourseEditor`
    // re-persists `extractLmsAssetPath(<signed url>)`, which for a legacy
    // thumbnail yields `thumbnails/x.png`; a 400 would block saving the course's
    // title and description too.
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
    // The flat namespace makes `<uuid>.mp4` and `<uuid>.png` shape-identical, so
    // the extension is the only thing that keeps a video out of thumbnail_url.
    await expect(assertBindablePaths([thumbnail('abc.mp4')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([video('abc.png')])).resolves.toBe(REJECTION);
    await expect(assertBindablePaths([document('documents/abc.mp4')])).resolves.toBe(REJECTION);
  });

  it('refuses an .svg avatar even though the shape is perfect', async () => {
    await expect(assertBindablePaths([avatar('avatars/evil.svg')])).resolves.toBe(REJECTION);
  });

  it('gives every rejection the SAME message, whatever the reason', async () => {
    // A caller cannot tell "wrong namespace" from "somebody else has it".
    const outOfFamily = await assertBindablePaths([avatar('someone-elses-lesson.mp4')]);
    const wrongKind = await assertBindablePaths([thumbnail('abc.mp4')]);
    referencedBySomeone('avatars/victim.png');
    const claimed = await assertBindablePaths([avatar('avatars/victim.png')]);
    expect([outOfFamily, wrongKind, claimed]).toEqual([REJECTION, REJECTION, REJECTION]);
  });

  it('allows an absolute external URL without reference-checking it', async () => {
    // thumbnail_url / logo_url / avatar_url have always been permitted to hold
    // absolute URLs, and two rows may legitimately point at the same public image
    // — so this is the one value that skips the claim check. It is never
    // deletable (see isBlobReleasable below), which is what makes that safe.
    await expect(assertBindablePaths([orgLogo('https://example.com/logo.png')])).resolves.toBeNull();
    await expect(assertBindablePaths([thumbnail('https://cdn.example.com/x')])).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lets a row keep the value it already holds without any check at all', async () => {
    // The exemption is what makes re-saving free, and it is also the reason a
    // legacy row can never be locked out by a rule added later.
    await expect(
      assertBindablePaths(
        [thumbnail('lms-assets/legacy thumb.png')],
        ['lms-assets/legacy thumb.png'],
      ),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('exempts a stored value even when a rule added later would refuse its shape', async () => {
    // `avatars/sub/deep.png` is `foreign` on a fresh bind, but a row that somehow
    // already holds it must still be saveable.
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
  // BLOCKER 2 needs no size violation and no shape violation: every user's avatar
  // is `avatars/<uuid>.<ext>`, so a victim's avatar is shape-identical to the
  // attacker's own. Step 1 of the two-step attack is binding it.
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
    // Refusing costs nothing here: the write that follows needs the same database.
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
    // Never deletable, and never reference-checked either — two rows may point at
    // the same public image, and neither may act on it.
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

describe('the two-step attack of #275 (bind a victim path, then clear it)', () => {
  it('cannot get past step 1, so step 2 never has anything to delete', async () => {
    const victimPath = 'avatars/victim.png';

    // STEP 1 — bind the victim's avatar to the attacker's own profile. It is a
    // perfectly well-formed image under the 10 MB cap, so neither the shape check
    // nor the size check has anything to object to; only "somebody else has it"
    // does.
    referencedBySomeone(victimPath);
    await expect(assertBindablePaths([avatar(victimPath)], [null])).resolves.toBe(REJECTION);

    // STEP 2 — the clear that would have deleted it. The attacker's row never
    // pointed at the victim's path, so this is not even reachable; and were the
    // path somehow already shared (a row written before this gate existed), the
    // release check refuses it too.
    await expect(isBlobReleasable(victimPath, 'avatar')).resolves.toBe(false);
  });
});
