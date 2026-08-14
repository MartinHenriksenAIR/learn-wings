import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { OrgMembership, Profile, OrgRole } from '@/lib/types';

interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: 'active' | 'invited' | 'disabled';
  created_at: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  department: string | null;
}

type MemberWithProfile = OrgMembership & { profile: Profile };

function reshapeMembership(row: MembershipRow): MemberWithProfile {
  return {
    id: row.id,
    org_id: row.org_id,
    user_id: row.user_id,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    profile: {
      id: row.user_id,
      full_name: row.full_name,
      first_name: null,
      last_name: null,
      department: row.department,
      email: row.email,
      avatar_url: row.avatar_url,
      is_platform_admin: false,
      created_at: row.created_at,
      preferred_language: null,
      assessment_level: null,
      assessment_skipped_at: null,
      assessment_taken_at: null,
    },
  };
}

export function useOrgMemberships(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgMemberships.list(orgId),
    queryFn: async () => {
      const { memberships } = await callApi<{ memberships: MembershipRow[] }>(
        '/api/org-memberships',
        { orgId },
      );
      const rows = Array.isArray(memberships) ? memberships : [];
      return rows.map(reshapeMembership);
    },
    staleTime: 30 * 1000,
    enabled: !!orgId,
  });
}
