import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n';
import { SidebarProvider } from '@/components/ui/sidebar';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Capture the path we were asked to sign so we can assert we never sign an org
// logo when we're not co-branding.
const mockSigned = vi.fn();
vi.mock('@/hooks/useSignedBrandingUrl', () => ({
  useSignedBrandingUrl: (path: string | null | undefined) => mockSigned(path),
}));

import { SidebarBrand } from './SidebarBrand';

function renderBrand({ open = true }: { open?: boolean } = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SidebarProvider defaultOpen={open}>
        <SidebarBrand />
      </SidebarProvider>
    </I18nextProvider>,
  );
}

const orgMember = (org: Record<string, unknown>) => ({
  currentOrg: org,
  effectiveIsPlatformAdmin: false,
});

describe('SidebarBrand co-branding (#372)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSigned.mockReturnValue({ data: undefined });
    await i18n.changeLanguage('en');
  });

  it('shows only the platform logo when there is no org', () => {
    mockUseAuth.mockReturnValue({ currentOrg: null, effectiveIsPlatformAdmin: false });
    renderBrand();

    expect(screen.getByAltText('AI Education')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
  });

  it('shows only the platform logo in platform-admin view even if an org is selected', () => {
    mockUseAuth.mockReturnValue({
      currentOrg: { id: 'o', name: 'Acme Corp', logo_url: 'orgs/acme.png' },
      effectiveIsPlatformAdmin: true,
    });
    renderBrand();

    expect(screen.getByAltText('AI Education')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    // Must not sign an org logo we're not going to show.
    expect(mockSigned).toHaveBeenCalledWith(null);
  });

  it('co-brands the org logo + name with the AIU mark for an org member', () => {
    mockSigned.mockReturnValue({ data: 'https://signed/acme.png' });
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: 'orgs/acme.png' }),
    );
    renderBrand();

    // The org name shows, and we sign the org's stored logo path to display it.
    // (The logo renders in a real browser via Radix AvatarImage — jsdom never
    // loads the image, so we assert the signing behaviour, not the rendered img.)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(mockSigned).toHaveBeenCalledWith('orgs/acme.png');
    // The AIU wordmark stays visible as the smaller endorsing mark.
    expect(screen.getByAltText('AI Education')).toBeInTheDocument();
  });

  it('falls back to an initials monogram when the org has no logo', () => {
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: null }),
    );
    renderBrand();

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByAltText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.getByAltText('AI Education')).toBeInTheDocument();
  });

  it('collapsed org context shows only the org mark (no name, no AIU wordmark)', () => {
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: null }),
    );
    renderBrand({ open: false });

    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.queryByAltText('AI Education')).not.toBeInTheDocument();
  });

  it('collapsed fallback shows the platform icon, not the wordmark', () => {
    mockUseAuth.mockReturnValue({ currentOrg: null, effectiveIsPlatformAdmin: false });
    renderBrand({ open: false });

    expect(screen.queryByAltText('AI Education')).not.toBeInTheDocument();
    expect(document.querySelector('svg.lucide-graduation-cap')).not.toBeNull();
  });
});
