import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ callApi: mockCallApi }));

const mockSetCurrentOrg = vi.fn();
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { OrgSelector } from './OrgSelector';

const orgA = {
  id: 'org-a',
  name: 'Alpha Org',
  slug: 'alpha',
  logo_url: null,
  seat_limit: 10,
  created_at: '2026-01-01T00:00:00Z',
};
const orgB = { ...orgA, id: 'org-b', name: 'Beta Org', slug: 'beta' };

const baseAuth = {
  user: { id: 'u-1', tid: 't-1', email: 'admin@x.test', name: 'Admin' },
  profile: { id: 'p-1', is_platform_admin: true },
  memberships: [],
  currentOrg: null,
  isPlatformAdmin: true,
  isOrgAdmin: false,
  isLoading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshUserContext: vi.fn(),
  setCurrentOrg: mockSetCurrentOrg,
  viewMode: 'org_admin' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: true,
};

describe('OrgSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches orgs from the Azure /api/organizations endpoint for platform admins', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue(baseAuth);

    render(<OrgSelector />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/organizations', {});
    });
  });

  it('auto-selects the first returned org when no org is currently selected', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue(baseAuth);

    render(<OrgSelector />);

    await waitFor(() => {
      expect(mockSetCurrentOrg).toHaveBeenCalledWith(orgA);
    });
  });

  it('does NOT auto-select when an org is already selected', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue({ ...baseAuth, currentOrg: orgB });

    render(<OrgSelector />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalled();
    });
    expect(mockSetCurrentOrg).not.toHaveBeenCalled();
  });

  it('does NOT fetch orgs when the user is not a platform admin', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      isPlatformAdmin: false,
      profile: { id: 'p-1', is_platform_admin: false },
      viewMode: 'learner' as const,
    });

    render(<OrgSelector />);

    // Let any pending microtasks settle, then assert no fetch + no spinner.
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('clears the loading spinner after the fetch resolves', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA] });
    mockUseAuth.mockReturnValue(baseAuth);

    render(<OrgSelector />);

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeNull();
    });
  });
});
