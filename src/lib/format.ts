const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const ils = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' });
const ils0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });

/** "$1,234.56" (or "$1,235" with `whole`). */
export function fmtUsd(n: number, whole = false): string {
  return (whole ? usd0 : usd).format(roundMoney(n, whole));
}

/** "₪1,234.56" (or "₪1,235" with `whole`). */
export function fmtIls(n: number, whole = false): string {
  return (whole ? ils0 : ils).format(roundMoney(n, whole));
}

/** True when an amount of money rounds to 0 (e.g. −0.0000001 left by floating point). */
export function isZeroMoney(n: number): boolean {
  return Math.abs(n) < 0.005;
}

/** Up to 4 decimals (or `decimals`), trailing zeros trimmed: "12", "0.3333", "1,250.5". */
export function fmtShares(n: number, decimals = 4): string {
  return fixNegZero(n).toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/** An order's quantity, exactly as planned and recorded (fractional orders go to 6 decimals). */
export function fmtOrderShares(n: number): string {
  return fmtShares(n, 6);
}

/** "12.3%". */
export function fmtPercent(n: number, digits = 1): string {
  return `${fixNegZero(n).toFixed(digits)}%`;
}

/** Percentage-point difference with sign: "+1.2 pp", "−0.4 pp", "0.0 pp". */
export function fmtPp(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  if (r === 0) return `${(0).toFixed(digits)} pp`;
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)} pp`;
}

/** USD/ILS rate: "3.6512". */
export function fmtRate(n: number): string {
  return n.toFixed(4);
}

/** Local short date and time. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Local short date. */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function fmtAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * A ticker the app accepts when typed: letters, digits and . - = ^ (e.g. VOO, BRK.B, MXWO.L), up to
 * 20 characters like saved and imported data, so anything that was imported can still be saved.
 */
export function isTicker(s: string): boolean {
  return /^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$/.test(s);
}

/** Trim and upper-case a ticker symbol. */
export function normalizeTicker(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Parse a number typed by the user. Accepts "1,234.5", " 12 ", "1_000". Returns null for empty or
 * invalid input.
 */
export function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[,_\s₪$]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Round to what will be displayed, so tiny negatives don't show as "−₪0.00". */
function roundMoney(n: number, whole: boolean): number {
  const f = whole ? 1 : 100;
  return fixNegZero(Math.round(n * f) / f);
}

function fixNegZero(n: number): number {
  return Object.is(n, -0) || Math.abs(n) < 1e-9 ? 0 : n;
}
