import type { OrgMembership, Profile } from './types';

type Member = OrgMembership & { profile?: Profile };

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const MEMBER_HEADERS = ['Name', 'Email', 'Department', 'Role', 'Status', 'Joined'];

export function membersToCsv(members: Member[]): string {
  const rows = members.map((m) => [
    m.profile?.full_name ?? '',
    m.profile?.email ?? '',
    m.profile?.department ?? '',
    m.role,
    m.status,
    (m.created_at ?? '').slice(0, 10),
  ]);
  return [MEMBER_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\r\n');
}

const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function membersCsvFilename(orgName: string | null | undefined, date: Date): string {
  const slug = slugify(orgName ?? '') || 'organization';
  return `${slug}-members-${date.toISOString().slice(0, 10)}.csv`;
}

const UTF8_BOM = String.fromCharCode(0xfeff);

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
