import { CURRENCIES } from './finance';

/** Live market rates, all quoted against USD. Used ONLY for display conversions (never for the exchange table). */
export type LiveRates = { rates: Record<string, number>; fetchedAt: string } | null;
const KEY = 'ffm-live-rates';

export function loadCachedLive(): LiveRates {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.rates && typeof v.fetchedAt === 'string' ? v : null;
  } catch { return null; }
}

export async function fetchLiveRates(): Promise<NonNullable<LiveRates>> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  if (!res.ok) throw new Error('rates unavailable');
  const json = await res.json();
  const rates: Record<string, number> = { USD: 1 };
  for (const c of CURRENCIES) { const r = Number(json?.rates?.[c]); if (r > 0) rates[c] = r; }
  if (Object.keys(rates).length < 3) throw new Error('rates incomplete');
  const live = { rates, fetchedAt: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(live)); } catch { /* storage full or blocked: keep in memory only */ }
  return live;
}

/** from -> to through USD. null when the rates (or one of the currencies) are not available. */
export function liveRate(from: string, to: string, live: LiveRates): number | null {
  if (from === to) return 1;
  const a = live?.rates[from], b = live?.rates[to];
  return a && b ? b / a : null;
}
export const convertLive = (amount: number, from: string, to: string, live: LiveRates) => {
  const r = liveRate(from, to, live);
  return r === null ? null : amount * r;
};
