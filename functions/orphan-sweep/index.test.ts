import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

// Only the DB is mocked. `../shared/blob` and `../shared/sas` run for real against
// a stubbed `fetch`, so these tests exercise the actual SAS signing, the actual
// URL construction and the actual `deleteBlob` — the whole path that would
// destroy a customer's file if it targeted the wrong blob.
vi.mock('../shared/db', () => ({
  query: mockQuery,
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
  getDb: vi.fn(),
}));

import { runOrphanSweep, referenceVariants, parseListPage } from './index';

const NOW = Date.parse('2026-07-25T03:00:00.000Z');
const HOUR = 3_600_000;
const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toUTCString();

/** The blobs a healthy container holds: five referenced, in both storage formats. */
const REFERENCED_ROWS = [
  { path: 'lesson-video.mp4' },        // lessons.azure_blob_path      — bare
  { path: 'lesson-doc.pdf' },          // lessons.document_storage_path — bare
  { path: 'course-thumb.png' },        // courses.thumbnail_url         — bare
  { path: 'avatars/user-1.jpg' },      // profiles.avatar_url           — PREFIXED
  { path: 'org-logos/org-1.png' },     // organizations.logo_url        — PREFIXED
];
const REFERENCED_NAMES = REFERENCED_ROWS.map((r) => r.path);

interface BlobFixture {
  name: string;
  bytes?: number;
  /** Hours before NOW. Defaults to 72 (well outside the grace window). */
  ageHours?: number;
  /** Set true to omit <Last-Modified> entirely. */
  undated?: boolean;
}

function listPage(blobs: BlobFixture[], nextMarker = ''): string {
  const entries = blobs
    .map((b) => {
      const modified = b.undated
        ? ''
        : `\n        <Last-Modified>${hoursAgo(b.ageHours ?? 72)}</Last-Modified>`;
      return `
    <Blob>
      <Name>${b.name}</Name>
      <Properties>${modified}
        <Content-Length>${b.bytes ?? 1024}</Content-Length>
        <BlobType>BlockBlob</BlobType>
      </Properties>
    </Blob>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://testaccount.blob.core.windows.net/" ContainerName="lms-videos">
  <Blobs>${entries}
  </Blobs>
  <NextMarker>${nextMarker}</NextMarker>
</EnumerationResults>`;
}

/** The blob a DELETE request actually targeted, read back out of the signed URL. */
function targetOf(url: string): string {
  return new URL(url).pathname.split('/').slice(2).map(decodeURIComponent).join('/');
}

interface StubOptions {
  /** XML per list page, in order. */
  pages?: string[];
  /** Status for the list request (non-2xx makes the listing fail). */
  listStatus?: number;
  /** Per-blob DELETE status; anything not listed succeeds with 202. */
  deleteStatus?: Record<string, number>;
  /** Make list requests reject outright. */
  listThrows?: boolean;
}

function stubFetch(options: StubOptions = {}) {
  const { pages = [], listStatus = 200, deleteStatus = {}, listThrows = false } = options;
  const listUrls: string[] = [];
  const listInits: Array<Record<string, unknown> | undefined> = [];
  const deleted: string[] = [];

  const fetchMock = vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    if (url.includes('comp=list')) {
      if (listThrows) throw new Error('network down');
      listUrls.push(url);
      listInits.push(init as Record<string, unknown> | undefined);
      if (listStatus !== 200) return { ok: false, status: listStatus };
      const body = pages[listUrls.length - 1] ?? pages[pages.length - 1] ?? '';
      return { ok: true, status: 200, text: async () => body };
    }
    const name = targetOf(url);
    const status = deleteStatus[name] ?? 202;
    if (status >= 200 && status < 300) deleted.push(name);
    return { ok: status >= 200 && status < 300, status };
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, listUrls, listInits, deleted };
}

const makeLog = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue(REFERENCED_ROWS);
  process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
  process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
  process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
  delete process.env.ORPHAN_SWEEP_DISABLED;
  delete process.env.ORPHAN_SWEEP_MAX_SHARE;
  delete process.env.ORPHAN_SWEEP_MAX_DELETIONS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
  delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
  delete process.env.AZURE_STORAGE_CONTAINER_NAME;
  delete process.env.ORPHAN_SWEEP_DISABLED;
  delete process.env.ORPHAN_SWEEP_MAX_SHARE;
  delete process.env.ORPHAN_SWEEP_MAX_DELETIONS;
});

