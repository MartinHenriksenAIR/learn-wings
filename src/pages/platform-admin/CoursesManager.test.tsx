import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock AppLayout as passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock api-client ---
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

// --- mock storage helpers ---
vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn((url: string | null) => Promise.resolve(url)),
  extractLmsAssetPath: vi.fn((url: string | null) => url),
}));

// --- mock sonner toast (this file uses @/components/ui/sonner) ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// --- stub heavy child components that import file-upload deps ---
vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => <div data-testid="file-upload" />,
}));
vi.mock('@/components/ui/search-filter', () => ({
  SearchFilter: ({ searchValue, onSearchChange }: { searchValue: string; onSearchChange: (v: string) => void }) => (
    <input
      data-testid="search-filter"
      value={searchValue}
      onChange={(e) => onSearchChange(e.target.value)}
    />
  ),
}));

import CoursesManager from './CoursesManager';

const successResponse = [
  { courses: [], accessRecords: [] },
  { organizations: [] },
];

function renderPage() {
  // useOrganizations needs a QueryClient; fresh per render (retry off) so the
  // call-count-based mocks below stay deterministic and no cache leaks between tests.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CoursesManager />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CoursesManager — fetchData error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) failed fetch → spinner gone, error block shown, no infinite spinner', async () => {
    mockCallApi.mockRejectedValue(new Error('Network error'));

    renderPage();

    // Wait for loading to resolve and error to appear
    const errorText = await screen.findByText('Failed to load courses');
    expect(errorText).toBeInTheDocument();

    // Retry button present
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    // Spinner must be gone
    expect(document.querySelector('.animate-spin')).toBeNull();

    // Toast fired with destructive variant
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to load courses', variant: 'destructive' })
    );
  });

  it('(b) Retry clears error and on success renders normal page (tabs visible)', async () => {
    // Use a call-count approach: first round of calls (initial load) fails, second round (Retry) succeeds.
    let callCount = 0;
    mockCallApi.mockImplementation(async (path: string) => {
      callCount++;
      // First two calls are the initial load (courses-admin + shared organizations query) — fail them
      if (callCount <= 2) throw new Error('Network error');
      // Subsequent calls are the Retry's refetches — succeed them
      if (path === '/api/courses-admin') return successResponse[0];
      if (path === '/api/organizations') return successResponse[1];
    });

    renderPage();

    // Wait for error block
    const retryBtn = await screen.findByRole('button', { name: /retry/i });

    // Click retry
    fireEvent.click(retryBtn);

    // Error block should disappear, Courses tab should appear
    await waitFor(() =>
      expect(screen.queryByText('Failed to load courses')).toBeNull()
    );

    // Normal page content: tabs rendered
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /courses/i })).toBeInTheDocument()
    );
  });

  it('(c) happy path: successful load renders courses tab without error block', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return successResponse[0];
      if (path === '/api/organizations') return successResponse[1];
    });

    renderPage();

    // Tabs rendered (no error block)
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /courses/i })).toBeInTheDocument()
    );

    expect(screen.queryByText('Failed to load courses')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('CoursesManager — mutations patch the courses cache (#48)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publish toggle patches the cache from the RETURNING row — no full refetch', async () => {
    const course = {
      id: 'c1',
      title: 'Course One',
      description: 'A course',
      level: 'basic',
      is_published: false,
      thumbnail_url: null,
      created_by_user_id: null,
      created_at: '2024-01-01T00:00:00Z',
    };
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return { courses: [course], accessRecords: [] };
      if (path === '/api/organizations') return { organizations: [] };
      if (path === '/api/course-update') return { course: { ...course, is_published: true } };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    const toggle = await screen.findByRole('switch');
    expect(screen.getByText('Draft')).toBeInTheDocument();

    fireEvent.click(toggle);

    // The RETURNING'd row lands in the UI via the cache patch
    await waitFor(() => expect(screen.getByText('Published')).toBeInTheDocument());
    expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', {
      courseId: 'c1',
      updates: { isPublished: true },
    });

    // The whole point of #48: a one-row toggle must NOT refire courses-admin
    // (which would also re-sign every course thumbnail)
    const coursesAdminCalls = mockCallApi.mock.calls.filter(([path]) => path === '/api/courses-admin');
    expect(coursesAdminCalls).toHaveLength(1);
  });
});
