import { supabase } from '@/integrations/supabase/client';

/**
 * Get a signed URL for a storage file that expires after 1 hour.
 * This is more secure than public URLs as access expires.
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<string | null> {
  if (!path) return null;
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  
  if (error) {
    console.error('Error creating signed URL:', error);
    return null;
  }
  
  return data?.signedUrl || null;
}

/**
 * Get signed URLs for course content (videos and documents).
 * Falls back to the original path if signing fails.
 */
export async function getSignedAssetUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  
  // The lms-assets bucket stores course materials
  return getSignedUrl('lms-assets', storagePath, 3600);
}
