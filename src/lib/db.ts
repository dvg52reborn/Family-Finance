import Dexie, { type Table } from 'dexie';
import type { Expense, ExpenseCategory, AuditRecord, MonthlyBudget, IncomeEntry, Conversion, Setting } from '../types/finance';

/** Database for 0.8.0. Ids are no longer counted 1, 2, 3...: several devices create records at the same time, so every id must be unique across devices. */
export const DB_NAME = 'family-finance-manager-v7';

/** Bookkeeping for sync: what each record looked like the last time it was in step with the cloud. */
export type SyncEntry = { key: string; tbl: string; id: string; hash: string | null; pushedHash: string | null; ver: number };
export type MetaRow = { key: string; value: unknown };

export class FinanceDB extends Dexie {
  expenses!: Table<Expense, number>;
  categories!: Table<ExpenseCategory, number>;
  auditLog!: Table<AuditRecord, number>;
  budgets!: Table<MonthlyBudget, number>;
  income!: Table<IncomeEntry, number>;
  conversions!: Table<Conversion, number>;
  settings!: Table<Setting, string>;
  syncState!: Table<SyncEntry, string>;
  syncMeta!: Table<MetaRow, string>;
  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      expenses: 'id,date,categoryId,outsideBudget,recurring,recurringParentId',
      categories: 'id,name',
      auditLog: 'id,entity,entityId,at',
      budgets: 'id,month',
      income: 'id,date',
      conversions: 'id,date',
      settings: 'key',
      syncState: 'key',
      syncMeta: 'key',
    });
  }
}
export const db = new FinanceDB();

/* ---------- ids ---------- */
/** Random id below 2^53 (safe in JavaScript and in a Postgres bigint). Ids under 1000 are reserved for built-in categories. */
export function newId(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  const n = (a[0] & 0x1fffff) * 4294967296 + a[1];
  return n < 1000 ? n + 1000 : n;
}
/** Same text -> same id on every device (cyrb53). Used where two devices may create "the same" record at the same moment. */
export function hashId(s: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n < 1000 ? n + 1000 : n;
}
export const occurrenceId = (parentId: number, date: string) => hashId(`occurrence|${parentId}|${date}`);
export const overrunId = (month: string) => hashId(`overrun|${month}`);
export const budgetId = (month: string) => hashId(`budget|${month}`);

/** Built-in categories keep the same ids on every device, so a second device never creates a second "Food & groceries". */
export const DEFAULT_CATEGORIES = [
  { id: 1, name: 'Food & groceries', color: '#f59e0b' }, { id: 2, name: 'Transport', color: '#3b82f6' }, { id: 3, name: 'Utilities', color: '#8b5cf6' },
  { id: 4, name: 'Education', color: '#10b981' }, { id: 5, name: 'Health', color: '#ef4444' }, { id: 6, name: 'Other', color: '#64748b' },
];
export const OVERRUN_CATEGORY_ID = 7;

export async function seedCategories(database: FinanceDB = db) {
  if (await database.categories.count()) return;
  const createdAt = new Date().toISOString();
  await database.categories.bulkPut(DEFAULT_CATEGORIES.map((c) => ({ ...c, createdAt })));
}

export async function logAudit(rec: Omit<AuditRecord, 'id' | 'at' | 'summary'> & { summary?: string }, database: FinanceDB = db) {
  await database.auditLog.add({ id: newId(), summary: '', ...rec, at: new Date().toISOString() });
}
