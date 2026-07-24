# Localize Invitation Email (#225) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the invitation email (subject + body + `<html lang>`) in the recipient's language instead of always Danish, per ADR-0016 category 3.

**Architecture:** Language is resolved **server-side** in `send-invitation-email` by precedence — the invitee's stored `profiles.preferred_language` wins; else the inviter's dialog pick (`inviterLanguage` in the request body); else the platform default `da`. All fixed strings come from a keyed `da`/`en` map local to the endpoint. The frontend adds a language selector (defaulting to the inviting admin's UI language) to the four invite surfaces and forwards the pick. No language is persisted (the email is sent once at create time; no resend feature) → no DB migration.

**Tech Stack:** Azure Functions v4 (Node 20, raw `pg`, Resend) · React 18 + Vite + TypeScript · shadcn/ui `Select` · i18next (en+da) · Vitest.

## Global Constraints

- Supported languages are **`'da' | 'en'` only**; platform default is **`da`**. — copied from ADR-0016 / spec.
- **No DB migration** and no change to `invitations` / `invitation-create` / `invitation-bulk-create` / `invitation-accept`. — spec "Out of scope".
- `allowedLinkDomains()` / `ALLOWED_LINK_DOMAINS`, the Resend send, and the platform-admin-OR-org-admin authorization in `send-invitation-email` are **unchanged**. — issue AC + spec.
- Functions tests **mock `pg`** (`vi.mock('../shared/db')`); no live DB. — `.claude/rules/functions.md`.
- All verification gates must exit 0 before the PR: root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; in `functions/`: `npm run build` · `npm test`. — AGENTS.md.
- Work on branch `feat/localize-invitation-email-225`. Conventional-commit messages, each ending with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Selector option labels reuse existing keys `languages.da` / `languages.en`; only one new label key (`common.emailLanguage`) is added.

---

### Task 1: Backend — localized email strings + server-side language resolution

**Files:**
- Create: `functions/send-invitation-email/strings.ts`
- Modify: `functions/send-invitation-email/index.ts`
- Test: `functions/send-invitation-email/index.test.ts`

**Interfaces:**
- Produces: `EmailLanguage = 'da' | 'en'`; `EMAIL_STRINGS: Record<EmailLanguage, EmailStrings>`; `resolveEmailLanguage(bodyLang: unknown, profileLang: string | null): EmailLanguage`. Request body gains optional `inviterLanguage?: 'da' | 'en'`.
- Consumes: existing `queryOne` from `../shared/db`.

- [ ] **Step 1: Create the string map** — `functions/send-invitation-email/strings.ts`

```ts
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
```

- [ ] **Step 2: Write the failing endpoint tests** — append to `functions/send-invitation-email/index.test.ts` inside the existing `describe`

The authz `queryOne` is the FIRST call; the new invitee-language lookup is the SECOND. Mock both in order.

```ts
  it("uses the existing recipient's preferred_language over the inviter's pick", async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_platform_admin: true })      // authz
      .mockResolvedValueOnce({ preferred_language: 'en' });    // invitee profile
    mockEmailSend.mockResolvedValueOnce({ id: 'e1' });

    const res = await handler(makeReq({ ...validBody, inviterLanguage: 'da' }) as any, {} as any);
    const html = mockEmailSend.mock.calls[0][0].html as string;
    const subject = mockEmailSend.mock.calls[0][0].subject as string;

    expect(res.status).toBe(200);
    expect(html).toContain('lang="en"');
    expect(html).toContain("You're invited!");
    expect(subject).toContain('You have been invited');
  });

  it("uses the inviter's pick when the recipient has no profile", async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_platform_admin: true })      // authz
      .mockResolvedValueOnce(undefined);                        // no invitee profile
    mockEmailSend.mockResolvedValueOnce({ id: 'e2' });

    const res = await handler(makeReq({ ...validBody, inviterLanguage: 'en' }) as any, {} as any);
    const html = mockEmailSend.mock.calls[0][0].html as string;

    expect(res.status).toBe(200);
    expect(html).toContain('lang="en"');
    expect(html).toContain("You're invited!");
  });

  it('falls back to Danish when no profile and no inviter pick', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_platform_admin: true })      // authz
      .mockResolvedValueOnce(undefined);                        // no invitee profile
    mockEmailSend.mockResolvedValueOnce({ id: 'e3' });

    const res = await handler(makeReq(validBody) as any, {} as any); // no inviterLanguage
    const html = mockEmailSend.mock.calls[0][0].html as string;

    expect(res.status).toBe(200);
    expect(html).toContain('lang="da"');
    expect(html).toContain('Du er inviteret!');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd functions && npx vitest run send-invitation-email/index.test.ts`
Expected: the 3 new tests FAIL (email still renders Danish / `lang="da"`, no second query consumed) while the 5 existing tests still pass.

- [ ] **Step 4: Modify the endpoint** — `functions/send-invitation-email/index.ts`

4a. Add the import at the top (next to the other local imports):

```ts
import { EMAIL_STRINGS, resolveEmailLanguage, type EmailLanguage } from './strings';
```

4b. Add `inviterLanguage` to the request interface:

```ts
interface InvitationEmailRequest {
  email: string;
  orgName: string | null;
  role: string;
  inviteLink: string;
  inviterLanguage?: 'da' | 'en';
}
```

4c. Replace the `generateEmailHtml` signature + body so it takes the resolved `lang` and its `strings`, drops the hardcoded Danish, and uses `<html lang="${lang}">`:

```ts
function generateEmailHtml({
  orgName,
  roleLabel,
  inviteLink,
  isPlatformAdmin,
  lang,
  s,
}: {
  orgName: string | null;
  roleLabel: string;
  inviteLink: string;
  isPlatformAdmin: boolean;
  lang: EmailLanguage;
  s: typeof EMAIL_STRINGS[EmailLanguage];
}): string {
  const welcomeMessage = isPlatformAdmin ? s.welcomePlatformAdmin : s.welcomeOrg(roleLabel, orgName);
  const logoUrl = `${process.env.STATIC_ASSETS_BASE_URL ?? 'https://ai-uddannelse.dk'}/logo-light.png`;

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${s.documentTitle}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <img src="${logoUrl}" alt="AI Uddannelse" style="height: 50px; width: auto;" />
              <p style="margin: 12px 0 0; font-size: 14px; color: #71717a;">${s.tagline}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">${s.heading}</h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">${welcomeMessage}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f4f4f5; padding: 8px 16px; border-radius: 6px;">
                    <span style="font-size: 14px; font-weight: 500; color: #3f3f46;">${s.yourRole} <strong style="color: #18181b;">${roleLabel}</strong></span>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center; padding: 8px 0;">
                    <a href="${inviteLink}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">${s.cta}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 14px; color: #71717a; text-align: center;">${s.copyLinkHint}</p>
              <p style="margin: 8px 0 0; font-size: 12px; word-break: break-all; color: #a1a1aa; text-align: center;">${inviteLink}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #a1a1aa; text-align: center;">${s.expiryNote}</p>
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">${s.ignoreNote}</p>
            </td>
          </tr>
        </table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">© ${new Date().getFullYear()} AI Uddannelse. ${s.rightsReserved}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
```

4d. In `handler`, replace the body destructure + subject/roleLabel/html block. After the domain validation (`if (!allowedLinkDomains()...)`), and using the already-destructured `inviterLanguage`:

```ts
    const { email, orgName, role, inviteLink, inviterLanguage } = await req.json() as InvitationEmailRequest;
```

Then replace the `isPlatformAdminInvite` / `roleLabel` / `subject` / `html` block with:

```ts
    const isPlatformAdminInvite = role === 'platform_admin';

    // Resolve email language (ADR-0016 cat.3): existing recipient's stored
    // preference wins; else the inviter's dialog pick; else default 'da'.
    // Best-effort — a lookup failure must not block the send.
    let profileLang: string | null = null;
    try {
      const invitee = await queryOne<{ preferred_language: string }>(
        `SELECT preferred_language FROM profiles
         WHERE lower(email) = lower($1) AND preferred_language IS NOT NULL
         ORDER BY created_at ASC LIMIT 1`,
        [email],
      );
      profileLang = invitee?.preferred_language ?? null;
    } catch (lookupErr) {
      context.warn?.('invitee language lookup failed; falling back', lookupErr);
    }
    const lang = resolveEmailLanguage(inviterLanguage, profileLang);
    const s = EMAIL_STRINGS[lang];

    const roleLabel =
      role === 'org_admin' ? s.roleLabels.org_admin
      : role === 'platform_admin' ? s.roleLabels.platform_admin
      : s.roleLabels.learner;
    const subject = isPlatformAdminInvite ? s.subjectPlatformAdmin : s.subjectOrg(orgName);
    const html = generateEmailHtml({ orgName, roleLabel, inviteLink, isPlatformAdmin: isPlatformAdminInvite, lang, s });
```

> Ordering note: keep the profile lookup AFTER the link-domain validation so invalid-domain requests still return 400 with only the single authz query (existing domain-reject tests keep their one mock).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx vitest run send-invitation-email/index.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 6: Typecheck + build the functions tree**

Run: `cd functions && npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add functions/send-invitation-email/strings.ts functions/send-invitation-email/index.ts functions/send-invitation-email/index.test.ts
git commit -m "feat(email): localize invitation email server-side (da/en) (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Client — `inviterLanguage` type, UI-language helper, and lib param

**Files:**
- Create: `src/lib/inviteLanguage.ts`
- Create: `src/lib/inviteLanguage.test.ts`
- Modify: `src/lib/sendInvitationEmail.ts`

**Interfaces:**
- Produces: `InviteLanguage = 'da' | 'en'`; `uiLangToInvite(lang: string | undefined): InviteLanguage`. `sendInvitationEmail(params)` gains optional `inviterLanguage?: InviteLanguage`, forwarded in the POST body as `inviterLanguage`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing helper test** — `src/lib/inviteLanguage.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { uiLangToInvite } from './inviteLanguage';

describe('uiLangToInvite', () => {
  it('maps English variants to en', () => {
    expect(uiLangToInvite('en')).toBe('en');
    expect(uiLangToInvite('en-US')).toBe('en');
    expect(uiLangToInvite('EN')).toBe('en');
  });
  it('maps everything else (incl. Danish and unknown) to da', () => {
    expect(uiLangToInvite('da')).toBe('da');
    expect(uiLangToInvite('da-DK')).toBe('da');
    expect(uiLangToInvite(undefined)).toBe('da');
    expect(uiLangToInvite('')).toBe('da');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/inviteLanguage.test.ts`
Expected: FAIL — `inviteLanguage.ts` does not exist.

- [ ] **Step 3: Create the helper** — `src/lib/inviteLanguage.ts`

```ts
export type InviteLanguage = 'da' | 'en';

/**
 * Map an i18next resolvedLanguage (e.g. 'da', 'en', 'en-US') to the invite
 * language the selector defaults to. Platform default is Danish, so anything
 * not explicitly English resolves to 'da'.
 */
export function uiLangToInvite(lang: string | undefined): InviteLanguage {
  return lang?.toLowerCase().startsWith('en') ? 'en' : 'da';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/inviteLanguage.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the param to the client lib** — `src/lib/sendInvitationEmail.ts`

Add the import and extend `SendInvitationEmailParams` + the body:

```ts
import { callApi } from '@/lib/api-client';
import { getInviteLink } from '@/lib/config';
import type { InviteLanguage } from '@/lib/inviteLanguage';

interface SendInvitationEmailParams {
  email: string;
  orgName: string | null;
  role: 'learner' | 'org_admin' | 'platform_admin';
  linkId: string;
  inviterLanguage?: InviteLanguage;
}
```

In the function signature destructure `inviterLanguage` and include it in the `callApi` body:

```ts
export async function sendInvitationEmail({
  email,
  orgName,
  role,
  linkId,
  inviterLanguage,
}: SendInvitationEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    const inviteLink = getInviteLink(linkId);

    const data = await callApi<{ success: boolean; error?: string }>('/api/send-invitation-email', {
      email,
      orgName,
      role,
      inviteLink,
      inviterLanguage,
    });
    // …rest unchanged…
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: exit 0 (the field is optional, so existing call sites still compile).

- [ ] **Step 7: Commit**

```bash
git add src/lib/inviteLanguage.ts src/lib/inviteLanguage.test.ts src/lib/sendInvitationEmail.ts
git commit -m "feat(invite): thread inviterLanguage through the email client lib (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Shared `InviteLanguageSelect` component + i18n label

**Files:**
- Create: `src/components/InviteLanguageSelect.tsx`
- Create: `src/components/InviteLanguageSelect.test.tsx`
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/da.json`

**Interfaces:**
- Produces: `<InviteLanguageSelect value={InviteLanguage} onChange={(v: InviteLanguage) => void} id? />`. New i18n key `common.emailLanguage`.
- Consumes: `InviteLanguage` from Task 2; existing `languages.da` / `languages.en` keys.

- [ ] **Step 1: Add the label key** — in `src/i18n/locales/en.json`, inside the `"common"` object, add:

```json
    "emailLanguage": "Email language",
```

and in `src/i18n/locales/da.json`, inside `"common"`:

```json
    "emailLanguage": "E-mailsprog",
```

(Place before an existing key and keep valid JSON — no trailing comma on the last member.)

- [ ] **Step 2: Write the failing component test** — `src/components/InviteLanguageSelect.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InviteLanguageSelect } from './InviteLanguageSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => ({
      'common.emailLanguage': 'Email language',
      'languages.da': 'Danish',
      'languages.en': 'English',
    }[k] ?? k),
  }),
}));