// ──────────────────────────────────────────────────────────────────────────────
// The comparison: what must survive a sweep
// ──────────────────────────────────────────────────────────────────────────────
describe('orphan-sweep — referenced blobs are never deleted', () => {
  it('leaves a referenced BARE blob name alone and deletes the genuine orphan beside it', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.mp4' }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual(['stranded.mp4']);
    expect(deleted).not.toContain('lesson-video.mp4');
    expect(summary).toMatchObject({ aborted: false, scanned: 6, eligible: 6, orphaned: 1, deleted: 1, failed: 0 });
  });

  /**
   * THE TRAP-2 REGRESSION TEST.
   *
   * `List Blobs` returns `avatars/user-1.jpg`; the database stores exactly that.
   * Any basename-extraction or prefix-stripping on the LISTED name would turn it
   * into `user-1.jpg`, match nothing, and delete every avatar and org logo in the
   * system. The assertion below is the whole reason this job can be armed.
   */
  it('leaves referenced PREFIXED branding paths alone (avatars/, org-logos/)', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.png' }])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).not.toContain('avatars/user-1.jpg');
    expect(deleted).not.toContain('org-logos/org-1.png');
    // Not vacuous: the sweep did run and did delete the one blob it should have.
    expect(deleted).toEqual(['stranded.png']);
  });

  it('protects a blob referenced by ONE column even though the other five do not mention it', async () => {
    // Only `lessons.document_storage_path` still points at this file.
    mockQuery.mockResolvedValue([{ path: 'sole-reference.pdf' }, ...REFERENCED_ROWS]);
    const { deleted } = stubFetch({
      pages: [listPage([{ name: 'sole-reference.pdf' }, ...REFERENCED_NAMES.map((name) => ({ name }))])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
  });

  it('unions all six path columns, with no normalising expression around any of them', async () => {
    stubFetch({ pages: [listPage([{ name: 'lesson-video.mp4' }])] });
    await runOrphanSweep(makeLog(), NOW);

    const sql = mockQuery.mock.calls[0][0] as string;
    for (const column of [
      'video_storage_path',
      'azure_blob_path',
      'document_storage_path',
      'thumbnail_url',
      'logo_url',
      'avatar_url',
    ]) {
      expect(sql).toContain(column);
    }
    for (const table of ['lessons', 'courses', 'organizations', 'profiles']) {
      expect(sql).toContain(table);
    }
    // A transform on the DB side of the comparison is the trap-2 bug class.
    expect(sql).not.toMatch(/trim|substring|replace|lower|split_part|regexp/i);
    // video_url is a deprecated EXTERNAL url — never a reconciliation target.
    expect(sql).not.toContain('video_url');
  });

  it('protects a blob whose stored value is an absolute Azure URL rather than a bare path', async () => {
    mockQuery.mockResolvedValue([
      { path: 'https://testaccount.blob.core.windows.net/lms-videos/legacy-thumb.png' },
      ...REFERENCED_ROWS,
    ]);
    const { deleted } = stubFetch({
      pages: [listPage([{ name: 'legacy-thumb.png' }, ...REFERENCED_NAMES.map((name) => ({ name }))])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
  });

  it('protects a blob whose stored value carries a stray leading slash or whitespace', async () => {
    mockQuery.mockResolvedValue([{ path: '  /avatars/user-9.jpg  ' }, ...REFERENCED_ROWS]);
    const { deleted } = stubFetch({
      pages: [listPage([{ name: 'avatars/user-9.jpg' }, ...REFERENCED_NAMES.map((name) => ({ name }))])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Grace window
// ──────────────────────────────────────────────────────────────────────────────
describe('orphan-sweep — 24 h grace window', () => {
  it('deletes an unreferenced blob older than 24 h', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'old.mp4', ageHours: 25 }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual(['old.mp4']);
    expect(summary.skippedByGrace).toBe(0);
  });

  it('skips an unreferenced blob younger than 24 h (an upload still sitting in a form)', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'fresh.mp4', ageHours: 2 }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: false, orphaned: 1, skippedByGrace: 1, deleted: 0 });
  });

  it('treats an undateable blob as brand new and never deletes it', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'undated.mp4', undated: true }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary.skippedByGrace).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Abort conditions — every one of these must delete NOTHING
// ──────────────────────────────────────────────────────────────────────────────
describe('orphan-sweep — refusals', () => {
  it('aborts when the orphan share is implausible, deleting nothing', async () => {
    mockQuery.mockResolvedValue([{ path: 'lesson-video.mp4' }]);
    const { deleted } = stubFetch({
      pages: [
        listPage([
          { name: 'lesson-video.mp4' },
          { name: 'a.mp4' },
          { name: 'b.mp4' },
          { name: 'c.mp4' },
          { name: 'd.mp4' },
        ]),
      ],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-share-implausible', orphaned: 4, deleted: 0 });
    expect(log.error).toHaveBeenCalled();
  });

  it('aborts when the run would exceed the per-run deletion ceiling', async () => {
    process.env.ORPHAN_SWEEP_MAX_DELETIONS = '2';
    const orphans = ['x1.mp4', 'x2.mp4', 'x3.mp4'].map((name) => ({ name }));
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), ...orphans])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-count-implausible', deleted: 0 });
  });

  it('aborts on an EMPTY reference set rather than treating the container as all-orphan', async () => {
    mockQuery.mockResolvedValue([]);
    const { fetchMock } = stubFetch({ pages: [listPage([{ name: 'anything.mp4' }])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'empty-reference-set', deleted: 0 });
    // It never even listed the container — there was nothing safe to compare against.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts when every reference row is null/empty (a broken query looks exactly like this)', async () => {
    mockQuery.mockResolvedValue([{ path: null }, { path: '' }]);
    const { fetchMock } = stubFetch({ pages: [listPage([{ name: 'anything.mp4' }])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'empty-reference-set', deleted: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts when the reference read fails, deleting nothing', async () => {
    mockQuery.mockRejectedValue(new Error('connection terminated'));
    const { fetchMock } = stubFetch({ pages: [listPage([{ name: 'anything.mp4' }])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'reference-read-failed', deleted: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts when the SECOND reference read (the one closing the listing race) fails', async () => {
    mockQuery.mockResolvedValueOnce(REFERENCED_ROWS).mockRejectedValueOnce(new Error('pool exhausted'));
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.mp4' }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'reference-read-failed', deleted: 0 });
  });

  it('protects a blob that only the SECOND reference read knows about (row written mid-listing)', async () => {
    mockQuery
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockResolvedValueOnce([...REFERENCED_ROWS, { path: 'just-attached.mp4' }]);
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'just-attached.mp4' }])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
  });

  it('aborts when the listing returns a non-2xx, deleting nothing', async () => {
    const { deleted } = stubFetch({ listStatus: 503 });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'listing-failed', deleted: 0 });
  });

  it('aborts when the listing request throws', async () => {
    const { deleted } = stubFetch({ listThrows: true });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'listing-failed' });
  });

  it('aborts when a LATER page fails, without acting on the pages it did read', async () => {
    // Page 1 parses and advertises a marker; page 2 comes back empty/garbage.
    const { fetchMock, deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.mp4' }], 'marker-1'), 'not xml'],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'listing-failed', deleted: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts on an unparseable first page rather than reading it as "no blobs"', async () => {
    const { deleted } = stubFetch({ pages: ['<html>502 Bad Gateway</html>'] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'listing-failed' });
  });

  it('aborts when NextMarker repeats instead of looping forever', async () => {
    const page = listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.mp4' }], 'stuck');
    const { deleted } = stubFetch({ pages: [page, page, page] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'listing-failed' });
  });

  it('aborts when storage is not configured, before touching the database', async () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const { fetchMock } = stubFetch({ pages: [listPage([{ name: 'anything.mp4' }])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'storage-not-configured', deleted: 0 });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing at all when the kill switch is set', async () => {
    process.env.ORPHAN_SWEEP_DISABLED = '1';
    const { fetchMock } = stubFetch({ pages: [listPage([{ name: 'anything.mp4' }])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'disabled', deleted: 0 });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the built-in ceilings when the env overrides are unusable', async () => {
    // A threshold of 5 (or of "banana") must not become a licence to delete more.
    process.env.ORPHAN_SWEEP_MAX_SHARE = '5';
    process.env.ORPHAN_SWEEP_MAX_DELETIONS = 'banana';
    mockQuery.mockResolvedValue([{ path: 'lesson-video.mp4' }]);
    const { deleted } = stubFetch({
      pages: [listPage([{ name: 'lesson-video.mp4' }, { name: 'a.mp4' }, { name: 'b.mp4' }, { name: 'c.mp4' }])],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-share-implausible' });
    expect(log.warn).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Listing mechanics
// ──────────────────────────────────────────────────────────────────────────────
describe('orphan-sweep — listing', () => {
  it('walks every page via NextMarker and sweeps blobs found on the last one', async () => {
    const { fetchMock, listUrls, deleted } = stubFetch({
      pages: [
        listPage(REFERENCED_NAMES.slice(0, 3).map((name) => ({ name })), 'marker-1'),
        listPage(REFERENCED_NAMES.slice(3).map((name) => ({ name })), 'marker-2'),
        listPage([{ name: 'page-three-orphan.mp4' }]),
      ],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(listUrls).toHaveLength(3);
    expect(listUrls[0]).not.toContain('marker=');
    expect(listUrls[1]).toContain('marker=marker-1');
    expect(listUrls[2]).toContain('marker=marker-2');
    expect(summary.scanned).toBe(6);
    expect(deleted).toEqual(['page-three-orphan.mp4']);
    // 3 list requests + 1 delete
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('mints a CONTAINER-scoped list SAS and sends the matching x-ms-version', async () => {
    const { listUrls, listInits } = stubFetch({ pages: [listPage([{ name: 'lesson-video.mp4' }])] });

    await runOrphanSweep(makeLog(), NOW);

    const url = new URL(listUrls[0]);
    expect(url.searchParams.get('restype')).toBe('container');
    expect(url.searchParams.get('comp')).toBe('list');
    expect(url.searchParams.get('sr')).toBe('c');   // trap 1: a blob SAS cannot list
    expect(url.searchParams.get('sp')).toBe('l');
    expect(url.searchParams.get('sig')).toBeTruthy();
    expect(listInits[0]).toMatchObject({
      method: 'GET',
      headers: { 'x-ms-version': url.searchParams.get('sv') },
    });
  });

  it('handles a genuinely empty container without deleting or aborting', async () => {
    const { deleted } = stubFetch({ pages: [listPage([])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: false, scanned: 0, orphaned: 0, deleted: 0 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Deletion behaviour
// ──────────────────────────────────────────────────────────────────────────────
describe('orphan-sweep — deletion', () => {
  it('counts delete failures without aborting the rest of the run', async () => {
    const { deleted } = stubFetch({
      pages: [
        listPage([
          ...REFERENCED_NAMES.map((name) => ({ name })),
          { name: 'ok-1.mp4' },
          { name: 'broken.mp4' },
          { name: 'ok-2.mp4' },
        ]),
      ],
      deleteStatus: { 'broken.mp4': 500 },
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted.sort()).toEqual(['ok-1.mp4', 'ok-2.mp4']);
    expect(summary).toMatchObject({ aborted: false, orphaned: 3, deleted: 2, failed: 1 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('FAILED to delete broken.mp4'));
  });

  it('logs each deletion with path, size and age, plus a run summary', async () => {
    stubFetch({
      pages: [
        listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.mp4', bytes: 4096, ageHours: 30 }]),
      ],
    });
    const log = makeLog();

    await runOrphanSweep(log, NOW);

    expect(log.log).toHaveBeenCalledWith('[orphan-sweep] deleted stranded.mp4 (4096 bytes, age 30.0h)');
    expect(log.log).toHaveBeenCalledWith(
      '[orphan-sweep] run complete',
      expect.objectContaining({ scanned: 6, orphaned: 1, deleted: 1, failed: 0 }),
    );
  });

  it('refuses to delete a blob whose name is not URL-safe (the DELETE could target another blob)', async () => {
    const { deleted } = stubFetch({
      pages: [
        listPage([
          ...REFERENCED_NAMES.map((name) => ({ name })),
          { name: 'weird name?x=1.mp4' },
          { name: 'legit-orphan.mp4' },
        ]),
      ],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual(['legit-orphan.mp4']);
    expect(summary).toMatchObject({ skippedUnsafeName: 1, scanned: 7, eligible: 6 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('will not delete'), 'weird name?x=1.mp4');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Units
// ──────────────────────────────────────────────────────────────────────────────
describe('referenceVariants', () => {
  it('always includes the stored value verbatim', () => {
    expect(referenceVariants('avatars/x.jpg')).toContain('avatars/x.jpg');
    expect(referenceVariants('abc.mp4')).toContain('abc.mp4');
  });

  it('never strips a branding prefix down to a basename', () => {
    expect(referenceVariants('avatars/x.jpg')).not.toContain('x.jpg');
    expect(referenceVariants('org-logos/y.png')).not.toContain('y.png');
  });

  it('adds the blob path behind an absolute Azure Blob Storage URL', () => {
    expect(referenceVariants('https://acct.blob.core.windows.net/lms-videos/avatars/x%20y.jpg')).toContain(
      'avatars/x y.jpg',
    );
  });

  it('adds the path behind a legacy Supabase storage URL', () => {
    expect(
      referenceVariants('https://proj.supabase.co/storage/v1/object/sign/lms-assets/videos/a.mp4?token=zz'),
    ).toContain('videos/a.mp4');
  });

  it('leaves a plain external URL as itself (it simply matches no blob name)', () => {
    const variants = referenceVariants('https://example.com/pic.png');
    expect(variants).toContain('https://example.com/pic.png');
    expect(variants).not.toContain('pic.png');
  });
});

describe('parseListPage', () => {
  it('extracts name, size and last-modified', () => {
    const parsed = parseListPage(listPage([{ name: 'avatars/x.jpg', bytes: 77, ageHours: 10 }]));
    expect(parsed?.blobs).toEqual([
      { name: 'avatars/x.jpg', contentLength: 77, lastModified: Date.parse(hoursAgo(10)) },
    ]);
    expect(parsed?.nextMarker).toBeNull();
  });

  it('returns the NextMarker when the listing continues', () => {
    expect(parseListPage(listPage([{ name: 'a.mp4' }], 'more'))?.nextMarker).toBe('more');
  });

  it('returns null (→ abort) for a payload that is not a List Blobs response', () => {
    expect(parseListPage('<html>oops</html>')).toBeNull();
    expect(parseListPage('')).toBeNull();
  });

  it('returns null (→ abort) rather than silently dropping a <Blob> with no <Name>', () => {
    const xml = `<?xml version="1.0"?><EnumerationResults><Blobs><Blob><Properties/></Blob></Blobs></EnumerationResults>`;
    expect(parseListPage(xml)).toBeNull();
  });

  it('accepts a self-closing empty <Blobs /> as a genuinely empty container', () => {
    const xml = `<?xml version="1.0"?><EnumerationResults><Blobs /><NextMarker /></EnumerationResults>`;
    expect(parseListPage(xml)).toEqual({ blobs: [], nextMarker: null });
  });
});
