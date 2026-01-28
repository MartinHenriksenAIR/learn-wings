/**
 * Video URL Utilities
 * 
 * Handles validation and transformation of video URLs from supported platforms
 * for embedding in an iframe.
 * 
 * Supported platforms:
 * - Google Drive (recommended)
 * - SharePoint (embed.aspx URLs only)
 * - Microsoft Stream
 */

/**
 * Validates if a URL is a Google Drive URL.
 * Matches patterns like:
 * - https://drive.google.com/file/d/{fileId}/view
 * - https://drive.google.com/file/d/{fileId}/preview
 * - https://drive.google.com/open?id={fileId}
 */
export function isGoogleDriveUrl(url: string): boolean {
  if (!url) return false;
  
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'drive.google.com';
  } catch {
    return false;
  }
}

/**
 * Extracts the file ID from a Google Drive URL.
 */
function extractGoogleDriveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    
    // Format: /file/d/{fileId}/...
    const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    // Format: ?id={fileId}
    const idParam = parsed.searchParams.get('id');
    if (idParam) {
      return idParam;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Transforms a Google Drive URL into an embeddable URL.
 * 
 * Input patterns:
 * - https://drive.google.com/file/d/{fileId}/view
 * - https://drive.google.com/file/d/{fileId}/view?usp=sharing
 * - https://drive.google.com/open?id={fileId}
 * 
 * Output:
 * - https://drive.google.com/file/d/{fileId}/preview
 */
export function getGoogleDriveEmbedUrl(url: string): string | null {
  const cleanedUrl = cleanVideoUrl(url);
  
  if (!isGoogleDriveUrl(cleanedUrl)) return null;
  
  const fileId = extractGoogleDriveFileId(cleanedUrl);
  if (!fileId) return null;
  
  // The /preview endpoint is designed for iframe embedding
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

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
 * Validates if a URL is a Microsoft Stream video URL.
 * Matches patterns like:
 * - https://web.microsoftstream.com/video/{id}
 * - https://web.microsoftstream.com/embed/video/{id}
 * - https://{tenant}.stream.office.com/video/{id} (new Stream)
 */
export function isMicrosoftStreamUrl(url: string): boolean {
  if (!url) return false;
  
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'web.microsoftstream.com' || 
           parsed.hostname.endsWith('.stream.office.com');
  } catch {
    return false;
  }
}

/**
 * Cleans a video URL that might contain extra HTML attributes
 * from copying the entire embed code instead of just the src URL.
 * 
 * Input: 'https://...embed.aspx?..." width="640" height="360"...'
 * Output: 'https://...embed.aspx?...'
 */
export function cleanVideoUrl(input: string): string {
  if (!input) return input;
  
  // Trim whitespace
  let url = input.trim();
  
  // Check if the input contains HTML attributes after the URL (common mistake)
  // Look for patterns like: " width=" or "' width=" or just ending quote + attributes
  const quoteAttrPattern = /["']\s*(width|height|frameborder|scrolling|allowfullscreen|title|class|style)\s*=/i;
  const match = url.match(quoteAttrPattern);
  
  if (match && match.index !== undefined) {
    // Cut off everything from the quote before attributes
    url = url.substring(0, match.index);
  }
  
  // Also handle case where URL ends with a quote
  url = url.replace(/["']$/, '');
  
  return url.trim();
}

// Keep the old function name as an alias for backward compatibility
export const cleanSharePointUrl = cleanVideoUrl;

/**
 * Transforms a Microsoft Stream URL into an embeddable URL.
 * 
 * Input patterns:
 * - https://web.microsoftstream.com/video/{id}
 * 
 * Output:
 * - https://web.microsoftstream.com/embed/video/{id}?autoplay=false&showinfo=true
 */
export function getMicrosoftStreamEmbedUrl(url: string): string | null {
  const cleanedUrl = cleanVideoUrl(url);
  
  if (!isMicrosoftStreamUrl(cleanedUrl)) return null;
  
  try {
    const parsed = new URL(cleanedUrl);
    
    // Already an embed URL
    if (parsed.pathname.includes('/embed/video/')) {
      return cleanedUrl;
    }
    
    // Transform /video/{id} to /embed/video/{id}
    if (parsed.pathname.includes('/video/')) {
      const videoId = parsed.pathname.split('/video/')[1]?.split('/')[0]?.split('?')[0];
      if (videoId) {
        return `https://${parsed.hostname}/embed/video/${videoId}?autoplay=false&showinfo=true`;
      }
    }
    
    return cleanedUrl;
  } catch {
    return null;
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
 * 
 * WARNING: SharePoint embedding has significant limitations due to X-Frame-Options.
 * Consider using Google Drive instead for reliable cross-origin embedding.
 */
export function getSharePointEmbedUrl(url: string): string | null {
  // First clean the URL in case extra HTML attributes were pasted
  const cleanedUrl = cleanVideoUrl(url);
  
  if (!isSharePointUrl(cleanedUrl)) return null;
  
  try {
    const parsed = new URL(cleanedUrl);
    
    // If already an embed URL, clean up auth-forcing parameters
    if (parsed.pathname.includes('/embed.aspx') || parsed.pathname.includes('/_layouts/15/embed.aspx')) {
      // The 'embed' param contains JSON with ust:true that forces authentication
      // We must remove this to allow anonymous viewing with "Anyone with the link" permissions
      const embedParam = parsed.searchParams.get('embed');
      if (embedParam) {
        try {
          const embedJson = JSON.parse(embedParam);
          // Remove user session token requirement for anonymous viewing
          // When ust:true is present, SharePoint requires Microsoft login even if
          // the file is shared with "Anyone with the link"
          if ('ust' in embedJson) {
            delete embedJson.ust;
            // If only 'hv' remains and it's just metadata, we can keep it or remove the whole param
            if (Object.keys(embedJson).length === 0) {
              parsed.searchParams.delete('embed');
            } else {
              parsed.searchParams.set('embed', JSON.stringify(embedJson));
            }
          }
        } catch {
          // If parsing fails, try to remove the embed param entirely as fallback
          // This is aggressive but ensures the video can play
          console.warn('Failed to parse embed param, removing it for anonymous access');
          parsed.searchParams.delete('embed');
        }
      }
      return parsed.toString();
    }
    
    // Check if it's a video share link (contains /:v:/)
    if (parsed.pathname.includes('/:v:/')) {
      // Transform share link to embed URL
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
 * Gets the best embeddable URL for any supported video source.
 * Priority: Google Drive > Microsoft Stream > SharePoint
 */
export function getVideoEmbedUrl(url: string): string | null {
  if (!url) return null;
  
  const cleanedUrl = cleanVideoUrl(url);
  
  // Try Google Drive first (most reliable for cross-origin embedding)
  if (isGoogleDriveUrl(cleanedUrl)) {
    return getGoogleDriveEmbedUrl(cleanedUrl);
  }
  
  // Try Microsoft Stream (better cross-origin support than SharePoint)
  if (isMicrosoftStreamUrl(cleanedUrl)) {
    return getMicrosoftStreamEmbedUrl(cleanedUrl);
  }
  
  // Try SharePoint (may have X-Frame-Options issues)
  if (isSharePointUrl(cleanedUrl)) {
    return getSharePointEmbedUrl(cleanedUrl);
  }
  
  // Return as-is if not recognized
  return cleanedUrl;
}

/**
 * Validates a video URL and returns validation result.
 * Accepts Google Drive, SharePoint embed URLs, and Microsoft Stream URLs.
 */
export function validateVideoUrl(url: string): { valid: boolean; error?: string } {
  if (!url || !url.trim()) {
    return { valid: false, error: 'URL is required' };
  }
  
  // Clean the URL first (handle pasted embed codes with HTML attributes)
  const cleanedUrl = cleanVideoUrl(url);
  
  try {
    new URL(cleanedUrl);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  
  if (isGoogleDriveUrl(cleanedUrl)) {
    const fileId = extractGoogleDriveFileId(cleanedUrl);
    if (!fileId) {
      return { valid: false, error: 'Could not extract file ID from Google Drive URL. Use format: drive.google.com/file/d/{fileId}/view' };
    }
    return { valid: true };
  }
  
  if (isSharePointUrl(cleanedUrl) || isMicrosoftStreamUrl(cleanedUrl)) {
    return { valid: true };
  }
  
  return { 
    valid: false, 
    error: 'URL must be a Google Drive link (drive.google.com/file/d/...), SharePoint embed URL, or Microsoft Stream link' 
  };
}

// Keep the old function name as an alias for backward compatibility
export const validateSharePointUrl = validateVideoUrl;
