import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('course-categories', async ({ reply }) => {
  const categories = await query(
    `SELECT * FROM course_categories ORDER BY sort_order, name_en`,
    [],
  );
  return reply(200, { categories });
});
