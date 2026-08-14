export function profileJson(alias: string): string {
  return `json_build_object('id', ${alias}.id, 'full_name', ${alias}.full_name, 'avatar_url', ${alias}.avatar_url)`;
}
