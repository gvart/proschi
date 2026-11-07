/** Formatting for the admin panel: times are Unix seconds, shown in the browser's time zone. */

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function formatDateTime(seconds: number | null | undefined): string {
  return seconds ? dateTime.format(new Date(seconds * 1000)) : '—';
}

export function formatDate(seconds: number | null | undefined): string {
  return seconds ? date.format(new Date(seconds * 1000)) : '—';
}

/** "3 min ago", "5 h ago", "2 days ago"; `now` in seconds. */
export function formatAgo(seconds: number | null | undefined, now = Math.floor(Date.now() / 1000)): string {
  if (!seconds) return 'never';
  const d = Math.max(0, now - seconds);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)} h ago`;
  const days = Math.floor(d / 86_400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** A UTC day (YYYY-MM-DD) relative to today: "today", "yesterday", "4 days ago". */
export function formatDayAgo(day: string | null, today = new Date().toISOString().slice(0, 10)): string {
  if (!day) return 'never';
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export const formatNumber = (n: number): string => n.toLocaleString();

/** A machine name as a label: `sign_in_failed` → "Sign in failed". */
export function humanize(name: string): string {
  const text = name.replace(/[_.]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** US dollars, to the cent; below a cent with more digits (a model call costs fractions of one). */
export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—';
  if (usd !== 0 && Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 0.25 → "25%". */
export const formatPercent = (share: number | null | undefined): string => (share === null || share === undefined ? '—' : `${Math.round(share * 1000) / 10}%`);

/** 1234567 → "1.2M": token counts. */
export const formatCompact = (n: number): string => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
