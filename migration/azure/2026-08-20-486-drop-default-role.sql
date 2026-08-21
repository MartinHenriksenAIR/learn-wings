-- 2026-08-20-486-drop-default-role.sql
-- #486 delete the inert platform_settings.user_access.default_role key.
-- It never had a reader: every membership-creating path picks its role
-- independently (tenant-binding autoJoinByTenant and user-context
-- ensureIndividualMembership inline 'learner', invitation-convert replays
-- invitation.role, org-membership-create validates a role from the body).
-- PlatformSettings.tsx rendered no control for it and simply wrote
-- 'learner' back on every save.
--
-- RUN THIS *AFTER* THE #486 DEPLOY, NOT BEFORE — the inverse of the standing
-- rule in README.md. platform-settings-update merges with `value || $2::jsonb`,
-- so while the old frontend is still live the next User & Access save re-adds
-- the key. Once the new bundle ships nothing writes it and nothing accepts it
-- (the validator now 400s on the unknown field).
--
-- Data-only: no schema object to fold into 01-schema.sql. The key is dropped
-- from 02-seed.sql in the same PR, so a fresh database never grows it.
-- Idempotent; safe to re-run.
BEGIN;

UPDATE public.platform_settings
   SET value = value - 'default_role'
 WHERE key = 'user_access'
   AND value ? 'default_role';

COMMIT;
