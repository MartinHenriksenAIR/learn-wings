import { describe, it, expect } from 'vitest';
import { INDIVIDUAL_ORG_ID, INDIVIDUAL_ORG_KIND, INDIVIDUAL_ORG_NAME } from './individual-tier';

describe('individual-tier constants', () => {
  it('pins the seeded placeholder identity', () => {
    expect(INDIVIDUAL_ORG_ID).toBe('00000000-0000-0000-0000-000000000354');
    expect(INDIVIDUAL_ORG_KIND).toBe('individual');
    expect(INDIVIDUAL_ORG_NAME).toBe('AI Uddannelse');
  });
});
