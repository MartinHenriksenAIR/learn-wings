import { useLocation, useNavigate } from 'react-router-dom';
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
  Award,
  Eye,
  Lightbulb,
  Flag,
  MessageSquare,
} from 'lucide-react';
import { OrgSelector } from '@/components/OrgSelector';
import logoLight from '@/assets/logo-light.png';

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
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
    learner: 'Learner',
    org_admin: 'Org. Admin',
    platform_admin: 'Platform Admin',
  };

  // Build learner items based on feature toggles
  const learnerItems = [
    { title: 'Dashboard', url: '/app/dashboard', icon: LayoutDashboard },
    { title: 'My Courses', url: '/app/courses', icon: BookOpen },
    ...(features.certificates_enabled ? [{ title: 'Certificates', url: '/app/certificates', icon: Award }] : []),
    ...(features.community_enabled ? [{ title: 'Community', url: '/app/community', icon: MessageSquare }] : []),
  ];

  // Build org admin items based on feature toggles
  const orgAdminItems = [
    { title: 'Organization', url: '/app/admin/org', icon: Building2 },
    { title: 'Team Members', url: '/app/admin/org/users', icon: Users },
    ...(features.analytics_enabled ? [{ title: 'Analytics', url: '/app/admin/analytics', icon: BarChart3 }] : []),
    ...(features.community_enabled ? [
      { title: 'Ideas Overview', url: '/app/admin/org/ideas', icon: Lightbulb },
      { title: 'Moderation', url: '/app/admin/org/moderation', icon: Flag },
    ] : []),
  ];

  // Build platform admin items based on feature toggles
  const platformAdminItems = [
    { title: 'Organizations', url: '/app/admin/organizations', icon: Building2 },
    { title: 'Users', url: '/app/admin/users', icon: Users },
    { title: 'Course Manager', url: '/app/admin/courses', icon: GraduationCap },
    ...(features.analytics_enabled ? [{ title: 'Global Analytics', url: '/app/admin/analytics/global', icon: BarChart3 }] : []),
    ...(features.community_enabled ? [{ title: 'Community Moderation', url: '/app/admin/platform/moderation', icon: Flag }] : []),
    { title: 'Platform Settings', url: '/app/admin/platform/settings', icon: SettingsIcon },
  ];

  const initials = profile?.full_name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const getCurrentRoleLabel = () => {
    if (isPlatformAdmin) {
      return `Viewing as: ${viewModeLabels[viewMode]}`;
    }
    return effectiveIsOrgAdmin ? 'Org Admin' : 'Learner';
  };

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center justify-center">
          {collapsed ? (
            <GraduationCap className="h-6 w-6 text-sidebar-primary" />
          ) : (
            <img 
              src={logoLight} 
              alt="AI Uddannelse" 
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
              Learning
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {learnerItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
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
              Organization
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {orgAdminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
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
              Platform Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {platformAdminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
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
                  Switch View
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                  <DropdownMenuRadioItem value="platform_admin">Platform Admin</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="org_admin">Org. Admin</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="learner">Learner</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => navigate('/app/settings')}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
