import { queryOne } from './db';

const SUPPORTED_LANGUAGES = ['da', 'en'] as const;

export type MemberLanguage = typeof SUPPORTED_LANGUAGES[number];

export function isMemberLanguage(value: unknown): value is MemberLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function resolveProvisioningLanguage(orgDefault: unknown, requested: unknown): MemberLanguage {
  if (isMemberLanguage(orgDefault)) return orgDefault;
  return isMemberLanguage(requested) ? requested : 'en';
}

export async function orgDefaultLanguageForNewProfile(
  email: string,
  tid: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();

  if (normalized) {
    const invited = await queryOne<{ default_member_language: string | null }>(
      `SELECT o.default_member_language
         FROM invitations i
         JOIN organizations o ON o.id = i.org_id
        WHERE i.status = 'pending' AND i.org_id IS NOT NULL AND i.expires_at > now()
          AND lower(trim(i.email)) = $1
        ORDER BY i.created_at DESC
        LIMIT 1`,
      [normalized],
    );
    if (invited) return invited.default_member_language;
  }

  if (!tid || !tid.trim()) return null;

  const bound = await queryOne<{ default_member_language: string | null }>(
    `SELECT default_member_language FROM organizations
      WHERE entra_tid = $1 AND allow_self_registration = true`,
    [tid],
  );
  return bound?.default_member_language ?? null;
}

export async function orgDefaultLanguageForInvitation(linkId: string): Promise<string | null> {
  const row = await queryOne<{ default_member_language: string | null }>(
    `SELECT o.default_member_language
       FROM invitations i
       JOIN organizations o ON o.id = i.org_id
      WHERE i.link_id = $1 AND i.status = 'pending' AND i.expires_at > now()`,
    [linkId],
  );
  return row?.default_member_language ?? null;
}
