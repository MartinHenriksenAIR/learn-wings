import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    is_published: false,
    thumbnail_url: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    org_id: null,
  },
  modules: [],
};

function renderPage(courseId = 'course-1') {
  return render(
    <MemoryRouter initialEntries={[`/app/admin/courses/${courseId}`]}>
      <Routes>
        <Route path="/app/admin/courses/:courseId" element={<CourseEditor />} />
      </Routes>
    </MemoryRouter>
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
