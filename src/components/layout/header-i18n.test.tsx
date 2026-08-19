import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import i18n from '@/i18n';
import { routes } from '@/lib/routes';

vi.mock('./AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { AppLayout } from './AppLayout';

const REQUIRED_KEYS = ['common.back'] as const;

function resolve(locale: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, locale);
}

describe('header i18n keys (#462)', () => {
  it.each(REQUIRED_KEYS)('defines "%s" in both en and da', (key) => {
    expect(typeof resolve(en, key)).toBe('string');
    expect((resolve(en, key) as string).length).toBeGreaterThan(0);
    expect(typeof resolve(da, key)).toBe('string');
    expect((resolve(da, key) as string).length).toBeGreaterThan(0);
  });
});

describe('AppLayout header (#462)', () => {
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

  function renderLayout(path: string, props: { title?: string; headerLabel?: string } = {}) {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <AppLayout {...props}>
            <div>child</div>
          </AppLayout>
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it('renders the translated Back button in English', async () => {
    await i18n.changeLanguage('en');
    renderLayout(routes.learner.courses);
    expect(screen.getByRole('button', { name: en.common.back })).toBeInTheDocument();
  });

  it('renders the translated Back button in Danish', async () => {
    await i18n.changeLanguage('da');
    renderLayout(routes.learner.courses);
    expect(screen.getByRole('button', { name: da.common.back })).toBeInTheDocument();
    expect(en.common.back).not.toBe(da.common.back);
  });

  it('hides the Back button on the role home route', () => {
    renderLayout(routes.learner.dashboard);
    expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument();
  });

  it('hides the Back button on the platform admin home route', () => {
    mockUseAuth.mockReturnValue({
      effectiveIsPlatformAdmin: true,
      isPlatformAdmin: true,
      viewMode: 'platform_admin',
    });
    renderLayout(routes.platformAdmin.organizations);
    expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument();
  });

  it('renders headerLabel in the header without adding a second heading', () => {
    renderLayout(routes.learner.courses, { headerLabel: 'Header label' });
    expect(screen.getByText('Header label')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('keeps title driving the body heading and lets headerLabel differ', () => {
    renderLayout(routes.learner.courses, { title: 'Body title', headerLabel: 'Header label' });
    expect(screen.getByRole('heading', { level: 1, name: 'Body title' })).toBeInTheDocument();
    expect(screen.getByText('Header label')).toBeInTheDocument();
  });

  it('uses title as the header label when headerLabel is omitted', () => {
    renderLayout(routes.learner.courses, { title: 'Body title' });
    expect(screen.getAllByText('Body title')).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 1, name: 'Body title' })).toBeInTheDocument();
  });
});
