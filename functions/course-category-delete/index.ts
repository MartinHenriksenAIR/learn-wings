import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('course-category-delete', async ({ req, reply }) => {
  const body = await req.json() as { categoryId?: unknown };
  const { categoryId } = body;

  if (!categoryId || typeof categoryId !== 'string') {
    return reply(400, { error: 'categoryId is required' });
  }

  const deleted = await queryOne(
    `DELETE FROM course_categories WHERE id = $1 RETURNING id`,
    [categoryId],
  );

  if (!deleted) {
    return reply(404, { error: 'Category not found' });
  }

  return reply(200, { success: true });
});
