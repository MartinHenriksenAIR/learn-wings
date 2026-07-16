import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('module-update', async ({ req, reply }) => {
  const body = await req.json() as { moduleId?: unknown; title?: unknown };
  const { moduleId, title } = body;

  if (!moduleId || typeof moduleId !== 'string') {
    return reply(400, { error: 'moduleId is required' });
  }

  if (!title || typeof title !== 'string' || (title as string).trim() === '') {
    return reply(400, { error: 'title is required' });
  }

  const module_ = await queryOne(
    `UPDATE course_modules SET title = $1 WHERE id = $2 RETURNING *`,
    [title, moduleId], // title stored raw — trim is validation-only (course-create parity)
  );

  if (!module_) {
    return reply(404, { error: 'Module not found' });
  }

  return reply(200, { module: module_ });
});
