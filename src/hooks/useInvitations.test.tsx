import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useInvitations } from './useInvitations';

const invitations = [
  {
    id: 'inv-1',
    org_id: 'org-a',
    email: 'alice@example.com',
    role: 'learner' as const,
    link_id: 'link-abc',
    status: 'pending' as const,
    invited_by_user_id: null,
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    is_platform_admin_invite: false,
  },
];

function Consumer({
  testId,
  orgId,
  scope,
}: {
  testId: string;
  orgId: string | undefined;
  scope: 'platform' | 'org';
}) {
  const { data } = useInvitations(orgId, scope);
  return <div data-testid={testId}>{(data ?? []).map((i) => i.email).join(',')}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches /api/invitations with { scope, orgId } for platform scope', async () => {
    mockCallApi.mockResolvedValue({ invitations });

    renderWithClient(<Consumer testId="result" orgId="org-a" scope="platform" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('alice@example.com');
    });

    expect(mockCallApi).toHaveBeenCalledWith('/api/invitations', {
      scope: 'platform',
      orgId: 'org-a',
    });
  });

  it('fetches /api/invitations with { scope, orgId } for org scope', async () => {
    mockCallApi.mockResolvedValue({ invitations });

    renderWithClient(<Consumer testId="result" orgId="org-a" scope="org" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('alice@example.com');
    });

    expect(mockCallApi).toHaveBeenCalledWith('/api/invitations', {
      scope: 'org',
      orgId: 'org-a',
    });
  });

  it('platform and org scope consumers for the same orgId do NOT share a cache entry', async () => {
    mockCallApi.mockResolvedValue({ invitations });

    renderWithClient(
      <>
        <Consumer testId="platform" orgId="org-a" scope="platform" />
        <Consumer testId="org" orgId="org-a" scope="org" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('platform')).toHaveTextContent('alice@example.com');
    });

    // Two distinct cache keys → two fetches.
    expect(mockCallApi).toHaveBeenCalledTimes(2);
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue({ invitations });

    renderWithClient(<Consumer testId="gated" orgId={undefined} scope="platform" />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('');
  });

  it('normalizes a malformed response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ invitations: null });

    renderWithClient(<Consumer testId="malformed" orgId="org-a" scope="platform" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });
});
