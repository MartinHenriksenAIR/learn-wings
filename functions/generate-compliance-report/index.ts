// Hand-rolled (not shared/endpoint.ts): binary PDF response and token-only auth
// (oid-scoped SQL lookups, no getProfile). Renders a branded AI Act Article-4
// AI-literacy report with pdfkit (see render.ts); content localized per
// ADR-0016 category 3 (the requesting user's UI language, sent as `language`).
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, getCorsHeaders } from '../shared/cors';
import { internalError } from '../shared/errors';
import { STRINGS, resolveLang, type LevelKey } from './strings';
import { generatePDF, type DeptRow, type CourseRow, type LevelRow, type ReportData } from './render';

const TARGET = 80; // baseline participation target (%), per department and overall
const REFRESHER_MONTHS = 12;

// ---- data assembly helpers ----
const LVL_NUM: Record<string, number> = { basic: 1, intermediate: 2, advanced: 3 };
const LVL_BY_NUM: Record<number, LevelKey> = { 1: 'basic', 2: 'intermediate', 3: 'advanced' };

function deptLevel(levels: (string | null)[]): LevelKey {
  const nums = levels.filter((l): l is string => !!l).map((l) => LVL_NUM[l]);
  if (nums.length === 0) return 'na';
  const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return LVL_BY_NUM[avg] || 'na';
}
function deptStatus(pct: number): DeptRow['status'] {
  return pct >= TARGET ? 'ok' : pct < 50 ? 'bad' : 'warn';
}
function truncate(t: string): string {
  return t.length > 44 ? t.slice(0, 42) + '…' : t;
}

interface MemberRow { department: string | null; assessment_level: string | null; trained: boolean; last_completed: string | Date | null }
interface CourseStat { title: string; enrolled: string | number; completed: string | number }

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const { orgId, language } = (await req.json()) as { orgId?: string; language?: string };
    if (!orgId) {
      return { status: 400, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'orgId is required' }) };
    }
    const lang = resolveLang(language);
    const s = STRINGS[lang];

    // Access + caller identity in one lookup (entra_oid-scoped)
    const caller = await queryOne<{ full_name: string; is_platform_admin: boolean; is_org_admin: boolean }>(
      `SELECT p.full_name, p.is_platform_admin,
        EXISTS(
          SELECT 1 FROM org_memberships om
          WHERE om.user_id = p.id AND om.org_id = $2 AND om.role = 'org_admin' AND om.status = 'active'
        ) AS is_org_admin
       FROM profiles p WHERE p.entra_oid = $1`,
      [user.id, orgId]
    );
    if (!caller || !(caller.is_platform_admin || caller.is_org_admin)) {
      return { status: 403, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const org = await queryOne<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [orgId]);
    if (!org) {
      return { status: 404, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Organization not found' }) };
    }

    // Course completion across the org's enabled courses (§3 + the "AI-literacy course" set)
    const courseStats = await query<CourseStat>(
      `SELECT c.title,
        COUNT(e.user_id) AS enrolled,
        COUNT(e.user_id) FILTER (WHERE e.status = 'completed') AS completed
       FROM org_course_access oca
       JOIN courses c ON c.id = oca.course_id
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.org_id = $1
       WHERE oca.org_id = $1 AND oca.access = 'enabled'
       GROUP BY c.id, c.title`,
      [orgId]
    );

    // Active members: department, assessed level, trained flag, latest completion
    const members = await query<MemberRow>(
      `SELECT p.department, p.assessment_level::text AS assessment_level,
        EXISTS(
          SELECT 1 FROM enrollments e
          JOIN org_course_access oca ON oca.course_id = e.course_id AND oca.org_id = e.org_id AND oca.access = 'enabled'
          WHERE e.org_id = $1 AND e.user_id = p.id AND e.status = 'completed'
        ) AS trained,
        (SELECT MAX(e.completed_at) FROM enrollments e
          JOIN org_course_access oca ON oca.course_id = e.course_id AND oca.org_id = e.org_id AND oca.access = 'enabled'
          WHERE e.org_id = $1 AND e.user_id = p.id AND e.status = 'completed') AS last_completed
       FROM org_memberships om
       JOIN profiles p ON p.id = om.user_id
       WHERE om.org_id = $1 AND om.status = 'active'`,
      [orgId]
    );

    // ---- assemble ----
    const staff = members.length;
    const trained = members.filter((m) => m.trained).length;
    const participation = staff ? Math.round((trained / staff) * 100) : 0;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - REFRESHER_MONTHS);
    const refresher = members.filter((m) => m.trained && m.last_completed && new Date(m.last_completed) < cutoff).length;

    const byDept = new Map<string, { staff: number; trained: number; levels: (string | null)[] }>();
    for (const m of members) {
      const key = m.department || s.unassigned;
      const row = byDept.get(key) || { staff: 0, trained: 0, levels: [] };
      row.staff += 1;
      if (m.trained) row.trained += 1;
      row.levels.push(m.assessment_level);
      byDept.set(key, row);
    }
    const depts: DeptRow[] = [...byDept.entries()]
      .map(([dept, v]) => {
        const pct = v.staff ? Math.round((v.trained / v.staff) * 100) : 0;
        return { dept, staff: v.staff, trained: v.trained, pct, level: deptLevel(v.levels), status: deptStatus(pct) };
      })
      .sort((a, b) => b.pct - a.pct || b.staff - a.staff);

    const levelCounts: Record<LevelKey, number> = { advanced: 0, intermediate: 0, basic: 0, na: 0 };
    for (const m of members) {
      const k = (m.assessment_level as LevelKey) || 'na';
      levelCounts[k in levelCounts ? k : 'na'] += 1;
    }
    const levelTotal = staff || 1;
    const levels: LevelRow[] = (['advanced', 'intermediate', 'basic', 'na'] as LevelKey[]).map((key) => ({
      key,
      n: levelCounts[key],
      pct: Math.round((levelCounts[key] / levelTotal) * 100),
    }));

    const courses: CourseRow[] = courseStats
      .map((c) => {
        const enrolled = Number(c.enrolled);
        const completed = Number(c.completed);
        return { title: truncate(c.title), pct: enrolled ? Math.round((completed / enrolled) * 100) : 0 };
      })
      .sort((a, b) => a.pct - b.pct || a.title.localeCompare(b.title));

    const now = new Date();
    const ref = `AIL·${now.getFullYear()}·${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const roleLabel = caller.is_platform_admin ? s.rolePlatform : s.roleAdmin;

    const data: ReportData = {
      org: org.name,
      preparedBy: `${caller.full_name}, ${roleLabel}`,
      dateStr: now.toLocaleDateString(s.locale, s.dateFmt),
      ref,
      target: TARGET,
      kf: { staff, trained, participation, notTrained: staff - trained, refresher },
      belowN: depts.filter((d) => d.status !== 'ok').length,
      deficiency: participation < TARGET,
      depts,
      courses,
      levels,
    };

    const pdf = await generatePDF(data, lang);

    return {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ai-act-compliance-report-${Date.now()}.pdf"`,
      },
      body: pdf,
    };
  } catch (err: unknown) {
    if (err instanceof AuthError) return { status: 401, headers: getCorsHeaders(origin), body: JSON.stringify({ error: (err as Error).message }) };
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('generate-compliance-report', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
