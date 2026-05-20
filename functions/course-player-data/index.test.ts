import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'learner-uuid', email: 'learner@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ courseId: 'course-uuid', orgId: 'org-uuid' }),
};

describe('course-player-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns course, modules with lessons, progressMap, and review', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    const modules = [{ id: 'mod-1', title: 'Module 1', sort_order: 1 }];
    const lessons = [{ id: 'lesson-1', title: 'Lesson 1', sort_order: 1 }];
    const progress = [{ lesson_id: 'lesson-1', status: 'completed', completed_at: '2026-05-01T00:00:00Z' }];
    const review = { id: 'rev-1', rating: 5, comment: 'Great!' };

    mockQueryOne.mockResolvedValueOnce(course);   // course lookup
    mockQuery.mockResolvedValueOnce(modules);     // course_modules
    mockQuery.mockResolvedValueOnce(lessons);     // lessons for mod-1
    mockQuery.mockResolvedValueOnce(progress);    // lesson_progress
    mockQueryOne.mockResolvedValueOnce(review);   // course_reviews

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.course.id).toBe('course-uuid');
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].lessons).toHaveLength(1);
    expect(body.progressMap['lesson-1'].status).toBe('completed');
    expect(body.review.rating).toBe(5);
  });

  it('returns 404 when course does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // course not found

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(404);
  });

  it('returns null review when user has not reviewed the course', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);  // course
    mockQuery.mockResolvedValueOnce([]);         // no modules
    mockQuery.mockResolvedValueOnce([]);         // no progress
    mockQueryOne.mockResolvedValueOnce(null);    // no review

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.review).toBeNull();
  });
});
