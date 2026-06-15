import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Initialize i18n so t() resolves real (English) strings, matching production.
import '@/i18n';

// --- mock AppLayout faithfully: the real one renders its `title` prop as an <h1>
// (see AppLayout.tsx). Modeling that here is what lets the #101 regression test below
// observe a duplicate heading if the page ever passes `title` AND renders its own <h1>. ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div>
      {title ? <h1>{title}</h1> : null}
      {children}
    </div>
  ),
}));

// --- mock api-client (fetchProfiles calls /api/profiles on mount) ---
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
  ApiError: class ApiError extends Error {},
}));

// --- mock the shared org-list hook (success, empty list) ---
vi.mock('@/hooks/useOrganizations', () => ({
  useOrganizations: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

// --- mock sonner toast ---
vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

// --- stub heavy child that imports file-upload deps ---
vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => <div data-testid="file-upload" />,
}));

import OrganizationsManager from './OrganizationsManager';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrganizationsManager />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OrganizationsManager — heading (#101)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockResolvedValue({ profiles: [] });
  });

  it('renders the "Organizations" heading exactly once on the success path', async () => {
    // Regression guard for #101: the success-path <AppLayout> must NOT also pass `title`,
    // or the (faithfully-mocked) layout title + the in-page <h1> stack into two identical
    // headings. The fix relies on the in-page header alone here.
    renderPage();

    const headings = await screen.findAllByRole('heading', { name: 'Organizations' });
    expect(headings).toHaveLength(1);
  });
});
