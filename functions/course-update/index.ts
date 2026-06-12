import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

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

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    const body = await req.json() as {
      courseId?: unknown;
      updates?: unknown;
    };

    const { courseId, updates } = body;

    // Validate courseId
    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' }) as HttpResponseInit;
    }

    // Validate updates: must be a non-null object with at least one whitelisted key
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return corsResponse(origin, 400, { error: 'No valid fields to update' }) as HttpResponseInit;
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
          return corsResponse(origin, 400, { error: 'title must be a non-empty string' }) as HttpResponseInit;
        }
      } else if (clientKey === 'description') {
        if (value !== null && typeof value !== 'string') {
          return corsResponse(origin, 400, { error: 'description must be a string or null' }) as HttpResponseInit;
        }
      } else if (clientKey === 'level') {
        if (!VALID_LEVELS.includes(value as CourseLevel)) {
          return corsResponse(origin, 400, { error: 'level must be basic, intermediate, or advanced' }) as HttpResponseInit;
        }
      } else if (clientKey === 'thumbnailUrl') {
        if (value !== null && typeof value !== 'string') {
          return corsResponse(origin, 400, { error: 'thumbnailUrl must be a string or null' }) as HttpResponseInit;
        }
      } else if (clientKey === 'isPublished') {
        if (typeof value !== 'boolean') {
          return corsResponse(origin, 400, { error: 'isPublished must be a boolean' }) as HttpResponseInit;
        }
      }

      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    }

    // Must have at least one field to update
    if (setClauses.length === 0) {
      return corsResponse(origin, 400, { error: 'No valid fields to update' }) as HttpResponseInit;
    }

    params.push(courseId);
    const sql = `UPDATE courses SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`;

    const course = await queryOne(sql, params);
    if (!course) return corsResponse(origin, 404, { error: 'Course not found' }) as HttpResponseInit;

    return corsResponse(origin, 200, { course }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('course-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
