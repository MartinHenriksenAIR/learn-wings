import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuth, ViewMode } from '@/hooks/useAuth';
import { useViewModeLabels } from '@/components/layout/view-mode-labels';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  Building2,
  BarChart3,
  Settings as SettingsIcon,
  LogOut,
  ChevronDown,
  Lightbulb,
  Flag,
  MessageSquare,
} from 'lucide-react';
import { OrgSelector } from '@/components/OrgSelector';
import { getInitials } from '@/lib/utils';
import logoLightDa from '@/assets/logo-light.png';
import logoLightEn from '@/assets/logo-light-en.png';

// Pill nav item: navy bg + white text when active, muted slate otherwise.
// data-[active=true]:font-semibold looks redundant next to the base font-semibold, but it is
// load-bearing: it twMerge-overrides the sidebar cva's data-[active=true]:font-medium.
const NAV_BUTTON_CLASSES =
  'h-auto gap-[11px] rounded-[11px] px-3 py-2.5 text-[13.5px] font-semibold text-sidebar-foreground ' +
  'hover:bg-[#f3f4f8] hover:text-foreground active:bg-[#f3f4f8] active:text-foreground ' +
  'data-[active=true]:bg-primary data-[active=true]:font-semibold data-[active=true]:text-primary-foreground ' +
  'data-[active=true]:hover:bg-primary data-[active=true]:hover:text-primary-foreground [&>svg]:size-[17px]';

const GROUP_LABEL_CLASSES =
  'h-auto px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#9aa0af]';

const MENU_ITEM_CLASSES = 'rounded-[9px] text-[13px] font-medium';

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { t } = useTranslation();
  const {
    profile,
    isPlatformAdmin,
    effectiveIsPlatformAdmin,
    effectiveIsOrgAdmin,
    currentOrg,
    signOut,
    viewMode,
    setViewMode,
  } = useAuth();
  const { features } = usePlatformSettings();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const viewModeLabels = useViewModeLabels();

  // Build learner items based on feature toggles
  const learnerItems = [
    { title: t('nav.dashboard'), url: '/app/dashboard', icon: LayoutDashboard },
    { title: t('nav.courses'), url: '/app/courses', icon: BookOpen },
    ...(features.community_enabled ? [{ title: t('nav.community'), url: '/app/community', icon: MessageSquare }] : []),
  ];

  // Build org admin items based on feature toggles
  const orgAdminItems = [

    ...(features.analytics_enabled ? [{ title: t('nav.organization'), url: '/app/admin/analytics', icon: BarChart3 }] : []),
    ...(features.community_enabled ? [
      { title: t('nav.ideasOverview'), url: '/app/admin/org/ideas', icon: Lightbulb },
      { title: t('nav.moderation'), url: '/app/admin/org/moderation', icon: Flag },
    ] : []),
    { title: t('nav.settings'), url: '/app/admin/org/settings', icon: SettingsIcon },
  ];

  // Build platform admin items based on feature toggles
  const platformAdminItems = [
    { title: t('nav.organizations'), url: '/app/admin/organizations', icon: Building2 },
    { title: t('nav.courseManager'), url: '/app/admin/courses', icon: GraduationCap },
    ...(features.analytics_enabled ? [{ title: t('nav.globalAnalytics'), url: '/app/admin/analytics/global', icon: BarChart3 }] : []),
    ...(features.community_enabled ? [{ title: t('nav.communityModeration'), url: '/app/admin/platform/moderation', icon: Flag }] : []),
    { title: t('nav.platformSettings'), url: '/app/admin/platform/settings', icon: SettingsIcon },
  ];

  const initials = getInitials(profile?.full_name);

  const getCurrentRoleLabel = () => {
    if (isPlatformAdmin) {
      return t('nav.viewingAs', { role: viewModeLabels[viewMode] });
    }
    return effectiveIsOrgAdmin ? t('nav.roles.orgAdmin') : t('nav.roles.learner');
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-5 pb-4 pt-[22px]">
        <div className="flex items-center justify-start">
          {collapsed ? (
            <GraduationCap className="h-6 w-6 text-sidebar-primary" />
          ) : (
            <img
              src={i18n.language === 'da' ? logoLightDa : logoLightEn}
              alt={i18n.language === 'da' ? 'AI Uddannelse' : 'AI Education'}
              className="block h-10 w-auto max-w-full object-contain"
            />
          )}
        </div>
      </SidebarHeader>

      {/* Org selector for platform admins viewing as learner/org_admin */}
      <OrgSelector />

      <SidebarContent className="gap-3.5 px-3.5 pb-4 pt-2">
        {/* Learner section - hidden when viewing as platform admin */}
        {!effectiveIsPlatformAdmin && (
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className={GROUP_LABEL_CLASSES}>
              {t('nav.learning')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-[3px]">
                {learnerItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={collapsed ? item.title : undefined}
                      className={NAV_BUTTON_CLASSES}
                    >
                      <NavLink to={item.url} end className="flex items-center">
                        <item.icon />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Org Admin section - hidden when viewing as platform admin */}
        {effectiveIsOrgAdmin && !effectiveIsPlatformAdmin && (
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className={GROUP_LABEL_CLASSES}>
              {t('nav.organization')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-[3px]">
                {orgAdminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={collapsed ? item.title : undefined}
                      className={NAV_BUTTON_CLASSES}
                    >
                      <NavLink to={item.url} end className="flex items-center">
                        <item.icon />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Platform Admin section */}
        {effectiveIsPlatformAdmin && (
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className={GROUP_LABEL_CLASSES}>
              {t('nav.platformAdmin')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-[3px]">
                {platformAdminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={collapsed ? item.title : undefined}
                      className={NAV_BUTTON_CLASSES}
                    >
                      <NavLink to={item.url} end className="flex items-center">
                        <item.icon />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-2.5 rounded-xl p-2 text-sidebar-foreground hover:bg-[#f3f4f8] hover:text-foreground"
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                    <span className="w-full truncate text-[13px] font-bold text-foreground">
                      {profile?.full_name}
                    </span>
                    <span className="w-full truncate text-[11.5px] text-[#9aa0af]">
                      {getCurrentRoleLabel()}
                    </span>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9aa0af]" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            className="w-56 rounded-[14px] border-border p-1.5 shadow-[0_16px_40px_rgba(20,24,46,0.14)]"
          >
            {isPlatformAdmin && (
              <>
                <DropdownMenuLabel className="px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#9aa0af]">
                  {t('nav.switchView')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                  <DropdownMenuRadioItem className={MENU_ITEM_CLASSES} value="platform_admin">
                    {t('nav.roles.platformAdmin')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem className={MENU_ITEM_CLASSES} value="org_admin">
                    {t('nav.roles.orgAdmin')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem className={MENU_ITEM_CLASSES} value="learner">
                    {t('nav.roles.learner')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator className="bg-border" />
              </>
            )}
            <DropdownMenuItem className={MENU_ITEM_CLASSES} onClick={() => navigate('/app/settings')}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={handleSignOut}
              className={`${MENU_ITEM_CLASSES} text-destructive focus:bg-[#fdf1f1] focus:text-destructive`}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t('nav.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
