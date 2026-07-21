import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { routes } from '@/lib/routes';

// --- mock AppLayout + PostForm as passthroughs (avoid pulling heavy child deps) ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/community/PostForm', () => ({
  PostForm: () => <div data-testid="post-form" />,
}));

// --- mock toast ---
vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

// --- mock api-client (community-api pulls it in transitively) ---
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  callApi: vi.fn(),
  callApiRaw: vi.fn(),
}));

// --- mock the community api; fetchPost resolves null so we hit the !post branch ---
const mockFetchPost = vi.fn();
const mockFetchCategories = vi.fn();
vi.mock('@/lib/community-api', () => ({
  fetchPost: (...args: unknown[]) => mockFetchPost(...args),
  fetchCategories: (...args: unknown[]) => mockFetchCategories(...args),
  updatePost: vi.fn(),
}));

// --- auth stub (values are read but irrelevant to the !post redirect) ---
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    profile: null,
    effectiveIsOrgAdmin: false,
    effectiveIsPlatformAdmin: false,
  }),
}));

import PostEdit from './PostEdit';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAt(scope: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routes.community.postEdit(scope, 'p1')]}>
        <Routes>
          <Route path={routes.community.postEditPattern} element={<PostEdit />} />
          <Route path={routes.community.feed} element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PostEdit — missing-post redirect (#203)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchCategories.mockResolvedValue([]);
    mockFetchPost.mockResolvedValue(null);
  });

  it('redirects a missing post to the community feed scoped by ?scope, not a 404', async () => {
    renderAt('org');

    await waitFor(() => expect(screen.getByTestId('location')).toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(`${routes.community.feed}?scope=org`);
  });

  it('carries the global scope through to the redirect target', async () => {
    renderAt('global');

    await waitFor(() => expect(screen.getByTestId('location')).toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(`${routes.community.feed}?scope=global`);
  });
});
