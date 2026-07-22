import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled } from '../shared/course-visibility';
import { courseGroupKey } from '../shared/course-groups';

const asLang = (v: unknown): 'en' | 'da' => (v === 'en' || v === 'da' ? v : 'da');

export default endpoint('org-course-progress', async ({ req, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const { orgId, adminLang } = await req.json() as { orgId?: string; adminLang?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  const lang = asLang(adminLang);

  // Representative edition per group: prefer the admin's app-language edition,
  // else the earliest-created; NULL languages never win ((x = $n) IS TRUE → false).
  // enrolled/completed are summed over the SAME visible edition set.

  if (orgId === 'all') {
    // All-orgs aggregate (#159) — platform-admin-only. Distinct learners across a group's
    // editions and orgs (a learner in different editions across two orgs counts once).
    requirePlatformAdmin();
    const courses = await query(
      `WITH visible AS (
         SELECT c.id, c.title, c.level, c.language, c.created_at,
                ${courseGroupKey('c')} AS group_key
           FROM courses c
          WHERE EXISTS (SELECT 1 FROM org_course_access oca
                         WHERE oca.course_id = c.id AND oca.access = 'enabled')
       ),
       counts AS (
         SELECT v.group_key,
                COUNT(DISTINCT e.user_id)::int AS enrolled,
                COUNT(DISTINCT e.user_id) FILTER (WHERE e.status = 'completed')::int AS completed
           FROM visible v
           LEFT JOIN enrollments e ON e.course_id = v.id
          GROUP BY v.group_key
       ),
       rep AS (
         SELECT DISTINCT ON (group_key) group_key, id, title, level
           FROM visible
          ORDER BY group_key, (language = $1) IS TRUE DESC, created_at ASC, id ASC
       )
       SELECT rep.id, rep.title, rep.level, counts.enrolled, counts.completed
         FROM rep JOIN counts USING (group_key)
        ORDER BY rep.title`,
      [lang],
    );
    return reply(200, { courses });
  }

  await requireOrgAdmin(orgId);

  const courses = await query(
    `WITH visible AS (
       SELECT c.id, c.title, c.level, c.language, c.created_at,
              ${courseGroupKey('c')} AS group_key
         FROM courses c
        WHERE ${orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 })}
     ),
     counts AS (
       SELECT v.group_key,
              COUNT(e.id)::int AS enrolled,
              COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
         FROM visible v
         LEFT JOIN enrollments e ON e.course_id = v.id AND e.org_id = $1
        GROUP BY v.group_key
     ),
     rep AS (
       SELECT DISTINCT ON (group_key) group_key, id, title, level
         FROM visible
        ORDER BY group_key, (language = $2) IS TRUE DESC, created_at ASC, id ASC
     )
     SELECT rep.id, rep.title, rep.level, counts.enrolled, counts.completed
       FROM rep JOIN counts USING (group_key)
      ORDER BY rep.title`,
    [orgId, lang],
  );
  return reply(200, { courses });
});
