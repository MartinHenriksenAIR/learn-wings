import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }));
vi.mock('./db', () => ({ queryOne: mockQueryOne }));

import {
  isMemberLanguage,
  resolveProvisioningLanguage,
  orgDefaultLanguageForNewProfile,
  orgDefaultLanguageForInvitation,
} from './member-language';

describe('member-language', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('resolveProvisioningLanguage', () => {
    it('prefers the org default over the browser-derived language', () => {
      expect(resolveProvisioningLanguage('da', 'en')).toBe('da');
    });

    it('falls back to the browser-derived language when the org has no default', () => {
      expect(resolveProvisioningLanguage(null, 'da')).toBe('da');
    });

    it('ignores an unsupported org default', () => {
      expect(resolveProvisioningLanguage('de', 'da')).toBe('da');
    });

    it('falls back to English when neither is usable', () => {
      expect(resolveProvisioningLanguage(null, 'fr')).toBe('en');
      expect(resolveProvisioningLanguage(null, undefined)).toBe('en');
    });
  });

  describe('isMemberLanguage', () => {
    it('accepts only en and da', () => {
      expect(isMemberLanguage('en')).toBe(true);
      expect(isMemberLanguage('da')).toBe(true);
      expect(isMemberLanguage('de')).toBe(false);
      expect(isMemberLanguage(null)).toBe(false);
      expect(isMemberLanguage(5)).toBe(false);
    });
  });

  describe('orgDefaultLanguageForNewProfile', () => {
    it('takes the pending invitation org and never probes the tenant binding', async () => {
      mockQueryOne.mockResolvedValueOnce({ default_member_language: 'da' });
      const result = await orgDefaultLanguageForNewProfile('User@Contoso.com ', 'tid-1');
      expect(result).toBe('da');
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      expect(mockQueryOne.mock.calls[0][0]).toContain('FROM invitations i');
      expect(mockQueryOne.mock.calls[0][1]).toEqual(['user@contoso.com']);
    });

    it('does not fall through to the tenant binding when the invitation org has no default', async () => {
      mockQueryOne.mockResolvedValueOnce({ default_member_language: null });
      expect(await orgDefaultLanguageForNewProfile('u@x.com', 'tid-1')).toBeNull();
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('falls back to the bound tenant org when there is no pending invitation', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ default_member_language: 'en' });
      expect(await orgDefaultLanguageForNewProfile('u@x.com', 'tid-1')).toBe('en');
      expect(mockQueryOne.mock.calls[1][0]).toContain('allow_self_registration = true');
      expect(mockQueryOne.mock.calls[1][1]).toEqual(['tid-1']);
    });

    it('skips the invitation probe for a blank email claim', async () => {
      mockQueryOne.mockResolvedValueOnce({ default_member_language: 'da' });
      expect(await orgDefaultLanguageForNewProfile('   ', 'tid-1')).toBe('da');
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      expect(mockQueryOne.mock.calls[0][0]).toContain('FROM organizations');
    });

    it('returns null with no tenant to probe', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await orgDefaultLanguageForNewProfile('u@x.com', '')).toBeNull();
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('returns null when the tenant is bound to no org', async () => {
      mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      expect(await orgDefaultLanguageForNewProfile('u@x.com', 'tid-1')).toBeNull();
    });
  });

  describe('orgDefaultLanguageForInvitation', () => {
    it('reads the default off the invitation org', async () => {
      mockQueryOne.mockResolvedValueOnce({ default_member_language: 'da' });
      expect(await orgDefaultLanguageForInvitation('link-1')).toBe('da');
      expect(mockQueryOne.mock.calls[0][1]).toEqual(['link-1']);
    });

    it('returns null for an unknown, expired or already-accepted link', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await orgDefaultLanguageForInvitation('link-1')).toBeNull();
    });
  });
});
