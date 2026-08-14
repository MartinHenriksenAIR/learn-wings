import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHeadBlob, mockDeleteBlob } = vi.hoisted(() => ({
  mockHeadBlob: vi.fn(),
  mockDeleteBlob: vi.fn(),
}));

vi.mock('./blob', () => ({ headBlob: mockHeadBlob, deleteBlob: mockDeleteBlob }));

import {
  UPLOAD_LIMITS,
  enforceUploadLimits,
  fileExtension,
  isGenericContentType,
  matchesContentType,
  normalizeContentType,
  pathExtensionAllowed,
  resolveUploadKind,
  type UploadAssetKind,
  type UploadCandidate,
} from './upload-limits';

const MB = 1024 * 1024;
const GB = 1024 * MB;

const candidate = (path: string | null | undefined, kind: UploadAssetKind): UploadCandidate =>
  ({ path, kind, family: 'lms' });

const found = (contentLength: number | null, contentType: string | null = null) => ({
  ok: true,
  exists: true,
  contentLength,
  contentType,
});
const missing = { ok: true, exists: false, contentLength: null, contentType: null };
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
  it('prefix-matches for video', () => {
    expect(matchesContentType('video', 'video/quicktime')).toBe(true);
    expect(matchesContentType('video', 'image/png')).toBe(false);
  });

  it('exact-matches the picker list for images — NOT an image/ prefix', () => {
    expect(matchesContentType('image', 'image/webp')).toBe(true);
    expect(matchesContentType('image', 'image/png')).toBe(true);
    expect(matchesContentType('image', 'video/mp4')).toBe(false);
  });

  it('rejects image/svg+xml, which an image/ prefix would have admitted', () => {
    expect(matchesContentType('image', 'image/svg+xml')).toBe(false);
  });

  it('rejects the other image/* types the prefix used to admit', () => {
    expect(matchesContentType('image', 'image/heic')).toBe(false);
    expect(matchesContentType('image', 'image/bmp')).toBe(false);
    expect(matchesContentType('image', 'image/tiff')).toBe(false);
  });

  it('tolerates the non-standard image/jpg alias some platforms report', () => {
    expect(matchesContentType('image', 'image/jpg')).toBe(true);
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
    expect(resolveUploadKind('logo.svg', 'image/svg+xml')).toBeNull();
  });

  it('rejects .heic — no browser outside Safari can render it', () => {
    expect(resolveUploadKind('IMG_0001.heic', 'image/heic')).toBeNull();
  });
});

