/**
 * SharePoint Video URL Utilities
 * 
 * Handles validation and transformation of SharePoint video URLs
 * for embedding in an iframe.
 */

/**
 * Validates if a URL is a SharePoint video URL.
 * Matches patterns like:
 * - https://company.sharepoint.com/:v:/s/SiteName/...
 * - https://company.sharepoint.com/:v:/r/sites/...
 * - https://company-my.sharepoint.com/:v:/g/personal/...
 * - https://company.sharepoint.com/.../embed.aspx?...
 */
export function isSharePointUrl(url: string): boolean {
  if (!url) return false;
  
  try {
    const parsed = new URL(url);
    // Check if domain ends with sharepoint.com
    return parsed.hostname.endsWith('.sharepoint.com');
  } catch {
    return false;
  }
}

/**
 * Transforms a SharePoint share URL into an embeddable URL.
 * 
 * Input patterns:
 * - Share link: https://company.sharepoint.com/:v:/s/SiteName/EaBC123...
 * - Already embed: https://company.sharepoint.com/.../embed.aspx?...
 * 
 * Output:
 * - Embed URL with action=embedview parameter
 */
export function getSharePointEmbedUrl(url: string): string | null {
  if (!isSharePointUrl(url)) return null;
  
  try {
    const parsed = new URL(url);
    
    // If already an embed URL, return as-is but ensure embedview action
    if (parsed.pathname.includes('/embed.aspx') || parsed.pathname.includes('/_layouts/15/embed.aspx')) {
      if (!parsed.searchParams.has('action')) {
        parsed.searchParams.set('action', 'embedview');
      }
      return parsed.toString();
    }
    
    // Check if it's a video share link (contains /:v:/)
    if (parsed.pathname.includes('/:v:/')) {
      // Transform share link to embed URL
      // SharePoint share links have format: /:v:/[type]/[path]/[id]
      // We need to add action=embedview to make it embeddable
      parsed.searchParams.set('action', 'embedview');
      return parsed.toString();
    }
    
    // For other SharePoint URLs, try adding action=embedview
    parsed.searchParams.set('action', 'embedview');
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates a SharePoint URL and returns validation result.
 */
export function validateSharePointUrl(url: string): { valid: boolean; error?: string } {
  if (!url || !url.trim()) {
    return { valid: false, error: 'URL is required' };
  }
  
  try {
    new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  
  if (!isSharePointUrl(url)) {
    return { valid: false, error: 'URL must be a SharePoint link (*.sharepoint.com)' };
  }
  
  return { valid: true };
}
