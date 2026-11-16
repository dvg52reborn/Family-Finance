import { OVERRUN_CATEGORY_ID, db, logAudit, occurrenceId, overrunId, type FinanceDB } from './db';
import type { Allowance, AuditRecord, Conversion, Expense, Frequency, IncomeEntry } from '../types/finance';
import { allowanceFor, allowanceForMonth, amountAsOf, costAsOf, monthEnd, overrunDate, overrunIn, spentThrough } from './allowances';
import { convertLive, type LiveRates } from './liveRates';
import type { Lang, Translation } from './i18n';
import { actLabel, catLabel } from './i18n';

/* ---------- dates (local calendar, no timezone surprises) ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const thisMonth = () => today().slice(0, 7);

/** date + k periods, anchored on the original day (Jan 31 + 1 month = Feb 28/29, + 2 months = Mar 31). */
export function addPeriods(iso: string, freq: Frequency, k: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (freq === 'weekly') return toISO(new Date(y, m - 1, d + 7 * k));
  const months = freq === 'monthly' ? k : 12 * k;
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toISO(new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)));
}

/* ---------- formatting ---------- */
export const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GH');
/** A YYYY-MM-DD date written for people, e.g. 1 Nov 2026. */
export const fmtDate = (iso: string, lang: Lang) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short', year: 'numeric' }); };
export const CURRENCIES = ['GHS', 'XOF', 'USD', 'EUR', 'GBP', 'NGN', 'CAD'] as const;
export const money = (n: number, lang: Lang = 'en', currency = 'GHS') =>
  new Intl.NumberFormat(locale(lang), { style: 'currency', currency, maximumFractionDigits: currency === 'XOF' ? 0 : 2 }).format(n);
export const currencyName = (code: string, lang: Lang) => {
  try { return `${new Intl.DisplayNames([locale(lang)], { type: 'currency' }).of(code) ?? code} (${code})`; } catch { return code; }
};
export const monthLabel = (month: string, lang: Lang) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(locale(lang), { month: 'long', year: 'numeric' });
};

/* ---------- recurring expenses ---------- */
/**
 * Creates every occurrence of every recurring template that is due up to today.
 * Safe to call repeatedly (React StrictMode, page reloads): it runs in one transaction and skips dates already generated.
 */
export async function generateRecurring(upTo = today(), database: FinanceDB = db): Promise<number> {
  let created = 0;
  await database.transaction('rw', database.expenses, database.auditLog, async () => {
    const templates = (await database.expenses.toArray()).filter((e) => e.recurring && e.recurringFrequency && e.id);
    for (const tpl of templates) {
      const freq = tpl.recurringFrequency as Frequency;
      let count = tpl.generatedCount ?? 0;
      const existing = new Set((await database.expenses.where('recurringParentId').equals(tpl.id!).toArray()).map((e) => e.date));
      for (let guard = 0; guard < 1000; guard++) {
        const date = addPeriods(tpl.date, freq, count + 1);
        if (date > upTo) break;
        count++;
        if (existing.has(date)) continue;
        const now = new Date().toISOString();
        // Same template + same date = same id on every device, so two devices generating the same day never create duplicates.
        const id = occurrenceId(tpl.id!, date);
        await database.expenses.put({
          id, title: tpl.title, amount: tpl.amount, currency: 'GHS', categoryId: tpl.categoryId, date, notes: tpl.notes,
          recurring: false, recurringFrequency: '', recurringParentId: tpl.id, outsideBudget: tpl.outsideBudget, createdAt: now, updatedAt: now,
        });
        await logAudit({ entity: 'expense', entityId: id, action: 'generated', title: tpl.title }, database);
        created++;
      }
      if (count !== (tpl.generatedCount ?? 0)) await database.expenses.update(tpl.id!, { generatedCount: count });
    }
  });
  return created;
}

/* ---------- budgets ---------- */
export type BudgetState = 'none' | 'ok' | 'warn' | 'over';
export function budgetState(spent: number, budget: number): BudgetState {
  if (!budget) return 'none';
  const r = spent / budget;
  return r > 1 ? 'over' : r >= 0.8 ? 'warn' : 'ok';
}
export const sumExpenses = (list: Expense[], pred: (e: Expense) => boolean = () => true) =>
  list.filter(pred).reduce((s, e) => s + e.amount, 0);

