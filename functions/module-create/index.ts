import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('module-create', async ({ req, reply }) => {
    const body = await req.json() as { courseId?: unknown; title?: unknown };
    const { courseId, title } = body;

    if (!courseId || typeof courseId !== 'string') {
      return reply(400, { error: 'courseId is required' });
    }

    if (!title || typeof title !== 'string' || (title as string).trim() === '') {
      return reply(400, { error: 'title is required' });
    }

    // sort_order is server-owned (issue #46): computed as MAX+1 within the course
    // inside the INSERT. Any client-supplied sortOrder is ignored — array-length
    // ranks from the client collided after delete-middle-then-add.
    const module_ = await queryOne(
      `INSERT INTO course_modules (course_id, title, sort_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM course_modules WHERE course_id = $1))
       RETURNING *`,
      [courseId, title], // title stored raw — trim is validation-only (course-create parity)
    );

    return reply(200, { module: module_ });
});
