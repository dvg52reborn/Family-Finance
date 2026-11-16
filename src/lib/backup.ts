import { DEFAULT_CATEGORIES, OVERRUN_CATEGORY_ID, budgetId, db, newId, occurrenceId, overrunId, type FinanceDB } from './db';

export const BACKUP_FORMAT = 7;
export const TABLES = ['expenses', 'categories', 'auditLog', 'budgets', 'allowances', 'income', 'conversions', 'settings'] as const;
type TableName = (typeof TABLES)[number];
export type Parsed = { tables: Record<TableName, unknown[]>; legacy: boolean; droppedRates: number; droppedAudit: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Minimal shape checks so a damaged or foreign file cannot put broken rows into the database. */
const valid: Record<TableName, (r: Record<string, unknown>) => boolean> = {
  expenses: (r) => str(r.title) && num(r.amount) && str(r.date) && num(r.categoryId),
  categories: (r) => str(r.name) && str(r.color),
  auditLog: (r) => str(r.entity) && str(r.action) && str(r.at),
  budgets: (r) => str(r.month) && num(r.amount),
  allowances: (r) => str(r.startDate) && num(r.amount) && (r.endDate === undefined || str(r.endDate)),
  income: (r) => str(r.title) && num(r.amount) && str(r.currency) && str(r.date),
  conversions: (r) => str(r.date) && str(r.fromCurrency) && str(r.toCurrency) && num(r.fromAmount) && num(r.toAmount) && num(r.rate),
  settings: (r) => str(r.key),
};

/**
 * Reads a backup file from this version (format 6) or from any older version.
 * Older backups (no "format" field) have the same tables plus "exchanges" (saved reference rates, which the app no longer uses),
 * and may lack "conversions" and "settings". Returns null if the file is not a valid Family Finance Manager backup.
 */
export function parseBackup(data: unknown): Parsed | null {
  if (!isObj(data) || data.app !== 'family-finance-manager') return null;
  if (data.format !== undefined && !num(data.format)) return null;
  if (num(data.format) && (data.format as number) > BACKUP_FORMAT) return null; // made by a newer version than this one
  const legacy = data.format !== BACKUP_FORMAT;
  const required: TableName[] = ['expenses', 'categories', 'auditLog', 'budgets', 'income'];
  if (!required.every((k) => Array.isArray(data[k]))) return null;
  const tables = {} as Record<TableName, unknown[]>;
  for (const k of TABLES) {
    const rows = Array.isArray(data[k]) ? (data[k] as unknown[]) : [];
    if (!rows.every((r) => isObj(r) && valid[k](r))) return null;
    tables[k] = rows;
  }
  let droppedAudit = 0;
  if (legacy) {
    // Reference-rate entries from old versions have no place any more, so their history lines are not kept either.
    const kept = (tables.auditLog as Record<string, unknown>[]).filter((a) => a.entity !== 'exchange');
    droppedAudit = tables.auditLog.length - kept.length;
    tables.auditLog = kept;
  }
  if (legacy) remapLegacyIds(tables);
  return { tables, legacy, droppedRates: legacy && Array.isArray(data.exchanges) ? data.exchanges.length : 0, droppedAudit };
}

type Row = Record<string, unknown>;
/**
 * Older versions numbered records 1, 2, 3... which would collide between devices once data is shared. When an older backup is
 * restored every record gets a unique id, and the links between records (category of an expense, template of a recurring
 * expense, record a history line is about) are rewritten to match. Built-in categories, generated recurring entries, budget
 * overruns and budgets get the same ids on every device, so restoring on two devices never creates duplicates.
 */
function remapLegacyIds(tables: Record<TableName, unknown[]>) {
  const defaults = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c.id]));
  const catMap = new Map<number, number>(), expMap = new Map<number, number>(), incMap = new Map<number, number>(), convMap = new Map<number, number>();
  const cats = new Map<number, Row>();
  for (const c of tables.categories as Row[]) {
    const id = defaults.get(c.name as string) ?? (c.name === 'Budget overrun' ? OVERRUN_CATEGORY_ID : newId());
    catMap.set(c.id as number, id); cats.set(id, { ...c, id });
  }
  tables.categories = [...cats.values()];
  const exps = tables.expenses as Row[];
  for (const e of exps) if (e.recurring) expMap.set(e.id as number, newId());                       // templates first: the others point at them
  tables.expenses = exps.map((e) => {
    const month = typeof e.autoOverrun === 'string' ? e.autoOverrun : undefined;
    const parent = typeof e.recurringParentId === 'number' ? expMap.get(e.recurringParentId) : undefined;
    const id = month ? overrunId(month) : e.recurring ? expMap.get(e.id as number)! : parent !== undefined ? occurrenceId(parent, e.date as string) : newId();
    expMap.set(e.id as number, id);
    return { ...e, id, categoryId: catMap.get(e.categoryId as number) ?? DEFAULT_CATEGORIES[5].id, ...(parent !== undefined ? { recurringParentId: parent } : {}) };
  });
  const byMonth = new Map<string, Row>();
  for (const b of tables.budgets as Row[]) byMonth.set(b.month as string, { ...b, id: budgetId(b.month as string) });
  tables.budgets = [...byMonth.values()];
  tables.income = (tables.income as Row[]).map((i) => { const id = newId(); incMap.set(i.id as number, id); return { ...i, id }; });
  tables.conversions = (tables.conversions as Row[]).map((c) => { const id = newId(); convMap.set(c.id as number, id); return { ...c, id }; });
  const target: Record<string, Map<number, number>> = { expense: expMap, income: incMap, category: catMap, conversion: convMap };
  tables.auditLog = (tables.auditLog as Row[]).map((a) => ({ ...a, id: newId(), entityId: target[a.entity as string]?.get(a.entityId as number) ?? a.entityId }));
}

/**
 * Who may restore a backup right now. While a device is linked to a family, a restore is a change to the whole family's data
 * (the sync turns every removed record into a deletion for everybody), so: only the owner, and only after a safety backup.
 *  'free'   not linked to a family: restore works as always, on this device only
 *  'owner'  linked and owner: allowed, with the family warning and an automatic safety backup first
 *  'member' linked and not owner (or role unknown): not allowed
 *  'wait'   the sync status is not known yet: try again in a moment
 */
export type RestoreGate = 'free' | 'owner' | 'member' | 'wait';
const LINKED_STATUSES = ['idle', 'syncing', 'offline', 'error'];
export function restoreGate(status: string, role?: 'owner' | 'member' | null): RestoreGate {
  if (status === 'loading') return 'wait';
  if (!LINKED_STATUSES.includes(status)) return 'free';
  return role === 'owner' ? 'owner' : 'member';
}

/** Replaces everything on this device with the backup. */
export async function applyBackup(p: Parsed, database: FinanceDB = db) {
  await database.transaction('rw', [database.expenses, database.categories, database.auditLog, database.budgets, database.allowances, database.income, database.conversions, database.settings], async () => {
    for (const k of TABLES) {
      const table = database[k] as unknown as { clear: () => Promise<void>; bulkPut: (r: unknown[]) => Promise<unknown> };
      await table.clear();
      await table.bulkPut(p.tables[k]);
    }
  });
}

export async function buildBackup(version: string, database: FinanceDB = db) {
  const data: Record<string, unknown> = { app: 'family-finance-manager', format: BACKUP_FORMAT, version, exportedAt: new Date().toISOString() };
  for (const k of TABLES) data[k] = await database[k].toArray();
  return data;
}
