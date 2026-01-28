// Platform configuration
// Update this when deploying to a custom domain

export const PLATFORM_BASE_URL = 'https://ai-uddannelse.dk';

/**
 * Generate an invite link using the platform's base URL
 */
export function getInviteLink(linkId: string): string {
  return `${PLATFORM_BASE_URL}/signup?invite=${linkId}`;
}
