import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'da', resolvedLanguage: 'da' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api-client', () => ({ callApi: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getSignedLmsAssetUrl: vi.fn().mockResolvedValue(null) }));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

vi.mock('@/hooks/useOrgGuard', () => ({ useOrgGuard: () => 'ready' }));

const mockUseCourseCategories = vi.fn();
vi.mock('@/hooks/useCourseCategories', () => ({
  useCourseCategories: (...args: unknown[]) => mockUseCourseCategories(...args),
}));

const mockUseFavorites = vi.fn();
const mockUseToggleFavorite = vi.fn();
vi.mock('@/hooks/useFavorites', () => ({
  useFavorites: (...args: unknown[]) => mockUseFavorites(...args),
  useToggleFavorite: (...args: unknown[]) => mockUseToggleFavorite(...args),
}));

import CourseDetail from './CourseDetail';
import { callApi } from '@/lib/api-client';

mockUseCourseCategories.mockReturnValue({
  data: [{ id: 'cat-1', name_en: 'Fundamentals', name_da: 'Grundlæggende', slug: 'fund', sort_order: 1, created_at: '' }],
});
mockUseFavorites.mockReturnValue({ isFavorite: () => false, favoriteIds: new Set(), data: { courses: [] } });
mockUseToggleFavorite.mockReturnValue({ toggleFavorite: vi.fn(), togglingId: null, isPending: false });

const currentOrg = { id: 'org-1', name: 'Org One' };

const baseCourse = {
  id: 'c-1', title: 'Intro to AI', description: 'Learn the basics',
  level: 'basic', language: 'da', thumbnail_url: null, category_id: 'cat-1',
};

function detailResponse(enrollment: { status: string } | null) {
  return {
    course: baseCourse,
    modules: [
      {
        id: 'm-1',
        title: 'Module 1',
        sort_order: 1,
        lesson_count: 2,
        lessons: [
          { id: 'l-1a', title: 'Intro lesson', sort_order: 1 },
          { id: 'l-1b', title: 'Deep dive lesson', sort_order: 2 },
        ],
      },
      {
        id: 'm-2',
        title: 'Module 2',
        sort_order: 2,
        lesson_count: 1,
        lessons: [{ id: 'l-2a', title: 'Wrap-up lesson', sort_order: 1 }],
      },
    ],
    enrollment,
  };
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/courses/c-1']}>
        <Routes>
          <Route path="/app/courses/:courseId" element={<CourseDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CourseDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ currentOrg, profile: { id: 'p-1' } });
  });

  it('renders the title, description, category, module outline (title + lesson count) and a Start CTA to the player', async () => {
    vi.mocked(callApi).mockResolvedValue(detailResponse(null));

    renderDetail();

    expect(await screen.findByTestId('course-detail-title')).toHaveTextContent('Intro to AI');
    expect(screen.getByText('Learn the basics')).toBeInTheDocument();
    // Localized (da) category label.
    expect(screen.getByText('Grundlæggende')).toBeInTheDocument();

    const outline = screen.getByTestId('module-outline');
    expect(outline).toHaveTextContent('Module 1');
    expect(outline).toHaveTextContent('Module 2');
    // Two modules → the lesson-count key renders once per module.
    expect(screen.getAllByText('courses.detail.lessonCount')).toHaveLength(2);

    // Not started → "Start course" linking to the PLAYER (never enrolls from here).
    const cta = screen.getByTestId('course-detail-cta');
    expect(cta).toHaveAttribute('href', '/app/learn/c-1');
    expect(cta).toHaveTextContent('courses.startCourse');
  });

  it('renders a top-left Back-to-catalog control above the card', async () => {
    vi.mocked(callApi).mockResolvedValue(detailResponse(null));

    renderDetail();
    await screen.findByTestId('course-detail-title');

    const back = screen.getByRole('link', { name: 'courses.detail.backToCatalog' });
    expect(back).toHaveAttribute('href', '/app/courses');
  });

  it('Contents is an accordion — collapsed on load, expanding reveals lesson names, one open at a time', async () => {
    vi.mocked(callApi).mockResolvedValue(detailResponse(null));

    renderDetail();
    await screen.findByTestId('course-detail-title');

    // Collapsed on load: no lesson names visible yet.
    expect(screen.queryByText('Intro lesson')).toBeNull();
    expect(screen.queryByText('Wrap-up lesson')).toBeNull();

    // Expand Module 1 → its lesson names appear.
    fireEvent.click(screen.getByRole('button', { name: /Module 1/ }));
    expect(await screen.findByText('Intro lesson')).toBeInTheDocument();
    expect(screen.getByText('Deep dive lesson')).toBeInTheDocument();

    // Expand Module 2 → its lesson appears and Module 1 collapses (single/collapsible).
    fireEvent.click(screen.getByRole('button', { name: /Module 2/ }));
    expect(await screen.findByText('Wrap-up lesson')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Intro lesson')).toBeNull());
  });

  it('fetches the read-only detail endpoint — never the player or an enroll endpoint', async () => {
    vi.mocked(callApi).mockResolvedValue(detailResponse(null));

    renderDetail();
    await screen.findByTestId('course-detail-title');

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith('/api/learner-course-detail', { orgId: 'org-1', courseId: 'c-1' });
    });
    // Reading about a course must not enroll or hit the player.
    const urls = vi.mocked(callApi).mock.calls.map(([url]) => url);
    expect(urls).not.toContain('/api/course-player-data');
    expect(urls.some((u) => /enroll/.test(u as string))).toBe(false);
  });

  it('a started course shows a Continue CTA', async () => {
    vi.mocked(callApi).mockResolvedValue(detailResponse({ status: 'enrolled' }));

    renderDetail();

    const cta = await screen.findByTestId('course-detail-cta');
    expect(cta).toHaveTextContent('common.continue');
    expect(cta).toHaveAttribute('href', '/app/learn/c-1');
  });

  it('a completed course shows a Review CTA', async () => {
    vi.mocked(callApi).mockResolvedValue(detailResponse({ status: 'completed' }));

    renderDetail();

    const cta = await screen.findByTestId('course-detail-cta');
    expect(cta).toHaveTextContent('courses.reviewCourse');
  });

  it('shows a not-available fork with a back-to-catalog link when the fetch fails (404/403)', async () => {
    vi.mocked(callApi).mockRejectedValue(new Error('not found'));

    renderDetail();

    expect(await screen.findByText('courses.detail.notAvailable')).toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'courses.detail.backToCatalog' });
    expect(back).toHaveAttribute('href', '/app/courses');
    // No CTA / outline when the course isn't available.
    expect(screen.queryByTestId('course-detail-cta')).toBeNull();
  });

  it('hides the module outline when the course has no modules', async () => {
    vi.mocked(callApi).mockResolvedValue({ course: baseCourse, modules: [], enrollment: null });

    renderDetail();

    await screen.findByTestId('course-detail-title');
    expect(screen.queryByTestId('module-outline')).toBeNull();
  });

  it('shows the no-org state (and never fetches) when the learner has no current org', () => {
    mockUseAuth.mockReturnValue({ currentOrg: null, profile: { id: 'p-1' } });

    renderDetail();

    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
    expect(screen.getByText('courses.joinOrgToAccessCourses')).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalled();
  });
});