/* ---------- display conversions: LIVE market rates only (the exchange table keeps the family's own rates) ---------- */
/** Income converted into `cur` at live market rates. null = rates unavailable for this pair right now. */
export const incomeIn = (i: IncomeEntry, cur: string, live: LiveRates) => convertLive(i.amount, i.currency, cur, live);

/* ---------- audit text ---------- */
const fieldKey: Record<string, keyof Translation> = {
  title: 'title', amount: 'amount', category: 'category', date: 'date', notes: 'notes',
  recurring: 'recurring', frequency: 'frequency', outsideBudget: 'outsideBudget', currency: 'currency',
  startDate: 'allowanceStart', endDate: 'allowanceEnd', rate: 'rate', source: 'source', fromAmount: 'exchangeFrom', toAmount: 'receivedAmount', fromCurrency: 'fromCurrency', toCurrency: 'toCurrency',
};
export function auditText(a: AuditRecord, t: Translation, lang: Lang): string {
  if (!a.title) return actLabel(a.summary, lang);
  const verb = { created: t.auditCreated, updated: t.auditUpdated, deleted: t.auditDeleted, generated: t.auditGenerated }[a.action];
  const what = { expense: t.auditExpense, income: t.auditIncome, category: t.auditCategory, conversion: t.auditConversion, allowance: t.auditAllowance }[a.entity];
  const base = `${verb} · ${what} “${a.title}”`;
  if (!a.changes?.length) return base;
  const show = (field: string, v: string) =>
    field === 'category' ? catLabel(v, lang) : field === 'recurring' || field === 'outsideBudget' ? (v === 'true' ? t.yes : t.no)
    : field === 'frequency' && v ? (t[v as Frequency] ?? v) : v || '—';
  const parts = a.changes.map((c) => `${t[fieldKey[c.field] ?? 'title']}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`);
  return `${base} (${parts.join('; ')})`;
}
export function diffFields(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(after).filter((k) => before[k] !== after[k]).map((field) => ({ field, from: before[field] ?? '', to: after[field] }));
}

/* ---------- CSV ---------- */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- months ---------- */
export const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return toISO(new Date(y, mo - 2, 1)).slice(0, 7); };
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; ) { out.push(m); const [y, mo] = m.split('-').map(Number); m = toISO(new Date(y, mo, 1)).slice(0, 7); }
  return out;
}

/* ---------- monthly split: in-budget vs out-of-budget (overrun moved out automatically) ---------- */
/**
 * What one calendar month looks like against the allowance(s). Expenses stay in the month they were made in; the allowance
 * shown is the newest one that overlaps the month, and `used` is what it has spent up to the end of that month.
 */
export function monthSplit(month: string, expenses: Expense[], allowances: Allowance[]) {
  const rows = expenses.filter((e) => e.date.startsWith(month) && !e.autoOverrun);
  const raw = sumExpenses(rows, (e) => !e.outsideBudget);          // everything entered as "within budget"
  const outsideRows = sumExpenses(rows, (e) => e.outsideBudget);   // entered as "outside budget"
  const mEnd = monthEnd(month);
  const allowance = allowanceForMonth(month, allowances) ?? null;
  const overrun = cents(allowances.reduce((s, a) => s + overrunIn(a, month, expenses), 0));   // spending beyond the allowance(s) this month
  const budget = allowance ? amountAsOf(allowance, allowance.endDate && allowance.endDate < mEnd ? allowance.endDate : mEnd) : 0;
  const used = allowance ? spentThrough(allowance, mEnd, expenses) : raw;
  const inside = raw - overrun;                                    // in-budget total, without the excess
  return { budget, allowance, used, raw, inside, outsideRows, overrun, outside: outsideRows + overrun, total: raw + outsideRows };
}

/* ---------- family funds ---------- */
export type FundsInput = { openings: Record<string, number>; incomes: IncomeEntry[]; conversions: Conversion[]; expenses: Expense[]; allowances: Allowance[] };
/**
 * Money the family owns per currency at the END of `month`:
 *   opening balance + income - exchanged out + exchanged in - GHS spending.
 * GHS spending = out-of-budget expenses + expenses made with no allowance running + what the allowances have taken out of funds.
 * An open allowance holds its whole amount (or its spending, if that is more); a closed one holds only what was spent, so the
 * unspent part is back in funds. Amount changes count from the day they were made, so past months keep their figures.
 */
