import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useSignedBrandingUrl', () => ({ useSignedBrandingUrl: () => ({ data: undefined }) }));

import Settings from './Settings';

describe('Settings — profile save feedback (#20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: {
        id: 'p-1', first_name: 'Test', last_name: 'User', department: '',
        preferred_language: 'en', created_at: '2026-01-01T00:00:00Z', is_platform_admin: false,
      },
      memberships: [],
      isPlatformAdmin: false,
      isOrgAdmin: false,
      refreshUserContext: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('morphs the save button into the Saved state after a successful profile save', async () => {
    mockCallApi.mockResolvedValue({ profile: {} });

    render(<MemoryRouter><Settings /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /settings.saveChanges/i }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/profile-update', {
        first_name: 'Test', last_name: 'User', department: '',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.saved' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'common.saved' }).className).toMatch(/bg-success/);

    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' })
    );
  });

  it('shows a destructive toast when the save fails', async () => {
    mockCallApi.mockRejectedValue(new Error('save failed'));

    render(<MemoryRouter><Settings /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /settings.saveChanges/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'settings.profileUpdateFailed',
        variant: 'destructive',
      }));
    });
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('associates the profile-photo label with its upload input (#327)', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const input = screen.getByLabelText('settings.profilePhoto');
    expect(input).toHaveAttribute('id', 'profile-photo');
    expect(input).toHaveAttribute('type', 'file');
  });
});

describe('Settings — assessment card (#117)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderSettings() {
    return render(<MemoryRouter><Settings /></MemoryRouter>);
  }

  const baseProfile = {
    id: 'p-1', first_name: 'Test', last_name: 'User', department: '',
    preferred_language: 'en', created_at: '2026-01-01T00:00:00Z', is_platform_admin: false,
  };

  it('shows the take-button and notTaken text when no assessment level is set', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: { ...baseProfile, assessment_level: null, assessment_taken_at: null },
      memberships: [],
      isPlatformAdmin: false,
      isOrgAdmin: false,
      refreshUserContext: vi.fn().mockResolvedValue(undefined),
    });

    renderSettings();

    const card = screen.getByTestId('assessment-settings-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('assessment.settings.notTaken');
    expect(screen.getByRole('button', { name: 'assessment.settings.take' })).toBeInTheDocument();
  });

  it('shows the LevelBadge, lastTaken date and retake-button when assessment level is set', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: {
        ...baseProfile,
        assessment_level: 'intermediate',
        assessment_taken_at: '2026-07-01T12:00:00Z',
      },
      memberships: [],
      isPlatformAdmin: false,
      isOrgAdmin: false,
      refreshUserContext: vi.fn().mockResolvedValue(undefined),
    });

    renderSettings();

    const card = screen.getByTestId('assessment-settings-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assessment.settings.retake' })).toBeInTheDocument();
    expect(card).toHaveTextContent('assessment.settings.lastTaken');
  });

  it('hides the assessment card for a platform admin', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: { ...baseProfile, assessment_level: null, assessment_taken_at: null },
      memberships: [],
      isPlatformAdmin: true,
      isOrgAdmin: false,
      refreshUserContext: vi.fn().mockResolvedValue(undefined),
    });

    renderSettings();

    expect(screen.queryByTestId('assessment-settings-card')).toBeNull();
  });

  it('hides the assessment card for an org admin', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: { ...baseProfile, assessment_level: null, assessment_taken_at: null },
      memberships: [],
      isPlatformAdmin: false,
      isOrgAdmin: true,
      refreshUserContext: vi.fn().mockResolvedValue(undefined),
    });

    renderSettings();

    expect(screen.queryByTestId('assessment-settings-card')).toBeNull();
  });
});

describe('Settings — the profile photo can be removed (#476)', () => {
  const refreshUserContext = vi.fn().mockResolvedValue(undefined);

  const photoProfile = {
    id: 'p-1', first_name: 'Test', last_name: 'User', department: '',
    preferred_language: 'en', created_at: '2026-01-01T00:00:00Z', is_platform_admin: false,
  };

  class FakeXHR {
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    status = 200;
    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.onload?.());
    }
  }

  function renderWithPhoto(avatar_url: string | null) {
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: { ...photoProfile, avatar_url },
      memberships: [],
      isPlatformAdmin: false,
      isOrgAdmin: false,
      refreshUserContext,
    });
    return render(<MemoryRouter><Settings /></MemoryRouter>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    URL.createObjectURL = vi.fn(() => 'blob:preview-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks profile-update to clear the column — the empty string it stores as NULL', async () => {
    mockCallApi.mockResolvedValue({ profile: {} });
    renderWithPhoto('avatars/p-1/face.png');

    fireEvent.click(screen.getByRole('button', { name: /settings.removePhoto/i }));

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/profile-update', { avatar_url: '' })
    );
    await waitFor(() => expect(refreshUserContext).toHaveBeenCalled());
  });

  it('offers nothing to remove when no photo is stored', () => {
    renderWithPhoto(null);

    expect(screen.queryByRole('button', { name: /settings.removePhoto/i })).not.toBeInTheDocument();
  });

  it('reports the failure and stops spinning when the clear fails', async () => {
    mockCallApi.mockRejectedValue(new Error('clear failed'));
    renderWithPhoto('avatars/p-1/face.png');

    fireEvent.click(screen.getByRole('button', { name: /settings.removePhoto/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'settings.photoUpdateFailed',
        variant: 'destructive',
      }))
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /settings.removePhoto/i })).not.toBeDisabled()
    );
  });

  it('still saves an upload as the storage path the widget reports', async () => {
    mockCallApi.mockImplementation((path: string) =>
      path === '/api/azure-upload-url'
        ? Promise.resolve({
            uploadUrl: 'https://acct.blob.core.windows.net/lms-assets/avatars/p-1/face.png?sig=abc',
            blobPath: 'avatars/p-1/face.png',
            contentType: 'image/png',
          })
        : Promise.resolve({ profile: {} })
    );
    renderWithPhoto(null);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'face.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('settings.profilePhoto'), { target: { files: [png] } });

    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith('/api/profile-update', { avatar_url: 'avatars/p-1/face.png' })
    );
  });
});
