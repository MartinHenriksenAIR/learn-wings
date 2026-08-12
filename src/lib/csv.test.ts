import { describe, it, expect } from 'vitest';
import { membersToCsv, membersCsvFilename } from './csv';
import type { OrgMembership, Profile } from './types';

type Member = OrgMembership & { profile?: Profile };

function member(overrides: {
  role?: OrgMembership['role'];
  status?: OrgMembership['status'];
  created_at?: string;
  profile?: Partial<Profile> | null;
} = {}): Member {
  const { profile, ...rest } = overrides;
  return {
    id: 'm1',
    org_id: 'o1',
    user_id: 'u1',
    role: 'learner',
    status: 'active',
    created_at: '2026-01-14T09:30:00.000Z',
    ...rest,
    profile:
      profile === null
        ? undefined
        : ({
            id: 'u1',
            full_name: 'Anna Berg',
            first_name: 'Anna',
            last_name: 'Berg',
            department: 'Engineering',
            email: 'anna@example.com',
            avatar_url: null,
            is_platform_admin: false,
            created_at: '2026-01-14T09:30:00.000Z',
            preferred_language: 'da',
            assessment_level: null,
            assessment_skipped_at: null,
            assessment_taken_at: null,
            ...profile,
          } as Profile),
  };
}

describe('membersToCsv', () => {
  it('emits the fixed English header row first', () => {
    const csv = membersToCsv([]);
    expect(csv).toBe('Name,Email,Department,Role,Status,Joined');
  });

  it('maps a member to name, email, department, raw role/status and ISO joined date', () => {
    const csv = membersToCsv([
      member({ role: 'org_admin', status: 'disabled' }),
    ]);
    const [, row] = csv.split('\r\n');
    expect(row).toBe('Anna Berg,anna@example.com,Engineering,org_admin,disabled,2026-01-14');
  });

  it('separates rows with CRLF', () => {
    const csv = membersToCsv([member(), member()]);
    expect(csv.split('\r\n')).toHaveLength(3); // header + 2 rows
  });

  it('renders empty cells for a member with no profile', () => {
    const csv = membersToCsv([member({ profile: null })]);
    const [, row] = csv.split('\r\n');
    expect(row).toBe(',,,learner,active,2026-01-14');
  });

  it('renders an empty cell for a null department or email', () => {
    const csv = membersToCsv([
      member({ profile: { department: null, email: null } }),
    ]);
    const [, row] = csv.split('\r\n');
    expect(row).toBe('Anna Berg,,,learner,active,2026-01-14');
  });

  it('quotes fields containing a comma (RFC-4180)', () => {
    const csv = membersToCsv([
      member({ profile: { full_name: 'Berg, Anna' } }),
    ]);
    const [, row] = csv.split('\r\n');
    expect(row.startsWith('"Berg, Anna",')).toBe(true);
  });

  it('quotes and doubles an embedded double-quote', () => {
    const csv = membersToCsv([
      member({ profile: { department: 'Sales "EMEA"' } }),
    ]);
    expect(csv).toContain('"Sales ""EMEA"""');
  });

  it('quotes a field containing a newline', () => {
    const csv = membersToCsv([
      member({ profile: { full_name: 'Line1\nLine2' } }),
    ]);
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('preserves æøå unescaped (they are not special)', () => {
    const csv = membersToCsv([
      member({ profile: { full_name: 'Bjørn Ærø', department: 'Måløv' } }),
    ]);
    expect(csv).toContain('Bjørn Ærø,anna@example.com,Måløv');
  });
});

describe('membersCsvFilename', () => {
  const date = new Date('2026-08-12T10:00:00.000Z');

  it('builds <slug>-members-<YYYY-MM-DD>.csv', () => {
    expect(membersCsvFilename('Acme Corp', date)).toBe('acme-corp-members-2026-08-12.csv');
  });

  it('transliterates Danish characters in the org slug', () => {
    expect(membersCsvFilename('Bjørn & Ærø ApS', date)).toBe('bjorn-aero-aps-members-2026-08-12.csv');
  });

  it('falls back to "organization" when the name is missing', () => {
    expect(membersCsvFilename(null, date)).toBe('organization-members-2026-08-12.csv');
    expect(membersCsvFilename('   ', date)).toBe('organization-members-2026-08-12.csv');
  });
});
