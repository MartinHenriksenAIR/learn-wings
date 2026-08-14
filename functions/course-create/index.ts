import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths } from '../shared/blob-ownership';

const VALID_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
type CourseLevel = typeof VALID_LEVELS[number];

const VALID_LANGUAGES = ['en', 'da'] as const;
type CourseLanguage = typeof VALID_LANGUAGES[number];

export default adminEndpoint('course-create', async ({ req, profile, reply }) => {
  const body = await req.json() as {
    title?: unknown;
    description?: unknown;
    level?: unknown;
    language?: unknown;
    thumbnailUrl?: unknown;
    categoryId?: unknown;
  };

  const { title, description, level, language, thumbnailUrl, categoryId } = body;

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return reply(400, { error: 'title is required' });
  }

  if (!level || !VALID_LEVELS.includes(level as CourseLevel)) {
    return reply(400, { error: 'level must be basic, intermediate, or advanced' });
  }

  if (!VALID_LANGUAGES.includes(language as CourseLanguage)) {
    return reply(400, { error: "language must be 'en' or 'da'" });
  }

  if (description !== undefined && description !== null && typeof description !== 'string') {
    return reply(400, { error: 'description must be a string or null' });
  }

  if (thumbnailUrl !== undefined && thumbnailUrl !== null && typeof thumbnailUrl !== 'string') {
    return reply(400, { error: 'thumbnailUrl must be a string or null' });
  }

  if (categoryId !== undefined && categoryId !== null && typeof categoryId !== 'string') {
    return reply(400, { error: 'categoryId must be a string or null' });
  }
  if (typeof categoryId === 'string') {
    const category = await queryOne('SELECT 1 FROM course_categories WHERE id = $1', [categoryId]);
    if (!category) {
      return reply(400, { error: 'category not found' });
    }
  }

  const candidates: UploadCandidate[] = [
    { path: thumbnailUrl as string | null | undefined, kind: 'image', family: 'lms' },
  ];

  const bindError = await assertBindablePaths(candidates);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  const limitError = await enforceUploadLimits(candidates);
  if (limitError) {
    return reply(413, { error: limitError });
  }

  const course = await queryOne(
    `INSERT INTO courses (title, description, level, language, thumbnail_url, created_by_user_id, category_id, is_published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING *`,
    [
      title,
      description ?? null,
      level,
      language,
      thumbnailUrl ?? null,
      profile.id,  // server-set — never from client body
      categoryId ?? null,
    ],
  );

  return reply(200, { course });
});
