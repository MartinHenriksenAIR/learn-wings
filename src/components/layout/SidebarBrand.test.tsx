import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('shows only the platform logo for the individual-tier placeholder org (#354)', () => {
    // #354 gives org-less walk-ins a hidden "Individuals" placeholder org; it
    // must never present as a real co-branded org.
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'org-ind', name: 'Individuals', kind: 'individual', logo_url: 'orgs/ind.png' }),
    );
    renderBrand();

    expect(screen.getByAltText('AI Education')).toBeInTheDocument();
    expect(screen.queryByText('Individuals')).not.toBeInTheDocument();
    // Must not sign an org logo we're not going to show.
    expect(mockSigned).toHaveBeenCalledWith(null);
  });

  it('shows the org logo + name only — no AI Uddannelse wordmark — for an org member', () => {
    mockSigned.mockReturnValue({ data: 'https://signed/acme.png' });
    mockUseAuth.mockReturnValue(
      orgMember({ id: 'o', name: 'Acme Corp', logo_url: 'orgs/acme.png' }),
    );
    renderBrand();

    // The org name shows, and we sign the org's stored logo path to display it.
    // (The expanded logo is a bare <img> — uncropped, natural aspect, #411; the
    // dedicated test below asserts its shape.)
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(mockSigned).toHaveBeenCalledWith('orgs/acme.png');
    // The platform wordmark is NOT co-branded under the org name anymore.
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
    // Natural aspect, not cropped: object-contain, never the object-cover crop.
    expect(logo?.className).toContain('object-contain');
    expect(logo?.className).not.toContain('object-cover');
    // Decorative — the org name sits beside it.
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

    // A broken / expired signed URL falls back to the monogram, not a broken image.
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
