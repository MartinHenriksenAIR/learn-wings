import type { OrgMembership, Profile } from './types';

type Member = OrgMembership & { profile?: Profile };

/**
 * RFC-4180 field escaping: wrap the value in double quotes when it contains a
 * comma, double-quote, CR or LF, doubling any embedded double-quotes. Plain
 * values (including æøå — not special) pass through untouched.
 */
function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const MEMBER_HEADERS = ['Name', 'Email', 'Department', 'Role', 'Status', 'Joined'];

/**
 * Serialise an org's member roster to CSV text (no BOM — {@link downloadCsv}
 * adds that). Columns: Name, Email, Department, Role, Status, Joined. Role and
 * status keep their raw stable values (`org_admin`/`learner`, `active`/…) and
 * Joined is the membership's ISO `YYYY-MM-DD` join date, so the file stays
 * locale-independent and sortable.
 */
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

// Unicode combining diacritical marks block, U+0300–U+036F. After NFD
// decomposition (å → a + combining ring) these carry the accent; stripping them
// leaves the base ASCII letter.
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
);

/** Lowercase, Danish-transliterated, hyphenated slug for a filename segment. */
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

/** `<org-slug>-members-<YYYY-MM-DD>.csv`, falling back to `organization`. */
export function membersCsvFilename(orgName: string | null | undefined, date: Date): string {
  const slug = slugify(orgName ?? '') || 'organization';
  return `${slug}-members-${date.toISOString().slice(0, 10)}.csv`;
}

// Byte-order mark (U+FEFF): prepended to the CSV so Excel detects UTF-8 and
// renders æøå correctly rather than mojibake.
const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * Trigger a browser download of CSV text (with a UTF-8 BOM and
 * `text/csv;charset=utf-8`).
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
