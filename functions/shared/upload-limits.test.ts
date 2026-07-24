import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHeadBlob, mockDeleteBlob } = vi.hoisted(() => ({
  mockHeadBlob: vi.fn(),
  mockDeleteBlob: vi.fn(),
}));

// Only the two storage primitives are mocked — the allow-list/cap logic under
// test is the real thing.
vi.mock('./blob', () => ({ headBlob: mockHeadBlob, deleteBlob: mockDeleteBlob }));

import {
  UPLOAD_LIMITS,
  enforceUploadLimits,
  fileExtension,
  isGenericContentType,
  matchesContentType,
  normalizeContentType,
  resolveUploadKind,
} from './upload-limits';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A conclusive "blob exists" HEAD. */
const found = (contentLength: number | null, contentType: string | null = null) => ({
  ok: true,
  exists: true,
  contentLength,
  contentType,
});
/** A conclusive "blob is not there" HEAD. */
const missing = { ok: true, exists: false, contentLength: null, contentType: null };
/** The "we could not find out" HEAD (network error, 5xx, missing env vars). */
const inconclusive = { ok: false, exists: false, contentLength: null, contentType: null };

describe('the agreed caps', () => {
  it('pins video at 2 GB, document at 100 MB, image at 10 MB', () => {
    expect(UPLOAD_LIMITS.video.maxBytes).toBe(2 * GB);
    expect(UPLOAD_LIMITS.document.maxBytes).toBe(100 * MB);
    expect(UPLOAD_LIMITS.image.maxBytes).toBe(10 * MB);
  });

  it('labels each cap the way the 413 message renders it', () => {
    expect(UPLOAD_LIMITS.video.maxLabel).toBe('2 GB');
    expect(UPLOAD_LIMITS.document.maxLabel).toBe('100 MB');
    expect(UPLOAD_LIMITS.image.maxLabel).toBe('10 MB');
  });
});

describe('normalizeContentType', () => {
  it('strips parameters, whitespace and casing', () => {
    expect(normalizeContentType('  Image/PNG ; charset=binary ')).toBe('image/png');
  });
  it('maps non-strings to the empty string', () => {
    expect(normalizeContentType(undefined)).toBe('');
    expect(normalizeContentType(null)).toBe('');
  });
});

describe('isGenericContentType', () => {
  it('treats absent and octet-stream types as "says nothing"', () => {
    expect(isGenericContentType(undefined)).toBe(true);
    expect(isGenericContentType('')).toBe(true);
    expect(isGenericContentType('application/octet-stream')).toBe(true);
    expect(isGenericContentType('binary/octet-stream')).toBe(true);
  });
  it('treats a real media type as informative', () => {
    expect(isGenericContentType('video/mp4')).toBe(false);
    expect(isGenericContentType('image/png')).toBe(false);
  });
});

