import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('course-category-update', async ({ req, reply }) => {
  const body = await req.json() as {
    categoryId?: unknown;
    updates?: { nameEn?: unknown; nameDa?: unknown };
  };
  const { categoryId, updates } = body;

  if (!categoryId || typeof categoryId !== 'string') {
    return reply(400, { error: 'categoryId is required' });
  }
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return reply(400, { error: 'updates must be an object' });
  }

  // Only name_en / name_da are mutable here — slug and sort_order are never
  // touched by a rename (slug stays whatever CREATE derived; order is the
  // reorder endpoint's job). Build the SET clause from whichever names are given.
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.nameEn !== undefined) {
    if (typeof updates.nameEn !== 'string' || updates.nameEn.trim() === '') {
      return reply(400, { error: 'nameEn must be a non-empty string' });
    }
    params.push(updates.nameEn.trim());
    setClauses.push(`name_en = $${params.length}`);
  }
  if (updates.nameDa !== undefined) {
    if (typeof updates.nameDa !== 'string' || updates.nameDa.trim() === '') {
      return reply(400, { error: 'nameDa must be a non-empty string' });
    }
    params.push(updates.nameDa.trim());
    setClauses.push(`name_da = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return reply(400, { error: 'No update fields provided' });
  }

  params.push(categoryId);
  const category = await queryOne(
    `UPDATE course_categories SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );

  if (!category) {
    return reply(404, { error: 'Category not found' });
  }

  return reply(200, { category });
});
