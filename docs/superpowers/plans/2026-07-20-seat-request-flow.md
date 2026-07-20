# Seat-Request Flow Implementation Plan (#127)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org admin request additional seats at a binding annual ex-moms DKK price; persist the request, email the platform admin to invoice offline, and let the platform admin bump `seat_limit` on fulfilment — no online payment.

**Architecture:** Five POST-only Azure Functions via the `endpoint()`/`adminEndpoint()` factory + a `seat_requests` table + a `seat_pricing` key in `platform_settings`. Frontend reads via shared TanStack Query hooks and the `queryKeys` factory; mutations run inline via `useToastMutation` and invalidate factory keys. The server always re-reads and snapshots the price — the client-sent price is never trusted.

**Tech Stack:** React 18 + Vite + TypeScript strict, TanStack Query v5, shadcn/ui + Radix + Tailwind, i18next (en+da); Azure Functions v4 (Node 20, raw `pg`), Resend for email, PostgreSQL 15.

## Global Constraints

- **Backend endpoints** MUST use `endpoint()`/`adminEndpoint()` from `functions/shared/endpoint.ts` (ADR-0015); every endpoint is POST-only; every new folder MUST be imported in the `functions/index.ts` barrel (alphabetical) or it silently never registers (fleet guard: `functions/registration-names.test.ts`). Route names may NOT start with `admin`, `runtime`, or `host`.
- **No module-load-time side effects that can throw** — `new Resend(...)` must be lazy inside a getter.
- **500 responses are generic** (ADR-0014, handled by the factory); deliberate 4xx `code`s (`SEAT_PRICING_UNCONFIGURED`, `REQUEST_ALREADY_PENDING`, `NOT_PENDING`, `ORG_UNLIMITED`) are caller-facing contract.
- **Never trust a client-sent price** — the server reads `seat_pricing` and computes/stores `unit_price_snapshot` itself.
- **Backend tests** mock `../shared/auth`, `../shared/db`, `../shared/profile`; NEVER touch a real DB. Standard cases per endpoint: OPTIONS→204, invalid token→401, null profile→401, validation→400, authz→403, happy→200, endpoint-specific error codes.
- **Frontend:** all backend calls via `callApi<T>('/api/<endpoint>', body)`; reads via a shared hook in `src/hooks/` keyed from `src/lib/query-keys.ts`; mutations via `useToastMutation` invalidating factory keys; ownership comparisons use `profile?.id`; saving flags cleared in `finally`; **every new user-facing string gets keys in BOTH `en.json` and `da.json`.**
- **Money:** DKK, ex-moms; `annual_price_per_seat` is `null` by default and the flow is gated (UI + server) until it is set. Display note: "+ 25% moms tilføjes på fakturaen".
- **DB:** canonical schema edit lands in `migration/azure/01-schema.sql`; the **prod apply is an idempotent script Martin runs by hand** (`migration/azure/03-seat-requests.sql`) — the plan must NEVER run DDL against Azure.
- **Verification gates (all exit 0):** root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/` `npm run build` · `npm test`.
- **Work in the worktree:** `/Users/martin/AIR/AIEDU/learn-wings/.claude/worktrees/feat+seat-request-flow-127` on branch `feat/seat-request-flow-127`.

---

## File Structure

**Backend (create):**
- `functions/shared/seat-request-notify.ts` — pure `renderSeatRequestEmail()` + best-effort `notifySeatRequest()`.
- `functions/seat-pricing/index.ts` — read `{ annual_price_per_seat, currency }` for the dialog.
- `functions/seat-request-create/index.ts` — org admin creates a pending request (+ notify).
- `functions/seat-requests/index.ts` — list an org's requests.
- `functions/seat-request-cancel/index.ts` — org admin cancels their pending request.
- `functions/seat-request-fulfill/index.ts` — platform admin fulfils (bump `seat_limit`).
- Matching `*/index.test.ts` + `functions/shared/seat-request-notify.test.ts`.

**Backend (modify):**
- `functions/index.ts` — barrel imports for the five new endpoints.
- `functions/platform-settings-update/index.ts` (+ test) — allow the `seat_pricing` key.

**DB (modify/create):**
- `migration/azure/01-schema.sql` — enum + table + indexes (canonical).
- `migration/azure/02-seed.sql` — seed the `seat_pricing` settings row.
- `migration/azure/03-seat-requests.sql` — **new** idempotent prod apply script.
- `migration/azure/README.md` — bump Tables/Enums counts + lists.

**Frontend (create):**
- `src/hooks/useSeatPricing.ts`, `src/hooks/useSeatRequests.ts`.
- `src/components/org-admin/RequestSeatsDialog.tsx` (+ test).
- `src/components/platform-admin/org-detail/SeatRequestsSection.tsx` (+ test).

**Frontend (modify):**
- `src/lib/types.ts` — `SeatRequest`, `SeatRequestStatus`, `SeatPricing`.
- `src/lib/query-keys.ts` (+ `src/lib/query-keys.test.ts`) — `seatPricing`, `seatRequests` families.
- `src/components/org-admin/OrgMembersTab.tsx` — standing button + at-cap nudge + pending state.
- `src/pages/platform-admin/OrganizationDetail.tsx` — render the fulfil section.
- `src/pages/platform-admin/PlatformSettings.tsx` — the Seat pricing panel.
- `src/i18n/locales/en.json` + `src/i18n/locales/da.json` — new `seatRequests`/`seatPricing` keys.

**Docs (modify at the end):** `migration/WORKLOG.md` (append), `migration/STATUS.html` (checkpoint).

---

## Task 1: DB schema — `seat_requests` table, enum, and prod apply script

**Files:**
- Modify: `migration/azure/01-schema.sql`
- Modify: `migration/azure/02-seed.sql`
- Create: `migration/azure/03-seat-requests.sql`
- Modify: `migration/azure/README.md`

**Interfaces:**
- Produces: table `public.seat_requests` (columns: `id, org_id, requested_by_user_id, additional_seats, unit_price_snapshot numeric(12,2), currency, status seat_request_status, created_at, fulfilled_at, fulfilled_by_user_id, cancelled_at`); enum `seat_request_status ('pending','fulfilled','cancelled')`; partial unique index `seat_requests_one_pending_per_org`; `platform_settings` row `key='seat_pricing'` value `{annual_price_per_seat:null, currency:'DKK', notification_email:'jacob@ai-raadgivning.dk'}`.

- [ ] **Step 1: Add the enum to `01-schema.sql`** — in SECTION 1 (alongside the other `CREATE TYPE` lines, e.g. after `membership_status`):

```sql
CREATE TYPE public.seat_request_status AS ENUM ('pending', 'fulfilled', 'cancelled');
```

- [ ] **Step 2: Add the table to `01-schema.sql`** — in SECTION 2, positioned AFTER `organizations` and `profiles` (FK targets must already exist):

```sql
-- ---- seat_requests (issue #127) ----
-- An org admin requests additional seats; a platform admin fulfils it offline
-- (invoice), then marks it fulfilled which bumps organizations.seat_limit.
-- unit_price_snapshot is the binding annual ex-moms price captured at request time.
CREATE TABLE public.seat_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  additional_seats     integer NOT NULL CHECK (additional_seats >= 1),
  unit_price_snapshot  numeric(12,2) NOT NULL,
  currency             text NOT NULL DEFAULT 'DKK',
  status               public.seat_request_status NOT NULL DEFAULT 'pending',
  created_at           timestamptz NOT NULL DEFAULT now(),
  fulfilled_at         timestamptz,
  fulfilled_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at         timestamptz
);

-- One pending request per org (backs the "one-at-a-time" rule at the DB layer).
CREATE UNIQUE INDEX seat_requests_one_pending_per_org
  ON public.seat_requests (org_id) WHERE status = 'pending';
