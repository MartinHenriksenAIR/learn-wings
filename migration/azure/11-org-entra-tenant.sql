-- 11-org-entra-tenant.sql
-- #353 org auto-join via verified Entra tenant. Binds an organization to a
-- verified Entra tenant ID so members of that tenant self-onboard via SSO with
-- no invite (functions/user-context auto-join). entra_tid is auto-seeded from
-- the first org_admin's verified token tid (functions/shared/tenant-binding),
-- guarded against the shared consumer/MSA tenant; entra_tid_label is the
-- admin's email domain, a cosmetic hint a platform admin can edit.
--
-- UNIQUE on entra_tid: a verified tenant binds to at most one org (the
-- first-bound-wins collision rule). UNIQUE allows multiple NULLs, so unbound
-- orgs are unconstrained.
--
-- MUST run on prod BEFORE the #353 deploy: functions/user-context and
-- functions/organization-update read/write these columns the moment they go live.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
-- Idempotent; safe to re-run.
BEGIN;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS entra_tid       text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS entra_tid_label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_entra_tid_key'
  ) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_entra_tid_key UNIQUE (entra_tid);
  END IF;
END$$;

COMMENT ON COLUMN public.organizations.entra_tid IS 'Bound Entra tenant ID for SSO auto-join (#353). NULL = unbound. UNIQUE: a verified tenant binds to at most one org.';
COMMENT ON COLUMN public.organizations.entra_tid_label IS 'Human-friendly domain label for the tenant binding, e.g. acme.com (#353). Cosmetic; editable by platform admin.';

COMMIT;
