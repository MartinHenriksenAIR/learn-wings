import { profileJson } from './profile-json';

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
