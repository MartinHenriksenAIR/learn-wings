import { useLocation, useNavigate } from 'react-router-dom';
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
import { NavLink } from '@/components/NavLink';
import { useAuth, ViewMode } from '@/hooks/useAuth';
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
  Users,
  Building2,
  BarChart3,
  Settings as SettingsIcon,
  LogOut,
  ChevronDown,
  Eye,
  Lightbulb,
  Flag,
  MessageSquare,
} from 'lucide-react';
import { OrgSelector } from '@/components/OrgSelector';
import logoLightDa from '@/assets/logo-light.png';
import logoLightEn from '@/assets/logo-light-en.png';

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

  const viewModeLabels: Record<ViewMode, string> = {
    learner: t('nav.roles.learner'),
    org_admin: t('nav.roles.orgAdmin'),
    platform_admin: t('nav.roles.platformAdmin'),
  };

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

  const initials = profile?.full_name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const getCurrentRoleLabel = () => {
    if (isPlatformAdmin) {
      return t('nav.viewingAs', { role: viewModeLabels[viewMode] });
    }
    return effectiveIsOrgAdmin ? t('nav.roles.orgAdmin') : t('nav.roles.learner');
  };

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center justify-start">
          {collapsed ? (
            <GraduationCap className="h-6 w-6 text-sidebar-primary" />
          ) : (
            <img 
              src={i18n.language === 'da' ? logoLightDa : logoLightEn} 
              alt={i18n.language === 'da' ? 'AI Uddannelse' : 'AI Education'} 
              className="h-auto w-full max-w-[180px] object-contain"
            />
          )}
        </div>
      </SidebarHeader>

      {/* Org selector for platform admins viewing as learner/org_admin */}
      <OrgSelector />

      <SidebarContent className="px-2">
        {/* Learner section - hidden when viewing as platform admin */}
        {!effectiveIsPlatformAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
              {t('nav.learning')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {learnerItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={collapsed ? item.title : undefined}
                    >
                      <NavLink
                        to={item.url}
                        end
                        className="flex items-center gap-3"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                      >
                        <item.icon className="h-4 w-4" />
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
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
              {t('nav.organization')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {orgAdminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={collapsed ? item.title : undefined}
                    >
                      <NavLink
                        to={item.url}
                        end
                        className="flex items-center gap-3"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                      >
                        <item.icon className="h-4 w-4" />
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
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
              {t('nav.platformAdmin')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {platformAdminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.url}
                      tooltip={collapsed ? item.title : undefined}
                    >
                      <NavLink
                        to={item.url}
                        end
                        className="flex items-center gap-3"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                      >
                        <item.icon className="h-4 w-4" />
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

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-[hsl(145,63%,42%)] text-white text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex flex-1 flex-col items-start text-left">
                    <span className="text-sm font-medium">{profile?.full_name}</span>
                    <span className="text-xs text-sidebar-foreground/60">
                      {getCurrentRoleLabel()}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {isPlatformAdmin && (
              <>
                <DropdownMenuLabel className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  {t('nav.switchView')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                  <DropdownMenuRadioItem value="platform_admin">{t('nav.roles.platformAdmin')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="org_admin">{t('nav.roles.orgAdmin')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="learner">{t('nav.roles.learner')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => navigate('/app/settings')}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              {t('nav.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
