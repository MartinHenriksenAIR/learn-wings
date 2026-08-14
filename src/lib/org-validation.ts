import { z } from 'zod';


const ORG_NAME_MIN_LENGTH = 2;
const ORG_NAME_MAX_LENGTH = 100;
const ORG_SLUG_MIN_LENGTH = 2;
const ORG_SLUG_MAX_LENGTH = 50;
const ORG_SLUG_REGEX = /^[a-z0-9-]+$/;

const orgNameSchema = z
  .string()
  .trim()
  .min(ORG_NAME_MIN_LENGTH, `Name must be at least ${ORG_NAME_MIN_LENGTH} characters`)
  .max(ORG_NAME_MAX_LENGTH, `Name must be less than ${ORG_NAME_MAX_LENGTH} characters`);

const orgSlugSchema = z
  .string()
  .min(ORG_SLUG_MIN_LENGTH, `Slug must be at least ${ORG_SLUG_MIN_LENGTH} characters`)
  .max(ORG_SLUG_MAX_LENGTH, `Slug must be less than ${ORG_SLUG_MAX_LENGTH} characters`)
  .regex(ORG_SLUG_REGEX, 'Slug can only contain lowercase letters, numbers, and hyphens');

export const orgSchema = z.object({
  name: orgNameSchema,
  slug: orgSlugSchema,
});
