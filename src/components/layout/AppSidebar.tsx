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
  Layers,
  Award,
  Eye,
} from 'lucide-react';
import { OrgSelector } from '@/components/OrgSelector';

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

  const learnerItems = [
    { title: 'Dashboard', url: '/app/dashboard', icon: LayoutDashboard },
    { title: 'My Courses', url: '/app/courses', icon: BookOpen },
    { title: 'Certificates', url: '/app/certificates', icon: Award },
  ];

  const orgAdminItems = [
    { title: 'Organization', url: '/app/admin/org', icon: Building2 },
    { title: 'Team Members', url: '/app/admin/users', icon: Users },
    { title: 'Analytics', url: '/app/admin/analytics', icon: BarChart3 },
  ];

  const platformAdminItems = [
    { title: 'Platform Overview', url: '/app/admin/platform', icon: Layers },
    { title: 'Organizations', url: '/app/admin/organizations', icon: Building2 },
    { title: 'Course Manager', url: '/app/admin/courses', icon: GraduationCap },
    { title: 'Global Analytics', url: '/app/admin/analytics/global', icon: BarChart3 },
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
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
            <GraduationCap className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-sidebar-foreground">
                AIR Academy
              </span>
              {currentOrg && (
                <span className="text-xs text-sidebar-foreground/60">
                  {currentOrg.name}
                </span>
              )}
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* Org selector for platform admins viewing as learner/org_admin */}
      <OrgSelector />

      <SidebarContent className="px-2">
        {/* Learner section - shown to all users */}
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

        {/* Org Admin section */}
        {effectiveIsOrgAdmin && (
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
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
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
