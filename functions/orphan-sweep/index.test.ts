import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../shared/db', () => ({
  query: mockQuery,
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
  getDb: vi.fn(),
}));

const { mockRecordAndNotify } = vi.hoisted(() => ({ mockRecordAndNotify: vi.fn() }));
vi.mock('./notify', () => ({ recordAndNotify: mockRecordAndNotify }));

import {
  runOrphanSweep,
  runScheduledSweep,
  referenceVariants,
  parseListPage,
  blobBucket,
  blobBuckets,
  rootFileClass,
} from './index';

const NOW = Date.parse('2026-07-25T03:00:00.000Z');
const HOUR = 3_600_000;
const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toUTCString();

const REFERENCED_ROWS = [
  { path: 'lesson-video.mp4' },        // lessons.azure_blob_path       — bare
  { path: 'videos/welcome.mp4' },      // lessons.video_storage_path    — PREFIXED (seed/legacy)
  { path: 'legacy-video.mp4' },        // lessons.video_storage_path    — bare
  { path: 'lesson-doc.pdf' },          // lessons.document_storage_path — bare
  { path: 'documents/handbook.pdf' },  // lessons.document_storage_path — PREFIXED (minted today)
  { path: 'course-thumb.png' },        // courses.thumbnail_url         — bare
  { path: 'avatars/user-1.jpg' },      // profiles.avatar_url           — PREFIXED
  { path: 'org-logos/org-1.png' },     // organizations.logo_url        — PREFIXED
];
const REFERENCED_NAMES = REFERENCED_ROWS.map((r) => r.path);
const referencedBlobs = () => REFERENCED_NAMES.map((name) => ({ name }));

interface BlobFixture {
  name: string;
  bytes?: number;
  ageHours?: number;
  undated?: boolean;
  nameAttrs?: string;
}

