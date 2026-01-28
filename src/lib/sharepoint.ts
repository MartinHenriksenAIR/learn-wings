/**
 * Video URL Utilities
 * 
 * Handles validation and transformation of SharePoint and Microsoft Stream video URLs
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
 * Cleans a SharePoint/Stream URL that might contain extra HTML attributes
 * from copying the entire embed code instead of just the src URL.
 * 
 * Input: 'https://...embed.aspx?..." width="640" height="360"...'
 * Output: 'https://...embed.aspx?...'
 */
export function cleanSharePointUrl(input: string): string {
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
  const cleanedUrl = cleanSharePointUrl(url);
  
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
 */
export function getSharePointEmbedUrl(url: string): string | null {
  // First clean the URL in case extra HTML attributes were pasted
  const cleanedUrl = cleanSharePointUrl(url);
  
  if (!isSharePointUrl(cleanedUrl)) return null;
  
  try {
    const parsed = new URL(cleanedUrl);
    
    // If already an embed URL, clean up auth-forcing parameters
    if (parsed.pathname.includes('/embed.aspx') || parsed.pathname.includes('/_layouts/15/embed.aspx')) {
      // Check if embed param exists and contains ust:true (forces auth)
      const embedParam = parsed.searchParams.get('embed');
      if (embedParam) {
        try {
          const embedJson = JSON.parse(embedParam);
          // Remove user session token requirement for anonymous viewing
          if (embedJson.ust === true) {
            delete embedJson.ust;
            parsed.searchParams.set('embed', JSON.stringify(embedJson));
          }
        } catch {
          // If parsing fails, continue with original URL
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
 * Tries Microsoft Stream first (better iframe support), then SharePoint.
 */
export function getVideoEmbedUrl(url: string): string | null {
  if (!url) return null;
  
  const cleanedUrl = cleanSharePointUrl(url);
  
  // Try Microsoft Stream first (better cross-origin support)
  if (isMicrosoftStreamUrl(cleanedUrl)) {
    return getMicrosoftStreamEmbedUrl(cleanedUrl);
  }
  
  // Try SharePoint
  if (isSharePointUrl(cleanedUrl)) {
    return getSharePointEmbedUrl(cleanedUrl);
  }
  
  // Return as-is if not recognized
  return cleanedUrl;
}

/**
 * Validates a video URL and returns validation result.
 * Accepts SharePoint embed URLs and Microsoft Stream URLs.
 */
export function validateSharePointUrl(url: string): { valid: boolean; error?: string } {
  if (!url || !url.trim()) {
    return { valid: false, error: 'URL is required' };
  }
  
  // Clean the URL first (handle pasted embed codes with HTML attributes)
  const cleanedUrl = cleanSharePointUrl(url);
  
  try {
    new URL(cleanedUrl);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
  
  if (!isSharePointUrl(cleanedUrl) && !isMicrosoftStreamUrl(cleanedUrl)) {
    return { valid: false, error: 'URL must be a SharePoint embed URL (*.sharepoint.com/...embed.aspx) or Microsoft Stream link' };
  }
  
  return { valid: true };
}
