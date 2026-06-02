// lib/date.ts
export function parseKstDateEndOfDay(value?: string | null): number | null {
  if (!value) return null;

  const m = String(value).match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;

  const [, y, mo, d] = m;
  const iso = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T23:59:59.999+09:00`;
  const t = Date.parse(iso);

  return Number.isNaN(t) ? null : t;
}

export function formatKstYmd(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));

  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';

  return `${y}.${m}.${d}`;
}
