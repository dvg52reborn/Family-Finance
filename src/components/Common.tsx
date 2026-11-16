import type { Translation, Lang } from '../lib/i18n';
import { CURRENCIES, budgetState, currencyName, fmtDate, money, type BudgetState } from '../lib/finance';
import type { Allowance } from '../types/finance';
import { liveRate, type LiveRates } from '../lib/liveRates';

export const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((a, [k, v]) => a.replace(`{${k}}`, String(v)), s);

/** "From 1 Nov 2026" or "1 Nov 2026 – 30 Nov 2026" (the end date is shown only if it is set). */
export function periodLabel(a: Allowance, t: Translation, lang: Lang) {
  return a.endDate ? fill(t.alwFromTo, { start: fmtDate(a.startDate, lang), end: fmtDate(a.endDate, lang) }) : fill(t.alwFromDate, { start: fmtDate(a.startDate, lang) });
}

export function MonthPicker({ t, month, onChange }: { t: Translation; month: string; onChange: (m: string) => void }) {
  return <label className="month-picker">{t.month}<input type="month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} /></label>;
}

export function ProgressBar({ spent, budget }: { spent: number; budget: number }) {
  const state = budgetState(spent, budget);
  return <div className={`progress ${state}`}><i style={{ width: `${budget ? Math.min(100, (spent / budget) * 100) : 0}%` }} /></div>;
}

export function StateBadge({ t, state }: { t: Translation; state: BudgetState }) {
  if (state === 'none') return null;
  return <span className={`state-badge ${state}`}>{{ ok: t.budgetOk, warn: t.budgetWarn, over: t.budgetOver }[state]}</span>;
}

/** Warning shown when spending approaches or passes the monthly budget. */
export function BudgetAlert({ t, lang, spent, budget }: { t: Translation; lang: Lang; spent: number; budget: number }) {
  const state = budgetState(spent, budget);
  if (state !== 'warn' && state !== 'over') return null;
  const text = state === 'over' ? fill(t.overBudgetBy, { amount: money(spent - budget, lang) }) : fill(t.nearBudget, { percent: Math.round((spent / budget) * 100) });
  return <div className={`banner ${state}`} role="alert">{state === 'over' ? '⚠ ' : '● '}{text}</div>;
}

/** One card per currency the family holds (GHS and XOF always shown), in that currency only. Negative balances in red. */
export function BalanceCards({ lang, funds }: { lang: Lang; funds: Record<string, number> }) {
  const shown = CURRENCIES.filter((c) => (funds[c] ?? 0) !== 0 || c === 'GHS' || c === 'XOF');
  return (
    <div className="balances">
      {shown.map((c) => (
        <div className="balance" key={c}>
          <small>{currencyName(c, lang)}</small>
          <strong className={(funds[c] ?? 0) < 0 ? 'neg' : ''}>{money(funds[c] ?? 0, lang, c)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Small selector that lives inside the card whose figure it converts. Every card remembers its own choice. */
export function CurrencySelect({ t, value, onChange }: { t: Translation; value: string; onChange: (c: string) => void }) {
  return (
    <select className="cur-select" aria-label={t.showIn} title={t.showIn} value={value} onChange={(e) => onChange(e.target.value)}>
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

/** Currency to use for a page-wide report: the chosen one, or GHS while live rates for it are unavailable. */
export const reportCurrency = (chosen: string, live: LiveRates) => (liveRate('GHS', chosen, live) !== null ? chosen : 'GHS');

export function LiveRatesNotice({ t, live, onRetry }: { t: Translation; live: LiveRates; onRetry: () => void }) {
  if (live) return null;
  return <div className="banner warn" role="status">⚠ {t.liveRatesUnavailable}<button className="retry" onClick={onRetry}>{t.retry}</button></div>;
}

export function LiveStamp({ t, lang, live }: { t: Translation; lang: Lang; live: LiveRates }) {
  if (!live) return null;
  return <p className="hint">{fill(t.liveRatesUpdated, { time: new Date(live.fetchedAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GH') })}</p>;
}
