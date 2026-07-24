import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// --- mock platform settings (branding for the preview footer) ---
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ branding: { platform_name: 'AIR Academy' } }),
}));

import { CertificateCard } from './CertificateCard';
import { Enrollment, Course, Profile } from '@/lib/types';

const enrollment = {
  id: 'e-1',
  org_id: 'org-1',
  user_id: 'p-1',
  course_id: 'c-1',
  status: 'completed',
  enrolled_at: '2026-06-01T00:00:00Z',
  completed_at: '2026-06-10T00:00:00Z',
  course: { id: 'c-1', title: 'Finished Course', level: 'basic', description: '' },
} as unknown as Enrollment & { course: Course };

const profile = { id: 'p-1', full_name: 'Maja Lindberg' } as Profile;

function renderCard(props: Partial<React.ComponentProps<typeof CertificateCard>> = {}) {
  const onDownload = vi.fn();
  render(
    <CertificateCard
      enrollment={enrollment}
      profile={profile}
      downloading={false}
      saved={false}
      onDownload={onDownload}
      {...props}
    />
  );
  return { onDownload };
}

describe('CertificateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the download button and calls onDownload with the enrollment id', () => {
    const { onDownload } = renderCard();

    const button = screen.getByRole('button', { name: /common\.download/ });
    fireEvent.click(button);
    expect(onDownload).toHaveBeenCalledWith('e-1', 'Finished Course');
  });

  it('morphs to the green saved state while saved is true', () => {
    renderCard({ saved: true });

    const button = screen.getByRole('button', { name: /common\.saved/ });
    expect(button.className).toContain('text-success');
    expect(screen.queryByText('common.download')).toBeNull();
  });

  it('disables the button while downloading', () => {
    renderCard({ downloading: true });

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders the hover certificate preview with holder name and platform branding', () => {
    renderCard();

    const preview = screen.getByTestId('certificate-preview');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview.textContent).toContain('certificates.certificateOfCompletion');
    expect(preview.textContent).toContain('Maja Lindberg');
    expect(preview.textContent).toContain('AIR Academy');
  });
});
