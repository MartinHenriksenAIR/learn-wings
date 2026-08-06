import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

const { mockGetSignedLmsAssetUrl } = vi.hoisted(() => ({
  mockGetSignedLmsAssetUrl: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: (...args: unknown[]) => mockGetSignedLmsAssetUrl(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

import { queryKeys } from '@/lib/query-keys';
import { useFavorites, useToggleFavorite, type ToggleFavoriteInput } from './useFavorites';

type CachedFavorites = { courses: Array<{ id: string }> };

const course = {
  id: 'c-1',
  title: 'Intro to AI',
  description: 'Learn the basics',
  level: 'basic' as const,
  language: 'en' as const,
  course_group_id: null,
  category_id: null,
  is_published: true,
  thumbnail_url: 'raw-path/thumb.jpg',
  created_by_user_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

function FavoritesConsumer({ orgId, enabled }: { orgId: string | undefined; enabled?: boolean }) {
  const { data, isLoading, favoriteIds, isFavorite } = useFavorites(
    orgId,
    enabled !== undefined ? { enabled } : {},
  );
  if (isLoading) return <div data-testid="loading">loading</div>;
  return (
    <div>
      <div data-testid="courses">{(data?.courses ?? []).map((c) => c.thumbnail_url).join(',')}</div>
      <div data-testid="favoriteIds">{[...favoriteIds].join(',')}</div>
      <div data-testid="isFavorite">{String(isFavorite('c-1'))}</div>
    </div>
  );
}

const otherCourse = { ...course, id: 'c-0', title: 'Other course' };

function ToggleConsumer({ orgId }: { orgId: string | undefined }) {
  const { toggleFavorite, togglingId } = useToggleFavorite(orgId);
  return (
    <div>
      <div data-testid="togglingId">{togglingId ?? ''}</div>
      <button type="button" onClick={() => toggleFavorite({ courseId: 'c-1', favorite: false })}>
        remove
      </button>
    </div>
  );
}

// Fires an arbitrary toggle input so a test can drive the onSuccess cache-patch
// (add with/without a course object, dedup, remove) against a shared QueryClient.
function ToggleInputConsumer({
  orgId,
  input,
}: {
  orgId: string | undefined;
  input: ToggleFavoriteInput;
}) {
  const { toggleFavorite } = useToggleFavorite(orgId);
  return (
    <button type="button" onClick={() => toggleFavorite(input)}>
      toggle
    </button>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// Renders against a caller-owned client so the test can seed the favorites cache
// beforehand and read it back after the mutation settles.
function renderWithSeededClient(ui: React.ReactElement, queryClient: QueryClient) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function seededClient(courses: unknown[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.favorites.list('org-1'), { courses });
  return queryClient;
}

function cachedIds(queryClient: QueryClient) {
  const data = queryClient.getQueryData<CachedFavorites>(queryKeys.favorites.list('org-1'));
  return (data?.courses ?? []).map((c) => c.id);
}

describe('useFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/favorites with the correct { orgId } body', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue('https://signed.example.com/thumb.jpg');
    mockCallApi.mockResolvedValue({ courses: [course] });

    renderWithClient(<FavoritesConsumer orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/favorites', { orgId: 'org-1' });
    });
  });

  it('signs thumbnail URLs and derives favoriteIds / isFavorite', async () => {
    const signedUrl = 'https://signed.example.com/thumb.jpg';
    mockGetSignedLmsAssetUrl.mockResolvedValue(signedUrl);
    mockCallApi.mockResolvedValue({ courses: [course] });

    renderWithClient(<FavoritesConsumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('courses')).toHaveTextContent(signedUrl);
    });
    expect(screen.getByTestId('favoriteIds')).toHaveTextContent('c-1');
    expect(screen.getByTestId('isFavorite')).toHaveTextContent('true');
    expect(mockGetSignedLmsAssetUrl).toHaveBeenCalledWith(course.thumbnail_url);
  });

  it('tolerates a non-array courses payload (Array.isArray guard)', async () => {
    mockCallApi.mockResolvedValue({ courses: undefined });

    renderWithClient(<FavoritesConsumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('favoriteIds')).toHaveTextContent('');
    });
    expect(screen.getByTestId('isFavorite')).toHaveTextContent('false');
  });

  it('does not fetch when enabled is false', async () => {
    renderWithClient(<FavoritesConsumer orgId="org-1" enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('does not fetch when orgId is undefined (default enabled gate)', async () => {
    renderWithClient(<FavoritesConsumer orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });
});

describe('useToggleFavorite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/favorite-set with { orgId, courseId, favorite }', async () => {
    mockCallApi.mockResolvedValue({ favorited: false });

    renderWithClient(<ToggleConsumer orgId="org-1" />);
    fireEvent.click(screen.getByText('remove'));

    // togglingId is set to the in-flight course id while the mutation runs.
    expect(screen.getByTestId('togglingId')).toHaveTextContent('c-1');

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/favorite-set', {
        orgId: 'org-1',
        courseId: 'c-1',
        favorite: false,
      });
    });

    // onSettled clears the pending id once the mutation resolves.
    await waitFor(() => {
      expect(screen.getByTestId('togglingId')).toHaveTextContent('');
    });
  });

  it('onSuccess add-patch prepends the course to the favorites cache', async () => {
    mockCallApi.mockResolvedValue({ favorited: true });
    const queryClient = seededClient([otherCourse]);

    renderWithSeededClient(
      <ToggleInputConsumer orgId="org-1" input={{ courseId: 'c-1', favorite: true, course }} />,
      queryClient,
    );
    fireEvent.click(screen.getByText('toggle'));

    // Prepended (newest first), matching the endpoint's ORDER BY created_at DESC.
    await waitFor(() => {
      expect(cachedIds(queryClient)).toEqual(['c-1', 'c-0']);
    });
  });

  it('onSuccess add-patch does not duplicate a course already in the cache', async () => {
    mockCallApi.mockResolvedValue({ favorited: true });
    const queryClient = seededClient([course]);

    renderWithSeededClient(
      <ToggleInputConsumer orgId="org-1" input={{ courseId: 'c-1', favorite: true, course }} />,
      queryClient,
    );
    fireEvent.click(screen.getByText('toggle'));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/favorite-set', {
        orgId: 'org-1',
        courseId: 'c-1',
        favorite: true,
      });
    });
    // Dedup guard: still a single entry, not two.
    expect(cachedIds(queryClient)).toEqual(['c-1']);
  });

  it('onSuccess add-patch no-ops when the caller supplies no course object', async () => {
    mockCallApi.mockResolvedValue({ favorited: true });
    const queryClient = seededClient([otherCourse]);

    renderWithSeededClient(
      <ToggleInputConsumer orgId="org-1" input={{ courseId: 'c-1', favorite: true }} />,
      queryClient,
    );
    fireEvent.click(screen.getByText('toggle'));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/favorite-set', {
        orgId: 'org-1',
        courseId: 'c-1',
        favorite: true,
      });
    });
    // No course to add and no throw: the cache is left untouched.
    expect(cachedIds(queryClient)).toEqual(['c-0']);
  });

  it('onSuccess remove-patch drops the course from the favorites cache', async () => {
    mockCallApi.mockResolvedValue({ favorited: false });
    const queryClient = seededClient([course, otherCourse]);

    renderWithSeededClient(
      <ToggleInputConsumer orgId="org-1" input={{ courseId: 'c-1', favorite: false }} />,
      queryClient,
    );
    fireEvent.click(screen.getByText('toggle'));

    await waitFor(() => {
      expect(cachedIds(queryClient)).toEqual(['c-0']);
    });
  });
});
