export const RENEWAL_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

function dateOnly(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function parseAnyDate(value: string): Date | null {
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(text);
  if (iso) return dateOnly(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const regional = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})\.?$/.exec(text);
  if (regional) return dateOnly(Number(regional[4]), Number(regional[3]), Number(regional[1]));

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial <= 40000) return null;
    const excel = new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS);
    return dateOnly(excel.getUTCFullYear(), excel.getUTCMonth() + 1, excel.getUTCDate());
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

export function getDaysUntilExpiration(value: string, today: Date): number {
  const date = parseAnyDate(value);
  return date ? dayNumber(date) - dayNumber(today) : Infinity;
}

export function isExpiringSoon(days: number): boolean {
  return days >= 0 && days <= RENEWAL_WINDOW_DAYS;
}
