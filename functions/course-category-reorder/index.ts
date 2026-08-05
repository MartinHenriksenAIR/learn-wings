import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { PoolClient } from 'pg';

export default adminEndpoint('course-category-reorder', async ({ req, reply }) => {
  const body = await req.json() as { orderedIds?: unknown };
  const { orderedIds } = body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return reply(400, { error: 'orderedIds must be a non-empty array' });
  }
  if (!orderedIds.every((id) => typeof id === 'string')) {
    return reply(400, { error: 'orderedIds must contain only strings' });
  }
  const ids = orderedIds as string[];

  // One transaction: set sort_order = position for every id given, then read the
  // whole table back in the new order. Ids not present are simply left as-is
  // (we only update what the caller sent), but the writes + the read are atomic.
  const categories = await withTransaction(async (client: PoolClient) => {
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE course_categories SET sort_order = $1 WHERE id = $2`,
        [i, ids[i]],
      );
    }
    const { rows } = await client.query(
      `SELECT * FROM course_categories ORDER BY sort_order, name_en`,
    );
    return rows;
  });

  return reply(200, { categories });
});
