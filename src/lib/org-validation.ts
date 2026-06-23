import { z } from 'zod';

// Organization name/slug validation rules — the single frontend copy
// (issue #51). Manually mirrors the canonical backend rules in
// functions/shared/org-validation.ts; the parity test
// src/lib/org-validation.test.ts pins both against the same fixture table,
// so a drift in either copy fails the suite.

export const ORG_NAME_MIN_LENGTH = 2;
export const ORG_NAME_MAX_LENGTH = 100;
export const ORG_SLUG_MIN_LENGTH = 2;
export const ORG_SLUG_MAX_LENGTH = 50;
export const ORG_SLUG_REGEX = /^[a-z0-9-]+$/;

export const orgNameSchema = z
  .string()
  .trim()
  .min(ORG_NAME_MIN_LENGTH, `Name must be at least ${ORG_NAME_MIN_LENGTH} characters`)
  .max(ORG_NAME_MAX_LENGTH, `Name must be less than ${ORG_NAME_MAX_LENGTH} characters`);

export const orgSlugSchema = z
  .string()
  .min(ORG_SLUG_MIN_LENGTH, `Slug must be at least ${ORG_SLUG_MIN_LENGTH} characters`)
  .max(ORG_SLUG_MAX_LENGTH, `Slug must be less than ${ORG_SLUG_MAX_LENGTH} characters`)
  .regex(ORG_SLUG_REGEX, 'Slug can only contain lowercase letters, numbers, and hyphens');

/** Shared schema for the org create/edit forms (OrganizationsManager, OrganizationDetail). */
export const orgSchema = z.object({
  name: orgNameSchema,
  slug: orgSlugSchema,
});
