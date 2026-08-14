import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import en from '@/i18n/locales/en.json';
import i18n from '@/i18n';
import { routes } from '@/lib/routes';
import { SidebarProvider } from '@/components/ui/sidebar';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockFeatures = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: mockFeatures() }),
}));

vi.mock('@/components/OrgSelector', () => ({
  OrgSelector: () => <div data-testid="org-selector" />,
}));

vi.mock('@/hooks/useSignedBrandingUrl', () => ({
  useSignedBrandingUrl: () => ({ data: undefined }),
}));

import { AppSidebar } from './AppSidebar';

const allFeatures = {
  certificates_enabled: true,
  quizzes_enabled: true,
  analytics_enabled: true,
  course_reviews_enabled: false,
  community_enabled: true,
};

const baseAuth = {
  profile: { id: 'p-1', full_name: 'Ada Lovelace', avatar_url: null },
  isPlatformAdmin: false,
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: false,
  currentOrg: { id: 'org-1', name: 'Acme' },
  signOut: vi.fn(),
  viewMode: 'learner' as const,
  setViewMode: vi.fn(),
};

function renderSidebar(
  initialPath: string = routes.learner.dashboard,
  { open = true }: { open?: boolean } = {},
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SidebarProvider defaultOpen={open}>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function groupLabels(): string[] {
  return Array.from(document.querySelectorAll('[data-sidebar="group-label"]')).map(
    (el) => el.textContent ?? '',
  );
}

function navLink(url: string): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`a[href="${url}"]`);
}