CREATE INDEX seat_requests_org_id_idx ON public.seat_requests (org_id);
```

- [ ] **Step 3: Seed the `seat_pricing` settings row in `02-seed.sql`** — near the other `platform_settings` inserts (price starts unset):

```sql
INSERT INTO public.platform_settings (key, value)
VALUES ('seat_pricing', '{"annual_price_per_seat": null, "currency": "DKK", "notification_email": "jacob@ai-raadgivning.dk"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 4: Create the idempotent prod apply script** `migration/azure/03-seat-requests.sql`:

```sql
-- migration/azure/03-seat-requests.sql
-- Additive migration for #127 (seat-request flow). IDEMPOTENT — safe to re-run.
-- Apply to prod via psql from Azure Cloud Shell with a temporary single-IP
-- firewall rule (see migration/azure/README.md "How to apply"). HUMAN-GATED.
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.seat_request_status AS ENUM ('pending', 'fulfilled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.seat_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  additional_seats     integer NOT NULL CHECK (additional_seats >= 1),
  unit_price_snapshot  numeric(12,2) NOT NULL,
  currency             text NOT NULL DEFAULT 'DKK',
  status               public.seat_request_status NOT NULL DEFAULT 'pending',
  created_at           timestamptz NOT NULL DEFAULT now(),
  fulfilled_at         timestamptz,
  fulfilled_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at         timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS seat_requests_one_pending_per_org
  ON public.seat_requests (org_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS seat_requests_org_id_idx ON public.seat_requests (org_id);

INSERT INTO public.platform_settings (key, value)
VALUES ('seat_pricing', '{"annual_price_per_seat": null, "currency": "DKK", "notification_email": "jacob@ai-raadgivning.dk"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
```

- [ ] **Step 5: Update `migration/azure/README.md`** — increment the Tables count (e.g. "Tables: 30" → "31") and Enums count ("12" → "13"), and add `seat_requests` / `seat_request_status` to whichever table/enum lists the README maintains. (Read the file first; match its exact wording.)

- [ ] **Step 6: Verify SQL is self-consistent** (no live DB — a parse-only check):

Run: `grep -n "seat_requests\|seat_request_status\|seat_pricing" migration/azure/01-schema.sql migration/azure/02-seed.sql migration/azure/03-seat-requests.sql`
Expected: the enum precedes the table in `01-schema.sql`; the table references `organizations`/`profiles` which appear earlier in the file; the seed + `03` both mention `seat_pricing`.

- [ ] **Step 7: Commit**

```bash
git add migration/azure/01-schema.sql migration/azure/02-seed.sql migration/azure/03-seat-requests.sql migration/azure/README.md
git commit -m "feat(db): seat_requests table + seat_pricing setting (#127)"
```

---

## Task 2: `seat-pricing` read endpoint

**Files:**
- Create: `functions/seat-pricing/index.ts`
- Test: `functions/seat-pricing/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Produces: `POST /api/seat-pricing` `{}` → `200 { pricing: { annual_price_per_seat: number | null, currency: string } }`. Any authenticated user. Never returns `notification_email`.

- [ ] **Step 1: Write the failing test** `functions/seat-pricing/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const req = () => ({ method: 'POST', headers: { get: () => 'https://ai-uddannelse.dk' }, json: async () => ({}) }) as any;

describe('seat-pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(req(), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns the configured price and currency, never the notification email', async () => {
    mockQueryOne.mockResolvedValueOnce({ value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } });
    const res = await handler(req(), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ pricing: { annual_price_per_seat: 1200, currency: 'DKK' } });
  });

  it('defaults to null price / DKK when the setting row is absent', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(req(), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ pricing: { annual_price_per_seat: null, currency: 'DKK' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && npx vitest run seat-pricing`
Expected: FAIL (cannot resolve `./index`).

- [ ] **Step 3: Write `functions/seat-pricing/index.ts`:**

```ts
import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface SeatPricingValue {
  annual_price_per_seat: number | null;
  currency: string;
  notification_email: string;
}

// Public price read for the org-admin request dialog. Deliberately does NOT
// use platform-settings (which returns [] to non-admins to protect SMTP creds);
// this endpoint exposes ONLY the sales price + currency, never notification_email.
export default endpoint('seat-pricing', async ({ reply }) => {
  const row = await queryOne<{ value: SeatPricingValue }>(
    `SELECT value FROM platform_settings WHERE key = 'seat_pricing'`,
  );
  const value = row?.value;
  return reply(200, {
    pricing: {
      annual_price_per_seat: value?.annual_price_per_seat ?? null,
      currency: value?.currency ?? 'DKK',
    },
  });
});
```

- [ ] **Step 4: Register in the barrel** — add to `functions/index.ts` in alphabetical position:

```ts
import './seat-pricing/index';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx vitest run seat-pricing registration-names`
Expected: PASS (both the endpoint tests and the fleet registration guard).

- [ ] **Step 6: Commit**

```bash
git add functions/seat-pricing functions/index.ts
git commit -m "feat(functions): seat-pricing read endpoint (#127)"
```

---

## Task 3: allow the `seat_pricing` key in `platform-settings-update`

**Files:**
- Modify: `functions/platform-settings-update/index.ts`
- Modify: `functions/platform-settings-update/index.test.ts`

**Interfaces:**
- Produces: `POST /api/platform-settings-update` accepts `key: 'seat_pricing'` with `value` fields `annual_price_per_seat` (non-negative number or null), `currency` (string), `notification_email` (string). Platform admin only (unchanged).

- [ ] **Step 1: Add the failing tests** to `functions/platform-settings-update/index.test.ts` (append inside the existing `describe`):

```ts
  it('accepts a valid seat_pricing update', async () => {
    // getProfile returns a platform admin in this suite's beforeEach.
    mockQueryOne.mockResolvedValueOnce({ key: 'seat_pricing', value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } });
    const res = await handler(baseReq({ key: 'seat_pricing', value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } }), {} as any);
    expect(res.status).toBe(200);
  });

  it('accepts a null seat price (unsetting)', async () => {
    mockQueryOne.mockResolvedValueOnce({ key: 'seat_pricing', value: { annual_price_per_seat: null } });
    const res = await handler(baseReq({ key: 'seat_pricing', value: { annual_price_per_seat: null } }), {} as any);
    expect(res.status).toBe(200);
  });

  it('rejects a negative seat price', async () => {
    const res = await handler(baseReq({ key: 'seat_pricing', value: { annual_price_per_seat: -5 } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown seat_pricing field', async () => {
    const res = await handler(baseReq({ key: 'seat_pricing', value: { bogus: 1 } }), {} as any);
    expect(res.status).toBe(400);
  });
```

> If the suite's mock helper is named differently than `mockQueryOne`/`baseReq`, match the existing names in that file. Also update any existing assertion that checks the exact "key must be one of: branding, user_access, email, features" message — it must now include `seat_pricing`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npx vitest run platform-settings-update`
Expected: FAIL (seat_pricing rejected as unknown key → 400 where 200 expected).

- [ ] **Step 3: Implement** — three edits in `functions/platform-settings-update/index.ts`:

Add `'seat_pricing'` to the allowed keys and update the error sentence:

```ts
const ALLOWED_KEYS = ['branding', 'user_access', 'email', 'features', 'seat_pricing'] as const;
```
```ts
    return reply(400, { error: 'key must be one of: branding, user_access, email, features, seat_pricing' });
```

Add a validator next to the other `FieldCheck` consts:

```ts
const isNonNegativeNumberOrNull: FieldCheck = (v) =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
```

Add the shape entry to `FIELD_SHAPES`:

```ts
  seat_pricing: {
    annual_price_per_seat: isNonNegativeNumberOrNull,
    currency: isString,
    notification_email: isString,
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npx vitest run platform-settings-update`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/platform-settings-update
git commit -m "feat(functions): allow seat_pricing key in platform-settings-update (#127)"
```

---

## Task 4: seat-request notification helper

**Files:**
- Create: `functions/shared/seat-request-notify.ts`
- Test: `functions/shared/seat-request-notify.test.ts`

**Interfaces:**
- Produces:
  - `renderSeatRequestEmail(p: SeatRequestEmailParams): { subject: string; html: string }` (pure).
  - `notifySeatRequest(context: InvocationContext, p: SeatRequestEmailParams): Promise<void>` (best-effort — never throws).
  - `SeatRequestEmailParams = { recipient, orgName, requesterName, requesterEmail, seatLimit: number|null, usedSeats, additionalSeats, unitPrice, currency, requestId, createdAt }`.
- Consumed by: Task 5 (`seat-request-create`).

- [ ] **Step 1: Write the failing test** `functions/shared/seat-request-notify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import { renderSeatRequestEmail, notifySeatRequest } from './seat-request-notify';

const params = {
  recipient: 'jacob@ai-raadgivning.dk', orgName: 'Acme A/S',
  requesterName: 'Mette Hansen', requesterEmail: 'mette@acme.dk',
  seatLimit: 10, usedSeats: 10, additionalSeats: 5,
  unitPrice: 1200, currency: 'DKK', requestId: 'req-1', createdAt: '2026-07-20T10:00:00.000Z',
};

describe('renderSeatRequestEmail', () => {
  it('includes org, requester, seat counts, and the request id', () => {
    const { subject, html } = renderSeatRequestEmail(params);
    expect(subject).toContain('Acme A/S');
    expect(subject).toContain('5');
    expect(html).toContain('Acme A/S');
    expect(html).toContain('Mette Hansen');
    expect(html).toContain('mette@acme.dk');
    expect(html).toContain('req-1');
  });
});

describe('notifySeatRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends via Resend from the branded sender to the recipient', async () => {
    mockSend.mockResolvedValueOnce({ id: 'e1' });
    await notifySeatRequest({ error: vi.fn() } as any, params);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toBe('AI Uddannelse <no-reply@ai-uddannelse.dk>');
    expect(arg.to).toEqual(['jacob@ai-raadgivning.dk']);
  });

  it('never throws when Resend fails — logs instead', async () => {
    const context = { error: vi.fn() } as any;
    mockSend.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifySeatRequest(context, params)).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npx vitest run seat-request-notify`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `functions/shared/seat-request-notify.ts`:

```ts
import type { InvocationContext } from '@azure/functions';
import { Resend } from 'resend';

// Lazy init — constructing Resend without an API key throws at load time, which
// would deregister ALL functions (functions.md).
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export interface SeatRequestEmailParams {
  recipient: string;
  orgName: string;
  requesterName: string;
  requesterEmail: string;
  seatLimit: number | null;
  usedSeats: number;
  additionalSeats: number;
  unitPrice: number;
  currency: string;
  requestId: string;
  createdAt: string;
}

export function renderSeatRequestEmail(p: SeatRequestEmailParams): { subject: string; html: string } {
  const total = p.additionalSeats * p.unitPrice;
  const money = (n: number) => `${n.toLocaleString('da-DK')} ${p.currency}`;
  const subject = `Anmodning om ${p.additionalSeats} ekstra pladser — ${p.orgName}`;
  const html = `
    <h2>Ny anmodning om ekstra pladser</h2>
    <p><strong>Organisation:</strong> ${p.orgName}</p>
    <p><strong>Anmodet af:</strong> ${p.requesterName} (${p.requesterEmail})</p>
    <p><strong>Nuværende forbrug:</strong> ${p.usedSeats} pladser brugt af ${p.seatLimit ?? 'ubegrænset'}</p>
    <p><strong>Ønsket antal ekstra pladser:</strong> ${p.additionalSeats}</p>
    <p><strong>Pris:</strong> ${p.additionalSeats} × ${money(p.unitPrice)}/år =
       <strong>${money(total)}/år</strong> ekskl. moms (+ 25% moms tilføjes på fakturaen)</p>
    <p style="color:#777;font-size:12px">Anmodnings-ID: ${p.requestId} · ${p.createdAt}</p>
  `;
  return { subject, html };
}

// Best-effort: the request row is already committed and visible in-app. A failed
// email is logged, never thrown — we must not lose the persisted request.
export async function notifySeatRequest(context: InvocationContext, p: SeatRequestEmailParams): Promise<void> {
  try {
    const { subject, html } = renderSeatRequestEmail(p);
    await getResend().emails.send({
      from: 'AI Uddannelse <no-reply@ai-uddannelse.dk>',
      to: [p.recipient],
      subject,
      html,
    });
  } catch (err) {
    context.error('seat-request notification email failed', err);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npx vitest run seat-request-notify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/shared/seat-request-notify.ts functions/shared/seat-request-notify.test.ts
git commit -m "feat(functions): seat-request email notify helper (#127)"
```

---

## Task 5: `seat-request-create` endpoint

**Files:**
- Create: `functions/seat-request-create/index.ts`
- Test: `functions/seat-request-create/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Consumes: `notifySeatRequest` (Task 4); `withTransaction`, `queryOne`, `isUniqueViolation` (`shared/db`).
- Produces: `POST /api/seat-request-create` `{ orgId: string, additionalSeats: number }` → `200 { request }`. Errors: `400` (bad `orgId`/`additionalSeats`), `403` (not org admin), `404` (org missing), `409 SEAT_PRICING_UNCONFIGURED`, `409 ORG_UNLIMITED`, `409 REQUEST_ALREADY_PENDING`. `request` has `id, org_id, requested_by_user_id, additional_seats, unit_price_snapshot (number), currency, status, created_at`.

- [ ] **Step 1: Write the failing test** `functions/seat-request-create/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockClientQuery, mockWithTransaction, mockQueryOne, mockGetProfile, mockIsOrgAdmin, mockNotify } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError, mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (c: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
    mockQueryOne: vi.fn(), mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(), mockNotify: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: mockWithTransaction,
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));
vi.mock('../shared/seat-request-notify', () => ({ notifySeatRequest: mockNotify }));

import handler from './index';

const rows = (...r: unknown[]) => ({ rows: r });
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'https://ai-uddannelse.dk' }, json: async () => body }) as any;
const valid = { orgId: 'org-1', additionalSeats: 5 };
const orgRow = (seat_limit: number | null) => ({ name: 'Acme', seat_limit, active_count: 10, pending_count: 0 });
const inserted = { id: 'req-1', org_id: 'org-1', requested_by_user_id: 'p1', additional_seats: 5, unit_price_snapshot: 1200, currency: 'DKK', status: 'pending', created_at: '2026-07-20T10:00:00.000Z' };

describe('seat-request-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
    // Default: price configured. queryOne is called for (1) seat_pricing then (2) requester profile.
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('platform_settings')
        ? { value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } }
        : { full_name: 'Mette', email: 'mette@acme.dk' });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'x' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await handler(baseReq({ additionalSeats: 5 }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when additionalSeats is not a positive integer', async () => {
    for (const bad of [0, -3, 2.5, 1001, 'x']) {
      const res = await handler(baseReq({ orgId: 'org-1', additionalSeats: bad }), {} as any);
      expect(res.status).toBe(400);
    }
  });

  it('returns 403 when caller is not an org admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 409 SEAT_PRICING_UNCONFIGURED when no price is set', async () => {
    mockQueryOne.mockImplementationOnce(async () => ({ value: { annual_price_per_seat: null, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } }));
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('SEAT_PRICING_UNCONFIGURED');
  });

  it('returns 404 when the org does not exist', async () => {
    mockClientQuery.mockResolvedValueOnce(rows()); // org lock returns nothing
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(404);
  });

  it('returns 409 ORG_UNLIMITED when the org has no seat limit', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(orgRow(null)));
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('ORG_UNLIMITED');
  });

  it('happy path: snapshots the server price, inserts, notifies, returns the request', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(orgRow(10))); // org lock
    mockClientQuery.mockResolvedValueOnce(rows(inserted));   // insert
    const res = await handler(baseReq(valid), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: inserted });
    // price came from the setting, not the client (client sent none anyway)
    const [insertSql, insertParams] = mockClientQuery.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO seat_requests');
    expect(insertParams).toEqual(['org-1', 'p1', 5, 1200, 'DKK']);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][1]).toMatchObject({ recipient: 'jacob@ai-raadgivning.dk', orgName: 'Acme', additionalSeats: 5, unitPrice: 1200 });
  });

  it('returns 409 REQUEST_ALREADY_PENDING on the unique-index violation', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(orgRow(10)));
    mockClientQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('REQUEST_ALREADY_PENDING');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npx vitest run seat-request-create`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `functions/seat-request-create/index.ts`:

```ts
import { isUniqueViolation, queryOne, withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { notifySeatRequest } from '../shared/seat-request-notify';

const MAX_SEATS = 1000;

interface SeatPricingValue {
  annual_price_per_seat: number | null;
  currency: string;
  notification_email: string;
}

export default endpoint('seat-request-create', async ({ req, context, profile, reply, requireOrgAdmin }) => {
  const { orgId, additionalSeats } = await req.json() as { orgId?: unknown; additionalSeats?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (typeof additionalSeats !== 'number' || !Number.isInteger(additionalSeats)
      || additionalSeats < 1 || additionalSeats > MAX_SEATS) {
    return reply(400, { error: `additionalSeats must be an integer between 1 and ${MAX_SEATS}` });
  }

  await requireOrgAdmin(orgId);

  // Binding price is authoritative server-side; the client never sends a price.
  const pricingRow = await queryOne<{ value: SeatPricingValue }>(
    `SELECT value FROM platform_settings WHERE key = 'seat_pricing'`,
  );
  const unitPrice = pricingRow?.value?.annual_price_per_seat ?? null;
  if (unitPrice === null) {
    return reply(409, { error: 'Seat pricing is not configured', code: 'SEAT_PRICING_UNCONFIGURED' });
  }
  const currency = pricingRow?.value?.currency ?? 'DKK';

  let outcome: { kind: 'created'; request: Record<string, unknown>; orgName: string; seatLimit: number; usedSeats: number }
    | { kind: 'not_found' } | { kind: 'unlimited' };
  try {
    outcome = await withTransaction(async (client) => {
      const orgRes = await client.query<{ name: string; seat_limit: number | null; active_count: number; pending_count: number }>(
        `SELECT o.name, o.seat_limit,
                (SELECT COUNT(*)::int FROM org_memberships m WHERE m.org_id = o.id AND m.status = 'active')  AS active_count,
                (SELECT COUNT(*)::int FROM invitations       i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_count
           FROM organizations o
          WHERE o.id = $1
          FOR UPDATE OF o`,
        [orgId],
      );
      const org = orgRes.rows[0];
      if (!org) return { kind: 'not_found' as const };
      if (org.seat_limit === null) return { kind: 'unlimited' as const };

      const insertRes = await client.query(
        `INSERT INTO seat_requests (org_id, requested_by_user_id, additional_seats, unit_price_snapshot, currency)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, org_id, requested_by_user_id, additional_seats,
                   unit_price_snapshot::float8 AS unit_price_snapshot, currency, status, created_at`,
        [orgId, profile.id, additionalSeats, unitPrice, currency],
      );
      return {
        kind: 'created' as const,
        request: insertRes.rows[0],
        orgName: org.name,
        seatLimit: org.seat_limit,
        usedSeats: Number(org.active_count) + Number(org.pending_count),
      };
    });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'A seat request is already pending for this organization', code: 'REQUEST_ALREADY_PENDING' });
    }
    throw dbErr;
  }

  if (outcome.kind === 'not_found') return reply(404, { error: 'Organization not found' });
  if (outcome.kind === 'unlimited') return reply(409, { error: 'Organization has no seat limit', code: 'ORG_UNLIMITED' });

  // Notify the platform admin (best-effort — notifySeatRequest never throws).
  const requester = await queryOne<{ full_name: string; email: string | null }>(
    `SELECT full_name, email FROM profiles WHERE id = $1`, [profile.id],
  );
  await notifySeatRequest(context, {
    recipient: pricingRow?.value?.notification_email ?? 'jacob@ai-raadgivning.dk',
    orgName: outcome.orgName,
    requesterName: requester?.full_name ?? 'Unknown',
    requesterEmail: requester?.email ?? '',
    seatLimit: outcome.seatLimit,
    usedSeats: outcome.usedSeats,
    additionalSeats,
    unitPrice,
    currency,
    requestId: outcome.request.id as string,
    createdAt: outcome.request.created_at as string,
  });

  return reply(200, { request: outcome.request });
});
```

- [ ] **Step 4: Register in the barrel** — add to `functions/index.ts` (alphabetical):

```ts
import './seat-request-create/index';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx vitest run seat-request-create registration-names`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/seat-request-create functions/index.ts
git commit -m "feat(functions): seat-request-create endpoint (#127)"
```

---

## Task 6: `seat-requests` list endpoint

**Files:**
- Create: `functions/seat-requests/index.ts`
- Test: `functions/seat-requests/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Produces: `POST /api/seat-requests` `{ orgId: string }` → `200 { requests: SeatRequest[] }` (all statuses, newest first, each with `requester_name`/`requester_email`). `403` when not org admin (platform admin bypasses); `400` when `orgId` missing.

- [ ] **Step 1: Write the failing test** `functions/seat-requests/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQuery: vi.fn(), mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: mockQuery, queryOne: vi.fn(), withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller is not an org admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
  });

  it('lists the org requests (platform admin bypass)', async () => {
    const requests = [{ id: 'req-1', org_id: 'org-1', status: 'pending', additional_seats: 5, unit_price_snapshot: 1200, currency: 'DKK', requester_name: 'Mette', requester_email: 'mette@acme.dk' }];
    mockQuery.mockResolvedValueOnce(requests);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ requests });
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM seat_requests');
    expect(params).toEqual(['org-1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npx vitest run seat-requests` → FAIL.

- [ ] **Step 3: Implement** `functions/seat-requests/index.ts`:

```ts
import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('seat-requests', async ({ req, reply, requireOrgAdmin }) => {
  const { orgId } = await req.json() as { orgId?: unknown };
  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });

  await requireOrgAdmin(orgId);

  const requests = await query(
    `SELECT sr.id, sr.org_id, sr.requested_by_user_id, sr.additional_seats,
            sr.unit_price_snapshot::float8 AS unit_price_snapshot, sr.currency, sr.status,
            sr.created_at, sr.fulfilled_at, sr.cancelled_at,
            p.full_name AS requester_name, p.email AS requester_email
       FROM seat_requests sr
       LEFT JOIN profiles p ON p.id = sr.requested_by_user_id
      WHERE sr.org_id = $1
      ORDER BY sr.created_at DESC`,
    [orgId],
  );
  return reply(200, { requests });
});
```

- [ ] **Step 4: Register** — add `import './seat-requests/index';` to `functions/index.ts` (alphabetical, after `seat-request-*`? note: `seat-requests` sorts after `seat-request-fulfill`; place accordingly).

- [ ] **Step 5: Run to verify it passes** — `cd functions && npx vitest run seat-requests registration-names` → PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/seat-requests functions/index.ts
git commit -m "feat(functions): seat-requests list endpoint (#127)"
```

---

## Task 7: `seat-request-cancel` endpoint

**Files:**
- Create: `functions/seat-request-cancel/index.ts`
- Test: `functions/seat-request-cancel/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Produces: `POST /api/seat-request-cancel` `{ id: string }` → `200 { request }`. `400` missing id; `404` unknown id; `403` not org admin of the request's org; `409 NOT_PENDING`.

- [ ] **Step 1: Write the failing test** `functions/seat-request-cancel/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-request-cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('returns 400 when id missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });

  it('returns 404 when the request does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // existence lookup
    expect((await handler(baseReq({ id: 'req-x' }), {} as any)).status).toBe(404);
  });

  it('returns 403 when the caller is not org admin of the request org', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1', status: 'pending' });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    expect((await handler(baseReq({ id: 'req-1' }), {} as any)).status).toBe(403);
  });

  it('cancels a pending request', async () => {
    const cancelled = { id: 'req-1', org_id: 'org-1', status: 'cancelled', additional_seats: 5, unit_price_snapshot: 1200, currency: 'DKK', cancelled_at: '2026-07-20T11:00:00.000Z' };
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1', status: 'pending' }); // existence
    mockQueryOne.mockResolvedValueOnce(cancelled);                               // conditional update
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: cancelled });
  });

  it('returns 409 NOT_PENDING when the request is not pending', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1', status: 'fulfilled' }); // existence
    mockQueryOne.mockResolvedValueOnce(null);                                     // conditional update matched 0 rows
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('NOT_PENDING');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npx vitest run seat-request-cancel` → FAIL.

- [ ] **Step 3: Implement** `functions/seat-request-cancel/index.ts` (the `AND status='pending'` conditional update is atomic — no transaction needed):

```ts
import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('seat-request-cancel', async ({ req, reply, requireOrgAdmin }) => {
  const { id } = await req.json() as { id?: unknown };
  if (!id || typeof id !== 'string') return reply(400, { error: 'id is required' });

  const existing = await queryOne<{ org_id: string; status: string }>(
    `SELECT org_id, status FROM seat_requests WHERE id = $1`, [id],
  );
  if (!existing) return reply(404, { error: 'Seat request not found' });

  await requireOrgAdmin(existing.org_id);

  const updated = await queryOne(
    `UPDATE seat_requests
        SET status = 'cancelled', cancelled_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, org_id, additional_seats, unit_price_snapshot::float8 AS unit_price_snapshot,
                currency, status, created_at, cancelled_at`,
    [id],
  );
  if (!updated) return reply(409, { error: 'Seat request is not pending', code: 'NOT_PENDING' });

  return reply(200, { request: updated });
});
```

- [ ] **Step 4: Register** — add `import './seat-request-cancel/index';` to `functions/index.ts` (alphabetical).

- [ ] **Step 5: Run to verify it passes** — `cd functions && npx vitest run seat-request-cancel registration-names` → PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/seat-request-cancel functions/index.ts
git commit -m "feat(functions): seat-request-cancel endpoint (#127)"
```

---

## Task 8: `seat-request-fulfill` endpoint

**Files:**
- Create: `functions/seat-request-fulfill/index.ts`
- Test: `functions/seat-request-fulfill/index.test.ts`
- Modify: `functions/index.ts`

**Interfaces:**
- Produces: `POST /api/seat-request-fulfill` `{ id: string }` → `200 { request, seatLimit }`. **Platform admin only** (`adminEndpoint`). `400` missing id; `404` unknown id; `409 NOT_PENDING`; `409 ORG_UNLIMITED`. Atomically bumps `organizations.seat_limit += additional_seats`.

- [ ] **Step 1: Write the failing test** `functions/seat-request-fulfill/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockClientQuery, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError, mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (c: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: vi.fn(), withTransaction: mockWithTransaction,
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const rows = (...r: unknown[]) => ({ rows: r });
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-request-fulfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'admin-1', is_platform_admin: true });
  });

  it('returns 403 for a non-platform-admin (adminEndpoint gate)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    expect((await handler(baseReq({ id: 'req-1' }), {} as any)).status).toBe(403);
  });

  it('returns 400 when id missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });

  it('returns 404 when the request does not exist', async () => {
    mockClientQuery.mockResolvedValueOnce(rows()); // request lock: none
    expect((await handler(baseReq({ id: 'req-x' }), {} as any)).status).toBe(404);
  });

  it('returns 409 NOT_PENDING when already fulfilled', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'fulfilled', additional_seats: 5 }));
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('NOT_PENDING');
  });

  it('returns 409 ORG_UNLIMITED when the org has no seat limit', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'pending', additional_seats: 5 }));
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: null }));
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('ORG_UNLIMITED');
  });

  it('bumps seat_limit and marks fulfilled', async () => {
    const fulfilled = { id: 'req-1', org_id: 'org-1', additional_seats: 5, status: 'fulfilled', unit_price_snapshot: 1200, currency: 'DKK', fulfilled_at: '2026-07-20T12:00:00.000Z' };
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'pending', additional_seats: 5 })); // request lock
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: 10 }));  // org lock
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: 15 }));  // bump
    mockClientQuery.mockResolvedValueOnce(rows(fulfilled));           // mark fulfilled
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: fulfilled, seatLimit: 15 });
    const [bumpSql, bumpParams] = mockClientQuery.mock.calls[2] as [string, unknown[]];
    expect(bumpSql).toContain('UPDATE organizations SET seat_limit = seat_limit +');
    expect(bumpParams).toEqual(['org-1', 5]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd functions && npx vitest run seat-request-fulfill` → FAIL.

- [ ] **Step 3: Implement** `functions/seat-request-fulfill/index.ts`:

```ts
import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('seat-request-fulfill', async ({ req, profile, reply }) => {
  const { id } = await req.json() as { id?: unknown };
  if (!id || typeof id !== 'string') return reply(400, { error: 'id is required' });

  const result = await withTransaction(async (client) => {
    const reqRes = await client.query<{ org_id: string; status: string; additional_seats: number }>(
      `SELECT org_id, status, additional_seats FROM seat_requests WHERE id = $1 FOR UPDATE`, [id],
    );
    const sr = reqRes.rows[0];
    if (!sr) return { kind: 'not_found' as const };
    if (sr.status !== 'pending') return { kind: 'not_pending' as const };

    const orgRes = await client.query<{ seat_limit: number | null }>(
      `SELECT seat_limit FROM organizations WHERE id = $1 FOR UPDATE`, [sr.org_id],
    );
    const org = orgRes.rows[0];
    if (!org) return { kind: 'not_found' as const };
    if (org.seat_limit === null) return { kind: 'unlimited' as const };

    const bump = await client.query<{ seat_limit: number }>(
      `UPDATE organizations SET seat_limit = seat_limit + $2 WHERE id = $1 RETURNING seat_limit`,
      [sr.org_id, sr.additional_seats],
    );
    const updated = await client.query(
      `UPDATE seat_requests
          SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by_user_id = $2
        WHERE id = $1
        RETURNING id, org_id, requested_by_user_id, additional_seats,
                  unit_price_snapshot::float8 AS unit_price_snapshot, currency, status, created_at, fulfilled_at`,
      [id, profile.id],
    );
    return { kind: 'fulfilled' as const, request: updated.rows[0], seatLimit: bump.rows[0].seat_limit };
  });

  if (result.kind === 'not_found') return reply(404, { error: 'Seat request not found' });
  if (result.kind === 'not_pending') return reply(409, { error: 'Seat request is not pending', code: 'NOT_PENDING' });
  if (result.kind === 'unlimited') return reply(409, { error: 'Organization has no seat limit', code: 'ORG_UNLIMITED' });
  return reply(200, { request: result.request, seatLimit: result.seatLimit });
});
```

- [ ] **Step 4: Register** — add `import './seat-request-fulfill/index';` to `functions/index.ts` (alphabetical).

- [ ] **Step 5: Run to verify it passes** — `cd functions && npx vitest run seat-request-fulfill registration-names` → PASS.

- [ ] **Step 6: Run the whole functions suite + build**

Run: `cd functions && npm test && npm run build`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add functions/seat-request-fulfill functions/index.ts
git commit -m "feat(functions): seat-request-fulfill endpoint (#127)"
```

---

## Task 9: frontend types + query-keys families

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/query-keys.ts`
- Modify: `src/lib/query-keys.test.ts`

**Interfaces:**
- Produces: `SeatRequestStatus`, `SeatRequest`, `SeatPricing` (types); `queryKeys.seatPricing.all = ['seat-pricing']`; `queryKeys.seatRequests.all = ['seat-requests']` + `queryKeys.seatRequests.list(orgId)`.

- [ ] **Step 1: Add types** to `src/lib/types.ts`:

```ts
export type SeatRequestStatus = 'pending' | 'fulfilled' | 'cancelled';

export interface SeatRequest {
  id: string;
  org_id: string;
  requested_by_user_id: string | null;
  additional_seats: number;
  unit_price_snapshot: number;
  currency: string;
  status: SeatRequestStatus;
  created_at: string;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
}

export interface SeatPricing {
  annual_price_per_seat: number | null;
  currency: string;
}
```

- [ ] **Step 2: Add the query-key families** to `src/lib/query-keys.ts` (inside the `queryKeys` object):

```ts
  // ── Seat requests (issue #127) ─────────────────────────────────────────────
  seatPricing: {
    /** ['seat-pricing'] — the single platform-wide price (read-only for org admins). */
    all: ['seat-pricing'] as const,
  },

  seatRequests: {
    /** ['seat-requests'] — invalidation prefix. */
    all: ['seat-requests'] as const,
    /** Full key: ['seat-requests', orgId] */
    list: (orgId: string | undefined) => ['seat-requests', orgId] as const,
  },
```

- [ ] **Step 3: Add key tests** to `src/lib/query-keys.test.ts` (match the file's existing assertion style):

```ts
  it('seatPricing.all is stable', () => {
    expect(queryKeys.seatPricing.all).toEqual(['seat-pricing']);
  });
  it('seatRequests.list is keyed by orgId', () => {
    expect(queryKeys.seatRequests.all).toEqual(['seat-requests']);
    expect(queryKeys.seatRequests.list('org-1')).toEqual(['seat-requests', 'org-1']);
  });
```

- [ ] **Step 4: Run to verify** — `npm test -- query-keys` → PASS; `npx tsc --noEmit -p tsconfig.app.json` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/query-keys.ts src/lib/query-keys.test.ts
git commit -m "feat(web): seat-request types + query keys (#127)"
```

---

## Task 10: read hooks `useSeatPricing` + `useSeatRequests`

**Files:**
- Create: `src/hooks/useSeatPricing.ts`
- Create: `src/hooks/useSeatRequests.ts`

**Interfaces:**
- Consumes: `queryKeys.seatPricing`, `queryKeys.seatRequests` (Task 9); `callApi`.
- Produces: `useSeatPricing()` → `UseQueryResult<SeatPricing>`; `useSeatRequests(orgId?: string)` → `UseQueryResult<SeatRequest[]>` (gated on `orgId`).

- [ ] **Step 1: Create `src/hooks/useSeatPricing.ts`:**

```ts
import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { SeatPricing } from '@/lib/types';

/** The one way to read the seat price for the request dialog. */
export function useSeatPricing() {
  return useQuery({
    queryKey: queryKeys.seatPricing.all,
    queryFn: async () => {
      const { pricing } = await callApi<{ pricing: SeatPricing }>('/api/seat-pricing', {});
      return pricing;
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Create `src/hooks/useSeatRequests.ts`:**

```ts
import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { SeatRequest } from '@/lib/types';

/** The one way to read an org's seat requests. Gated on orgId. */
export function useSeatRequests(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.seatRequests.list(orgId),
    queryFn: async () => {
      const { requests } = await callApi<{ requests: SeatRequest[] }>('/api/seat-requests', { orgId });
      return Array.isArray(requests) ? requests : [];
    },
    enabled: !!orgId,
  });
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.app.json` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSeatPricing.ts src/hooks/useSeatRequests.ts
git commit -m "feat(web): useSeatPricing + useSeatRequests hooks (#127)"
```

