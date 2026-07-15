import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

const VALID_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
type CourseLevel = typeof VALID_LEVELS[number];

export default adminEndpoint('course-create', async ({ req, profile, reply }) => {
    const body = await req.json() as {
      title?: unknown;
      description?: unknown;
      level?: unknown;
      thumbnailUrl?: unknown;
    };

    const { title, description, level, thumbnailUrl } = body;

    // Validate title: required, non-empty string
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return reply(400, { error: 'title is required' });
    }

    // Validate level: required, must be one of the enum values
    if (!level || !VALID_LEVELS.includes(level as CourseLevel)) {
      return reply(400, { error: 'level must be basic, intermediate, or advanced' });
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
      `INSERT INTO courses (title, description, level, thumbnail_url, created_by_user_id, is_published)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING *`,
      [
        title,
        description ?? null,
        level,
        thumbnailUrl ?? null,
        profile.id,  // server-set — never from client body
      ],
    );

    return reply(200, { course });
});
