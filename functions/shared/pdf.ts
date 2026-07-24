/**
 * Escape a string for safe inclusion inside a PDF content-stream string
 * literal `(...)`. In a content stream, '(' ')' and '\' are delimiters: an
 * unescaped one closes the literal early, after which the remaining bytes are
 * parsed as PDF operators — so an attacker-controlled value (e.g. a profile
 * `department`) could inject drawing operators and spoof or corrupt the
 * document (see #232 / generate-compliance-report).
 *
 * Backslash is escaped FIRST so the backslashes added for the parens are not
 * themselves doubled. Every dynamic value written into a `(...) Tj` MUST pass
 * through here. Shared source of truth for all hand-rolled PDF endpoints
 * (generate-certificate, generate-compliance-report).
 */
export function pdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
