import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import '@/i18n';

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { quizzes_enabled: false, exercises_enabled: false }, isLoading: false }),
}));

vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: ({
    value,
    onChange,
  }: {
    value?: string | null;
    onChange: (url: string | null, storagePath: string | null) => void;
  }) => (
    <div data-testid="file-upload">
      <span data-testid="file-upload-value">{value ?? ''}</span>
      <button type="button" onClick={() => onChange(null, null)}>remove thumbnail</button>
      <button
        type="button"
        onClick={() => onChange('thumbnails/new.png', 'thumbnails/new.png')}
      >
        upload thumbnail
      </button>
    </div>
  ),
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
vi.mock('@/components/platform-admin/ExerciseEditorDialog', () => ({
  ExerciseEditorDialog: () => <div data-testid="exercise-editor-dialog" />,
}));

import { getSignedLmsAssetUrl } from '@/lib/storage';
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

    const errorText = await screen.findByText('Failed to load course');
    expect(errorText).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    expect(screen.queryByText('Course not found')).toBeNull();

    expect(document.querySelector('.animate-spin')).toBeNull();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to load course', variant: 'destructive' })
    );
  });

  it('(b) Retry clears error and on success renders course editor', async () => {
    mockCallApi
      .mockRejectedValueOnce(new Error('API down'))
      .mockResolvedValueOnce(successResponse);

    renderPage();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });

    fireEvent.click(retryBtn);

    await waitFor(() =>
      expect(screen.queryByText('Failed to load course')).toBeNull()
    );

    expect(screen.queryByText('Course not found')).toBeNull();

    await waitFor(() =>
      expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument()
    );
  });

  it('(c) happy path: successful load renders course editor, no error block', async () => {
    mockCallApi.mockResolvedValueOnce(successResponse);

    renderPage();

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
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    await screen.findByText(/Module 1: Old Name/);

    fireEvent.click(await screen.findByRole('button', { name: /rename module/i }));
    const titleInput = await screen.findByDisplayValue('Old Name');
    fireEvent.change(titleInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }));

    await waitFor(() =>
      expect(screen.getByText(/Module 1: New Name/)).toBeInTheDocument()
    );
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Module updated!' }));

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
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();

    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', {
        courseId: 'course-1',
        updates: { isPublished: true },
      })
    );

    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());

    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/publish/i) })
    );

    const structureCalls = mockCallApi.mock.calls.filter(([path]) => path === '/api/course-structure-admin');
    expect(structureCalls).toHaveLength(1);
  });
});

describe('CourseEditor — Language editions (#213)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the Language editions section with an eligible candidate', async () => {
    const courseDa = {
      id: 'c-da', title: 'Kursus DA', description: '', level: 'basic',
      language: 'da', course_group_id: null, is_published: false,
      thumbnail_url: null, created_at: '2024-01-01T00:00:00Z',
    };
    const candidateEn = { ...courseDa, id: 'c-en', title: 'English Course', language: 'en' };

    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') return { course: courseDa, modules: [] };
      if (path === '/api/courses-admin') return { courses: [courseDa, candidateEn] };
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage('c-da');

    expect(await screen.findByText(/Choose a course to link/)).toBeInTheDocument();
    expect(screen.getByText('Language editions')).toBeInTheDocument();
    expect(screen.getByText(/Not linked to any other language edition/)).toBeInTheDocument();
    expect(screen.queryByText(/No eligible courses to link/)).toBeNull();
  });

  it('lists a linked sibling with an Unlink action and excludes same-language candidates', async () => {
    const courseDa = {
      id: 'c-da', title: 'Kursus DA', description: '', level: 'basic',
      language: 'da', course_group_id: 'g1', is_published: false,
      thumbnail_url: null, created_at: '2024-01-01T00:00:00Z',
    };
    const siblingEn = { ...courseDa, id: 'c-en-sib', title: 'English Edition', language: 'en', course_group_id: 'g1' };
    const standaloneDa = { ...courseDa, id: 'c-da2', title: 'Another DA', language: 'da', course_group_id: null };

    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') return { course: courseDa, modules: [] };
      if (path === '/api/courses-admin') return { courses: [courseDa, siblingEn, standaloneDa] };
      if (path === '/api/course-translation-link') return { success: true };
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage('c-da');

    expect(await screen.findByText('English Edition')).toBeInTheDocument();
    expect(screen.getByText(/No eligible courses to link/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-translation-link', {
        action: 'unlink',
        courseId: 'c-en-sib',
      }),
    );
  });
});

