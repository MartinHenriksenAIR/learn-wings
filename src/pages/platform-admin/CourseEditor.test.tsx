import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Initialize i18n so t() resolves real (English) strings, matching production.
import '@/i18n';

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

// --- mock usePlatformSettings ---
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { quizzes_enabled: false }, isLoading: false }),
}));

// --- stub heavy child components ---
vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => <div data-testid="file-upload" />,
}));
vi.mock('@/components/ui/azure-video-upload', () => ({
  AzureVideoUpload: () => <div data-testid="azure-video-upload" />,
}));
vi.mock('@/components/ui/azure-document-upload', () => ({
  AzureDocumentUpload: () => <div data-testid="azure-document-upload" />,
}));
vi.mock('@/components/platform-admin/QuizEditorDialog', () => ({
  QuizEditorDialog: () => <div data-testid="quiz-editor-dialog" />,
}));

import CourseEditor from './CourseEditor';

const successResponse = {
  course: {
    id: 'course-1',
    title: 'Test Course',
    description: 'A test course',
    level: 'basic',
    language: null,
    is_published: false,
    thumbnail_url: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    org_id: null,
  },
  modules: [],
};

function renderPage(courseId = 'course-1') {
  // Fresh QueryClient per render (retry off) so call-count-based mocks stay
  // deterministic and no cache leaks between tests.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/admin/platform/courses/${courseId}`]}>
        <Routes>
          <Route path="/app/admin/platform/courses/:courseId" element={<CourseEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CourseEditor — fetchStructure error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) failed fetch → error block shown, NOT "Course not found"', async () => {
    mockCallApi.mockRejectedValue(new Error('API down'));

    renderPage();

    // Error block appears
    const errorText = await screen.findByText('Failed to load course');
    expect(errorText).toBeInTheDocument();

    // Retry button present
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    // Must NOT show the misleading "Course not found" message
    expect(screen.queryByText('Course not found')).toBeNull();

    // Spinner must be gone
    expect(document.querySelector('.animate-spin')).toBeNull();

    // Toast fired with destructive variant
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to load course', variant: 'destructive' })
    );
  });

  it('(b) Retry clears error and on success renders course editor', async () => {
    mockCallApi
      .mockRejectedValueOnce(new Error('API down'))
      .mockResolvedValueOnce(successResponse);

    renderPage();

    // Wait for error block
    const retryBtn = await screen.findByRole('button', { name: /retry/i });

    // Click retry
    fireEvent.click(retryBtn);

    // Error block disappears
    await waitFor(() =>
      expect(screen.queryByText('Failed to load course')).toBeNull()
    );

    // "Course not found" must not appear either
    expect(screen.queryByText('Course not found')).toBeNull();

    // Course title appears in the page (in input or heading)
    await waitFor(() =>
      expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument()
    );
  });

  it('(c) happy path: successful load renders course editor, no error block', async () => {
    mockCallApi.mockResolvedValueOnce(successResponse);

    renderPage();

    // Spinner shows initially, then course editor renders
    await waitFor(() =>
      expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument()
    );

    expect(screen.queryByText('Failed to load course')).toBeNull();
    expect(screen.queryByText('Course not found')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('(d) course-not-found (null course from API) still shows "Course not found", not error block', async () => {
    mockCallApi.mockResolvedValueOnce({ course: null, modules: [] });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Course not found')).toBeInTheDocument()
    );

    // No error block
    expect(screen.queryByText('Failed to load course')).toBeNull();
  });
});

describe('CourseEditor — mutations patch the structure cache (#48)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('module rename patches the cache from the RETURNING row — no structure refetch', async () => {
    const moduleRow = { id: 'mod-1', course_id: 'course-1', title: 'Old Name', sort_order: 0 };
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') {
        return { ...successResponse, modules: [{ ...moduleRow, lessons: [] }] };
      }
      if (path === '/api/module-update') {
        return { module: { ...moduleRow, title: 'New Name' } };
      }
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    // Structure loaded — module rows are always expanded (no accordion).
    await screen.findByText(/Module 1: Old Name/);

    // Open the rename dialog and rename
    fireEvent.click(await screen.findByRole('button', { name: /rename module/i }));
    const titleInput = await screen.findByDisplayValue('Old Name');
    fireEvent.change(titleInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }));

    // RETURNING'd row lands in the UI via the cache patch
    await waitFor(() =>
      expect(screen.getByText(/Module 1: New Name/)).toBeInTheDocument()
    );
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Module updated!' }));

    // The whole point of #48: the one-row rename must NOT re-ship the course tree
    const structureCalls = mockCallApi.mock.calls.filter(([path]) => path === '/api/course-structure-admin');
    expect(structureCalls).toHaveLength(1);
  });
});

describe('CourseEditor — publish toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flipping the publish switch calls the publish mutation and reflects the new state', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') return successResponse; // is_published: false
      if (path === '/api/course-update') {
        return { course: { ...successResponse.course, is_published: true } };
      }
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    // Course loaded; the publish switch reflects the draft state.
    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    // Same mutation/payload the manager's publish switch uses.
    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', {
        courseId: 'course-1',
        updates: { isPublished: true },
      })
    );

    // The RETURNING'd row lands via the cache patch — the switch flips on.
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());

    // Publish toggle is routine: the switch state IS the feedback, no toast.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/publish/i) })
    );

    // #48: the one-row publish toggle must NOT re-ship the course tree.
    const structureCalls = mockCallApi.mock.calls.filter(([path]) => path === '/api/course-structure-admin');
    expect(structureCalls).toHaveLength(1);
  });
});

describe('CourseEditor — language field (#191)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds the language select from course.language ?? "da" for a null (pre-existing) course', async () => {
    mockCallApi.mockResolvedValueOnce(successResponse); // course.language: null

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument());

    expect(screen.getByText('Danish')).toBeInTheDocument();
  });

  it('save payload always carries the selected language', async () => {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') return successResponse; // course.language: null
      if (path === '/api/course-update') return { course: successResponse.course };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', {
        courseId: 'course-1',
        updates: expect.objectContaining({ language: 'da' }),
      }),
    );
  });
});
