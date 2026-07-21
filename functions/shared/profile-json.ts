/**
 * SQL fragment projecting the canonical author-profile object for a joined
 * `profiles` row under the given table `alias`.
 *
 * Returns just the `json_build_object(...)` expression — no `AS profile` alias and
 * no NULL guard — so callers compose it to match their JOIN:
 *   INNER JOIN (row always present):  `${profileJson('pr')} AS profile`
 *   LEFT  JOIN (row may be null):     `CASE WHEN pr.id IS NULL THEN NULL ELSE ${profileJson('pr')} END AS profile`
 *
 * The shape is fixed at ('id', 'full_name', 'avatar_url') and is the single source
 * of truth that replaced the ~10 hand-copied variants (issue #197). Widen the shape
 * HERE, once, rather than re-drifting it per endpoint. Pinned by profile-json.test.ts,
 * which also fails the build if any endpoint hand-rolls this fragment again.
 */
export function profileJson(alias: string): string {
  return `json_build_object('id', ${alias}.id, 'full_name', ${alias}.full_name, 'avatar_url', ${alias}.avatar_url)`;
}
