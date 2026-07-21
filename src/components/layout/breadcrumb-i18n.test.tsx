import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import i18n from '@/i18n';

// AppSidebar pulls in the full auth/navigation tree; the breadcrumb header is
// what we're exercising, so stub the sidebar to keep the render focused.
vi.mock('./AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { AppLayout } from './AppLayout';

// The breadcrumb crumb labels these keys back (#206): the AppLayout Home crumb
// plus the community pages' intermediate/leaf crumbs.
const REQUIRED_KEYS = [
  'nav.home',
  'community.title',
  'community.ideaLibrary',
  'community.idea',
  'community.post',
  'community.resources',
  'community.submitIdea',
  'community.ideaForm.editHeading',
] as const;

function resolve(locale: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, locale);
}

describe('breadcrumb i18n keys (#206)', () => {
  it.each(REQUIRED_KEYS)('defines "%s" in both en and da', (key) => {
    expect(typeof resolve(en, key)).toBe('string');
    expect((resolve(en, key) as string).length).toBeGreaterThan(0);
    expect(typeof resolve(da, key)).toBe('string');
    expect((resolve(da, key) as string).length).toBeGreaterThan(0);
  });
});

describe('AppLayout Home crumb (#206)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      effectiveIsPlatformAdmin: false,
      isPlatformAdmin: false,
      viewMode: 'learner',
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  function renderLayout() {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppLayout>
            <div>child</div>
          </AppLayout>
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it('renders the translated Home crumb in English', async () => {
    await i18n.changeLanguage('en');
    renderLayout();
    expect(screen.getByText(en.nav.home)).toBeInTheDocument();
  });

  it('renders the translated Home crumb in Danish', async () => {
    await i18n.changeLanguage('da');
    renderLayout();
    expect(screen.getByText(da.nav.home)).toBeInTheDocument();
    // The English literal must not leak once translated.
    expect(en.nav.home).not.toBe(da.nav.home);
  });
});
