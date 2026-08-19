import { endpoint } from '../shared/endpoint';
import { deleteBlob, classifyBlobPath, type BlobPathFamily } from '../shared/blob';
import { isBlobReleasable } from '../shared/blob-ownership';
import { verifyReleaseToken } from '../shared/release-token';

const FAMILIES: readonly BlobPathFamily[] = ['avatar', 'org-logo', 'lms'];

function familyOf(blobPath: string): BlobPathFamily | null {
  return FAMILIES.find((family) => classifyBlobPath(blobPath, family) === 'own') ?? null;
}

export default endpoint('blob-release', async ({ req, profile, reply }) => {
  const { blobPath, releaseToken } = await req.json() as { blobPath?: unknown; releaseToken?: unknown };

  if (typeof blobPath !== 'string' || blobPath === '') {
    return reply(400, { error: 'blobPath is required' });
  }
  if (typeof releaseToken !== 'string' || releaseToken === '') {
    return reply(400, { error: 'releaseToken is required' });
  }

  if (!verifyReleaseToken(releaseToken, blobPath, profile.id)) {
    return reply(403, { error: 'Forbidden' });
  }

  const family = familyOf(blobPath);
  if (!family) {
    return reply(400, { error: 'Invalid upload path' });
  }

  if (!await isBlobReleasable(blobPath, family)) {
    return reply(200, { released: false });
  }

  return reply(200, { released: await deleteBlob(blobPath) });
});