describe('AppSidebar nav groups (#271)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFeatures.mockReturnValue(allFeatures);
    await i18n.changeLanguage('en');
  });

  describe('which groups render for a role', () => {
    it('renders the Dashboard item plus the Læring and Fællesskab groups for a plain learner', () => {
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar();

      expect(groupLabels()).toEqual([en.nav.learning, en.nav.community]);
      expect(navLink(routes.learner.dashboard)).not.toBeNull();
      expect(navLink(routes.orgAdmin.settings)).toBeNull();
      expect(navLink(routes.platformAdmin.organizations)).toBeNull();
    });

    it('renders the learner groups + Administration for an org admin', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, effectiveIsOrgAdmin: true });
      renderSidebar();

      expect(groupLabels()).toEqual([en.nav.learning, en.nav.community, en.nav.administration]);
      expect(navLink(routes.orgAdmin.users)).not.toBeNull();
      expect(navLink(routes.orgAdmin.root)).not.toBeNull();
      expect(navLink(routes.orgAdmin.settings)).not.toBeNull();
      expect(navLink(routes.platformAdmin.organizations)).toBeNull();
    });

    it('renders only the Platform Admin group when viewing as platform admin', () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        isPlatformAdmin: true,
        effectiveIsPlatformAdmin: true,
        effectiveIsOrgAdmin: true,
        viewMode: 'platform_admin' as const,
      });
      renderSidebar();

      expect(groupLabels()).toEqual([en.nav.platformAdmin]);
      expect(navLink(routes.learner.dashboard)).toBeNull();
      expect(navLink(routes.orgAdmin.settings)).toBeNull();
    });

    it('drops the community items and the Fællesskab group when community is disabled', () => {
      mockFeatures.mockReturnValue({ ...allFeatures, community_enabled: false });
      mockUseAuth.mockReturnValue({ ...baseAuth, effectiveIsOrgAdmin: true });
      renderSidebar();

      expect(groupLabels()).toEqual([en.nav.learning, en.nav.administration]);
      expect(navLink(routes.community.feed)).toBeNull();
      expect(navLink(routes.orgAdmin.ideas)).toBeNull();
      expect(navLink(routes.orgAdmin.moderation)).toBeNull();
      expect(navLink(routes.orgAdmin.users)).not.toBeNull();
      expect(navLink(routes.orgAdmin.settings)).not.toBeNull();
    });

    it('keeps Brugere reachable but drops Organisation when analytics is disabled (#465)', () => {
      mockFeatures.mockReturnValue({ ...allFeatures, analytics_enabled: false });
      mockUseAuth.mockReturnValue({ ...baseAuth, effectiveIsOrgAdmin: true });
      renderSidebar();

      expect(navLink(routes.orgAdmin.users)).not.toBeNull();
      expect(navLink(routes.orgAdmin.root)).toBeNull();
      expect(navLink(routes.orgAdmin.settings)).not.toBeNull();
    });

    it('keeps Resources in the Fællesskab group when community is on (#344)', () => {
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar();

      expect(navLink(routes.community.events)).not.toBeNull();
      expect(navLink(routes.community.resources)).not.toBeNull();
      expect(groupLabels()).toEqual([en.nav.learning, en.nav.community]);
    });

    it('keeps Resources reachable in Læring when community is off (#344)', () => {
      mockFeatures.mockReturnValue({ ...allFeatures, community_enabled: false });
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar();

      expect(navLink(routes.community.feed)).toBeNull();
      expect(navLink(routes.community.events)).toBeNull();
      expect(groupLabels()).toEqual([en.nav.learning]);
      expect(navLink(routes.community.resources)).not.toBeNull();
    });
  });

  describe('item labels and hrefs', () => {
    it('renders every learner item with its translated label and route', () => {
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar();

      expect(screen.getByRole('link', { name: en.nav.dashboard })).toHaveAttribute(
        'href',
        routes.learner.dashboard,
      );
      expect(screen.getByRole('link', { name: en.nav.training })).toHaveAttribute(
        'href',
        routes.learner.training,
      );
      expect(screen.getByRole('link', { name: en.nav.courses })).toHaveAttribute(
        'href',
        routes.learner.courses,
      );
      expect(screen.getByRole('link', { name: en.nav.tips })).toHaveAttribute(
        'href',
        routes.learner.tips,
      );
      expect(screen.getByRole('link', { name: en.nav.discussions })).toHaveAttribute(
        'href',
        routes.community.feed,
      );
      expect(screen.getByRole('link', { name: en.nav.events })).toHaveAttribute(
        'href',
        routes.community.events,
      );
      expect(screen.getByRole('link', { name: en.nav.resources })).toHaveAttribute(
        'href',
        routes.community.resources,
      );
    });

    it('renders every platform-admin item with its translated label and route', () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        isPlatformAdmin: true,
        effectiveIsPlatformAdmin: true,
        viewMode: 'platform_admin' as const,
      });
      renderSidebar(routes.platformAdmin.organizations);

      expect(screen.getByRole('link', { name: en.nav.organizations })).toHaveAttribute(
        'href',
        routes.platformAdmin.organizations,
      );
      expect(screen.getByRole('link', { name: en.nav.courseManager })).toHaveAttribute(
        'href',
        routes.platformAdmin.courses,
      );
      expect(screen.getByRole('link', { name: en.nav.globalAnalytics })).toHaveAttribute(
        'href',
        routes.platformAdmin.analytics,
      );
      expect(screen.getByRole('link', { name: en.nav.communityModeration })).toHaveAttribute(
        'href',
        routes.platformAdmin.moderation,
      );
      expect(screen.getByRole('link', { name: en.nav.platformSettings })).toHaveAttribute(
        'href',
        routes.platformAdmin.settings,
      );
    });

    it('translates the group labels and items when the language changes', async () => {
      mockUseAuth.mockReturnValue(baseAuth);
      await i18n.changeLanguage('da');
      renderSidebar();

      const da = i18n.getResourceBundle('da', 'translation');
      expect(groupLabels()).toEqual([da.nav.learning, da.nav.community]);
      expect(screen.getByRole('link', { name: da.nav.dashboard })).toHaveAttribute(
        'href',
        routes.learner.dashboard,
      );
    });
  });

  describe('active state', () => {
    it('marks only the item matching the current pathname as active', () => {
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar(routes.learner.courses);

      expect(navLink(routes.learner.courses)).toHaveAttribute('data-active', 'true');
      expect(navLink(routes.learner.dashboard)).toHaveAttribute('data-active', 'false');
      expect(navLink(routes.community.feed)).toHaveAttribute('data-active', 'false');
    });

    it('marks the active item inside the org-admin group', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, effectiveIsOrgAdmin: true });
      renderSidebar(routes.orgAdmin.settings);

      expect(navLink(routes.orgAdmin.settings)).toHaveAttribute('data-active', 'true');
      expect(navLink(routes.orgAdmin.root)).toHaveAttribute('data-active', 'false');
      expect(navLink(routes.learner.dashboard)).toHaveAttribute('data-active', 'false');
    });

    it('keeps React Router from matching the org root on a nested path (the `end` prop)', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, effectiveIsOrgAdmin: true });
      renderSidebar(routes.orgAdmin.settings);

      expect(navLink(routes.orgAdmin.settings)).toHaveAttribute('aria-current', 'page');
      expect(navLink(routes.orgAdmin.root)).not.toHaveAttribute('aria-current');
    });

    it('marks the active item inside the platform-admin group', () => {
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        isPlatformAdmin: true,
        effectiveIsPlatformAdmin: true,
        viewMode: 'platform_admin' as const,
      });
      renderSidebar(routes.platformAdmin.analytics);

      expect(navLink(routes.platformAdmin.analytics)).toHaveAttribute('data-active', 'true');
      expect(navLink(routes.platformAdmin.organizations)).toHaveAttribute('data-active', 'false');
    });

    it('leaves every item inactive on a route that is not in the nav', () => {
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar(routes.settings);

      for (const url of [routes.learner.dashboard, routes.learner.courses, routes.community.feed]) {
        expect(navLink(url)).toHaveAttribute('data-active', 'false');
      }
    });
  });

  describe('collapsed mode', () => {
    it('hides the item labels but keeps the links and their active state', () => {
      mockUseAuth.mockReturnValue(baseAuth);
      renderSidebar(routes.learner.courses, { open: false });

      const courses = navLink(routes.learner.courses);
      expect(courses).not.toBeNull();
      expect(courses).toHaveAttribute('data-active', 'true');
      expect(courses?.textContent).toBe('');
      expect(screen.queryByText(en.nav.courses)).not.toBeInTheDocument();
    });

    it('drops the section labels from the rail so they cannot intercept the icons (#370)', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, effectiveIsOrgAdmin: true });
      renderSidebar(routes.learner.dashboard, { open: false });

      const labels = document.querySelectorAll('[data-sidebar="group-label"]');
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((label) => {
        expect(label.className).toContain('group-data-[collapsible=icon]:hidden');
      });
    });
  });
});
