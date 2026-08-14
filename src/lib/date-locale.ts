import {
  format as dateFnsFormat,
  formatDistanceToNow as dateFnsFormatDistanceToNow,
  type Locale,
} from 'date-fns';
import { da } from 'date-fns/locale';

export function getDateFnsLocale(language: string | undefined): Locale | undefined {
  return language?.toLowerCase().startsWith('da') ? da : undefined;
}

export function formatDate(
  date: Date | number,
  formatStr: string,
  language: string | undefined,
): string {
  return dateFnsFormat(date, formatStr, { locale: getDateFnsLocale(language) });
}

export function formatDistanceToNowLocalized(
  date: Date | number,
  language: string | undefined,
): string {
  return dateFnsFormatDistanceToNow(date, {
    addSuffix: true,
    locale: getDateFnsLocale(language),
  });
}
