-- 2026-08-20-487-drop-require-email-verification.sql
-- #487 delete the platform_settings.user_access.require_email_verification key.
-- It had no reader, and unlike the sibling default_role (#486) it made a security
-- claim the system does not honour: the UI offered a switch labelled "Users must
-- verify their email before accessing the platform" that enforced nothing. It was
-- set true in production, so the false assurance was live.
--
-- There is no verification step to wire it to. Authentication is Entra-only
-- (ADR-0005): there is no signup, no password, and no user-supplied address, so
-- no unverified email ever enters the system. The address is taken from the
-- token's preferred_username claim, which Entra sources from the UPN and only
-- permits on a DNS-verified tenant domain -- already a stronger guarantee than
-- the xms_edov claim option 1 proposed. xms_edov additionally requires enabling
-- the 'email' optional claim, which Microsoft documents as mutable and unfit for
-- authorization, and is false for SAML/WS-Fed federated accounts -- so gating
-- sign-in on it would lock out federated enterprise users. See #487 for the
-- full investigation.
--
-- RUN THIS *AFTER* THE #487 DEPLOY, NOT BEFORE -- the inverse of the standing
-- rule in README.md, and the same ordering #486 needed. platform-settings-update
-- merges with `value || $2::jsonb`, so while the old frontend is still live the
-- next User & Access save re-adds the key. Once the new bundle ships nothing
-- writes it and nothing accepts it (the validator now 400s on the unknown field).
--
-- Data-only: no schema object to fold into 01-schema.sql. The key is dropped
-- from 02-seed.sql in the same PR, so a fresh database never grows it.
-- Idempotent; safe to re-run.
BEGIN;

UPDATE public.platform_settings
   SET value = value - 'require_email_verification'
 WHERE key = 'user_access'
   AND value ? 'require_email_verification';

COMMIT;