---

## Task 11: i18n keys for the seat-request UI

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/da.json`

**Interfaces:**
- Produces: a `seatRequests` translation block used by Tasks 12–15.

- [ ] **Step 1: Add to `en.json`** (top level, near the existing `seats` block):

```json
  "seatRequests": {
    "requestMore": "Request more seats",
    "dialogTitle": "Request more seats",
    "dialogDescription": "Ask AI Rådgivning to add more seats to your organization. You will receive an invoice.",
    "additionalSeats": "Additional seats",
    "estimate": "{{seats}} × {{price}} {{currency}}/yr = {{total}} {{currency}}/yr excl. VAT",
    "vatNote": "+ 25% VAT is added on the invoice.",
    "notConfigured": "Seat pricing isn’t available online yet — please contact AI Rådgivning.",
    "submit": "Send request",
    "submitted": "Seat request sent",
    "pending": "Request pending — {{seats}} seats, submitted {{date}}",
    "cancel": "Cancel request",
    "cancelled": "Seat request cancelled",
    "atCap": "You’ve used all your seats. Request more to keep adding members.",
    "sectionTitle": "Seat requests",
    "fulfil": "Mark fulfilled",
    "fulfilled": "Seat request fulfilled — seat limit increased",
    "colRequester": "Requested by",
    "colSeats": "Seats",
    "colPrice": "Price/yr (excl. VAT)",
    "colStatus": "Status",
    "colDate": "Requested",
    "empty": "No seat requests."
  },
