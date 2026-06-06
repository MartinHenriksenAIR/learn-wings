import { callApi } from '@/lib/api-client';

export interface CommunityResource {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  description: string | null;
  resource_type: string;
  url: string | null;
  tags: string[] | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  profile?: {
    id: string;
    full_name: string;
    department: string | null;
  } | null;
}

// `user_id` is server-derived from the bearer token — never client-supplied (parity
// constraint from the RLS policy `user_id = auth.uid()` on create).
export interface CreateResourceInput {
  org_id: string;
  title: string;
  description?: string;
  resource_type: string;
  url?: string;
  tags?: string[];
}

export interface UpdateResourceInput {
  title?: string;
  description?: string;
  resource_type?: string;
  url?: string;
  tags?: string[];
  is_pinned?: boolean;
}

export const RESOURCE_TYPES = [
  { value: 'link', label: 'Link', icon: 'Link' },
  { value: 'document', label: 'Document', icon: 'FileText' },
  { value: 'template', label: 'Template', icon: 'FileCode' },
  { value: 'guide', label: 'Guide', icon: 'BookOpen' },
] as const;

export interface FetchResourcesResult {
  resources: CommunityResource[];
  allTags: string[];
}

export async function fetchResources(
  orgId: string,
  options?: {
    search?: string;
    resource_type?: string;
    tags?: string[];
  }
): Promise<FetchResourcesResult> {
  const res = await callApi<FetchResourcesResult>('/api/resources', {
    orgId,
    search: options?.search,
    resource_type: options?.resource_type,
    tags: options?.tags,
  });
  return { resources: res.resources ?? [], allTags: res.allTags ?? [] };
}

export async function createResource(input: CreateResourceInput): Promise<CommunityResource> {
  const res = await callApi<{ resource: CommunityResource }>('/api/resource-create', {
    orgId: input.org_id,
    title: input.title,
    description: input.description,
    resource_type: input.resource_type,
    url: input.url,
    tags: input.tags,
  });
  return res.resource;
}

export async function updateResource(
  id: string,
  input: UpdateResourceInput
): Promise<CommunityResource> {
  const res = await callApi<{ resource: CommunityResource }>('/api/resource-update', {
    resourceId: id,
    updates: input,
  });
  return res.resource;
}

export async function deleteResource(id: string): Promise<void> {
  await callApi('/api/resource-delete', { resourceId: id });
}

export async function toggleResourcePinned(id: string, pinned: boolean): Promise<void> {
  await callApi('/api/resource-update', { resourceId: id, updates: { is_pinned: pinned } });
}
