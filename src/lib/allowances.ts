import type { Allowance, Expense } from '../types/finance';
import { allowanceId } from './db';

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
