import { query } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('courses-admin', async ({ reply }) => {
  const [courses, accessRecords] = await Promise.all([
    query(`SELECT * FROM courses ORDER BY created_at DESC`),
    query(`SELECT * FROM org_course_access`),
  ]);

  return reply(200, { courses, accessRecords });
});
