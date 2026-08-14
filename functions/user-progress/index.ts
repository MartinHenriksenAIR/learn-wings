import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate } from '../shared/course-visibility';

interface EnrollmentRow {
  id: string; course_id: string; status: string; enrolled_at: string; completed_at: string | null;
  title: string; level: string;
}
interface ProgressRow { lesson_id: string; status: string; completed_at: string | null }
interface AttemptRow {
  id: string; quiz_id: string; score: number; passed: boolean;
  started_at: string; finished_at: string | null;
}
interface StructureRow {
  module_id: string; course_id: string; module_title: string; module_sort_order: number;
  lesson_id: string | null; lesson_title: string | null; lesson_type: string | null;
  lesson_sort_order: number | null;
}
interface QuizRow { id: string; lesson_id: string }

interface LessonOut {
  id: string; title: string; lessonType: string; sortOrder: number;
  status: string; completedAt: string | null;
  quizId?: string; latestQuizScore?: number; latestQuizPassed?: boolean;
}
interface ModuleOut { id: string; title: string; sortOrder: number; lessons: LessonOut[] }

export default endpoint('user-progress', async ({ req, profile, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const body = await req.json() as { orgId?: unknown; userId?: unknown };
  const { orgId, userId } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!userId || typeof userId !== 'string') {
    return reply(400, { error: 'userId is required' });
  }

  const allOrgs = orgId === 'all';

  if (allOrgs) requirePlatformAdmin();
  else await requireOrgAdmin(orgId);

  const visibilityFilter = profile.is_platform_admin
    ? ''
    : `AND ${courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 })}`;
  const enrollments = allOrgs
    ? await query<EnrollmentRow>(
        `SELECT id, course_id, status, enrolled_at, completed_at, title, level FROM (
           SELECT DISTINCT ON (e.course_id) e.id, e.course_id, e.status, e.enrolled_at,
                  e.completed_at, c.title, c.level
             FROM enrollments e
             JOIN courses c ON c.id = e.course_id
            WHERE e.user_id = $1
            ORDER BY e.course_id, (e.status = 'completed') DESC, e.enrolled_at ASC
         ) sub
        ORDER BY title`,
        [userId],
      )
    : await query<EnrollmentRow>(
        `SELECT e.id, e.course_id, e.status, e.enrolled_at, e.completed_at, c.title, c.level
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
          WHERE e.org_id = $1 AND e.user_id = $2 ${visibilityFilter}
          ORDER BY c.title`,
        [orgId, userId],
      );
  if (enrollments.length === 0) {
    return reply(200, { courses: [] });
  }
  const courseIds = enrollments.map((e) => e.course_id);

  const [progressRows, attemptRows, structureRows] = await Promise.all([
    allOrgs
      ? query<ProgressRow>(
          `SELECT lesson_id, status, completed_at FROM lesson_progress
            WHERE user_id = $1
            ORDER BY (status = 'completed')`,
          [userId],
        )
      : query<ProgressRow>(
          `SELECT lesson_id, status, completed_at FROM lesson_progress
            WHERE org_id = $1 AND user_id = $2`,
          [orgId, userId],
        ),
    allOrgs
      ? query<AttemptRow>(
          `SELECT id, quiz_id, score, passed, started_at, finished_at
             FROM quiz_attempts WHERE user_id = $1
            ORDER BY started_at DESC`,
          [userId],
        )
      : query<AttemptRow>(
          `SELECT id, quiz_id, score, passed, started_at, finished_at
             FROM quiz_attempts WHERE org_id = $1 AND user_id = $2
            ORDER BY started_at DESC`,
          [orgId, userId],
        ),
    query<StructureRow>(
      `SELECT cm.id AS module_id, cm.course_id, cm.title AS module_title,
              cm.sort_order AS module_sort_order,
              l.id AS lesson_id, l.title AS lesson_title, l.lesson_type,
              l.sort_order AS lesson_sort_order
         FROM course_modules cm
         LEFT JOIN lessons l ON l.module_id = cm.id
        WHERE cm.course_id = ANY($1)
        ORDER BY cm.course_id, cm.sort_order, l.sort_order`,
      [courseIds],
    ),
  ]);

  const lessonIds = structureRows
    .map((r) => r.lesson_id)
    .filter((id): id is string => id !== null);
  const quizRows = lessonIds.length > 0
    ? await query<QuizRow>(`SELECT id, lesson_id FROM quizzes WHERE lesson_id = ANY($1)`, [lessonIds])
    : [];

  const progressMap = new Map(progressRows.map((p) => [p.lesson_id, p]));
  const quizByLesson = new Map(quizRows.map((q) => [q.lesson_id, q.id]));
  const lessonByQuiz = new Map(quizRows.map((q) => [q.id, q.lesson_id]));

  const courses = enrollments.map((e) => {
    const moduleMap = new Map<string, ModuleOut>();
    for (const row of structureRows) {
      if (row.course_id !== e.course_id) continue;
      let mod = moduleMap.get(row.module_id);
      if (!mod) {
        mod = { id: row.module_id, title: row.module_title, sortOrder: row.module_sort_order, lessons: [] };
        moduleMap.set(row.module_id, mod);
      }
      if (row.lesson_id !== null) {
        const progress = progressMap.get(row.lesson_id);
        const quizId = quizByLesson.get(row.lesson_id);
        const latest = quizId !== undefined
          ? attemptRows.find((a) => a.quiz_id === quizId) // attempts are DESC — first match is latest
          : undefined;
        mod.lessons.push({
          id: row.lesson_id,
          title: row.lesson_title as string,
          lessonType: row.lesson_type as string,
          sortOrder: row.lesson_sort_order as number,
          status: progress?.status ?? 'not_started',
          completedAt: progress?.completed_at ?? null,
          quizId, // undefined keys are dropped by JSON.stringify — dialog's !== undefined guard
          latestQuizScore: latest?.score,
          latestQuizPassed: latest?.passed,
        });
      }
    }
    const modules = [...moduleMap.values()];
    const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);
    const completedLessons = modules.reduce(
      (acc, m) => acc + m.lessons.filter((l) => l.status === 'completed').length, 0);

    const courseQuizIds = new Set(
      modules.flatMap((m) => m.lessons.map((l) => l.quizId)).filter(Boolean));
    const lessonTitleById = new Map(
      modules.flatMap((m) => m.lessons).map((l) => [l.id, l.title]));
    const quizAttempts = attemptRows
      .filter((a) => courseQuizIds.has(a.quiz_id))
      .map((a) => ({
        id: a.id,
        quizId: a.quiz_id,
        lessonTitle: lessonTitleById.get(lessonByQuiz.get(a.quiz_id) ?? '') ?? 'Unknown Quiz',
        score: a.score,
        passed: a.passed,
        startedAt: a.started_at,
        finishedAt: a.finished_at,
      }));

    return {
      enrollmentId: e.id,
      courseId: e.course_id,
      courseTitle: e.title,
      courseLevel: e.level,
      enrollmentStatus: e.status,
      enrolledAt: e.enrolled_at,
      completedAt: e.completed_at,
      modules,
      totalLessons,
      completedLessons,
      quizAttempts,
    };
  });

  return reply(200, { courses });
});
