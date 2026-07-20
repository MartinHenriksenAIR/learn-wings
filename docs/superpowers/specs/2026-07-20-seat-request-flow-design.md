# Seat‑Request Flow — Design Spec (#127)

**Date:** 2026‑07‑20
**Issue:** #127 (Payment) — scope A only
**Status:** design approved via grilling; pending spec review before implementation plan

---

## 1. Overview

Give an **org admin** a way to **request additional seats** for their organization
when their seat cap is (or is about to be) exhausted. The app shows a **binding
annual price**, persists the request, and **emails the platform admin
(`jacob@ai-raadgivning.dk`)** who then invoices the client offline and, once paid,
bumps the org's seat cap with one click.

**There is no online payment in this scope.** The word "yearly subscription" is
pricing framing only — we display an annual per‑seat rate. Money changes hands
entirely offline via a human‑sent invoice.

This is scope **A** of #127. Scope **B** (individual "free account → premium
license" self‑signup monetization) is explicitly **deferred to a separate project**
— it needs a data model that does not exist today (standalone org‑less users,
free‑vs‑paid course gating, per‑user licenses).

## 2. Non‑goals

- No payment provider / checkout / Stripe / card handling.
- No proration. A quote is always a **full annual price per seat**.
- No subscription term modelling — no term start/end dates, no renewal or expiry
  tracking, no dunning. `seat_limit` stays a bare integer.
- No per‑org or tiered/volume pricing (single global price).
- No confirmation email to the requesting org admin (in‑app confirmation only).
- No global cross‑org "seat requests" queue UI (fulfilment is per‑org).
- No B2C individual premium flow (scope B).

## 3. Current‑state facts (what we build on)

- `organizations.seat_limit integer DEFAULT NULL` (NULL = unlimited). Enforced
  atomically in `functions/org-membership-create` (row‑locked active count,
  returns `409 { code: 'SEAT_LIMIT_REACHED' }`). This is the #66/#126 foundation.
- No `plan`/`tier`/`subscription`/`license` concept anywhere; `profiles` has no
  paid flag. Everything is org‑scoped via `org_memberships`.
- Email already ships via **Resend** (`functions/send-invitation-email`,
  `from: 'AI Uddannelse <no-reply@ai-uddannelse.dk>'`, lazy client keyed on
  `RESEND_API_KEY`).
- `platform_settings` is a `key text UNIQUE / value jsonb` table — the config home
  for the price.
- Backend convention: **all new endpoints use `endpoint()` / `adminEndpoint()`**
  from `functions/shared/endpoint.ts` (ADR‑0015), registered in the
  `functions/index.ts` barrel. Frontend convention: reads via shared TanStack
  Query hooks + the `queryKeys` factory; mutations invalidate factory keys
  (`.claude/rules/frontend.md`).

## 4. Data model

### 4.1 New enum + table (canonical: `migration/azure/01-schema.sql`)

```sql
CREATE TYPE public.seat_request_status AS ENUM ('pending', 'fulfilled', 'cancelled');

CREATE TABLE public.seat_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  additional_seats    integer NOT NULL CHECK (additional_seats >= 1),
  unit_price_snapshot numeric(12,2) NOT NULL,   -- annual price per seat, ex‑moms, at request time
  currency            text NOT NULL DEFAULT 'DKK',
  status              public.seat_request_status NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  fulfilled_at        timestamptz,
  fulfilled_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at        timestamptz
);

-- One pending request per org, enforced by the DB (backs the "one‑at‑a‑time" rule).
CREATE UNIQUE INDEX seat_requests_one_pending_per_org
  ON public.seat_requests (org_id) WHERE status = 'pending';

CREATE INDEX seat_requests_org_id_idx ON public.seat_requests (org_id);
```

The **binding total** is always derived: `additional_seats × unit_price_snapshot`
(ex‑moms). We store the unit price, not the total, so the derivation stays explicit.

### 4.2 Pricing config (`platform_settings` key)

Key `seat_pricing`, value:

```json
{ "annual_price_per_seat": null, "currency": "DKK", "notification_email": "jacob@ai-raadgivning.dk" }
```

- `annual_price_per_seat` is **`null` by default** (unset) — ex‑moms DKK when set.
- `notification_email` defaults to `jacob@ai-raadgivning.dk`.
- Written only by a platform admin (via `platform-settings-update`).
  `annual_price_per_seat` + `currency` are readable by **any authenticated user**
  through the dedicated `seat-pricing` endpoint (a sales price, not sensitive);
  `notification_email` and any SMTP config are **never** exposed outside platform
  admins.

