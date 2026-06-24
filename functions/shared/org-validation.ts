// Canonical organization name/slug validation rules — the single backend copy
// (issue #51). The frontend mirrors these rules in src/lib/org-validation.ts
// (zod), pinned against this module by the parity test
// src/lib/org-validation.test.ts. Change the rules HERE first; the parity test
// fails until the frontend mirror is updated to match.
//
// The slug regex matches the DB-level unique constraint's expectation of
// lowercase URL-safe tokens.

export const ORG_NAME_MIN_LENGTH = 2;
export const ORG_NAME_MAX_LENGTH = 100;
export const ORG_SLUG_MIN_LENGTH = 2;
export const ORG_SLUG_MAX_LENGTH = 50;
export const ORG_SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * Returns an error message for an invalid org name, or null when valid. The
 * length check runs on the TRIMMED value, so a whitespace-only ("   ") or
 * surrounding-padded name is judged on its real content — and a name that is
 * only whitespace is rejected rather than stored as a blank-looking org.
 * Persist the trimmed value with normalizeOrgName.
 */
export function validateOrgName(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || trimmed.length < ORG_NAME_MIN_LENGTH || trimmed.length > ORG_NAME_MAX_LENGTH) {
    return `name must be a string between ${ORG_NAME_MIN_LENGTH} and ${ORG_NAME_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * Canonical normalization applied before persisting an org name: trims
 * surrounding whitespace so a padded name ("  Acme  ") is stored as "Acme".
 * Pair with validateOrgName (which validates the trimmed length). Slugs need no
 * equivalent — ORG_SLUG_REGEX already rejects any whitespace.
 */
export function normalizeOrgName(value: string): string {
  return value.trim();
}

/** Returns an error message for an invalid org slug, or null when valid. */
export function validateOrgSlug(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < ORG_SLUG_MIN_LENGTH || value.length > ORG_SLUG_MAX_LENGTH) {
    return `slug must be a string between ${ORG_SLUG_MIN_LENGTH} and ${ORG_SLUG_MAX_LENGTH} characters`;
  }
  if (!ORG_SLUG_REGEX.test(value)) {
    return 'slug must contain only lowercase letters, numbers, and hyphens';
  }
  return null;
}