```

- [ ] **Step 2: Add the matching block to `da.json`:**

```json
  "seatRequests": {
    "requestMore": "Anmod om flere pladser",
    "dialogTitle": "Anmod om flere pladser",
    "dialogDescription": "Bed AI Rådgivning om at tilføje flere pladser til din organisation. Du modtager en faktura.",
    "additionalSeats": "Ekstra pladser",
    "estimate": "{{seats}} × {{price}} {{currency}}/år = {{total}} {{currency}}/år ekskl. moms",
    "vatNote": "+ 25% moms tilføjes på fakturaen.",
    "notConfigured": "Priser er ikke tilgængelige online endnu — kontakt venligst AI Rådgivning.",
    "submit": "Send anmodning",
    "submitted": "Anmodning om pladser sendt",
    "pending": "Anmodning afventer — {{seats}} pladser, sendt {{date}}",
    "cancel": "Annullér anmodning",
    "cancelled": "Anmodning om pladser annulleret",
    "atCap": "Du har brugt alle dine pladser. Anmod om flere for at tilføje medlemmer.",
    "sectionTitle": "Anmodninger om pladser",
    "fulfil": "Markér som opfyldt",
    "fulfilled": "Anmodning opfyldt — pladsgrænsen er forhøjet",
    "colRequester": "Anmodet af",
    "colSeats": "Pladser",
    "colPrice": "Pris/år (ekskl. moms)",
    "colStatus": "Status",
    "colDate": "Anmodet",
    "empty": "Ingen anmodninger om pladser."
  },
