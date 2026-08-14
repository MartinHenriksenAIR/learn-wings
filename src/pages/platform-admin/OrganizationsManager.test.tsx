import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/hooks/useOrganizations', () => ({
  useOrganizations: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: ({ id }: { id?: string }) => <input type="file" id={id} data-testid="file-upload" />,
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

describe('OrganizationsManager — label associations (#327)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockResolvedValue({ profiles: [] });
  });

  it('associates the create-dialog logo label with its upload input', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New Organization' }));

    const logo = await screen.findByLabelText('Logo (optional)');
    expect(logo).toHaveAttribute('id', 'org-create-logo');
  });
});
