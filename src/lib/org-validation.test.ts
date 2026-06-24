import { describe, it, expect } from 'vitest';
import { orgSchema } from './org-validation';
import {
  validateOrgName,
  validateOrgSlug,
} from '../../functions/shared/org-validation';

// Parity test (issue #51): the frontend zod rules in src/lib/org-validation.ts
// manually mirror the canonical backend rules in
// functions/shared/org-validation.ts. This fixture table runs the same inputs
// through both copies and asserts they agree, so a drift in either copy fails
// here instead of surfacing as a 400 the form said was valid.

const VALID_NAME = 'Acme Corporation';
const VALID_SLUG = 'acme-corp';

const nameFixtures: Array<{ label: string; value: string; valid: boolean }> = [
  { label: 'empty string', value: '', valid: false },
  { label: '1 char (below min)', value: 'a', valid: false },
  { label: '2 chars (min boundary)', value: 'ab', valid: true },
  { label: 'typical name', value: 'Acme Corporation A/S', valid: true },
  { label: '100 chars (max boundary)', value: 'a'.repeat(100), valid: true },
  { label: '101 chars (above max)', value: 'a'.repeat(101), valid: false },
  // Whitespace handling (review finding I-1): length is judged on the trimmed value.
  { label: 'whitespace only', value: '   ', valid: false },
  { label: 'padded but valid (trims to "ab")', value: '  ab  ', valid: true },
  { label: 'padded down to 1 char (trims to "a")', value: '  a  ', valid: false },
];

const slugFixtures: Array<{ label: string; value: string; valid: boolean }> = [
  { label: 'empty string', value: '', valid: false },
  { label: '1 char (below min)', value: 'a', valid: false },
  { label: '2 chars (min boundary)', value: 'ab', valid: true },
  { label: 'typical slug', value: 'acme-corp-123', valid: true },
  { label: '50 chars (max boundary)', value: 'a'.repeat(50), valid: true },
  { label: '51 chars (above max)', value: 'a'.repeat(51), valid: false },
  { label: 'uppercase letters', value: 'Acme-Corp', valid: false },
  { label: 'underscore', value: 'acme_corp', valid: false },
  { label: 'space', value: 'acme corp', valid: false },
  { label: 'dot', value: 'acme.corp', valid: false },
  { label: 'non-ascii letters', value: 'æble-grød', valid: false },
  { label: 'leading/trailing hyphens allowed by the rules', value: '-acme-', valid: true },
];

describe('org-validation parity (frontend zod vs canonical backend rules)', () => {
  describe('name', () => {
    for (const { label, value, valid } of nameFixtures) {
      it(`${valid ? 'accepts' : 'rejects'} ${label}`, () => {
        const frontend = orgSchema.safeParse({ name: value, slug: VALID_SLUG }).success;
        const backend = validateOrgName(value) === null;
        expect(frontend).toBe(valid);
        expect(backend).toBe(valid);
      });
    }
  });

  describe('slug', () => {
    for (const { label, value, valid } of slugFixtures) {
      it(`${valid ? 'accepts' : 'rejects'} ${label}`, () => {
        const frontend = orgSchema.safeParse({ name: VALID_NAME, slug: value }).success;
        const backend = validateOrgSlug(value) === null;
        expect(frontend).toBe(valid);
        expect(backend).toBe(valid);
      });
    }
  });
});