function listPage(blobs: BlobFixture[], nextMarker = ''): string {
  const entries = blobs
    .map((b) => {
      const modified = b.undated
        ? ''
        : `\n        <Last-Modified>${hoursAgo(b.ageHours ?? 72)}</Last-Modified>`;
      const openName = b.nameAttrs ? `<Name ${b.nameAttrs}>` : '<Name>';
      return `
    <Blob>
      ${openName}${b.name}</Name>
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

function targetOf(url: string): string {
  return new URL(url).pathname.split('/').slice(2).map(decodeURIComponent).join('/');
}

interface StubOptions {
  pages?: string[];
  listStatus?: number;
  deleteStatus?: Record<string, number>;
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

describe('orphan-sweep — referenced blobs are never deleted', () => {
  it('leaves a referenced BARE blob name alone and deletes the genuine orphan beside it', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.mp4' }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual(['stranded.mp4']);
    expect(deleted).not.toContain('lesson-video.mp4');
    expect(summary).toMatchObject({ aborted: false, scanned: 9, eligible: 9, orphaned: 1, deleted: 1, failed: 0 });
  });

  it('leaves referenced PREFIXED branding paths alone (avatars/, org-logos/)', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...REFERENCED_NAMES.map((name) => ({ name })), { name: 'stranded.png' }])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).not.toContain('avatars/user-1.jpg');
    expect(deleted).not.toContain('org-logos/org-1.png');
    expect(deleted).toEqual(['stranded.png']);
  });

  it('leaves referenced PREFIXED lesson assets alone (documents/, videos/)', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'stranded.pdf' }])],
    });

    await runOrphanSweep(makeLog(), NOW);

    expect(deleted).not.toContain('documents/handbook.pdf');
    expect(deleted).not.toContain('videos/welcome.mp4');
    expect(deleted).toEqual(['stranded.pdf']);
  });

  it('protects a blob referenced by ONE column even though the other five do not mention it', async () => {
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
    expect(sql).not.toMatch(/trim|substring|replace|lower|split_part|regexp/i);
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

describe('orphan-sweep — per-bucket orphan share', () => {
  const rootFleet = (n: number) => Array.from({ length: n }, (_, i) => `root-${i}.mp4`);

  it('aborts when ONE prefix is wholly unreferenced even though the container as a whole looks healthy', async () => {
    const root = rootFleet(200);
    const branding = [
      ...Array.from({ length: 20 }, (_, i) => `avatars/u-${i}.jpg`),
      ...Array.from({ length: 5 }, (_, i) => `org-logos/o-${i}.png`),
    ];
    mockQuery.mockResolvedValue(root.map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [listPage([...root.map((name) => ({ name })), ...branding.map((name) => ({ name }))])],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({
      aborted: true,
      reason: 'orphan-bucket-share-implausible',
      eligible: 225,
      orphaned: 25,
      deleted: 0,
    });
    expect(summary.orphaned / summary.eligible).toBeLessThan(0.5);
    const message = log.error.mock.calls[0][0] as string;
    expect(message).toContain('avatars/');
    expect(message).toContain('20/20');
  });

  it('aborts on a wholly-unreferenced bucket at the container ROOT too', async () => {
    const avatars = Array.from({ length: 20 }, (_, i) => `avatars/u-${i}.jpg`);
    mockQuery.mockResolvedValue(avatars.map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [
        listPage([
          ...avatars.map((name) => ({ name })),
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
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-bucket-share-implausible', deleted: 0 });
    expect(log.error.mock.calls[0][0] as string).toContain('the container root');
  });

  it('still sweeps a minority orphan inside a prefix — the bucket check is not a blanket refusal', async () => {
    const root = rootFleet(10);
    const avatars = ['avatars/u-0.jpg', 'avatars/u-1.jpg', 'avatars/u-2.jpg', 'avatars/u-3.jpg'];
    mockQuery.mockResolvedValue([...root, ...avatars].map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [
        listPage([
          ...root.map((name) => ({ name })),
          ...avatars.map((name) => ({ name })),
          { name: 'avatars/stranded.jpg' },
        ]),
      ],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual(['avatars/stranded.jpg']);
    expect(summary).toMatchObject({ aborted: false, deleted: 1 });
  });

  it('reports the GLOBAL reason when the whole container is implausible, not the bucket one', async () => {
    mockQuery.mockResolvedValue([{ path: 'lesson-video.mp4' }]);
    const { deleted } = stubFetch({
      pages: [
        listPage([
          { name: 'lesson-video.mp4' },
          { name: 'a.mp4' },
          { name: 'avatars/b.jpg' },
          { name: 'avatars/c.jpg' },
        ]),
      ],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-share-implausible' });
  });

  it('still aborts on a TWO-blob prefix bucket — the root-class floor is not applied here', async () => {
    const root = rootFleet(40);
    mockQuery.mockResolvedValue(root.map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [
        listPage([...root.map((name) => ({ name })), { name: 'videos/a.mp4' }, { name: 'videos/b.mp4' }]),
      ],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-bucket-share-implausible', deleted: 0 });
    expect(log.error.mock.calls[0][0] as string).toContain('2/2');
  });
});

describe('orphan-sweep — root file-type classes', () => {
  const rootFleet = (n: number) => Array.from({ length: n }, (_, i) => `root-${i}.mp4`);

  it('aborts when the root IMAGE class is wholly unreferenced but the root as a whole is not', async () => {
    const root = rootFleet(200);
    const avatars = Array.from({ length: 20 }, (_, i) => `avatars/u-${i}.jpg`);
    const thumbnails = Array.from({ length: 12 }, (_, i) => `thumb-${i}.png`);
    mockQuery.mockResolvedValue([...root, ...avatars].map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [listPage([...root, ...avatars, ...thumbnails].map((name) => ({ name })))],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({
      aborted: true,
      reason: 'orphan-bucket-share-implausible',
      eligible: 232,
      orphaned: 12,
      deleted: 0,
    });
    expect(summary.orphaned / summary.eligible).toBeLessThan(0.5);
    const message = log.error.mock.calls[0][0] as string;
    expect(message).toContain('image files at the container root');
    expect(message).toContain('12/12');
    expect(message).toContain('thumb-0.png');
  });

  it('sweeps a healthy container with orphans scattered across every class', async () => {
    const referencedFixture = [
      ...Array.from({ length: 40 }, (_, i) => `root-${i}.mp4`),
      ...Array.from({ length: 12 }, (_, i) => `thumb-${i}.png`),
      ...Array.from({ length: 6 }, (_, i) => `doc-${i}.pdf`),
      ...Array.from({ length: 10 }, (_, i) => `avatars/u-${i}.jpg`),
      ...Array.from({ length: 5 }, (_, i) => `documents/d-${i}.pdf`),
    ];
    const orphanFixture = [
      'cancelled-1.mp4',
      'cancelled-2.mp4',
      'cancelled-3.mp4',
      'cancelled-1.png',
      'cancelled-2.png',
      'cancelled-1.pdf',
      'stray.tif',                 // the lone blob in an otherwise-empty class
      'avatars/cancelled.jpg',
      'documents/cancelled.pdf',
    ];
    mockQuery.mockResolvedValue(referencedFixture.map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [listPage([...referencedFixture, ...orphanFixture].map((name) => ({ name })))],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(summary).toMatchObject({ aborted: false, reason: null, eligible: 82, orphaned: 9, deleted: 9, failed: 0 });
    expect(deleted.sort()).toEqual([...orphanFixture].sort());
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reports the WHOLE-ROOT diagnosis, not a class one, when the whole root is unreferenced', async () => {
    const avatars = Array.from({ length: 30 }, (_, i) => `avatars/u-${i}.jpg`);
    const images = Array.from({ length: 10 }, (_, i) => `thumb-${i}.png`);
    mockQuery.mockResolvedValue(avatars.map((path) => ({ path })));
    const { deleted } = stubFetch({
      pages: [listPage([...avatars, ...images].map((name) => ({ name })))],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-bucket-share-implausible' });
    const message = log.error.mock.calls[0][0] as string;
    expect(message).toContain('the container root');
    expect(message).not.toContain('image files');
    expect(message).toContain('10/10');
  });

  it('aborts on a root class break that a first-glance reading would call videos', async () => {
    const root = rootFleet(60);
    const docs = Array.from({ length: 8 }, (_, i) => `handbook-${i}.pdf`);
    mockQuery.mockResolvedValue(root.map((path) => ({ path })));
    const { deleted } = stubFetch({ pages: [listPage([...root, ...docs].map((name) => ({ name })))] });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'orphan-bucket-share-implausible', orphaned: 8 });
    expect(log.error.mock.calls[0][0] as string).toContain('document files at the container root');
  });
});

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

  it('logs a refusal an operator can act on, not something that reads like a clean run', async () => {
    process.env.ORPHAN_SWEEP_MAX_DELETIONS = '2';
    const orphans = ['x1.mp4', 'x2.mp4', 'x3.mp4'].map((name) => ({ name }));
    stubFetch({ pages: [listPage([...referencedBlobs(), ...orphans])] });
    const log = makeLog();

    await runOrphanSweep(log, NOW);

    const message = log.error.mock.calls[0][0] as string;
    expect(message).toContain('REFUSED TO SWEEP');
    expect(message).toContain('0 blobs deleted');
    expect(message).toContain('NOT a clean run');
    expect(message).toContain('orphan-count-implausible');
    expect(message).toContain('WHAT TO DO');
    expect(message).toContain('ORPHAN_SWEEP_MAX_DELETIONS');
    expect(message).toContain('x1.mp4');
  });

  it('aborts on an EMPTY reference set rather than treating the container as all-orphan', async () => {
    mockQuery.mockResolvedValue([]);
    const { fetchMock } = stubFetch({ pages: [listPage([{ name: 'anything.mp4' }])] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'empty-reference-set', deleted: 0 });
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

describe('orphan-sweep — pre-delete re-check', () => {
  it('drops a candidate that became referenced after BOTH reads around the listing', async () => {
    mockQuery
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockResolvedValueOnce([...REFERENCED_ROWS, { path: 'just-saved.mp4' }]);
    const { deleted } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'just-saved.mp4' }, { name: 'genuine-orphan.mp4' }])],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(deleted).toEqual(['genuine-orphan.mp4']);
    expect(deleted).not.toContain('just-saved.mp4');
    expect(summary).toMatchObject({ aborted: false, orphaned: 2, skippedByRecheck: 1, deleted: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('became referenced after the listing'), [
      'just-saved.mp4',
    ]);
  });

  it('aborts when the re-check fails rather than deleting on information it knows is stale', async () => {
    mockQuery
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockRejectedValueOnce(new Error('pool exhausted'));
    const { deleted } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'stranded.mp4' }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'reference-read-failed', deleted: 0 });
  });

  it('aborts when the re-check comes back empty — a broken query looks exactly like this', async () => {
    mockQuery
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockResolvedValueOnce(REFERENCED_ROWS)
      .mockResolvedValueOnce([]);
    const { deleted } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'stranded.mp4' }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: true, reason: 'empty-reference-set', deleted: 0 });
  });

  it('does not re-read when there is nothing to delete', async () => {
    const { deleted } = stubFetch({ pages: [listPage(referencedBlobs())] });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ aborted: false, deleted: 0, skippedByRecheck: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

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
    expect(summary.scanned).toBe(9);
    expect(deleted).toEqual(['page-three-orphan.mp4']);
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
      expect.objectContaining({ scanned: 9, orphaned: 1, deleted: 1, failed: 0 }),
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
    expect(summary).toMatchObject({ skippedUnsafeName: 1, scanned: 10, eligible: 9 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('will not delete'), 'weird name?x=1.mp4');
  });

  it('carries the reclaimed bytes and the deleted names out of the run', async () => {
    stubFetch({
      pages: [
        listPage([
          ...referencedBlobs(),
          { name: 'stranded-1.mp4', bytes: 4096 },
          { name: 'stranded-2.mp4', bytes: 2048 },
        ]),
      ],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ deleted: 2, bytesReclaimed: 6144 });
    expect(summary.deletedSample).toEqual(['stranded-1.mp4', 'stranded-2.mp4']);
  });

  it('counts a blob Azure listed without a size as 0 bytes rather than guessing', async () => {
    stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'sizeless.mp4', bytes: Number.NaN as unknown as number }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ deleted: 1, bytesReclaimed: 0 });
  });

  it('counts a failed delete in neither the bytes nor the sample', async () => {
    stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'ok.mp4', bytes: 100 }, { name: 'broken.mp4', bytes: 900 }])],
      deleteStatus: { 'broken.mp4': 500 },
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ deleted: 1, failed: 1, bytesReclaimed: 100 });
    expect(summary.deletedSample).toEqual(['ok.mp4']);
  });

  it('caps the sample at 20 names while still counting every deletion', async () => {
    const referenced = Array.from({ length: 30 }, (_, i) => `keep-${i}.mp4`);
    const orphans = Array.from({ length: 25 }, (_, i) => `gone-${i}.mp4`);
    mockQuery.mockResolvedValue([...REFERENCED_ROWS, ...referenced.map((path) => ({ path }))]);
    stubFetch({
      pages: [
        listPage([
          ...referencedBlobs(),
          ...referenced.map((name) => ({ name, bytes: 10 })),
          ...orphans.map((name) => ({ name, bytes: 10 })),
        ]),
      ],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: false, deleted: 25, bytesReclaimed: 250 });
    expect(summary.deletedSample).toHaveLength(20);
    expect(summary.deletedSample[0]).toBe('gone-0.mp4');
  });
});

describe('orphan-sweep — names that are not literal', () => {
  it('skips a <Name Encoded="true"> blob and finishes the run instead of wedging forever', async () => {
    const { deleted } = stubFetch({
      pages: [
        listPage([
          ...referencedBlobs(),
          { name: 'a%00b.mp4', nameAttrs: 'Encoded="true"' },
          { name: 'legit-orphan.mp4' },
        ]),
      ],
    });
    const log = makeLog();

    const summary = await runOrphanSweep(log, NOW);

    expect(summary).toMatchObject({ aborted: false, reason: null, skippedUnsafeName: 1, deleted: 1 });
    expect(deleted).toEqual(['legit-orphan.mp4']);
    expect(deleted).not.toContain('a%00b.mp4');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Encoded="true"'), 'a%00b.mp4');
  });

  it('never deletes a blob whose listed name carries an XML entity', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'a&amp;b.mp4' }, { name: 'legit-orphan.mp4' }])],
    });

    const summary = await runOrphanSweep(makeLog(), NOW);

    expect(deleted).toEqual(['legit-orphan.mp4']);
    expect(deleted).not.toContain('a&amp;b.mp4');
    expect(deleted).not.toContain('a&b.mp4');
    expect(summary).toMatchObject({ aborted: false, skippedUnsafeName: 1 });
  });
});

describe('orphan-sweep — schedule', () => {
  it('refuses a PAST-DUE catch-up run rather than deleting at an arbitrary time of day', async () => {
    const { fetchMock } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'stranded.mp4' }])],
    });
    const log = makeLog();

    const summary = await runScheduledSweep({ isPastDue: true }, log, NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'past-due', deleted: 0 });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('past-due'), expect.anything());
  });

  it('sweeps normally when the timer fired on schedule', async () => {
    const { deleted } = stubFetch({
      pages: [listPage([...referencedBlobs(), { name: 'stranded.mp4' }])],
    });

    const summary = await runScheduledSweep({ isPastDue: false }, makeLog(), NOW);

    expect(deleted).toEqual(['stranded.mp4']);
    expect(summary).toMatchObject({ aborted: false, deleted: 1 });
  });

  it('registers with useMonitor OFF so a missed 03:00 is skipped, never caught up', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/^\s*useMonitor: false,$/m);
    expect(source).toMatch(/^\s*runOnStartup: false,$/m);
    expect(source).toMatch(/const SCHEDULE = '0 0 3 \* \* \*'/);
  });
});

describe('orphan-sweep — run record + alerting hand-off', () => {
  it('hands a completed run over with the summary it returned', async () => {
    stubFetch({ pages: [listPage([...referencedBlobs(), { name: 'stranded.mp4', bytes: 512 }])] });

    const summary = await runScheduledSweep({ isPastDue: false }, makeLog(), NOW);

    expect(mockRecordAndNotify).toHaveBeenCalledTimes(1);
    const [handed, ctx] = mockRecordAndNotify.mock.calls[0];
    expect(handed).toBe(summary);
    expect(handed).toMatchObject({ aborted: false, deleted: 1, bytesReclaimed: 512 });
    expect(ctx).toMatchObject({ startedAt: NOW, now: NOW });
  });

  it('hands an ABORTED run over too — a wedged night is the whole point', async () => {
    process.env.ORPHAN_SWEEP_DISABLED = '1';

    const summary = await runScheduledSweep({ isPastDue: false }, makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'disabled' });
    expect(mockRecordAndNotify).toHaveBeenCalledTimes(1);
    expect(mockRecordAndNotify.mock.calls[0][0]).toMatchObject({ aborted: true, reason: 'disabled' });
  });

  it('hands a PAST-DUE refusal over as well, so the run is still recorded', async () => {
    const summary = await runScheduledSweep({ isPastDue: true }, makeLog(), NOW);

    expect(summary).toMatchObject({ aborted: true, reason: 'past-due' });
    expect(mockRecordAndNotify).toHaveBeenCalledTimes(1);
  });

  it('returns the sweep result unchanged when the alerting throws', async () => {
    mockRecordAndNotify.mockRejectedValueOnce(new Error('alerting exploded'));
    const { deleted } = stubFetch({ pages: [listPage([...referencedBlobs(), { name: 'stranded.mp4' }])] });
    const log = makeLog();

    const summary = await runScheduledSweep({ isPastDue: false }, log, NOW);

    expect(summary).toMatchObject({ aborted: false, reason: null, deleted: 1 });
    expect(deleted).toEqual(['stranded.mp4']);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('the sweep result above stands'), expect.anything());
  });
});

describe('blobBucket', () => {
  it('buckets a prefixed name by its first segment, slash included', () => {
    expect(blobBucket('avatars/user-1.jpg')).toBe('avatars/');
    expect(blobBucket('org-logos/org-1.png')).toBe('org-logos/');
    expect(blobBucket('documents/handbook.pdf')).toBe('documents/');
    expect(blobBucket('videos/welcome.mp4')).toBe('videos/');
  });

  it('buckets a bare name at the container root', () => {
    expect(blobBucket('abc.mp4')).toBe('');
  });

  it('buckets a nested name by its FIRST segment only', () => {
    expect(blobBucket('a/b/c.mp4')).toBe('a/');
  });
});

describe('rootFileClass', () => {
  it('classifies by extension, using the same allow-list the upload gates use', () => {
    expect(rootFileClass('thumb.png')).toBe('image');
    expect(rootFileClass('thumb.jpeg')).toBe('image');
    expect(rootFileClass('thumb.webp')).toBe('image');
    expect(rootFileClass('clip.mp4')).toBe('video');
    expect(rootFileClass('clip.mov')).toBe('video');
    expect(rootFileClass('handbook.pdf')).toBe('document');
    expect(rootFileClass('sheet.xlsx')).toBe('document');
  });

  it('reads the extension case-insensitively without touching the name itself', () => {
    expect(rootFileClass('THUMB.PNG')).toBe('image');
    expect(rootFileClass('Clip.MP4')).toBe('video');
  });

  it('puts anything it cannot classify in `other` — a real bucket, not a discard', () => {
    expect(rootFileClass('legacy.tif')).toBe('other');
    expect(rootFileClass('archive.zip')).toBe('other');
    expect(rootFileClass('noextension')).toBe('other');
    expect(rootFileClass('trailing.')).toBe('other');
  });
});

describe('blobBuckets', () => {
  it('gives a ROOT name two buckets: the undivided root first, then its file-type class', () => {
    const buckets = blobBuckets('abc.mp4');
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toBe('');
    expect(buckets[1]).not.toBe('');
    expect(blobBuckets('abc.png')[1]).not.toBe(buckets[1]);
    expect(blobBuckets('def.mp4')[1]).toBe(buckets[1]);
  });

  it('does NOT split a PREFIXED name by extension — one bucket, the prefix', () => {
    expect(blobBuckets('avatars/u-1.jpg')).toEqual(['avatars/']);
    expect(blobBuckets('org-logos/o-1.png')).toEqual(['org-logos/']);
    expect(blobBuckets('documents/handbook.pdf')).toEqual(['documents/']);
    expect(blobBuckets('videos/welcome.mp4')).toEqual(['videos/']);
  });

  it('cannot collide a class key with a bucket key derived from a real blob name', () => {
    for (const name of ['abc.mp4', 'thumb.png', 'weird.tif', 'avatars/u.jpg']) {
      for (const bucket of blobBuckets(name)) {
        expect(bucket === '' || bucket.endsWith('/') || !bucket.includes('/')).toBe(true);
      }
    }
    expect(blobBuckets('abc.mp4')[1]).not.toMatch(/\/$/);
  });
});
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
      { name: 'avatars/x.jpg', contentLength: 77, lastModified: Date.parse(hoursAgo(10)), encodedName: false },
    ]);
    expect(parsed?.nextMarker).toBeNull();
  });

  it('parses a <Name> that carries attributes, flagging the name as not-literal', () => {
    const parsed = parseListPage(listPage([{ name: 'a%00b.mp4', nameAttrs: 'Encoded="true"', bytes: 12, ageHours: 10 }]));
    expect(parsed).not.toBeNull();
    expect(parsed?.blobs).toEqual([
      { name: 'a%00b.mp4', contentLength: 12, lastModified: Date.parse(hoursAgo(10)), encodedName: true },
    ]);
  });

  it('flags ANY attribute on <Name>, not just Encoded="true"', () => {
    const parsed = parseListPage(listPage([{ name: 'x.mp4', nameAttrs: 'Something="else"' }]));
    expect(parsed?.blobs[0]).toMatchObject({ name: 'x.mp4', encodedName: true });
  });

  it('leaves XML entities in the name exactly as sent — there is no decode step to get wrong', () => {
    const parsed = parseListPage(listPage([{ name: 'a&amp;b.mp4' }]));
    expect(parsed?.blobs[0]).toMatchObject({ name: 'a&amp;b.mp4', encodedName: false });
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