describe('pathExtensionAllowed', () => {
  it('accepts a STORED path whose extension matches the column kind', () => {
    expect(pathExtensionAllowed('avatars/abc.png', 'image')).toBe(true);
    expect(pathExtensionAllowed('abc.mp4', 'video')).toBe(true);
    expect(pathExtensionAllowed('documents/abc.pdf', 'document')).toBe(true);
  });

  it('is what separates the columns that share the flat namespace', () => {
    expect(pathExtensionAllowed('abc.mp4', 'image')).toBe(false);
    expect(pathExtensionAllowed('abc.png', 'video')).toBe(false);
    expect(pathExtensionAllowed('abc.mp4', 'document')).toBe(false);
  });

  it('rejects .svg and an extension-less path', () => {
    expect(pathExtensionAllowed('avatars/evil.svg', 'image')).toBe(false);
    expect(pathExtensionAllowed('avatars/noextension', 'image')).toBe(false);
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
      enforceUploadLimits([candidate('videos/new.mp4', 'video')]),
    ).resolves.toBeNull();
    expect(mockHeadBlob).toHaveBeenCalledWith('videos/new.mp4');
  });

  it('rejects an over-cap blob with the kind-specific message', async () => {
    mockHeadBlob.mockResolvedValue(found(2 * GB + 1));
    await expect(
      enforceUploadLimits([candidate('videos/huge.mp4', 'video')]),
    ).resolves.toBe('Video exceeds the maximum upload size of 2 GB');
  });

  it('accepts a blob exactly AT the cap (the cap is inclusive)', async () => {
    mockHeadBlob.mockResolvedValue(found(10 * MB));
    await expect(
      enforceUploadLimits([candidate('thumbs/exact.png', 'image')]),
    ).resolves.toBeNull();
  });

  it('applies the cap that belongs to the COLUMN, not to the bytes', async () => {
    mockHeadBlob.mockResolvedValue(found(50 * MB));
    await expect(enforceUploadLimits([candidate('a.mp4', 'video')])).resolves.toBeNull();
    await expect(enforceUploadLimits([candidate('b.pdf', 'document')])).resolves.toBeNull();
    await expect(enforceUploadLimits([candidate('c.png', 'image')])).resolves.toBe(
      'Image exceeds the maximum upload size of 10 MB',
    );
  });

  it('rejects a blob whose STORED content type is off the allow-list', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, 'application/x-msdownload'));
    await expect(
      enforceUploadLimits([candidate('thumbs/trojan.png', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
  });

  it('accepts a blob stored without a usable content type (inconclusive, not off-list)', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, 'application/octet-stream'));
    await expect(
      enforceUploadLimits([candidate('videos/new.mov', 'video')]),
    ).resolves.toBeNull();
  });


  it('refuses SVG bytes stored under an allow-listed .png path', async () => {
    mockHeadBlob.mockResolvedValue(found(4 * 1024, 'image/svg+xml'));
    await expect(
      enforceUploadLimits([candidate('avatars/looks-fine.png', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
  });

  it('refuses SVG bytes with a charset parameter attached', async () => {
    mockHeadBlob.mockResolvedValue(found(4 * 1024, 'image/svg+xml; charset=utf-8'));
    await expect(
      enforceUploadLimits([candidate('avatars/looks-fine.png', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
  });

  it('refuses HEIC bytes stored under an allow-listed .jpg path', async () => {
    mockHeadBlob.mockResolvedValue(found(4 * 1024, 'image/heic'));
    await expect(
      enforceUploadLimits([candidate('avatars/looks-fine.jpg', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
  });

  it('refuses a stored path whose EXTENSION is off the allow-list', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, null));
    await expect(
      enforceUploadLimits([candidate('avatars/evil.svg', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
  });

  it('refuses a video path bound to an image column (the flat namespace)', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, null));
    await expect(
      enforceUploadLimits([candidate('abc.mp4', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
  });


  it('never probes a path that is already stored on the row', async () => {
    await expect(
      enforceUploadLimits(
        [candidate('videos/keep.mp4', 'video')],
        ['videos/keep.mp4'],
      ),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('never probes a path that merely MOVED between columns of the same row', async () => {
    await expect(
      enforceUploadLimits(
        [candidate('videos/same.mp4', 'video')],
        [null, 'videos/same.mp4', null],
      ),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('cannot fail an update because an already-stored blob was removed from storage', async () => {
    mockHeadBlob.mockResolvedValue(missing);
    await expect(
      enforceUploadLimits([candidate('videos/gone.mp4', 'video')], ['videos/gone.mp4']),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('probes nothing when every candidate is null, undefined or empty', async () => {
    await expect(
      enforceUploadLimits([
        candidate(null, 'video'),
        candidate(undefined, 'document'),
        candidate('', 'image'),
      ]),
    ).resolves.toBeNull();
    expect(mockHeadBlob).not.toHaveBeenCalled();
  });

  it('probes a path once even when two columns reference it', async () => {
    await expect(
      enforceUploadLimits([
        candidate('videos/new.mp4', 'video'),
        candidate('videos/new.mp4', 'video'),
      ]),
    ).resolves.toBeNull();
    expect(mockHeadBlob).toHaveBeenCalledTimes(1);
  });


  it('allows the save when storage is unreachable', async () => {
    mockHeadBlob.mockResolvedValue(inconclusive);
    await expect(
      enforceUploadLimits([candidate('videos/new.mp4', 'video')]),
    ).resolves.toBeNull();
  });

  it('allows the save when the blob does not exist', async () => {
    mockHeadBlob.mockResolvedValue(missing);
    await expect(
      enforceUploadLimits([candidate('https://example.com/logo.png', 'image')]),
    ).resolves.toBeNull();
  });

  it('does not judge an absent blob by its extension', async () => {
    mockHeadBlob.mockResolvedValue(missing);
    await expect(
      enforceUploadLimits([candidate('https://example.com/branding/logo', 'image')]),
    ).resolves.toBeNull();
  });

  it('allows the save when the blob exists but reports no size', async () => {
    mockHeadBlob.mockResolvedValue(found(null));
    await expect(
      enforceUploadLimits([candidate('videos/new.mp4', 'video')]),
    ).resolves.toBeNull();
  });


  it('probes every fresh path concurrently and reports the first rejection', async () => {
    mockHeadBlob.mockImplementation(async (path: string) =>
      path === 'docs/huge.pdf' ? found(200 * MB) : found(1024),
    );
    await expect(
      enforceUploadLimits([
        candidate('videos/ok.mp4', 'video'),
        candidate('docs/huge.pdf', 'document'),
      ]),
    ).resolves.toBe('Document exceeds the maximum upload size of 100 MB');
    expect(mockHeadBlob).toHaveBeenCalledTimes(2);
  });


  it('deletes nothing when a blob is over cap', async () => {
    mockHeadBlob.mockResolvedValue(found(5 * GB));
    await expect(
      enforceUploadLimits([candidate('videos/huge.mp4', 'video')]),
    ).resolves.toBe('Video exceeds the maximum upload size of 2 GB');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('deletes nothing when a blob is off the content-type allow-list', async () => {
    mockHeadBlob.mockResolvedValue(found(1024, 'application/x-msdownload'));
    await expect(
      enforceUploadLimits([candidate('thumbs/trojan.png', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('deletes nothing when several candidates are rejected at once', async () => {
    mockHeadBlob.mockResolvedValue(found(5 * GB));
    await expect(
      enforceUploadLimits([
        candidate('videos/a.mp4', 'video'),
        candidate('videos/b.mp4', 'video'),
      ]),
    ).resolves.toBe('Video exceeds the maximum upload size of 2 GB');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('deletes nothing on ANY outcome — accepted, refused or inconclusive', async () => {
    mockHeadBlob
      .mockResolvedValueOnce(found(1024))
      .mockResolvedValueOnce(found(5 * GB))
      .mockResolvedValueOnce(inconclusive);
    await enforceUploadLimits([
      candidate('videos/a.mp4', 'video'),
      candidate('videos/b.mp4', 'video'),
      candidate('videos/c.mp4', 'video'),
    ]);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('a path from ANOTHER row cannot be destroyed by failing this column cap', async () => {
    mockHeadBlob.mockResolvedValue(found(500 * MB, 'video/mp4'));
    await expect(
      enforceUploadLimits([candidate('someone-elses-lesson.mp4', 'image')]),
    ).resolves.toBe('Image content type is not allowed');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });
});

