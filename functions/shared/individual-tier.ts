/**
 * The hidden "Individuals" self-serve placeholder org (#354). Org-less walk-ins
 * are auto-joined here as learners. Detection in query logic is ALWAYS by
 * kind = INDIVIDUAL_ORG_KIND — the fixed id exists only for idempotent seeding.
 */
export const INDIVIDUAL_ORG_ID = '00000000-0000-0000-0000-000000000354';
export const INDIVIDUAL_ORG_KIND = 'individual';
export const INDIVIDUAL_ORG_NAME = 'AI Uddannelse';
