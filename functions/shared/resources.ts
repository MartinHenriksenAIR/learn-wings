import { queryOne } from './db';
import { isOrgAdmin } from './profile';
import type { CallerProfile } from './profile';
import { profileJson } from './profile-json';

export const RESOURCE_TYPES = ['link', 'document', 'template', 'guide'];

export interface ResourceRow {
  id: string;
  org_id: string;
  user_id: string;
}

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

export const RESOURCE_PROFILE_PROJECTION = `
  CASE WHEN pr.id IS NULL THEN NULL ELSE
    ${profileJson('pr')}
  END AS profile
`.trim();