```

- [ ] **Step 3: Verify JSON parses** — `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` (Vite imports the JSON) → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "i18n: seat-request strings (en+da) (#127)"
```

---

## Task 12: `RequestSeatsDialog` (org-admin request UI)

**Files:**
- Create: `src/components/org-admin/RequestSeatsDialog.tsx`
- Test: `src/components/org-admin/RequestSeatsDialog.test.tsx`

**Interfaces:**
- Consumes: `useSeatPricing` (Task 10); `callApi`, `useToastMutation`, `queryKeys`, `toast`, i18n `seatRequests.*` (Task 11).
- Produces: `RequestSeatsDialog({ orgId, open, onOpenChange })` — controlled dialog; internal `additionalSeats` state; shows the ex-VAT estimate or the "not configured" gate; submits via inline `useCreateSeatRequest` mutation invalidating `queryKeys.seatRequests.list(orgId)`, `queryKeys.orgDetail.detail(orgId)`, `queryKeys.organizations.all`.

- [ ] **Step 1: Write the failing test** `src/components/org-admin/RequestSeatsDialog.test.tsx` (mock the pricing hook + api-client; render with a QueryClientProvider):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n echo — REPO CONVENTION (see AddExistingUserDialog.test.tsx): t returns
// the key, with interpolation params appended. Component tests assert on keys,
// NOT on English/Danish text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
}));

