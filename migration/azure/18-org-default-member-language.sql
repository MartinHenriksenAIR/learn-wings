-- 18-org-default-member-language.sql
-- #405 per-org default member language. The language a joining member's
-- profiles.preferred_language is seeded with, when their profile is created
-- via this org (functions/user-context and functions/invitation-accept both
-- resolve it BEFORE the profiles INSERT, so it is a seed and never an update).
--
-- NULL = no default: the member keeps the browser-derived language they arrive
-- with (#226 / ADR-0016). Nullable rather than NOT NULL DEFAULT because a
-- non-null default applied without an org admin ever asking would silently
-- change the language of system-generated email for every existing org.
--
-- Seeds the FIRST profile only. It never touches an existing profile, so it
-- never overrides a member's own Settings choice, and a member of two orgs
-- does not get their language re-decided by whichever org they joined second.
-- Changing this column affects future joins only; existing members are
-- untouched — same contract as allow_self_registration (#356).
--
-- Org admins write it via functions/organization-update (ORG_ADMIN_WRITABLE),
-- the same path as name/logo_url/allow_self_registration.
--
-- MUST run on prod BEFORE the #405 deploy: functions/organizations,
-- functions/organization-update, functions/user-context and
-- functions/invitation-accept read or write this column the moment they go
-- live. Folded into 01-schema.sql after apply (see migration/azure/README.md).
-- Idempotent; safe to re-run.
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_member_language text
  CONSTRAINT organizations_default_member_language_check
  CHECK (default_member_language IN ('en', 'da'));

COMMENT ON COLUMN public.organizations.default_member_language IS 'Per-org default language seeded into profiles.preferred_language when a member''s profile is first created via this org (#405). NULL = no default; the member keeps their browser-derived language. Applies to the first profile creation only: it never updates an existing profile, so a member''s own Settings choice always wins, and changing this column affects future joins only.';

COMMIT;
