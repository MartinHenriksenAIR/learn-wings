import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useOrgMemberships } from './useOrgMemberships';

const membershipRows = [
  {
    id: 'mem-1',
    org_id: 'org-a',
    user_id: 'user-a',
    role: 'learner' as const,
    status: 'active' as const,
    created_at: '2026-01-01T00:00:00Z',
    full_name: 'Alice',
    email: 'alice@example.com',
    avatar_url: null,
    department: 'Engineering',
  },
];

function Consumer({ testId, orgId }: { testId: string; orgId: string | undefined }) {
  const { data } = useOrgMemberships(orgId);
  return (
    <div data-testid={testId}>
      {(data ?? []).map((m) => m.profile.full_name).join(',')}
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useOrgMemberships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches /api/org-memberships with { orgId } and reshapes the row', async () => {
    mockCallApi.mockResolvedValue({ memberships: membershipRows });

    renderWithClient(<Consumer testId="result" orgId="org-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Alice');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/org-memberships', { orgId: 'org-a' });
  });

  it('two consumers for the same orgId share one cache entry', async () => {
    mockCallApi.mockResolvedValue({ memberships: membershipRows });

    renderWithClient(
      <>
        <Consumer testId="first" orgId="org-a" />
        <Consumer testId="second" orgId="org-a" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('Alice');
    });
    expect(screen.getByTestId('second')).toHaveTextContent('Alice');

    expect(mockCallApi).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue({ memberships: membershipRows });

    renderWithClient(<Consumer testId="gated" orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('');
  });

  it('normalizes a malformed response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ memberships: null });

    renderWithClient(<Consumer testId="malformed" orgId="org-a" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });

  it('reshapes membership row into OrgMembership + profile shape', async () => {
    mockCallApi.mockResolvedValue({ memberships: membershipRows });

    let capturedData: ReturnType<typeof useOrgMemberships>['data'] = undefined;

    function Inspector() {
      const { data } = useOrgMemberships('org-a');
      capturedData = data;
      return null;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Inspector />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(capturedData).toBeDefined();
    });

    const member = capturedData![0];
    expect(member.id).toBe('mem-1');
    expect(member.org_id).toBe('org-a');
    expect(member.user_id).toBe('user-a');
    expect(member.profile.full_name).toBe('Alice');
    expect(member.profile.department).toBe('Engineering');
    expect(member.profile.id).toBe('user-a');
  });
});
