import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

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
  };

  const { title, description, level, language, thumbnailUrl } = body;

  // Validate title: required, non-empty string
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return reply(400, { error: 'title is required' });
  }

  // Validate level: required, must be one of the enum values
  if (!level || !VALID_LEVELS.includes(level as CourseLevel)) {
    return reply(400, { error: 'level must be basic, intermediate, or advanced' });
  }

  // Validate language: required, must be 'en' or 'da'
  if (!VALID_LANGUAGES.includes(language as CourseLanguage)) {
    return reply(400, { error: "language must be 'en' or 'da'" });
  }

  // Validate description: if present, must be string or null (empty string allowed;
  // null accepted for consistency with course-update — the column is nullable)
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return reply(400, { error: 'description must be a string or null' });
  }

  // Validate thumbnailUrl: if present, must be string or null
  if (thumbnailUrl !== undefined && thumbnailUrl !== null && typeof thumbnailUrl !== 'string') {
    return reply(400, { error: 'thumbnailUrl must be a string or null' });
  }

  const course = await queryOne(
    `INSERT INTO courses (title, description, level, language, thumbnail_url, created_by_user_id, is_published)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     RETURNING *`,
    [
      title,
      description ?? null,
      level,
      language,
      thumbnailUrl ?? null,
      profile.id,  // server-set — never from client body
    ],
  );

  return reply(200, { course });
});
