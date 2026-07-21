import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Initialize i18n so t() resolves real (English) strings, matching production.
import '@/i18n';

import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';

// --- mock AppLayout (mirrors CoursesManager.test.tsx) ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div>
      {title ? <h1>{title}</h1> : null}
      {children}
    </div>
  ),
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

// --- mock sonner toast ---
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => vi.fn()(...args),
}));

// --- stub heavy child components that import file-upload deps ---
vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => <div data-testid="file-upload" />,
}));

import CoursesManager from './CoursesManager';

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

describe('CoursesManager — Organization Access tab filter (#166)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/courses-admin') return { courses: [], accessRecords: [] };
      if (path === '/api/organizations') return { organizations: [] };
      throw new Error(`Unexpected call: ${path}`);
    });
  });

  it('renders the org combobox but NO standalone search input on the Access tab', async () => {
    renderPage();

    // Switch to the Organization Access tab.
    const accessTab = await screen.findByRole('tab', { name: /organization access/i });
    fireEvent.click(accessTab);

    // The single-org combobox is the sole org-filtering control.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    // The redundant standalone org search field (an <input>) must be gone.
    // The combobox trigger is role="combobox" (a button), not a textbox, and the
    // integrated CommandInput only renders when the popover is open — so with the
    // popover closed there must be no textbox in the filter area at all.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('has removed the coursesManager.searchOrganizations key from both locale files', () => {
    expect(en.coursesManager).not.toHaveProperty('searchOrganizations');
    expect(da.coursesManager).not.toHaveProperty('searchOrganizations');

    // The combobox's own integrated search prompt is a different key and stays.
    expect(en.coursesManager).toHaveProperty('searchOrganizationPrompt');
    expect(da.coursesManager).toHaveProperty('searchOrganizationPrompt');
  });
});
