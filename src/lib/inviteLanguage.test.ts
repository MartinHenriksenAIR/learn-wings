import { describe, it, expect } from 'vitest';
import { uiLangToInvite } from './inviteLanguage';

describe('uiLangToInvite', () => {
  it('maps English variants to en', () => {
    expect(uiLangToInvite('en')).toBe('en');
    expect(uiLangToInvite('en-US')).toBe('en');
    expect(uiLangToInvite('EN')).toBe('en');
  });
  it('maps everything else (incl. Danish and unknown) to da', () => {
    expect(uiLangToInvite('da')).toBe('da');
    expect(uiLangToInvite('da-DK')).toBe('da');
    expect(uiLangToInvite(undefined)).toBe('da');
    expect(uiLangToInvite('')).toBe('da');
  });
});
