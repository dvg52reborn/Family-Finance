import type { Allowance, Expense } from '../types/finance';
import { allowanceId, db, type FinanceDB } from './db';

/*
 * Allowance rules (spending money taken from the GHS balance for a period). Pure functions: no database, no screens.
 *  - At most one open allowance (endDate '') at a time; starting a new one closes the previous one the day before.
 *  - An expense counts against the allowance whose period contains its date. In-budget only: out-of-budget expenses and
 *    automatic overrun entries do not count.
 *  - Closing returns the unspent part to funds; overspend becomes a "Budget overrun" expense dated on the end date.
 *  - Lowering the amount below what is already spent is refused.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const cents = (n: number) => Math.round(n * 100) / 100;

/** Date arithmetic on YYYY-MM-DD in the local calendar. */
export function addDays(iso: string, k: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + k);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

type Period = Pick<Allowance, 'startDate' | 'endDate'>;
/** True if the date falls inside the allowance's period (an open allowance has no end). */
export const covers = (a: Period, date: string) => a.startDate <= date && (!a.endDate || date <= a.endDate);
/** The allowance a date belongs to, if any. */
export const allowanceFor = (date: string, list: Allowance[]) => list.find((a) => covers(a, date));

/** What has been spent from an allowance: in-budget expenses dated inside its period. */
export function spentOn(a: Period, expenses: Expense[]): number {
  return cents(expenses.filter((e) => !e.autoOverrun && !e.outsideBudget && covers(a, e.date)).reduce((s, e) => s + e.amount, 0));
}
/** Amount left; negative when the allowance has been overspent. */
export const amountLeft = (a: Allowance, expenses: Expense[]) => cents(a.amount - spentOn(a, expenses));

/** An amount change is refused if it is not positive or would go below what is already spent. */
export function checkNewAmount(a: Allowance, amount: number, expenses: Expense[]): 'ok' | 'invalid' | 'below_spent' {
  if (!(amount > 0)) return 'invalid';
  return amount < spentOn(a, expenses) ? 'below_spent' : 'ok';
}

/** Result of ending an allowance on a given date. */
export type Closing = { endDate: string; spent: number; returnToFunds: number; overrun: number };
export function closeAllowance(a: Allowance, endDate: string, expenses: Expense[]): Closing {
  const spent = spentOn({ startDate: a.startDate, endDate }, expenses);
  return { endDate, spent, returnToFunds: cents(Math.max(0, a.amount - spent)), overrun: cents(Math.max(0, spent - a.amount)) };
}

export type NewAllowanceInput = { startDate: string; endDate?: string; amount: number; note?: string };
export type NewAllowancePlan =
  | { ok: true; closed: Allowance | null; closing: Closing | null; create: Allowance }
  | { ok: false; reason: 'invalid' | 'overlap' };

/**
 * Plans taking a new allowance. The open allowance (if any) is closed the day before the new start.
 * Refused if the amount or dates are not valid, or if the new period would overlap or come before an existing one.
 */
export function planNewAllowance(list: Allowance[], input: NewAllowanceInput, expenses: Expense[], now: string): NewAllowancePlan {
  const { startDate, endDate = '', amount } = input;
  if (!startDate || !(amount > 0) || (endDate && endDate < startDate)) return { ok: false, reason: 'invalid' };
  if (list.some((a) => a.startDate >= startDate || (a.endDate && a.endDate >= startDate))) return { ok: false, reason: 'overlap' };
  const open = list.find((a) => !a.endDate) ?? null;
  const closing = open ? closeAllowance(open, addDays(startDate, -1), expenses) : null;
  const closed = open ? { ...open, endDate: closing!.endDate, updatedAt: now } : null;
  const create: Allowance = { id: allowanceId(startDate), startDate, endDate, amount: cents(amount), note: input.note ?? '', createdAt: now, updatedAt: now };
  return { ok: true, closed, closing, create };
}

/** Automatic renewal settings (kept in Settings). */
export type RenewalRule = { enabled: boolean; useDefault: boolean; defaultAmount: number };

/**
 * When the latest allowance has ended and nothing new was added, returns the renewal to take: it starts the day after the
 * end and is open-ended. Amount = the previous amount, or the default amount if the rule says so. Null if no renewal applies.
 */
export function renewalFor(list: Allowance[], rule: RenewalRule, today: string, now: string): Allowance | null {
  if (!rule.enabled || !list.length) return null;
  const latest = list.reduce((x, y) => (y.startDate > x.startDate ? y : x));
  if (!latest.endDate || latest.endDate >= today) return null;
  const amount = rule.useDefault ? rule.defaultAmount : latest.amount;
  if (!(amount > 0)) return null;
  const startDate = addDays(latest.endDate, 1);
  return { id: allowanceId(startDate), startDate, endDate: '', amount: cents(amount), note: '', createdAt: now, updatedAt: now };
}

/* ---------- frozen history: the amount an allowance had on a given day ---------- */
const sumDeltas = (a: Allowance, upTo?: string) => (a.adjustments ?? []).filter((x) => upTo === undefined || x.date <= upTo).reduce((s, x) => s + x.delta, 0);
/** The amount the allowance was taken with, before any later change. */
export const startAmount = (a: Allowance) => cents(a.amount - sumDeltas(a));
/** The amount in force on `date` (0 before the allowance starts). Later changes do not rewrite earlier days. */
export const amountAsOf = (a: Allowance, date: string) => (date < a.startDate ? 0 : cents(startAmount(a) + sumDeltas(a, date)));

