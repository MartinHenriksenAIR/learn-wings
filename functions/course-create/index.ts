import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

const VALID_LEVELS = ['basic', 'intermediate', 'advanced'] as const;
type CourseLevel = typeof VALID_LEVELS[number];

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
      title?: unknown;
      description?: unknown;
      level?: unknown;
      thumbnailUrl?: unknown;
    };

    const { title, description, level, thumbnailUrl } = body;

    // Validate title: required, non-empty string
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return corsResponse(origin, 400, { error: 'title is required' }) as HttpResponseInit;
    }

    // Validate level: required, must be one of the enum values
    if (!level || !VALID_LEVELS.includes(level as CourseLevel)) {
      return corsResponse(origin, 400, { error: 'level must be basic, intermediate, or advanced' }) as HttpResponseInit;
    }

    // Validate description: if present, must be string (empty string allowed)
    if (description !== undefined && typeof description !== 'string') {
      return corsResponse(origin, 400, { error: 'description must be a string' }) as HttpResponseInit;
    }

    // Validate thumbnailUrl: if present, must be string or null
    if (thumbnailUrl !== undefined && thumbnailUrl !== null && typeof thumbnailUrl !== 'string') {
      return corsResponse(origin, 400, { error: 'thumbnailUrl must be a string or null' }) as HttpResponseInit;
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

    return corsResponse(origin, 200, { course }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('course-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
