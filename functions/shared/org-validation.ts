const ORG_NAME_MIN_LENGTH = 2;
const ORG_NAME_MAX_LENGTH = 100;
const ORG_SLUG_MIN_LENGTH = 2;
const ORG_SLUG_MAX_LENGTH = 50;
const ORG_SLUG_REGEX = /^[a-z0-9-]+$/;

export function validateOrgName(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || trimmed.length < ORG_NAME_MIN_LENGTH || trimmed.length > ORG_NAME_MAX_LENGTH) {
    return `name must be a string between ${ORG_NAME_MIN_LENGTH} and ${ORG_NAME_MAX_LENGTH} characters`;
  }
  return null;
}

export function normalizeOrgName(value: string): string {
  return value.trim();
}

export function validateOrgSlug(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < ORG_SLUG_MIN_LENGTH || value.length > ORG_SLUG_MAX_LENGTH) {
    return `slug must be a string between ${ORG_SLUG_MIN_LENGTH} and ${ORG_SLUG_MAX_LENGTH} characters`;
  }
  if (!ORG_SLUG_REGEX.test(value)) {
    return 'slug must contain only lowercase letters, numbers, and hyphens';
  }
  return null;
}