/** Records a new current amount. The change is dated `date` (never before the start), so earlier days keep their figures. */
export function changeAmount(a: Allowance, amount: number, date: string, now: string): Allowance {
  const delta = cents(amount - a.amount);
  if (delta === 0) return a;
  const at = date < a.startDate ? a.startDate : date;
  return { ...a, amount: cents(amount), adjustments: [...(a.adjustments ?? []), { date: at, delta }], updatedAt: now };
}

export const monthStart = (month: string) => `${month}-01`;
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`, -1);
}

/** Spent on the allowance up to and including `date` (never beyond its own end). */
export function spentThrough(a: Allowance, date: string, expenses: Expense[]): number {
  if (date < a.startDate) return 0;
  return spentOn({ startDate: a.startDate, endDate: a.endDate && a.endDate < date ? a.endDate : date }, expenses);
}
/** What the allowance has taken out of the family funds by the end of `date`:
 *  closed -> only what was spent (the rest is back in funds); still open -> the whole amount, or the spending if that is more. */
export function costAsOf(a: Allowance, date: string, expenses: Expense[]): number {
  if (date < a.startDate) return 0;
  const spent = spentThrough(a, date, expenses);
  return a.endDate && a.endDate <= date ? spent : Math.max(amountAsOf(a, date), spent);
}
/** Spending beyond the amount in force on `date`. */
export const overAsOf = (a: Allowance, date: string, expenses: Expense[]) =>
  date < a.startDate ? 0 : cents(Math.max(0, spentThrough(a, date, expenses) - amountAsOf(a, date)));
/** The part of the overspend that fell in `month` (it becomes that month's automatic "Budget overrun" expense). */
export function overrunIn(a: Allowance, month: string, expenses: Expense[]): number {
  const from = monthStart(month), to = monthEnd(month);
  if (a.startDate > to || (a.endDate && a.endDate < from)) return 0;
  return cents(Math.max(0, overAsOf(a, to, expenses) - overAsOf(a, addDays(from, -1), expenses)));
}
/** The day in `month` on which the overspend first grew. */
export function overrunDate(a: Allowance, month: string, expenses: Expense[]): string {
  const base = overAsOf(a, addDays(monthStart(month), -1), expenses);
  const days = [...new Set(expenses.filter((e) => !e.autoOverrun && !e.outsideBudget && e.date.startsWith(month) && covers(a, e.date)).map((e) => e.date))].sort();
  return days.find((d) => overAsOf(a, d, expenses) > base) ?? monthEnd(month);
}
/** The allowance to show for a month: the newest one that overlaps it. */
export function allowanceForMonth(month: string, list: Allowance[]): Allowance | undefined {
  const from = monthStart(month), to = monthEnd(month);
  return list.filter((a) => a.startDate <= to && (!a.endDate || a.endDate >= from)).sort((x, y) => y.startDate.localeCompare(x.startDate))[0];
}

/** An end date is refused if it is before the start, or reaches into a later allowance (an empty date reopens it, only if nothing follows). */
export function checkEndDate(list: Allowance[], a: Allowance, endDate: string): 'ok' | 'before_start' | 'overlap' {
  if (endDate && endDate < a.startDate) return 'before_start';
  return list.some((o) => o.id !== a.id && o.startDate > a.startDate && (!endDate || o.startDate <= endDate)) ? 'overlap' : 'ok';
}

/* ---------- from the old monthly budgets ---------- */
/** Each old monthly budget becomes an allowance from the 1st to the last day of that month. */
export function allowancesFromBudgets(budgets: { month: string; amount: number }[], now: string): Allowance[] {
  const byMonth = new Map<string, number>();
  for (const b of budgets) if (b.amount > 0) byMonth.set(b.month, b.amount);
  return [...byMonth.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([month, amount]) => ({
    id: allowanceId(monthStart(month)), startDate: monthStart(month), endDate: monthEnd(month), amount: cents(amount), note: '', createdAt: now, updatedAt: now,
  }));
}
export const MIGRATED_KEY = 'allowancesMigrated';
/** Runs once per device: copies the old monthly budgets into allowances (same ids on every device, so nothing doubles). The old budgets stay untouched. */
export async function migrateBudgets(database: FinanceDB = db): Promise<number> {
  return database.transaction('rw', database.budgets, database.allowances, database.settings, async () => {
    if (await database.settings.get(MIGRATED_KEY)) return 0;
    let n = 0;
    for (const r of allowancesFromBudgets(await database.budgets.toArray(), new Date().toISOString())) {
      if (!(await database.allowances.get(r.id!))) { await database.allowances.put(r); n++; }
    }
    await database.settings.put({ key: MIGRATED_KEY, value: true });
    return n;
  });
}

/* ---------- automatic renewal ---------- */
export const RENEWAL_KEY = 'allowanceRenewal';
export const DEFAULT_RENEWAL: RenewalRule = { enabled: true, useDefault: false, defaultAmount: 0 };
export const readRenewal = (value: unknown): RenewalRule => ({ ...DEFAULT_RENEWAL, ...(value && typeof value === 'object' ? (value as Partial<RenewalRule>) : {}) });
/** Takes the automatic renewal if one is due today. Returns it, or null when nothing was due. */
export async function runRenewal(todayIso: string, database: FinanceDB = db): Promise<Allowance | null> {
  return database.transaction('rw', database.allowances, database.settings, async () => {
    const rule = readRenewal((await database.settings.get(RENEWAL_KEY))?.value);
    const next = renewalFor(await database.allowances.toArray(), rule, todayIso, new Date().toISOString());
    if (!next || (await database.allowances.get(next.id!))) return null;
    await database.allowances.put(next);
    return next;
  });
}
