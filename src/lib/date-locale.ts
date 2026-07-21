import {
  format as dateFnsFormat,
  formatDistanceToNow as dateFnsFormatDistanceToNow,
  type Locale,
} from 'date-fns';
import { da } from 'date-fns/locale';

/**
 * Map an i18next language code to a date-fns `Locale`.
 *
 * date-fns defaults to English (`enUS`) when no locale is passed, so we only
 * need to return an explicit locale for the languages we actually translate.
 * Anything other than Danish → `undefined` → date-fns' built-in English.
 *
 * Pass `i18n.language` (read at render time) so output stays reactive on a
 * language switch — never a module-level snapshot.
 */
export function getDateFnsLocale(language: string | undefined): Locale | undefined {
  // Match "da" and any region variant (e.g. "da-DK").
  return language?.toLowerCase().startsWith('da') ? da : undefined;
}

/** `date-fns` `format`, localized from an i18next language code. */
export function formatDate(
  date: Date | number,
  formatStr: string,
  language: string | undefined,
): string {
  return dateFnsFormat(date, formatStr, { locale: getDateFnsLocale(language) });
}

/**
 * `date-fns` `formatDistanceToNow` with `addSuffix: true`, localized from an
 * i18next language code (e.g. "for cirka 2 timer siden" in Danish).
 */
export function formatDistanceToNowLocalized(
  date: Date | number,
  language: string | undefined,
): string {
  return dateFnsFormatDistanceToNow(date, {
    addSuffix: true,
    locale: getDateFnsLocale(language),
  });
}