export function fundsAsOf(month: string, d: FundsInput): Record<string, number> {
  const f: Record<string, number> = {};
  for (const c of CURRENCIES) f[c] = d.openings[c] ?? 0;
  const add = (c: string, v: number) => { f[c] = (f[c] ?? 0) + v; };
  d.incomes.filter((i) => i.date.slice(0, 7) <= month).forEach((i) => add(i.currency, i.amount));
  d.conversions.filter((c) => c.date.slice(0, 7) <= month).forEach((c) => { add(c.fromCurrency, -c.fromAmount); add(c.toCurrency, c.toAmount); });
  const real = d.expenses.filter((e) => !e.autoOverrun);
  const direct = real.filter((e) => e.date.slice(0, 7) <= month && (e.outsideBudget || !allowanceFor(e.date, d.allowances))).reduce((s, e) => s + e.amount, 0);
  const held = d.allowances.reduce((s, a) => s + costAsOf(a, monthEnd(month), real), 0);
  add('GHS', -(direct + held));
  for (const c of Object.keys(f)) f[c] = Math.round(f[c] * 100) / 100;
  return f;
}
/** Funds summed in one chosen currency at live market rates; currencies that cannot be converted right now are reported separately. */
export function fundsIn(funds: Record<string, number>, cur: string, live: LiveRates) {
  let total = 0; const missing: string[] = [];
  for (const [c, v] of Object.entries(funds)) {
    if (!v) continue;
    const x = convertLive(v, c, cur, live);
    if (x === null) missing.push(c); else total += x;
  }
  return { total, missing };
}

/* ---------- automatic budget-overrun entry (one per allowance and month, kept in sync) ---------- */
export const OVERRUN_CATEGORY = 'Budget overrun';
const cents = (n: number) => Math.round(n * 100) / 100;
export async function syncOverruns(database: FinanceDB = db): Promise<void> {
  await database.transaction('rw', database.expenses, database.categories, database.allowances, async () => {
    const [all, allowances, cats] = await Promise.all([database.expenses.toArray(), database.allowances.toArray(), database.categories.toArray()]);
    const real = all.filter((e) => !e.autoOverrun), autos = all.filter((e) => e.autoOverrun);
    const catId = cats.find((c) => c.name === OVERRUN_CATEGORY)?.id ?? OVERRUN_CATEGORY_ID;
    const catExists = cats.some((c) => c.id === catId);
    const latest = real.reduce((m, e) => (e.date.slice(0, 7) > m ? e.date.slice(0, 7) : m), thisMonth());
    // what should exist: one entry per allowance and month in which spending went beyond the amount
    const wanted = new Map<string, { over: number; date: string }>();
    for (const a of allowances) {
      for (const m of monthsBetween(a.startDate.slice(0, 7), a.endDate ? a.endDate.slice(0, 7) : latest)) {
        const over = overrunIn(a, m, real);
        if (over > 0) wanted.set(`${a.startDate}|${m}`, { over, date: overrunDate(a, m, real) });
      }
    }
    const now = new Date().toISOString();
    for (const [key, { over, date }] of wanted) {
      const [keep, ...dupes] = autos.filter((e) => e.autoOverrun === key);
      for (const d of dupes) await database.expenses.delete(d.id!);
      if (!keep) {
        if (!catExists) await database.categories.put({ id: catId, name: OVERRUN_CATEGORY, color: '#d9453a', createdAt: now });
        await database.expenses.put({ id: overrunId(key), title: OVERRUN_CATEGORY, amount: over, currency: 'GHS', categoryId: catId, date, notes: '', recurring: false, recurringFrequency: '', outsideBudget: true, autoOverrun: key, createdAt: now, updatedAt: now });
      } else if (keep.amount !== over || keep.date !== date) {
        await database.expenses.update(keep.id!, { amount: over, date, updatedAt: now });
      }
    }
    // entries that are no longer owed, and old per-month entries from before allowances
    for (const e of autos) if (!wanted.has(e.autoOverrun!)) await database.expenses.delete(e.id!);
  });
}
