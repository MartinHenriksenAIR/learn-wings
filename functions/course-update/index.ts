import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

const VALID_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
type CourseLevel = typeof VALID_LEVELS[number];

// Column mapping from client key to DB column name
const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  level: 'level',
  thumbnailUrl: 'thumbnail_url',
  isPublished: 'is_published',
};

export default adminEndpoint('course-update', async ({ req, reply }) => {
    const body = await req.json() as {
      courseId?: unknown;
      updates?: unknown;
    };

    const { courseId, updates } = body;

    // Validate courseId
    if (!courseId || typeof courseId !== 'string') {
      return reply(400, { error: 'courseId is required' });
    }

    // Validate updates: must be a non-null object with at least one whitelisted key
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return reply(400, { error: 'No valid fields to update' });
    }

    const updatesObj = updates as Record<string, unknown>;

    // Validate individual fields and build SET clause
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
      } else if (clientKey === 'thumbnailUrl') {
        if (value !== null && typeof value !== 'string') {
          return reply(400, { error: 'thumbnailUrl must be a string or null' });
        }
      } else if (clientKey === 'isPublished') {
        if (typeof value !== 'boolean') {
          return reply(400, { error: 'isPublished must be a boolean' });
        }
      }

      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }

    // Must have at least one field to update
    if (setClauses.length === 0) {
      return reply(400, { error: 'No valid fields to update' });
    }

    params.push(courseId);
    const sql = `UPDATE courses SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`;

    const course = await queryOne(sql, params);
    if (!course) return reply(404, { error: 'Course not found' });

    return reply(200, { course });
});