describe('CourseEditor — a failed thumbnail signing must not clear the column', () => {
  const STORED_PATH = 'thumbnails/live.png';
  const courseWithThumbnail = { ...successResponse.course, thumbnail_url: STORED_PATH };

  function courseUpdatePayload(): Record<string, unknown> {
    const call = mockCallApi.mock.calls.find(([path]) => path === '/api/course-update');
    return (call![1] as { updates: Record<string, unknown> }).updates;
  }

  function mockApi() {
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') return { course: courseWithThumbnail, modules: [] };
      if (path === '/api/course-update') return { course: courseWithThumbnail };
      if (path === '/api/courses-admin') return { courses: [courseWithThumbnail] };
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  afterEach(() => {
    vi.mocked(getSignedLmsAssetUrl).mockImplementation((url: string | null) => Promise.resolve(url));
  });

  it('saves the stored path unchanged when signing fails', async () => {
    vi.mocked(getSignedLmsAssetUrl).mockResolvedValue(null);

    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', expect.anything()),
    );
    expect(courseUpdatePayload().thumbnailUrl).toBe(STORED_PATH);
  });

  it('says the preview failed instead of silently showing an empty picker', async () => {
    vi.mocked(getSignedLmsAssetUrl).mockResolvedValue(null);

    renderPage();
    await waitFor(() => expect(screen.getByText(/could not be loaded for preview/i)).toBeInTheDocument());

    expect(screen.getByTestId('file-upload-value')).toHaveTextContent('');
  });

  it('still clears the column when the admin actually removes the thumbnail', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument());
    expect(screen.getByTestId('file-upload-value')).toHaveTextContent(STORED_PATH);

    fireEvent.click(screen.getByRole('button', { name: /remove thumbnail/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', expect.anything()),
    );
    expect(courseUpdatePayload().thumbnailUrl).toBeNull();
  });

  it('sends the newly uploaded path when the admin replaces the thumbnail', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /upload thumbnail/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/course-update', expect.anything()),
    );
    expect(courseUpdatePayload().thumbnailUrl).toBe('thumbnails/new.png');
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
      if (path === '/api/course-categories') return { categories: [] };
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

describe('CourseEditor — form fields have programmatic labels (#325)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('associates each course-details label with its control', async () => {
    mockCallApi.mockResolvedValueOnce(successResponse);

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue('Test Course')).toBeInTheDocument());

    expect(screen.getByLabelText('Title')).toBe(screen.getByDisplayValue('Test Course'));
    expect(screen.getByLabelText('Description')).toBe(screen.getByDisplayValue('A test course'));

    expect(screen.getByRole('combobox', { name: 'Level' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
  });

  it('associates the module- and lesson-dialog field labels with their controls', async () => {
    const moduleRow = { id: 'mod-1', course_id: 'course-1', title: 'Intro', sort_order: 0 };
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/course-structure-admin') {
        return { ...successResponse, modules: [{ ...moduleRow, lessons: [] }] };
      }
      if (path === '/api/course-categories') return { categories: [] };
      throw new Error(`Unexpected call: ${path}`);
    });

    renderPage();
    await screen.findByText('Module 1: Intro');

    fireEvent.click(screen.getByRole('button', { name: 'Add module' }));
    expect(await screen.findByLabelText('Module Title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    fireEvent.click(screen.getByRole('button', { name: /\+\s*Lesson/i }));
    expect(await screen.findByLabelText('Lesson Title')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByLabelText('Duration (minutes)')).toBeInTheDocument();
  });
});
