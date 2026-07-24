import { describe, it, expect } from 'vitest';

import { resolveEmailLanguage } from './strings';

describe('resolveEmailLanguage', () => {
  it("prefers the recipient's stored 'da' over the inviter's 'en' pick", () => {
    expect(resolveEmailLanguage('en', 'da')).toBe('da');
  });

  it("prefers the recipient's stored 'en' over the inviter's 'da' pick", () => {
    expect(resolveEmailLanguage('da', 'en')).toBe('en');
  });

  it("uses the inviter's 'da' pick when the recipient has no profile", () => {
    expect(resolveEmailLanguage('da', null)).toBe('da');
  });

  it("uses the inviter's 'en' pick when the recipient has no profile", () => {
    expect(resolveEmailLanguage('en', null)).toBe('en');
  });

  it('defaults to Danish when no profile and no inviter pick', () => {
    expect(resolveEmailLanguage(undefined, null)).toBe('da');
  });

  it('ignores an unsupported inviter language and defaults to Danish', () => {
    expect(resolveEmailLanguage('fr', null)).toBe('da');
  });

  it('ignores an empty-string inviter language and defaults to Danish', () => {
    expect(resolveEmailLanguage('', null)).toBe('da');
  });

  it('falls through an invalid stored profile language to the valid inviter pick', () => {
    expect(resolveEmailLanguage('en', 'xx')).toBe('en');
  });
});
