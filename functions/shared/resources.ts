/**
 * SQL fragment that projects the embedded `profile` object on a resource row.
 * Expects the FROM clause to LEFT JOIN profiles aliased as `pr` on the resource's user_id.
 * Used by resource list/create/update to keep the response shape consistent in one place.
 */
export const RESOURCE_PROFILE_PROJECTION = `
  CASE WHEN pr.id IS NULL THEN NULL ELSE
    json_build_object('id', pr.id, 'full_name', pr.full_name, 'department', pr.department)
  END AS profile
`.trim();
