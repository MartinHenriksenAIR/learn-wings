import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { OrgMembership, Profile, OrgRole } from '@/lib/types';

/**
 * The raw membership row shape returned by `/api/org-memberships`.
 * The endpoint joins profile columns inline rather than nesting an object.
 */
interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: 'active' | 'invited' | 'disabled';
  created_at: string;
  full_name: string;
  // The endpoint also returns email (no Profile slot — kept to document the
  // wire shape) and avatar_url (flows into the reshaped Profile below for
  // avatar display in the member tables).
  email: string;
  avatar_url: string | null;
  department: string | null;
}

/** Reshaped form that the two consumer pages both work with. */
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
      avatar_url: row.avatar_url,
      is_platform_admin: false,
      created_at: row.created_at,
      preferred_language: null,
    },
  };
}

/**
 * The one way to fetch `/api/org-memberships` from the frontend.
 *
 * All consumers for the same orgId share one cache entry. Reshaping
 * (joining the profile columns into the membership object) is done here
 * so both OrganizationDetail and OrgMembersTab get an identical shape.
 * Site-specific concerns (filtering, error toasts) stay at the site.
 */
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