## 5. Backend (Azure Functions)

All via the `endpoint()` / `adminEndpoint()` factory; all registered in
`functions/index.ts`; mock contract tests per endpoint (happy + 401/403 + key
errors). **The client‑sent price is never trusted** — the server re‑reads
`seat_pricing` and computes/stores the snapshot itself.

| Route | Factory / authz | Purpose |
|---|---|---|
| `seat-pricing` | `endpoint()` (any authed user) | Returns `{ annual_price_per_seat, currency }` **only** (no email/SMTP) for the request dialog to display. |
| `seat-request-create` | `endpoint()` → `ctx.requireOrgAdmin(orgId)` | Create a pending request for `orgId`. |
| `seat-requests` | `endpoint()` → `ctx.requireOrgAdmin(orgId)` | List an org's requests (platform admin bypasses per suite convention). |
| `seat-request-cancel` | `endpoint()` → `ctx.requireOrgAdmin(orgId)` | Org admin cancels their own `pending` request. |
| `seat-request-fulfill` | `adminEndpoint()` (platform admin only) | Bump `seat_limit` and mark `fulfilled`, atomically. |

### 5.1 `seat-request-create`

1. Validate `additional_seats`: integer, `1 ≤ n ≤ 1000` → `400` on violation.
2. Re‑read `seat_pricing`. If `annual_price_per_seat` is `null` →
   `409 { code: 'SEAT_PRICING_UNCONFIGURED' }` (the UI gates on this, but the
   server enforces it — a binding request cannot exist without a price).
