import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

const { mockGetSignedLmsAssetUrl } = vi.hoisted(() => ({ mockGetSignedLmsAssetUrl: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: (...args: unknown[]) => mockGetSignedLmsAssetUrl(...args),
}));

import { useLearnerAssignments } from './useLearnerAssignments';

const row = {
  course_id: 'c-1',
  course_title: 'Intro to AI',
  thumbnail_url: 'raw-path/thumb.jpg',
  mandatory: true,
  due_date: '2026-09-01',
  overdue: false,
  completed: false,
};

function Consumer({ orgId, enabled }: { orgId: string | undefined; enabled?: boolean }) {
  const query = useLearnerAssignments(orgId, enabled !== undefined ? { enabled } : {});
  if (query.isLoading) return <div data-testid="loading">loading</div>;
  const items = query.data ?? [];
  return (
    <div>
      <div data-testid="titles">{items.map((a) => a.courseTitle).join(',')}</div>
      <div data-testid="thumbs">{items.map((a) => a.thumbnailUrl).join(',')}</div>
      <div data-testid="orgctx">{items.map((a) => a.assignedByOrgId).join(',')}</div>
      <div data-testid="mandatory">{items.map((a) => String(a.mandatory)).join(',')}</div>
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useLearnerAssignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/learner-assignments with { orgId }', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue('https://signed/thumb.jpg');
    mockCallApi.mockResolvedValue({ assignments: [row] });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/learner-assignments', { orgId: 'org-1' });
    });
  });

  it('maps snake_case rows to camelCase, signs thumbnails, and sets assignedByOrgId', async () => {
    const signed = 'https://signed/thumb.jpg';
    mockGetSignedLmsAssetUrl.mockResolvedValue(signed);
    mockCallApi.mockResolvedValue({ assignments: [row] });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('titles')).toHaveTextContent('Intro to AI');
    });
    expect(screen.getByTestId('thumbs')).toHaveTextContent(signed);
    expect(screen.getByTestId('orgctx')).toHaveTextContent('org-1');
    expect(screen.getByTestId('mandatory')).toHaveTextContent('true');
    expect(mockGetSignedLmsAssetUrl).toHaveBeenCalledWith('raw-path/thumb.jpg');
  });

  it('does not fetch when orgId is undefined', async () => {
    renderWithClient(<Consumer orgId={undefined} />);
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', async () => {
    renderWithClient(<Consumer orgId="org-1" enabled={false} />);
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('tolerates a non-array payload', async () => {
    mockCallApi.mockResolvedValue({ assignments: undefined });
    renderWithClient(<Consumer orgId="org-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('titles')).toHaveTextContent('');
    });
  });
});
