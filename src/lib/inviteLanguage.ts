export type InviteLanguage = 'da' | 'en';

export function uiLangToInvite(lang: string | undefined): InviteLanguage {
  return lang?.toLowerCase().startsWith('en') ? 'en' : 'da';
}
