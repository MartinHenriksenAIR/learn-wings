export type InviteLanguage = 'da' | 'en';

/**
 * Map an i18next resolvedLanguage (e.g. 'da', 'en', 'en-US') to the invite
 * language the selector defaults to. Platform default is Danish, so anything
 * not explicitly English resolves to 'da'.
 */
export function uiLangToInvite(lang: string | undefined): InviteLanguage {
  return lang?.toLowerCase().startsWith('en') ? 'en' : 'da';
}