3. In a transaction: verify the org exists and `seat_limit IS NOT NULL`
   (unlimited orgs can't request) → else `409`. Insert the row with
   `unit_price_snapshot` + `currency` taken **from the setting**, `status = 'pending'`.
4. The `seat_requests_one_pending_per_org` unique index makes a concurrent second
   pending request fail — catch the unique violation → `409 { code: 'REQUEST_ALREADY_PENDING' }`.
5. **After commit**, send the notification email (best‑effort — see §7).
6. Return the created request.

### 5.2 `seat-request-fulfill` (atomic)

In one transaction, `SELECT … FOR UPDATE` the request row + its org, then:
- Guard `status = 'pending'` → else `409 { code: 'NOT_PENDING' }`.
- Guard `organizations.seat_limit IS NOT NULL` → else `409`.
- `UPDATE organizations SET seat_limit = seat_limit + additional_seats WHERE id = org_id`.
- `UPDATE seat_requests SET status='fulfilled', fulfilled_at=now(), fulfilled_by_user_id=<caller> WHERE id=…`.

### 5.3 `seat-request-cancel`

Transition the caller‑org's `pending` request → `cancelled` (`cancelled_at=now()`).
Non‑pending → `409 { code: 'NOT_PENDING' }`.

## 6. Frontend

Stack per ADRs 0001–0004; hooks + `queryKeys` factory per `.claude/rules/frontend.md`;
every string gets `en` **and** `da` keys; ownership comparisons use `profile?.id`;
saving flags cleared in `finally`.

### 6.1 Hooks & keys
- `queryKeys` additions: `seatPricing`, `seatRequests(orgId)`.
- `useSeatPricing()` → `seat-pricing`.
- `useSeatRequests(orgId)` → `seat-requests` (gated `enabled: !!orgId`).
- Mutations via `useToastMutation`, invalidating the affected factory keys:
  `useCreateSeatRequest`, `useCancelSeatRequest`, `useFulfillSeatRequest`
  (fulfil also invalidates the org's `organizations` key so the new `seat_limit`
  reflects immediately).

### 6.2 Org‑admin UI (Organization Members)
- **Standing "Request more seats"** button, shown only when the org has a
  **finite** `seat_limit`.
- **Nudge at the cap:** the blocked add‑member state (`SEAT_LIMIT_REACHED`)
  surfaces a CTA that opens the same dialog.
- **`RequestSeatsDialog`:**
  - Input: N additional seats (min 1).
  - Shows the binding total: `N × annual_price_per_seat` in **DKK, ex‑moms**
    ("+ 25% moms tilføjes på fakturaen"). May show the incl‑moms figure as a
    secondary line.
  - **Gated when price is unset:** if `annual_price_per_seat` is `null`, show
    *"Contact AI Rådgivning"* instead of the request form (matches the server's
    `SEAT_PRICING_UNCONFIGURED` guard).
  - Submit → success toast + the page shows the persistent pending state.
- **Pending state:** *"Request pending — N seats, submitted <date>"* with a
  **Cancel** action. While pending, the request button is replaced by this state
  (one‑at‑a‑time).

### 6.3 Platform‑admin UI (OrganizationDetail)
- A **pending seat‑requests** section on the org's detail page: requester, seats,
  snapshot unit price + total (ex‑moms), submitted date, and a **Mark fulfilled**
  button (calls `seat-request-fulfill`). Fulfilled/cancelled history may render
  collapsed/secondary.

### 6.4 Platform Settings
- A **Seat pricing** field group: `annual_price_per_seat` (DKK, ex‑moms),
  `currency` (fixed DKK for now), `notification_email` (default
  `jacob@ai-raadgivning.dk`) — saved via `platform-settings-update` under the
  `seat_pricing` key.

## 7. Email notification

- Reuse the Resend pattern from `send-invitation-email` (lazy client,
  `from: no-reply@ai-uddannelse.dk`). **Lazy‑init only** — no module‑load Resend
  construction (functions convention).
- **Recipient:** `seat_pricing.notification_email` (default `jacob@ai-raadgivning.dk`).
- **Content (Danish — recipient is internal DK staff):** org name, requesting
  admin's name + email, current `seat_limit` and current active usage, requested
  additional seats, snapshot unit price + computed annual total (ex‑moms),
  currency, request id, timestamp.
- **Best‑effort, non‑fatal:** the request row is committed **before** the send; if
  Resend fails we log the error (with context) and still return success — the
  request is visible in‑app to the platform admin regardless. We do **not** hide
  the failure (logged) and do **not** lose the request.

## 8. Error handling & edge cases

- Unlimited orgs (`seat_limit IS NULL`): no request entry points shown; server
  rejects a create with `409`.
- Price unset: UI gated to "Contact AI Rådgivning"; server rejects create with
  `SEAT_PRICING_UNCONFIGURED`.
- Duplicate pending: DB unique index + `REQUEST_ALREADY_PENDING` `409`; UI shows
  the pending state instead of the form.
- Fulfil race / double‑click: `FOR UPDATE` + `status='pending'` guard ⇒ the second
  attempt gets `NOT_PENDING`.
- Cancel of a non‑pending request: `NOT_PENDING` `409`.
- 500s stay generic (ADR‑0014, via the factory's `internalError`); deliberate 4xx
  `code`s above are caller‑facing contract.

## 9. Testing

- **Functions** (`cd functions && npm test`, mock `shared/auth|db|profile`):
  per‑endpoint contract tests — create (401/403, valid, price‑unset,
  duplicate‑pending, unlimited‑org), fulfill (atomic bump, 403 non‑admin,
  already‑fulfilled), cancel (pending→cancelled, non‑pending), list authz,
  seat‑pricing shape (no email leak).
- **Frontend:** hook/component tests following existing patterns (dialog gating on
  unset price; pending‑state rendering; fulfil invalidates org key).
- **Gates (all exit 0):** root `npm run lint` · `npm test` ·
  `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/`
  `npm run build` · `npm test`.

## 10. Deployment prerequisites (not code)

- Prod needs `RESEND_API_KEY` set for the email to actually send — the same
  pending dependency invitation emails have; the request/persist path works
  regardless.
- The `seat_requests` table + enum must be applied to the prod DB via the
  established migration channel (canonical schema updated in
  `migration/azure/01-schema.sql`).
- Post‑deploy, a platform admin sets `annual_price_per_seat` in Platform Settings;
  until then the org‑side flow stays gated.

## 11. Decision log (resolved via grilling, 2026‑07‑20)

1. Scope **A only** (B2B seat expansion), request‑only, **no payment**.
2. Pricing source: **single global** price in `platform_settings`.
3. Price is **binding** (snapshotted on the request).
4. **Full annual price**, no proration (no term‑date model introduced).
5. **DKK, ex‑moms**; moms added on the invoice.
6. **Persist** requests (table) **+ email**, not email‑only.
7. Seats granted via an in‑app **fulfil action** that bumps `seat_limit`.
8. Entry points: **standing button** (finite cap) **+ nudge at the cap**.
9. **One pending request per org** + cancel.
10. Recipient **configurable**, default `jacob@ai-raadgivning.dk`.
11. **In‑app confirmation only** (no requester email).
12. Fulfilment UI **per‑org on OrganizationDetail** (no global queue).
13. Price **unset by default**; request flow **gated until configured**.
