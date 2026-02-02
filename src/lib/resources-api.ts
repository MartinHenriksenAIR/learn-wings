import { supabase } from '@/integrations/supabase/client';

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

export interface CreateResourceInput {
  org_id: string;
  user_id: string;
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

export async function fetchResources(
  orgId: string,
  options?: {
    search?: string;
    resource_type?: string;
    tags?: string[];
  }
): Promise<CommunityResource[]> {
  let query = supabase
    .from('community_resources')
    .select(`
      *,
      profile:profiles!community_resources_user_id_fkey(id, full_name, department)
    `)
    .eq('org_id', orgId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (options?.search) {
    query = query.or(`title.ilike.%${options.search}%,description.ilike.%${options.search}%`);
  }

  if (options?.resource_type) {
    query = query.eq('resource_type', options.resource_type);
  }

  if (options?.tags && options.tags.length > 0) {
    query = query.overlaps('tags', options.tags);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data as CommunityResource[];
}

export async function createResource(input: CreateResourceInput): Promise<CommunityResource> {
  const { data, error } = await supabase
    .from('community_resources')
    .insert(input)
    .select(`
      *,
      profile:profiles!community_resources_user_id_fkey(id, full_name, department)
    `)
    .single();

  if (error) throw error;
  return data as CommunityResource;
}

export async function updateResource(
  id: string,
  input: UpdateResourceInput
): Promise<CommunityResource> {
  const { data, error } = await supabase
    .from('community_resources')
    .update(input)
    .eq('id', id)
    .select(`
      *,
      profile:profiles!community_resources_user_id_fkey(id, full_name, department)
    `)
    .single();

  if (error) throw error;
  return data as CommunityResource;
}

export async function deleteResource(id: string): Promise<void> {
  const { error } = await supabase
    .from('community_resources')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function toggleResourcePinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase
    .from('community_resources')
    .update({ is_pinned: pinned })
    .eq('id', id);

  if (error) throw error;
}