describe('fileExtension', () => {
  it('lower-cases the segment after the LAST dot', () => {
    expect(fileExtension('My Holiday.Photo.JPG')).toBe('jpg');
  });
  it('returns "" for a name with no dot — never the whole name', () => {
    expect(fileExtension('README')).toBe('');
  });
  it('returns "" for a non-alphanumeric or empty extension', () => {
    expect(fileExtension('archive.tar.gz~')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
    expect(fileExtension('sneaky.p n g')).toBe('');
  });
  it('returns "" for non-string input', () => {
    expect(fileExtension(undefined)).toBe('');
  });
});

describe('matchesContentType', () => {
  it('prefix-matches for video and image', () => {
    expect(matchesContentType('video', 'video/quicktime')).toBe(true);
    expect(matchesContentType('image', 'image/webp')).toBe(true);
    expect(matchesContentType('image', 'video/mp4')).toBe(false);
  });
  it('exact-matches the office list for documents', () => {
    expect(matchesContentType('document', 'application/pdf')).toBe(true);
    expect(matchesContentType(
      'document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )).toBe(true);
    expect(matchesContentType('document', 'application/zip')).toBe(false);
  });
  it('never matches an empty content type', () => {
    expect(matchesContentType('image', '')).toBe(false);
  });
});

describe('resolveUploadKind', () => {
  it('classifies by extension', () => {
    expect(resolveUploadKind('clip.mp4', 'video/mp4')).toBe('video');
    expect(resolveUploadKind('spec.pdf', 'application/pdf')).toBe('document');
    expect(resolveUploadKind('logo.PNG', 'image/png')).toBe('image');
  });

  it('accepts an absent or generic content type, letting the extension decide', () => {
    // Some browsers report no MIME type for .mov; azure-upload-url then
    // substitutes application/octet-stream. Neither may reject the upload.
    expect(resolveUploadKind('clip.mov')).toBe('video');
    expect(resolveUploadKind('clip.mov', 'application/octet-stream')).toBe('video');
  });

  it('rejects a content type that disagrees with the extension', () => {
    expect(resolveUploadKind('logo.png', 'video/mp4')).toBeNull();
    expect(resolveUploadKind('clip.mp4', 'image/png')).toBeNull();
  });

  it('rejects an unknown extension and an extension-less name', () => {
    expect(resolveUploadKind('payload.exe', 'application/octet-stream')).toBeNull();
    expect(resolveUploadKind('weird.bin', 'application/octet-stream')).toBeNull();
    expect(resolveUploadKind('noextension', 'image/png')).toBeNull();
  });

  it('rejects .svg even though image/svg+xml prefix-matches image/', () => {
    // Deliberate narrowing: an SVG opened from a signed URL is a scripting
    // context, and no file picker in the app offers SVG.
    expect(resolveUploadKind('logo.svg', 'image/svg+xml')).toBeNull();
  });

  it('rejects .heic — no browser outside Safari can render it', () => {
    expect(resolveUploadKind('IMG_0001.heic', 'image/heic')).toBeNull();
  });
});

describe('enforceUploadLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteBlob.mockResolvedValue(true);
    mockHeadBlob.mockResolvedValue(found(1024));
  });

  it('accepts a fresh path that is comfortably under its cap', async () => {
    await expect(
      enforceUploadLimits([{ path: 'videos/new.mp4', kind: 'video' }]),
    ).resolves.toBeNull();
    expect(mockHeadBlob).toHaveBeenCalledWith('videos/new.mp4');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('rejects an over-cap blob with the kind-specific message and deletes it', async () => {
    mockHeadBlob.mockResolvedValue(found(2 * GB + 1));
    await expect(
      enforceUploadLimits([{ path: 'videos/huge.mp4', kind: 'video' }]),
    ).resolves.toBe('Video exceeds the maximum upload size of 2 GB');
    // The refused blob must not be left behind as an orphan.
    expect(mockDeleteBlob).toHaveBeenCalledWith('videos/huge.mp4');
  });

  it('accepts a blob exactly AT the cap (the cap is inclusive)', async () => {
    mockHeadBlob.mockResolvedValue(found(10 * MB));
    await expect(
      enforceUploadLimits([{ path: 'thumbs/exact.png', kind: 'image' }]),
    ).resolves.toBeNull();
  });

  it('applies the cap that belongs to the COLUMN, not to the bytes', async () => {
    // 50 MB: fine as a video, fine as a document, over the 10 MB image cap.
    mockHeadBlob.mockResolvedValue(found(50 * MB));
    await expect(enforceUploadLimits([{ path: 'a.mp4', kind: 'video' }])).resolves.toBeNull();
    await expect(enforceUploadLimits([{ path: 'b.pdf', kind: 'document' }])).resolves.toBeNull();
    await expect(enforceUploadLimits([{ path: 'c.png', kind: 'image' }])).resolves.toBe(
      'Image exceeds the maximum upload size of 10 MB',
    );
  });

  it('rejects a blob whose STORED content type is off the allow-list', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, 'application/x-msdownload'));
    await expect(
      enforceUploadLimits([{ path: 'thumbs/trojan.png', kind: 'image' }]),
    ).resolves.toBe('Image content type is not allowed');
    expect(mockDeleteBlob).toHaveBeenCalledWith('thumbs/trojan.png');
  });

  it('accepts a blob stored without a usable content type (inconclusive, not off-list)', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, 'application/octet-stream'));
    await expect(
      enforceUploadLimits([{ path: 'videos/new.mov', kind: 'video' }]),
    ).resolves.toBeNull();
  });

  // --- Which paths get probed at all ---

  it('never probes a path that is already stored on the row', async () => {
    await expect(
      enforceUploadLimits(
        [{ path: 'videos/keep.mp4', kind: 'video' }],
        ['videos/keep.mp4'],
      ),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('never probes a path that merely MOVED between columns of the same row', async () => {
    // Mirrors the #275 cleanup semantics: previousPaths is row-wide, so
    // video_storage_path → azure_blob_path is not a new upload.
    await expect(
      enforceUploadLimits(
        [{ path: 'videos/same.mp4', kind: 'video' }],
        [null, 'videos/same.mp4', null],
      ),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('cannot fail an update because an already-stored blob was removed from storage', async () => {
    mockHeadBlob.mockResolvedValue(missing);
    await expect(
      enforceUploadLimits([{ path: 'videos/gone.mp4', kind: 'video' }], ['videos/gone.mp4']),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('probes nothing when every candidate is null, undefined or empty', async () => {
    await expect(
      enforceUploadLimits([
        { path: null, kind: 'video' },
        { path: undefined, kind: 'document' },
        { path: '', kind: 'image' },
      ]),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('probes a path once even when two columns reference it', async () => {
    await expect(
      enforceUploadLimits([
        { path: 'videos/new.mp4', kind: 'video' },
        { path: 'videos/new.mp4', kind: 'video' },
      ]),
    ).resolves.toBeNull();
    expect(mockHeadBlob).toHaveBeenCalledTimes(1);
  });

  // --- Fail-open on an inconclusive answer ---

  it('allows the save when storage is unreachable', async () => {
    mockHeadBlob.mockResolvedValue(inconclusive);
    await expect(
      enforceUploadLimits([{ path: 'videos/new.mp4', kind: 'video' }]),
    ).resolves.toBeNull();
    // Nothing is deleted on an inconclusive probe — the blob may be perfectly fine.
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('allows the save when the blob does not exist', async () => {
    // Covers the legitimate case of an absolute external URL stored in
    // thumbnail_url / logo_url, which HEADs as a 404.
    mockHeadBlob.mockResolvedValue(missing);
    await expect(
      enforceUploadLimits([{ path: 'https://example.com/logo.png', kind: 'image' }]),
    ).resolves.toBeNull();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('allows the save when the blob exists but reports no size', async () => {
    mockHeadBlob.mockResolvedValue(found(null));
    await expect(
      enforceUploadLimits([{ path: 'videos/new.mp4', kind: 'video' }]),
    ).resolves.toBeNull();
  });

  // --- Multiple candidates ---

  it('probes every fresh path concurrently and reports the first rejection', async () => {
    mockHeadBlob.mockImplementation(async (path: string) =>
      path === 'docs/huge.pdf' ? found(200 * MB) : found(1024),
    );
    await expect(
      enforceUploadLimits([
        { path: 'videos/ok.mp4', kind: 'video' },
        { path: 'docs/huge.pdf', kind: 'document' },
      ]),
    ).resolves.toBe('Document exceeds the maximum upload size of 100 MB');
    expect(mockHeadBlob).toHaveBeenCalledTimes(2);
    // Only the REFUSED blob is cleaned up; the accepted one may still be retried.
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('docs/huge.pdf');
  });

  it('deletes every rejected blob, not just the one it reports', async () => {
    mockHeadBlob.mockResolvedValue(found(5 * GB));
    await expect(
      enforceUploadLimits([
        { path: 'videos/a.mp4', kind: 'video' },
        { path: 'videos/b.mp4', kind: 'video' },
      ]),
    ).resolves.toBe('Video exceeds the maximum upload size of 2 GB');
    expect(mockDeleteBlob.mock.calls.map((c) => c[0]).sort()).toEqual([
      'videos/a.mp4',
      'videos/b.mp4',
    ]);
  });

  it('still rejects when the cleanup delete fails (storage 500)', async () => {
    mockHeadBlob.mockResolvedValue(found(5 * GB));
    mockDeleteBlob.mockResolvedValue(false);
    await expect(
      enforceUploadLimits([{ path: 'videos/huge.mp4', kind: 'video' }]),
    ).resolves.toBe('Video exceeds the maximum upload size of 2 GB');
  });
});
