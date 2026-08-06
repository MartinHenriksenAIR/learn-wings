-- 14-org-self-registration.sql
-- #356 per-org "Allow self-registration" toggle. A boolean per organization that
-- governs whether members of the org's bound Entra tenant (#353) auto-join via
-- SSO without an invite. It stacks with the platform-wide master switch
-- (platform_settings.user_access.allow_self_registration) and the member seat
-- cap: auto-join happens only when global ON *and* per-org ON *and* a seat is
-- free (functions/shared/tenant-binding autoJoinByTenant).
--
-- Default true: new (and existing) orgs keep the frictionless onboarding they
-- had before this switch existed. Toggling off requires an invite for the
-- tenant's users going forward; it never removes or disables existing members.
--
-- Both org admins (functions/org-settings-update) and platform admins
-- (functions/organization-update) write this one column — last write wins.
--
-- MUST run on prod BEFORE the #356 deploy: functions/user-context (via
-- tenant-binding), functions/organizations, functions/organization-update and
-- functions/org-settings-update read/write this column the moment they go live.
-- Folded into 01-schema.sql after apply (see migration/azure/README.md).
-- Idempotent; safe to re-run.
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS allow_self_registration boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.allow_self_registration IS 'Per-org on/off switch for Entra tenant auto-join (#356). true = members of the bound tenant auto-join without an invite (still subject to the platform-wide master switch and the member seat cap); false = an invite is required. Default true. Toggling off blocks only future auto-joins; existing members are untouched.';

COMMIT;
