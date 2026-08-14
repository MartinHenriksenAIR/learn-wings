import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import '@/i18n';

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div>
      {title ? <h1>{title}</h1> : null}
      {children}
    </div>
  ),
}));

const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn((url: string | null) => Promise.resolve(url)),
  extractLmsAssetPath: vi.fn((url: string | null) => url),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => <div data-testid="file-upload" />,
}));
import CoursesManager from './CoursesManager';

const successResponse = [
  { courses: [], accessRecords: [] },
  { organizations: [] },
];

function renderPage() {
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

    const errorText = await screen.findByText('Failed to load courses');
    expect(errorText).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to load courses', variant: 'destructive' })
    );
  });

  it('(b) Retry clears error and on success renders normal page (tabs visible)', async () => {
    let callCount = 0;
    mockCallApi.mockImplementation(async (path: string) => {
      callCount++;
      if (callCount <= 2) throw new Error('Network error');
      if (path === '/api/courses-admin') return successResponse[0];
      if (path === '/api/organizations') return successResponse[1];
    });

    renderPage();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() =>
      expect(screen.queryByText('Failed to load courses')).toBeNull()
    );

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

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /courses/i })).toBeInTheDocument()
    );

    expect(screen.queryByText('Failed to load courses')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('(#101) renders the "Course Manager" heading exactly once on the success path', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return successResponse[0];
      if (path === '/api/organizations') return successResponse[1];
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /courses/i })).toBeInTheDocument()
    );

    expect(screen.getAllByRole('heading', { name: 'Course Manager' })).toHaveLength(1);
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
      language: null,
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

    await waitFor(() => expect(screen.getByText('Published')).toBeInTheDocument());
    expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', {
      courseId: 'c1',
      updates: { isPublished: true },
    });

    const coursesAdminCalls = mockCallApi.mock.calls.filter(([path]) => path === '/api/courses-admin');
    expect(coursesAdminCalls).toHaveLength(1);
  });

  it('publish switch is disabled while mutation is in flight (prevents double-toggle)', async () => {
    const course = {
      id: 'c1',
      title: 'Course One',
      description: 'A course',
      level: 'basic',
      language: null,
      is_published: false,
      thumbnail_url: null,
      created_by_user_id: null,
      created_at: '2024-01-01T00:00:00Z',
    };
    let updateResolve: () => void;
    const updatePromise = new Promise<void>((resolve) => {
      updateResolve = resolve;
    });
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return { courses: [course], accessRecords: [] };
      if (path === '/api/organizations') return { organizations: [] };
      if (path === '/api/course-update') {
        await updatePromise;
        return { course: { ...course, is_published: true } };
      }
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    const toggle = await screen.findByRole('switch') as HTMLInputElement;
    expect(toggle.disabled).toBe(false);

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle.disabled).toBe(true);
    });

    updateResolve!();

    await waitFor(() => {
      expect(toggle.disabled).toBe(false);
    });
  });
});

describe('CoursesManager — language field (#191)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const existingCourse = {
    id: 'existing-1',
    title: 'Existing Course',
    description: 'An existing course',
    level: 'basic',
    language: 'en',
    is_published: true,
    thumbnail_url: null,
    created_by_user_id: null,
    created_at: '2024-01-01T00:00:00Z',
  };

  it('renders the LanguageBadge next to the LevelBadge in the course list', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return { courses: [existingCourse], accessRecords: [] };
      if (path === '/api/organizations') return { organizations: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    await screen.findByText('Existing Course');
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('create dialog defaults language to "da" and the create payload always carries it', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return { courses: [existingCourse], accessRecords: [] };
      if (path === '/api/organizations') return { organizations: [] };
      if (path === '/api/course-categories') return { categories: [] };
      if (path === '/api/course-create') return { course: { ...existingCourse, id: 'new-1', title: 'New Course' } };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    await screen.findByText('Existing Course');
    fireEvent.click(screen.getByRole('button', { name: /new course/i }));

    const titleInput = await screen.findByPlaceholderText('Course title');
    fireEvent.change(titleInput, { target: { value: 'New Course' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-create', {
        title: 'New Course',
        description: '',
        level: 'basic',
        language: 'da',
        categoryId: null,
        thumbnailUrl: null,
      }),
    );
  });

  it('associates the create-dialog title label with its input (#327)', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return { courses: [existingCourse], accessRecords: [] };
      if (path === '/api/organizations') return { organizations: [] };
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    await screen.findByText('Existing Course');
    fireEvent.click(screen.getByRole('button', { name: /new course/i }));

    const title = await screen.findByLabelText('Title');
    expect(title).toHaveAttribute('id', 'course-create-title');
  });
});