// Passthrough dialog primitives (jsdom can't drive the Radix portal).
vi.mock('@/components/ui/dialog', async () => {
  const R = await import('react');
  const pass = ({ children }: { children?: React.ReactNode }) => R.createElement('div', null, children);
  return { Dialog: pass, DialogContent: pass, DialogHeader: pass, DialogTitle: pass, DialogDescription: pass, DialogFooter: pass };
});

vi.mock('@/lib/api-client', () => ({ callApi: vi.fn(), ApiError: class extends Error {} }));
const mockUseSeatPricing = vi.fn();
vi.mock('@/hooks/useSeatPricing', () => ({ useSeatPricing: () => mockUseSeatPricing() }));

import { RequestSeatsDialog } from './RequestSeatsDialog';

const renderDialog = () => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RequestSeatsDialog orgId="org-1" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
};

describe('RequestSeatsDialog', () => {
  it('gates to the contact message + disables submit when no price is configured', () => {
    mockUseSeatPricing.mockReturnValue({ data: { annual_price_per_seat: null, currency: 'DKK' }, isLoading: false });
    renderDialog();
    expect(screen.getByText('seatRequests.notConfigured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'seatRequests.submit' })).toBeDisabled();
  });

  it('shows the ex-VAT estimate echo when a price is configured (1 seat × 1200)', () => {
    mockUseSeatPricing.mockReturnValue({ data: { annual_price_per_seat: 1200, currency: 'DKK' }, isLoading: false });
    renderDialog();
    expect(screen.getByText('seatRequests.estimate:seats=1,price=1200,currency=DKK,total=1200')).toBeInTheDocument();
    expect(screen.getByText('seatRequests.vatNote')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'seatRequests.submit' })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- RequestSeatsDialog` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/components/org-admin/RequestSeatsDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useSeatPricing } from '@/hooks/useSeatPricing';
import type { SeatRequest } from '@/lib/types';

interface RequestSeatsDialogProps {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestSeatsDialog({ orgId, open, onOpenChange }: RequestSeatsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: pricing, isLoading } = useSeatPricing();
  const [seats, setSeats] = useState(1);

  const price = pricing?.annual_price_per_seat ?? null;
  const currency = pricing?.currency ?? 'DKK';
  const priceConfigured = price !== null;
  const total = priceConfigured ? seats * price : 0;

  const mutation = useToastMutation({
    mutationFn: () =>
      callApi<{ request: SeatRequest }>('/api/seat-request-create', { orgId, additionalSeats: seats }),
    errorTitle: t('seatRequests.submit'),
    onSuccess: () => {
      toast({ title: t('seatRequests.submitted') });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatRequests.list(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('seatRequests.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('seatRequests.dialogDescription')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : !priceConfigured ? (
          <p className="text-sm font-medium text-muted-foreground">{t('seatRequests.notConfigured')}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="additional_seats" className="text-xs font-bold text-[#4a4f60]">
                {t('seatRequests.additionalSeats')}
              </Label>
              <Input
                id="additional_seats"
                type="number"
                min={1}
                max={1000}
                value={seats}
                onChange={(e) => setSeats(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
              />
            </div>
            <p className="text-sm font-medium">
              {t('seatRequests.estimate', { seats, price, currency, total })}
            </p>
            <p className="text-xs text-muted-foreground">{t('seatRequests.vatNote')}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('seatRequests.cancel')}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!priceConfigured || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('seatRequests.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- RequestSeatsDialog` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/org-admin/RequestSeatsDialog.tsx src/components/org-admin/RequestSeatsDialog.test.tsx
git commit -m "feat(web): RequestSeatsDialog (#127)"
```

---

## Task 13: wire the request entry points into `OrgMembersTab`

**Files:**
- Modify: `src/components/org-admin/OrgMembersTab.tsx`

**Interfaces:**
- Consumes: `RequestSeatsDialog` (Task 12), `useSeatRequests` (Task 10), `useCancelSeatRequest` (inline), `atSeatLimit` + `seatUsage` (already computed in the file), i18n `seatRequests.*`.
- Produces: a standing "Request more seats" button (only when the org's `seat_limit` is finite), an at-cap nudge in the invite dialog, and a pending-request state with a Cancel action.

- [ ] **Step 1: Add imports + state near the top of the component:**

```tsx
import { RequestSeatsDialog } from '@/components/org-admin/RequestSeatsDialog';
import { useSeatRequests } from '@/hooks/useSeatRequests';
```
```tsx
  const [requestSeatsOpen, setRequestSeatsOpen] = useState(false);
  const { data: seatRequests = [] } = useSeatRequests(currentOrg?.id);
  const pendingSeatRequest = seatRequests.find((r) => r.status === 'pending') ?? null;
  const hasFiniteSeatLimit = (orgDetail?.seat_limit ?? currentOrg?.seat_limit ?? null) !== null;
```

- [ ] **Step 2: Add the standing button + pending state** in the members toolbar (next to the existing "Invite Member" trigger, ~lines 451–464). Render ONE of: pending state, or the request button — only when the org has a finite limit:

```tsx
      {hasFiniteSeatLimit && (
        pendingSeatRequest ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('seatRequests.pending', {
                seats: pendingSeatRequest.additional_seats,
                date: new Date(pendingSeatRequest.created_at).toLocaleDateString(),
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancelSeatRequestMutation.mutate(pendingSeatRequest.id)}
              disabled={cancelSeatRequestMutation.isPending}
            >
              {t('seatRequests.cancel')}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setRequestSeatsOpen(true)}>
            {t('seatRequests.requestMore')}
          </Button>
        )
      )}
```

- [ ] **Step 3: Add the cancel mutation** (inline, near the other mutations in the file):

```tsx
  const cancelSeatRequestMutation = useToastMutation({
    mutationFn: (id: string) => callApi('/api/seat-request-cancel', { id }),
    errorTitle: t('seatRequests.cancel'),
    onSuccess: () => {
      toast({ title: t('seatRequests.cancelled') });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatRequests.list(currentOrg?.id) });
    },
  });
```

> If `useToastMutation`, `callApi`, `toast`, `queryClient`, or `queryKeys` aren't already imported in this file, add them (match the imports used in `OrganizationDetail.tsx`).

- [ ] **Step 4: Add the at-cap nudge** inside the existing `{(atSeatLimit || inviteErrorMessage) && ...}` block (~lines 524–541), after the destructive message, so the user can act on the wall:

```tsx
                {atSeatLimit && !pendingSeatRequest && (
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => { setInviteOpen(false); setRequestSeatsOpen(true); }}
                  >
                    {t('seatRequests.atCap')}
                  </Button>
                )}
```

- [ ] **Step 5: Render the dialog** near the file's other dialogs (e.g. after the invite `Dialog`):

```tsx
      {currentOrg?.id && (
        <RequestSeatsDialog orgId={currentOrg.id} open={requestSeatsOpen} onOpenChange={setRequestSeatsOpen} />
      )}
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit -p tsconfig.app.json` → exit 0; `npm test -- OrgMembersTab` (if a test exists) → PASS; `npm run lint` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/org-admin/OrgMembersTab.tsx
git commit -m "feat(web): request-more-seats entry points in OrgMembersTab (#127)"
```

---

## Task 14: `SeatRequestsSection` (platform-admin fulfil UI) + wire into OrganizationDetail

**Files:**
- Create: `src/components/platform-admin/org-detail/SeatRequestsSection.tsx`
- Test: `src/components/platform-admin/org-detail/SeatRequestsSection.test.tsx`
- Modify: `src/pages/platform-admin/OrganizationDetail.tsx`

**Interfaces:**
- Consumes: `useSeatRequests(orgId)` (Task 10); a `useFulfillSeatRequest` mutation (inline in the page); i18n `seatRequests.*`.
- Produces: `SeatRequestsSection({ requests, onFulfil, fulfilingId })` — a card listing pending requests each with a **Mark fulfilled** button; rendered on `OrganizationDetail` after `OrgSeatLimitCard`.

- [ ] **Step 1: Write the failing test** `SeatRequestsSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// i18n echo — REPO CONVENTION: t returns the key. Assert on keys + real data.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
}));

import { SeatRequestsSection } from './SeatRequestsSection';
import type { SeatRequest } from '@/lib/types';

const pending: SeatRequest = {
  id: 'req-1', org_id: 'org-1', requested_by_user_id: 'p1', additional_seats: 5,
  unit_price_snapshot: 1200, currency: 'DKK', status: 'pending',
  created_at: '2026-07-20T10:00:00.000Z', fulfilled_at: null, cancelled_at: null,
  requester_name: 'Mette', requester_email: 'mette@acme.dk',
};

describe('SeatRequestsSection', () => {
  it('renders a pending request row with a fulfil action', () => {
    const onFulfil = vi.fn();
    render(<SeatRequestsSection requests={[pending]} onFulfil={onFulfil} fulfilingId={null} />);
    expect(screen.getByText('Mette')).toBeInTheDocument(); // exact: the <strong> requester name
    screen.getByRole('button', { name: 'seatRequests.fulfil' }).click();
    expect(onFulfil).toHaveBeenCalledWith('req-1');
  });

  it('renders nothing when there are no pending requests', () => {
    const { container } = render(<SeatRequestsSection requests={[]} onFulfil={vi.fn()} fulfilingId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- SeatRequestsSection` → FAIL.

- [ ] **Step 3: Implement** `SeatRequestsSection.tsx` (card idiom from `OrgSeatLimitCard`):

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { SeatRequest } from '@/lib/types';

interface SeatRequestsSectionProps {
  requests: SeatRequest[];
  onFulfil: (id: string) => void;
  fulfilingId: string | null;
}

/**
 * Platform-admin fulfilment: lists an org's PENDING seat requests with a
 * "Mark fulfilled" action that bumps the org's seat_limit. Renders nothing
 * when there is nothing pending.
 */
export function SeatRequestsSection({ requests, onFulfil, fulfilingId }: SeatRequestsSectionProps) {
  const { t } = useTranslation();
  const pending = requests.filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4">
      <h2 className="mb-3 text-[13px] font-bold text-[#4a4f60]">{t('seatRequests.sectionTitle')}</h2>
      <ul className="space-y-2">
        {pending.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{r.requester_name ?? r.requester_email ?? '—'}</strong>
              {' · '}
              <span>{r.additional_seats}</span>{' '}{t('seatRequests.colSeats').toLowerCase()}
              {' · '}
              {r.additional_seats * r.unit_price_snapshot} {r.currency}/yr
            </span>
            <Button size="sm" onClick={() => onFulfil(r.id)} disabled={fulfilingId === r.id}>
              {t('seatRequests.fulfil')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- SeatRequestsSection` → PASS.

- [ ] **Step 5: Wire into `OrganizationDetail.tsx`** — add the hook, the fulfil mutation, and render the section after `OrgSeatLimitCard`:

```tsx
import { SeatRequestsSection } from '@/components/platform-admin/org-detail/SeatRequestsSection';
import { useSeatRequests } from '@/hooks/useSeatRequests';
```
```tsx
  const { data: seatRequests = [] } = useSeatRequests(orgId);

  const fulfilSeatRequestMutation = useToastMutation({
    mutationFn: (id: string) => callApi('/api/seat-request-fulfill', { id }),
    errorTitle: t('seatRequests.fulfil'),
    onSuccess: () => {
      toast({ title: t('seatRequests.fulfilled') });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatRequests.list(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });
```

Render right after the `{org.seat_limit ? <OrgSeatLimitCard .../> : null}` block:

```tsx
      <SeatRequestsSection
        requests={seatRequests}
        onFulfil={(id) => fulfilSeatRequestMutation.mutate(id)}
        fulfilingId={fulfilSeatRequestMutation.isPending ? (fulfilSeatRequestMutation.variables as string) : null}
      />
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit -p tsconfig.app.json` → exit 0; `npm test -- OrganizationDetail` → PASS; `npm run lint` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/platform-admin/org-detail/SeatRequestsSection.tsx src/components/platform-admin/org-detail/SeatRequestsSection.test.tsx src/pages/platform-admin/OrganizationDetail.tsx
git commit -m "feat(web): platform-admin seat-request fulfil section (#127)"
```

---

## Task 15: Platform Settings — Seat pricing panel

**Files:**
- Modify: `src/pages/platform-admin/PlatformSettings.tsx`
- Modify: `src/i18n/locales/en.json` + `src/i18n/locales/da.json`

**Interfaces:**
- Consumes: the existing `saveSettingMutation`/`saveSetting('seat_pricing', ...)` flow, `usePlatformSettingsAdmin` seeding, `SaveButton`.
- Produces: a new "Seat pricing" tab/panel editing `annual_price_per_seat` (number, ex-VAT), `currency` (fixed DKK, read-only), `notification_email`; saved to the `seat_pricing` key.

- [ ] **Step 1: Add i18n keys** — under a new `platformSettings.seatPricing` block in both `en.json` and `da.json`:

```json
    "seatPricing": {
      "tab": "Seat pricing",
      "annualPrice": "Annual price per seat (DKK, excl. VAT)",
      "currency": "Currency",
      "notificationEmail": "Requests are emailed to",
      "save": "Save seat pricing"
    }
```
```json
    "seatPricing": {
      "tab": "Pladspriser",
      "annualPrice": "Årlig pris pr. plads (DKK, ekskl. moms)",
      "currency": "Valuta",
      "notificationEmail": "Anmodninger sendes til",
      "save": "Gem pladspriser"
    }
```

(Nest these under the existing top-level `platformSettings` object in each file.)

- [ ] **Step 2: Extend the settings types + defaults** in `PlatformSettings.tsx`:

```tsx
type SettingsKey = 'branding' | 'user_access' | 'email' | 'features' | 'seat_pricing';
type SettingsValue = BrandingSettings | UserAccessSettings | EmailSettings | FeatureSettings | SeatPricingSettings;

interface SeatPricingSettings {
  annual_price_per_seat: number | null;
  currency: string;
  notification_email: string;
}
const defaultSeatPricing: SeatPricingSettings = {
  annual_price_per_seat: null, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk',
};
```
```tsx
  const [seatPricing, setSeatPricing] = useState<SeatPricingSettings>(defaultSeatPricing);
```

- [ ] **Step 3: Seed it from the server** — add a case to the `useEffect` switch (mirrors the other keys):

```tsx
        case 'seat_pricing':
          setSeatPricing({ ...defaultSeatPricing, ...(value as Partial<SeatPricingSettings>) });
          break;
```

- [ ] **Step 4: Add the tab** to the tabs array and render the panel** (mirror the branding panel + the `smtp_port` numeric-input pattern):

```tsx
        {activeTab === 'seat_pricing' && (
          <Card>
            <CardContent className="space-y-[18px] px-[26px] py-6">
              <div className="space-y-1.5">
                <Label htmlFor="annual_price_per_seat" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.seatPricing.annualPrice')}
                </Label>
                <Input
                  id="annual_price_per_seat"
                  type="number"
                  min={0}
                  value={seatPricing.annual_price_per_seat ?? ''}
                  onChange={(e) =>
                    setSeatPricing({
                      ...seatPricing,
                      annual_price_per_seat: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  placeholder="1200"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seat_currency" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.seatPricing.currency')}
                </Label>
                <Input id="seat_currency" value={seatPricing.currency} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seat_notification_email" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.seatPricing.notificationEmail')}
                </Label>
                <Input
                  id="seat_notification_email"
                  type="email"
                  value={seatPricing.notification_email}
                  onChange={(e) => setSeatPricing({ ...seatPricing, notification_email: e.target.value })}
                  placeholder="jacob@ai-raadgivning.dk"
                />
              </div>
              <SaveButton
                done={flashed('seat_pricing')}
                idleLabel={t('platformSettings.seatPricing.save')}
                onClick={() => saveSetting('seat_pricing', seatPricing)}
                disabled={isSaving('seat_pricing')}
              />
            </CardContent>
          </Card>
        )}
```

Add the tab entry to the tabs array (match its shape), e.g. `{ id: 'seat_pricing', label: t('platformSettings.seatPricing.tab') }`.

- [ ] **Step 5: Verify** — `npx tsc --noEmit -p tsconfig.app.json` → exit 0; `npm test -- PlatformSettings` (if a test exists) → PASS; `npm run lint` + `npm run build` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/platform-admin/PlatformSettings.tsx src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(web): seat-pricing settings panel (#127)"
```

---

## Task 16: full-gate verification, real-flow check, docs, deploy handoff

**Files:**
- Modify: `migration/WORKLOG.md` (append), `migration/STATUS.html` (checkpoint).

- [ ] **Step 1: Run every gate** from the worktree root:

Run:
```bash
npm run lint && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build
cd functions && npm run build && npm test && cd ..
```
Expected: all exit 0.

- [ ] **Step 2: Drive the real flow** — invoke the `verify` skill (or `run`) to exercise: org-admin at-cap → Request more seats → estimate shows / gated when price unset → submit → pending state + cancel; platform-admin → set price in Platform Settings → OrganizationDetail shows the request → Mark fulfilled → seat_limit increases. Capture a screenshot of the org-admin dialog and the platform-admin fulfil section.

- [ ] **Step 3: Append a `migration/WORKLOG.md` entry** (dated `2026-07-20`) summarizing: new `seat_requests` table + `seat_pricing` setting, five endpoints, org-admin request UI + platform-admin fulfil UI, and the **outstanding human-gated deploy steps** (below).

- [ ] **Step 4: Update the `migration/STATUS.html` checkpoint** (edit in place) to note #127 scope-A shipped and the deploy prerequisites.

- [ ] **Step 5: Record the deploy prerequisites in the PR** (do NOT run them):
  1. Apply `migration/azure/03-seat-requests.sql` to prod (psql via Azure Cloud Shell + temporary firewall rule — Martin runs it).
  2. Ensure `RESEND_API_KEY` is set in prod (same dependency as invitation emails) or the notification silently no-ops (request still persists).
  3. After deploy, a platform admin sets the annual price in Platform Settings → until then the org-side flow stays gated.

- [ ] **Step 6: Commit + push**

```bash
git add migration/WORKLOG.md migration/STATUS.html
git commit -m "docs: worklog + status checkpoint for seat-request flow (#127)"
git push
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- §4.1 table/enum → Task 1. §4.2 `seat_pricing` setting → Tasks 1 (seed) + 3 (update) + 15 (UI).
- §5 endpoints: `seat-pricing` → Task 2; `seat-request-create` → Task 5 (+ notify Task 4); `seat-requests` → Task 6; `seat-request-cancel` → Task 7; `seat-request-fulfill` → Task 8.
- §6.1 hooks/keys → Tasks 9–10. §6.2 org-admin UI → Tasks 12–13. §6.3 platform-admin UI → Task 14. §6.4 settings → Task 15.
- §7 email → Task 4 (+ wired in Task 5). §8 edge cases → covered by endpoint error codes (Tasks 5–8). §9 testing → per-task TDD + Task 16 gates. §10 deploy prereqs → Task 16. §11 decisions → embodied throughout.

**Placeholder scan** — no "TBD"/"add validation"/"similar to Task N"; every code step shows complete code.

**Type consistency** — `SeatRequest`/`SeatPricing` (Task 9) are the shapes returned by the endpoints (Tasks 2, 5, 6) and consumed by hooks/components (Tasks 10, 12, 14); `unit_price_snapshot` is a number everywhere (cast `::float8` in every read query); error codes `SEAT_PRICING_UNCONFIGURED` / `REQUEST_ALREADY_PENDING` / `NOT_PENDING` / `ORG_UNLIMITED` are used consistently between endpoints and (where surfaced) the UI; `queryKeys.seatRequests.list(orgId)` is the single invalidation key used by every mutation.
