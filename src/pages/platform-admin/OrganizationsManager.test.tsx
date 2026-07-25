import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Initialize i18n so t() resolves real (English) strings, matching production.
import '@/i18n';

// mock AppLayout faithfully: the real one renders its `title` prop as an <h1>, letting
// the #101 regression test observe a duplicate heading if the page ever passes `title`
// AND renders its own <h1>.
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
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/hooks/useOrganizations', () => ({
  useOrganizations: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

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
    renderPage();

    const headings = await screen.findAllByRole('heading', { name: 'Organizations' });
    expect(headings).toHaveLength(1);
  });
});
