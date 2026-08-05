import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths, isBlobReleasable } from '../shared/blob-ownership';

const VALID_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
type CourseLevel = typeof VALID_LEVELS[number];

const VALID_LANGUAGES = ['en', 'da'] as const;
type CourseLanguage = typeof VALID_LANGUAGES[number];

// Column mapping from client key to DB column name
const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  level: 'level',
  language: 'language',
  thumbnailUrl: 'thumbnail_url',
  categoryId: 'category_id',
  isPublished: 'is_published',
};

export default adminEndpoint('course-update', async ({ req, reply }) => {
  const body = await req.json() as {
    courseId?: unknown;
    updates?: unknown;
  };

  const { courseId, updates } = body;

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return reply(400, { error: 'No valid fields to update' });
  }

  const updatesObj = updates as Record<string, unknown>;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [clientKey, column] of Object.entries(COLUMN_MAP)) {
    if (!(clientKey in updatesObj)) continue;

    const value = updatesObj[clientKey];

    if (clientKey === 'title') {
      if (!value || typeof value !== 'string' || (value as string).trim() === '') {
        return reply(400, { error: 'title must be a non-empty string' });
      }
    } else if (clientKey === 'description') {
      if (value !== null && typeof value !== 'string') {
        return reply(400, { error: 'description must be a string or null' });
      }
    } else if (clientKey === 'level') {
      if (!VALID_LEVELS.includes(value as CourseLevel)) {
        return reply(400, { error: 'level must be basic, intermediate, or advanced' });
      }
    } else if (clientKey === 'language') {
      if (!VALID_LANGUAGES.includes(value as CourseLanguage)) {
        return reply(400, { error: "language must be 'en' or 'da'" });
      }
    } else if (clientKey === 'thumbnailUrl') {
      if (value !== null && typeof value !== 'string') {
        return reply(400, { error: 'thumbnailUrl must be a string or null' });
      }
    } else if (clientKey === 'categoryId') {
      // null clears the category (uncategorized); a string is checked for existence
      // below, before the UPDATE. Anything else is rejected here.
      if (value !== null && typeof value !== 'string') {
        return reply(400, { error: 'categoryId must be a string or null' });
      }
    } else if (clientKey === 'isPublished') {
      if (typeof value !== 'boolean') {
        return reply(400, { error: 'isPublished must be a boolean' });
      }
    }

    params.push(value);
    setClauses.push(`${column} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return reply(400, { error: 'No valid fields to update' });
  }

  // Category existence check — an independent lookup, run before the thumbnail
  // SELECT/blob gates so an invalid category fails fast without touching storage.
  // Only a non-null string needs checking; null (clear) was accepted in the loop.
  if ('categoryId' in updatesObj && typeof updatesObj.categoryId === 'string') {
    const category = await queryOne('SELECT 1 FROM course_categories WHERE id = $1', [updatesObj.categoryId]);
    if (!category) {
      return reply(400, { error: 'category not found' });
    }
  }

  // The blob path this update will write to thumbnail_url — `undefined` when the
  // caller never supplied thumbnailUrl, which is NOT a clear: an absent key leaves
  // the column (and its blob) alone. Validated above as string | null.
  const nextThumbnail = 'thumbnailUrl' in updatesObj
    ? (updatesObj.thumbnailUrl as string | null)
    : undefined;

  // Previous thumbnail blob path, read before the write so the superseded blob can
  // be deleted afterwards — a replace (or a clear-to-null) used to strand the file.
  // Issued ONLY when the update actually writes the column, so an unrelated field
  // change costs no extra round trip and can never delete a live thumbnail.
  //
  // A plain SELECT rather than pulling the old value out of the UPDATE itself: the
  // `RETURNING *` row is handed straight back to the client, so the self-join form
  // would leak a prev_* column into the response body.
  //
  // Deliberately NOT transactional: blob deletes are irreversible and cannot join a
  // DB transaction, and a stranded blob is strictly less bad than a failed update.
  let previousThumbnail: string | null = null;
  if (nextThumbnail !== undefined) {
    const prev = await queryOne<{ thumbnail_url: string | null }>(
      `SELECT thumbnail_url FROM courses WHERE id = $1`,
      [courseId],
    );
    previousThumbnail = prev?.thumbnail_url ?? null;
  }

  // One candidate list, handed to both gates in order, so they can never be given
  // different views of the same write. Thumbnails have NO folder prefix
  // (`azure-upload-url` gives non-branding uploads an empty prefix), so the family
  // is the flat `lms` namespace they share with lesson videos and documents —
  // which is why `kind: 'image'` matters here as more than a cap: it is what makes
  // the extension allow-list refuse a `.mp4` in `thumbnail_url`.
  const candidates: UploadCandidate[] = [{ path: nextThumbnail, kind: 'image', family: 'lms' }];

  // Ownership gate FIRST — before `enforceUploadLimits`, so no path this caller
  // may not bind is ever handed to `headBlob`. Within the flat namespace the
  // binding rule is "already on this row, or referenced by no row at all", since
  // the prefix cannot distinguish one course's thumbnail from another's.
  const bindError = await assertBindablePaths(candidates, [previousThumbnail]);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  // Size/type gate on a newly-referenced thumbnail (#276) — the client's cap is
  // advisory (the browser PUTs straight to storage), so this is where an
  // over-cap image is actually stopped, before the row is written. Reuses the
  // same change detection as the cleanup below: an unchanged path is not new, so
  // re-saving a course costs no HEAD.
  const limitError = await enforceUploadLimits(candidates, [previousThumbnail]);
  if (limitError) {
    return reply(413, { error: limitError });
  }

  params.push(courseId);
  const sql = `UPDATE courses SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`;

  const course = await queryOne(sql, params);
  if (!course) return reply(404, { error: 'Course not found' });

  // Best-effort cleanup of the superseded thumbnail, only after the row write
  // succeeded. An unchanged path is left alone; a null old path has nothing to
  // delete. deleteBlob never throws and its result is deliberately NOT surfaced in
  // the response — server logs are the only failure signal.
  //
  // `isBlobReleasable` runs AFTER the UPDATE on purpose: the row now points at the
  // new value, so "does any row still reference the old path?" is exactly the
  // question worth asking — and in a flat namespace it is the only thing that can
  // tell a superseded thumbnail from a live lesson video.
  if (previousThumbnail
    && previousThumbnail !== nextThumbnail
    && await isBlobReleasable(previousThumbnail, 'lms')) {
    await deleteBlob(previousThumbnail);
  }

  return reply(200, { course });
});
