import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import i18n from '@/i18n';
import { SidebarProvider } from '@/components/ui/sidebar';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

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
    expect(mockSigned).toHaveBeenCalledWith(null);
  });

  it('shows only the platform logo for the individual-tier placeholder org (#354)', () => {
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'org-ind', name: 'Individuals', kind: 'individual', logo_url: 'orgs/ind.png' }),
    );
    renderBrand();

    expect(screen.getByAltText('AI Education')).toBeInTheDocument();
    expect(screen.queryByText('Individuals')).not.toBeInTheDocument();
    expect(mockSigned).toHaveBeenCalledWith(null);
  });

  it('shows the org logo + name only — no AI Uddannelse wordmark — for an org member', () => {
    mockSigned.mockReturnValue({ data: 'https://signed/acme.png' });
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: 'orgs/acme.png' }),
    );
    renderBrand();

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(mockSigned).toHaveBeenCalledWith('orgs/acme.png');
    expect(screen.queryByAltText('AI Education')).not.toBeInTheDocument();
  });

  it('renders the expanded org logo uncropped at its natural aspect (#411)', () => {
    mockSigned.mockReturnValue({ data: 'https://signed/acme.png' });
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: 'orgs/acme.png' }),
    );
    const { container } = renderBrand();

    const logo = container.querySelector('img[src="https://signed/acme.png"]');
    expect(logo).not.toBeNull();
    expect(logo?.className).toContain('object-contain');
    expect(logo?.className).not.toContain('object-cover');
    expect(logo).toHaveAttribute('alt', '');
  });

  it('degrades to the initials monogram when the org logo fails to load (#411)', () => {
    mockSigned.mockReturnValue({ data: 'https://signed/acme.png' });
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: 'orgs/acme.png' }),
    );
    const { container } = renderBrand();

    const logo = container.querySelector('img[src="https://signed/acme.png"]');
    if (!logo) throw new Error('expected the org logo img to render');

    fireEvent.error(logo);

    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(container.querySelector('img[src="https://signed/acme.png"]')).toBeNull();
  });

  it('falls back to an initials monogram when the org has no logo', () => {
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: null }),
    );
    renderBrand();

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByAltText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.queryByAltText('AI Education')).not.toBeInTheDocument();
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
