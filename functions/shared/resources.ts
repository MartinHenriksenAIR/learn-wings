import { queryOne } from './db';
import { isOrgAdmin } from './profile';
import type { CallerProfile } from './profile';
import { profileJson } from './profile-json';

/**
 * Allowed resource_type values. Mirrors RESOURCE_TYPES in src/lib/resources-api.ts
 * (the form's <Select> options). No DB CHECK constraint exists (the column is
 * plain TEXT DEFAULT 'link'); validating in resource-create/resource-update keeps
 * types consistent with the frontend.
 */
export const RESOURCE_TYPES = ['link', 'document', 'template', 'guide'];

export interface ResourceRow {
  id: string;
  org_id: string;
  user_id: string;
}

/**
 * Shared load + authorize gate for the resource write endpoints
 * (resource-update, resource-delete — #261).
 *
 * Authorization (OR of RLS policies, provenance 20260202125517):
 *   - platform admin (suite convention; short-circuits WITHOUT the isOrgAdmin DB probe)
 *   - author of the resource
 *   - org admin of the resource's org
 *
 * Returns null for BOTH "doesn't exist" and "exists but caller isn't allowed" —
 * callers reply 404 { error: 'Resource not found' } either way. Collapsing the
 * two keeps an authenticated caller from distinguishing them — prevents
 * cross-org enumeration of resource IDs. Do not split the cases apart at call
 * sites or surface different bodies for them.
 */
export async function loadResourceForWrite(
  resourceId: string,
  profile: CallerProfile,
): Promise<ResourceRow | null> {
  const resource = await queryOne<ResourceRow>(
    `SELECT id, org_id, user_id FROM community_resources WHERE id = $1`,
    [resourceId],
  );
  if (!resource) return null;

  if (profile.is_platform_admin) return resource;
  if (resource.user_id === profile.id) return resource;
  if (await isOrgAdmin(profile.id, resource.org_id)) return resource;
  return null;
}

/**
 * SQL fragment that projects the embedded `profile` object on a resource row.
 * Expects the FROM clause to LEFT JOIN profiles aliased as `pr` on the resource's user_id.
 * Used by resource list/create/update to keep the response shape consistent in one place.
 * Wraps the shared canonical author-profile fragment in a NULL guard for the LEFT JOIN.
 */
export const RESOURCE_PROFILE_PROJECTION = `
  CASE WHEN pr.id IS NULL THEN NULL ELSE
    ${profileJson('pr')}
  END AS profile
`.trim();
