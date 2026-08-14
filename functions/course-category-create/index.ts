import { query, queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { slugify } from '../shared/slug';

export default adminEndpoint('course-category-create', async ({ req, reply }) => {
  const body = await req.json() as { nameEn?: unknown; nameDa?: unknown };
  const { nameEn, nameDa } = body;

  if (!nameEn || typeof nameEn !== 'string' || nameEn.trim() === '') {
    return reply(400, { error: 'nameEn is required' });
  }
  if (!nameDa || typeof nameDa !== 'string' || nameDa.trim() === '') {
    return reply(400, { error: 'nameDa is required' });
  }

  const base = slugify(nameEn) || 'category';

  const existing = await query<{ slug: string }>(
    `SELECT slug FROM course_categories WHERE slug = $1 OR slug LIKE $2`,
    [base, `${base}-%`],
  );
  const taken = new Set(existing.map((r) => r.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

  const category = await queryOne(
    `INSERT INTO course_categories (name_en, name_da, slug, sort_order)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM course_categories))
     RETURNING *`,
    [nameEn.trim(), nameDa.trim(), slug],
  );

  return reply(200, { category });
});
