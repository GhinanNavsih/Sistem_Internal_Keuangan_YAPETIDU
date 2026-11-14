import { format, isValid, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';

/** Format a date-only value without shifting it between time zones. */
export function formatLetterDate(value: string): string {
  if (!value) return '';
  const date = parseISO(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(date)
    ? format(date, 'd MMMM yyyy', { locale: id })
    : value;
}
