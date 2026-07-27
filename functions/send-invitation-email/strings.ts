export type EmailLanguage = 'da' | 'en';

export interface EmailStrings {
  documentTitle: string;
  tagline: string;
  heading: string;
  yourRole: string;
  cta: string;
  copyLinkHint: string;
  expiryNote: string;
  ignoreNote: string;
  rightsReserved: string;
  roleLabels: { learner: string; org_admin: string; platform_admin: string };
  welcomePlatformAdmin: string;
  subjectPlatformAdmin: string;
  welcomeOrg: (roleLabel: string, orgName: string | null) => string;
  subjectOrg: (orgName: string | null) => string;
}

export const EMAIL_STRINGS: Record<EmailLanguage, EmailStrings> = {
  da: {
    documentTitle: 'Invitation til AI Uddannelse',
    tagline: 'AI Uddannelse til Virksomheder',
    heading: 'Du er inviteret!',
    yourRole: 'Din rolle:',
    cta: 'Accepter invitation',
    copyLinkHint: 'Eller kopier dette link til din browser:',
    expiryNote: 'Denne invitation udløber om 7 dage.',
    ignoreNote: 'Hvis du ikke forventede denne invitation, kan du ignorere denne email.',
    rightsReserved: 'Alle rettigheder forbeholdes.',
    roleLabels: { learner: 'Kursist', org_admin: 'Administrator', platform_admin: 'Platform Administrator' },
    welcomePlatformAdmin: 'Du er blevet inviteret til at blive Platform Administrator på AI Uddannelse.',
    subjectPlatformAdmin: 'Du er blevet inviteret som Platform Administrator på AI Uddannelse',
    welcomeOrg: (roleLabel, orgName) =>
      `Du er blevet inviteret til at blive ${roleLabel} hos <strong>${orgName}</strong> på AI Uddannelse.`,
    subjectOrg: (orgName) => `Du er blevet inviteret til ${orgName} på AI Uddannelse`,
  },
  en: {
    documentTitle: 'Invitation to AI Uddannelse',
    tagline: 'AI Education for Businesses',
    heading: "You're invited!",
    yourRole: 'Your role:',
    cta: 'Accept invitation',
    copyLinkHint: 'Or copy this link into your browser:',
    expiryNote: 'This invitation expires in 7 days.',
    ignoreNote: "If you weren't expecting this invitation, you can safely ignore this email.",
    rightsReserved: 'All rights reserved.',
    roleLabels: { learner: 'Learner', org_admin: 'Administrator', platform_admin: 'Platform Administrator' },
    welcomePlatformAdmin: 'You have been invited to become a Platform Administrator at AI Uddannelse.',
    subjectPlatformAdmin: 'You have been invited as a Platform Administrator at AI Uddannelse',
    welcomeOrg: (roleLabel, orgName) =>
      `You have been invited to become ${roleLabel} at <strong>${orgName}</strong> on AI Uddannelse.`,
    subjectOrg: (orgName) => `You have been invited to ${orgName} on AI Uddannelse`,
  },
};

/**
 * Resolve the email language. ADR-0016 category 3: an existing recipient's
 * stored preferred_language wins; otherwise the inviter's dialog pick; otherwise
 * the platform default ('da').
 */
export function resolveEmailLanguage(bodyLang: unknown, profileLang: string | null): EmailLanguage {
  if (profileLang === 'da' || profileLang === 'en') return profileLang;
  if (bodyLang === 'da' || bodyLang === 'en') return bodyLang;
  return 'da';
}
