import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizations } from '@/hooks/useOrganizations';
import { Organization } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Building2, Loader2 } from 'lucide-react';

export function OrgSelector() {
  const { currentOrg, setCurrentOrg, isPlatformAdmin, viewMode } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { data: orgs = [], isLoading: loading, error } = useOrganizations({
    enabled: isPlatformAdmin,
  });

  // Auto-select the first org ONCE per mount when none is currently selected.
  // Deliberately not re-running on later refetches — a background refetch must
  // not reset the user's explicit "Platform-wide (no org)" choice.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || orgs.length === 0) return;
    autoSelected.current = true;
    if (!currentOrg) {
      setCurrentOrg(orgs[0]);
    }
    // Only react to the org list arriving — not currentOrg, to avoid resetting user's choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs]);

  useEffect(() => {
    if (error) {
      console.error('OrgSelector: failed to load organizations', error);
    }
  }, [error]);

  useEffect(() => {
    if (viewMode === 'org_admin' && !currentOrg && orgs.length > 0) {
      setCurrentOrg(orgs[0] as Organization);
    }
  }, [viewMode, currentOrg, orgs, setCurrentOrg]);

  if (!isPlatformAdmin || viewMode === 'platform_admin') {
    return null;
  }

  if (loading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground',
          collapsed && 'justify-center px-2',
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {!collapsed && <span>Loading orgs...</span>}
      </div>
    );
  }

  const isOrgAdminMode = viewMode === 'org_admin';
  const orgLabel = currentOrg?.name ?? 'Select organization';

  return (
    <div className={cn('px-3 py-2', collapsed && 'flex justify-center px-2')}>
      <Select
        value={currentOrg?.id || 'none'}
        onValueChange={(value) => {
          // Prevent clearing org in org_admin mode
          if (value === 'none') {
            if (!isOrgAdminMode) {
              setCurrentOrg(null as unknown as Organization);
            }
          } else {
            const org = orgs.find((o) => o.id === value);
            if (org) setCurrentOrg(org);
          }
        }}
      >
        {collapsed ? (
          // Icon rail (#370): a 32px square that still opens the full switcher; the org
          // name moves to a tooltip (+ aria-label) as there is no room for it. [&>svg]:hidden
          // drops the trigger's built-in chevron — the org mark survives because it is
          // wrapped in a <span>, not a direct <svg> child.
          <Tooltip>
            <TooltipTrigger asChild>
              <SelectTrigger
                aria-label={orgLabel}
                className="h-8 w-8 justify-center p-0 bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground [&>svg]:hidden"
              >
                <span className="flex items-center justify-center">
                  <Building2 className="h-4 w-4 shrink-0" />
                </span>
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{orgLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <SelectTrigger className="w-full bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0" />
              <SelectValue placeholder="Select organization" />
            </div>
          </SelectTrigger>
        )}
        <SelectContent>
          {!isOrgAdminMode && (
            <SelectItem value="none">
              <span className="text-muted-foreground">Platform-wide (no org)</span>
            </SelectItem>
          )}
          {orgs.map((org) => (
            <SelectItem key={org.id} value={org.id}>
              {org.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