describe('InviteLanguageSelect', () => {
  it('renders the label and the current value', () => {
    render(<InviteLanguageSelect value="da" onChange={() => {}} />);
    expect(screen.getByText('Email language')).toBeInTheDocument();
    // shadcn Select renders the selected item's label in the trigger
    expect(screen.getByText('Danish')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/components/InviteLanguageSelect.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Create the component** — `src/components/InviteLanguageSelect.tsx`

```tsx
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { InviteLanguage } from '@/lib/inviteLanguage';

interface InviteLanguageSelectProps {
  value: InviteLanguage;
  onChange: (value: InviteLanguage) => void;
  id?: string;
}

/**
 * Language picker for invitation emails. Options reuse the shared `languages.*`
 * labels; the resolved language is applied server-side (an existing recipient's
 * own preference can still override this pick — see ADR-0016 category 3).
 */
export function InviteLanguageSelect({ value, onChange, id = 'invite-language' }: InviteLanguageSelectProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('common.emailLanguage')}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as InviteLanguage)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="da">{t('languages.da')}</SelectItem>
          <SelectItem value="en">{t('languages.en')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 5: Run the test + i18n drift check**

Run: `npx vitest run src/components/InviteLanguageSelect.test.tsx src/i18n/index.test.ts`
Expected: PASS (the component test passes; the i18n parity test stays green because the key was added to BOTH locales).

- [ ] **Step 6: Commit**

```bash
git add src/components/InviteLanguageSelect.tsx src/components/InviteLanguageSelect.test.tsx src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(invite): shared InviteLanguageSelect + emailLanguage label (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the platform-admin org-detail invite (InviteUserDialog + OrganizationDetail)

**Files:**
- Modify: `src/components/platform-admin/org-detail/InviteUserDialog.tsx`
- Modify: `src/pages/platform-admin/OrganizationDetail.tsx`
- Test: `src/components/platform-admin/org-detail/InviteUserDialog.test.tsx`, `src/pages/platform-admin/OrganizationDetail.test.tsx`

**Interfaces:**
- Consumes: `InviteLanguageSelect` (Task 3), `uiLangToInvite`/`InviteLanguage` (Task 2), `sendInvitationEmail` `inviterLanguage` (Task 2).
- Produces: `InvitePayload` gains `language: InviteLanguage`.

- [ ] **Step 1: Extend `InvitePayload` + form state in `InviteUserDialog.tsx`**

Add imports:

```ts
import { InviteLanguageSelect } from '@/components/InviteLanguageSelect';
import { uiLangToInvite, type InviteLanguage } from '@/lib/inviteLanguage';
```

Extend the payload interface:

```ts
export interface InvitePayload {
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  role: OrgRole;
  language: InviteLanguage;
}
```

Add `i18n` to the hook and a `language` state initialised to the UI language:

```ts
  const { t, i18n } = useTranslation();
  // …existing state…
  const [language, setLanguage] = useState<InviteLanguage>(() => uiLangToInvite(i18n.resolvedLanguage));
```

Reset it on open (inside the existing `if (open) { … }` block):

```ts
      setLanguage(uiLangToInvite(i18n.resolvedLanguage));
```

Update the effect dependency array to include `i18n.resolvedLanguage`: `}, [open, i18n.resolvedLanguage]);`

Add the selector to the JSX after the role `<div className="space-y-2">…</div>` block:

```tsx
          <InviteLanguageSelect value={language} onChange={setLanguage} />
```

Include `language` in the submit payload:

```tsx
            onClick={() => onSubmit({ email, firstName, lastName, department, role, language })}
```

- [ ] **Step 2: Forward the pick in `OrganizationDetail.tsx`**

In the `inviteMutation` `mutationFn`, add `inviterLanguage` to the `sendInvitationEmail` call:

```ts
        const emailResult = await sendInvitationEmail({
          email: payload.email,
          orgName: org?.name || null,
          role: payload.role,
          linkId: invitation.link_id,
          inviterLanguage: payload.language,
        });
```

- [ ] **Step 3: Update the existing tests**

Any place these tests build an `InvitePayload` or call `onSubmit` must include `language`. Update `OrganizationDetail.test.tsx` to assert the language is forwarded, e.g. after triggering an invite:

```ts
    expect(sendInvitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterLanguage: expect.stringMatching(/^(da|en)$/) }),
    );
```

(Match the file's existing mock name/util for `sendInvitationEmail`; if it isn't mocked yet, add a `vi.mock('@/lib/sendInvitationEmail', …)` mirroring the file's other lib mocks.)

- [ ] **Step 4: Run the affected tests**

Run: `npx vitest run src/components/platform-admin/org-detail/InviteUserDialog.test.tsx src/pages/platform-admin/OrganizationDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/platform-admin/org-detail/InviteUserDialog.tsx src/pages/platform-admin/OrganizationDetail.tsx src/components/platform-admin/org-detail/InviteUserDialog.test.tsx src/pages/platform-admin/OrganizationDetail.test.tsx
git commit -m "feat(invite): language selector on org-detail invite dialog (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire the platform-admin OrganizationsManager invite

**Files:**
- Modify: `src/pages/platform-admin/OrganizationsManager.tsx`

**Interfaces:**
- Consumes: `InviteLanguageSelect`, `uiLangToInvite`/`InviteLanguage`, `sendInvitationEmail.inviterLanguage`.

- [ ] **Step 1: Add imports + state**

```ts
import { InviteLanguageSelect } from '@/components/InviteLanguageSelect';
import { uiLangToInvite, type InviteLanguage } from '@/lib/inviteLanguage';
```

This file uses `useTranslation` for `t`; ensure `i18n` is also destructured (`const { t, i18n } = useTranslation();`). Add state near `inviteEmail`:

```ts
  const [inviteLanguage, setInviteLanguage] = useState<InviteLanguage>(() => uiLangToInvite(i18n.resolvedLanguage));
```

- [ ] **Step 2: Render the selector** in the `adminTab === 'invite'` panel, directly below the invite-email input block (around the `inviteEmailHint` paragraph):

```tsx
                <InviteLanguageSelect value={inviteLanguage} onChange={setInviteLanguage} />
```

- [ ] **Step 3: Forward the pick** in the `sendInvitationEmail` call:

```ts
            const emailResult = await sendInvitationEmail({
              email: inviteEmail.trim(),
              orgName: name,
              role: 'org_admin',
              linkId: invitation.link_id,
              inviterLanguage: inviteLanguage,
            });
```

- [ ] **Step 4: Typecheck + run any existing test for this file**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Run: `npx vitest run src/pages/platform-admin/OrganizationsManager` (no-op if no test file exists)
Expected: exit 0 / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/platform-admin/OrganizationsManager.tsx
git commit -m "feat(invite): language selector on organizations-manager invite (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the org-admin OrgMembersTab invite form

**Files:**
- Modify: `src/components/org-admin/OrgMembersTab.tsx`

**Interfaces:**
- Consumes: `InviteLanguageSelect`, `uiLangToInvite`/`InviteLanguage`, `sendInvitationEmail.inviterLanguage`.

- [ ] **Step 1: Add imports + state**

```ts
import { InviteLanguageSelect } from '@/components/InviteLanguageSelect';
import { uiLangToInvite, type InviteLanguage } from '@/lib/inviteLanguage';
```

This file already does `const { t } = useTranslation();` — change it to `const { t, i18n } = useTranslation();`. Add state next to `inviteRole` (line ~170):

```ts
  const [inviteLanguage, setInviteLanguage] = useState<InviteLanguage>(() => uiLangToInvite(i18n.resolvedLanguage));
```

- [ ] **Step 2: Render the selector** in the invite form JSX, directly after the role `Select` block:

```tsx
          <InviteLanguageSelect value={inviteLanguage} onChange={setInviteLanguage} />
```

- [ ] **Step 3: Forward the pick** in the `sendInvitationEmail` call (line ~232):

```ts
        const emailResult = await sendInvitationEmail({
          email: inviteEmail,
          orgName: currentOrg?.name ?? null,
          role: inviteRole,
          linkId: invitation.link_id,
          inviterLanguage: inviteLanguage,
        });
```

- [ ] **Step 4: Reset on close (optional consistency)** — if the invite form resets its fields when the dialog closes, reset `inviteLanguage` the same way, to `uiLangToInvite(i18n.resolvedLanguage)`. If there is no reset routine, skip.

- [ ] **Step 5: Typecheck + run existing tab test**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Run: `npx vitest run src/components/org-admin/OrgMembersTab` (no-op if no test file exists)
Expected: exit 0 / PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/org-admin/OrgMembersTab.tsx
git commit -m "feat(invite): language selector on org-members invite form (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Wire the org-admin BulkInviteDialog (one language for the batch)

**Files:**
- Modify: `src/components/org-admin/BulkInviteDialog.tsx`

**Interfaces:**
- Consumes: `InviteLanguageSelect`, `uiLangToInvite`/`InviteLanguage`, `sendInvitationEmail.inviterLanguage`.

- [ ] **Step 1: Add imports + state**

```ts
import { InviteLanguageSelect } from '@/components/InviteLanguageSelect';
import { uiLangToInvite, type InviteLanguage } from '@/lib/inviteLanguage';
```

This file already does `const { t } = useTranslation();` — change it to `const { t, i18n } = useTranslation();`. Add batch-level state next to the other `useState` hooks (line ~64):

```ts
  const [inviteLanguage, setInviteLanguage] = useState<InviteLanguage>(() => uiLangToInvite(i18n.resolvedLanguage));
```

- [ ] **Step 2: Render the selector** just below the `SeatUsageNote` / dialog description (a single control for the whole batch):

```tsx
          <InviteLanguageSelect value={inviteLanguage} onChange={setInviteLanguage} />
```

- [ ] **Step 3: Forward the pick** in the per-row `sendInvitationEmail` call inside the `for (const row of rowResults)` loop (line ~205):

```ts
            const emailResult = await sendInvitationEmail({
              email: row.email,
              orgName,
              role: validInvites.find((v) => v.email === row.email)?.role ?? 'learner',
              linkId: row.invitation.link_id,
              inviterLanguage: inviteLanguage,
            });
```

- [ ] **Step 4: Typecheck + run existing dialog test**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Run: `npx vitest run src/components/org-admin/BulkInviteDialog` (no-op if no test file exists)
Expected: exit 0 / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/org-admin/BulkInviteDialog.tsx
git commit -m "feat(invite): batch language selector on bulk-invite dialog (#225)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full verification gates

**Files:** none (verification only).

- [ ] **Step 1: Root gates**

Run: `npm run lint && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: each exits 0; all tests pass.

- [ ] **Step 2: Functions gates**

Run: `cd functions && npm run build && npm test`
Expected: exit 0; all tests pass.

- [ ] **Step 3: Fix any failures**, re-run the affected gate until green. Do not proceed with red gates.

- [ ] **Step 4: Final commit if any fixes were made**

```bash
git add -A
git commit -m "chore(invite): verification-gate fixes for #225

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Server-side resolution (existing user > inviter pick > default da) → Task 1 (`resolveEmailLanguage` + profile lookup).
- Localized template + `<html lang>` → Task 1 (`EMAIL_STRINGS`, `generateEmailHtml`).
- Backward-compatible request contract (`inviterLanguage?`) → Task 1 (endpoint) + Task 2 (client lib).
- Selector on all four surfaces, default = UI language → Tasks 4–7 (+ shared component Task 3, helper Task 2).
- i18n keys → Task 3 (`common.emailLanguage`; option labels reuse `languages.*`).
- `ALLOWED_LINK_DOMAINS` / Resend / authz unchanged → Task 1 keeps them; existing tests retained; ordering note preserves the domain-reject path.
- No DB migration / no persistence → nothing in the plan touches the schema or invitation-create/bulk-create.
- Tests: resolution precedence + render (Task 1), helper (Task 2), component (Task 3), threading (Task 4), full gates (Task 8).

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The "no-op if no test file exists" run steps (Tasks 5–7) are explicit conditionals, not placeholders — those files have no dedicated test today; the shared units are covered by Tasks 1–4.

**Type consistency:** `InviteLanguage`/`EmailLanguage` are `'da'|'en'` throughout; `uiLangToInvite`, `resolveEmailLanguage`, `EMAIL_STRINGS`, and `sendInvitationEmail`'s `inviterLanguage` names match across tasks; `InvitePayload.language` is produced in Task 4 and consumed in the same task's `OrganizationDetail` change.
