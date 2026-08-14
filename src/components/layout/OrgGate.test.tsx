import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import en from '@/i18n/locales/en.json';
import i18n from '@/i18n';

vi.mock('./AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}));

vi.mock('@/components/ui/page-spinner', () => ({
  PageSpinner: () => <div data-testid="page-spinner" />,
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { OrgGate } from './OrgGate';

const baseAuth = {
  effectiveIsPlatformAdmin: false,
  isPlatformAdmin: false,
  viewMode: 'learner',
  contextError: null,
};

function renderGate() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <OrgGate
          titleKey="community.noOrganizationTitle"
          descriptionKey="community.noOrgIdeas"
        >
          <div data-testid="page-content" />
        </OrgGate>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('OrgGate (#256)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the spinner while the user context is still resolving', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'entra-oid' },
      profile: null,
      currentOrg: null,
    });
    renderGate();
    expect(screen.getByTestId('page-spinner')).toBeInTheDocument();
    expect(screen.queryByText(en.community.noOrganizationTitle)).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it('renders the no-org title and description once context settles without an org', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'entra-oid' },
      profile: { id: 'profile-uuid' },
      currentOrg: null,
    });
    renderGate();
    expect(screen.getByText(en.community.noOrganizationTitle)).toBeInTheDocument();
    expect(screen.getByText(en.community.noOrgIdeas)).toBeInTheDocument();
    expect(screen.queryByTestId('page-spinner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it('forwards breadcrumbs to AppLayout in the gate states', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'entra-oid' },
      profile: { id: 'profile-uuid' },
      currentOrg: null,
    });
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <OrgGate
            breadcrumbs={[{ label: 'Idea Management' }]}
            titleKey="community.noOrganizationTitle"
            descriptionKey="community.noOrgIdeas"
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Idea Management')).toBeInTheDocument();
  });

  it('renders children when an org is selected', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'entra-oid' },
      profile: { id: 'profile-uuid' },
      currentOrg: { id: 'org-1', name: 'Acme' },
    });
    renderGate();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.queryByTestId('page-spinner')).not.toBeInTheDocument();
    expect(screen.queryByText(en.community.noOrganizationTitle)).not.toBeInTheDocument();
  });
});
