import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Organization } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Loader2 } from 'lucide-react';

export function OrgSelector() {
  const { currentOrg, setCurrentOrg, isPlatformAdmin, viewMode } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrgs = async () => {
      if (!isPlatformAdmin) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('organizations')
        .select('*')
        .order('name');

      if (data) {
        setOrgs(data as Organization[]);
        // Auto-select first org if none selected
        if (!currentOrg && data.length > 0) {
          setCurrentOrg(data[0] as Organization);
        }
      }
      setLoading(false);
    };

    fetchOrgs();
  }, [isPlatformAdmin, currentOrg, setCurrentOrg]);

  // Only show for platform admins viewing as learner or org_admin
  if (!isPlatformAdmin || viewMode === 'platform_admin') {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading orgs...</span>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" />
        <span>No organizations</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <Select
        value={currentOrg?.id || ''}
        onValueChange={(value) => {
          const org = orgs.find((o) => o.id === value);
          if (org) setCurrentOrg(org);
        }}
      >
        <SelectTrigger className="w-full bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0" />
            <SelectValue placeholder="Select organization" />
          </div>
        </SelectTrigger>
        <SelectContent>
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
