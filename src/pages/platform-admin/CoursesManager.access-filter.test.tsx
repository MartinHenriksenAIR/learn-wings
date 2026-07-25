import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Initialize i18n so t() resolves real (English) strings, matching production.
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

vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => vi.fn()(...args),
}));

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

    const accessTab = await screen.findByRole('tab', { name: /organization access/i });
    fireEvent.click(accessTab);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    // The combobox trigger is a button (not a textbox); the CommandInput only
    // renders when the popover is open — so with it closed there must be no textbox.
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
