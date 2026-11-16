import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { applyBackup, buildBackup, parseBackup, restoreGate } from '../src/lib/backup';
import { generateRecurring } from '../src/lib/finance';
import { OVERRUN_CATEGORY_ID, budgetId, db, occurrenceId, overrunId } from '../src/lib/db';

const exp = (o: object = {}) => ({ id: 1, title: 'Rent', amount: 400, currency: 'GHS', categoryId: 1, date: '2026-08-31', notes: '', recurring: false, recurringFrequency: '', outsideBudget: false, createdAt: 'x', updatedAt: 'x', ...o });
const base = { app: 'family-finance-manager', exportedAt: '2026-09-01T00:00:00Z' };
const cats = [{ id: 1, name: 'Food & groceries', color: '#f59e0b', createdAt: 'x' }];

// 0.4.x backup: six tables, no "format", no conversions/settings, includes saved reference rates
const v04 = { ...base, version: '0.4.0', expenses: [exp({ recurring: true, recurringFrequency: 'monthly' })], categories: cats,
  auditLog: [{ id: 1, entity: 'expense', entityId: 1, action: 'created', summary: 'Added “Rent”', at: 'x' }],
  budgets: [{ id: 1, month: '2026-08', amount: 1000, currency: 'GHS' }], income: [{ id: 1, title: 'Salary', amount: 3000, currency: 'GHS', date: '2026-08-01', notes: '' }],
  exchanges: [{ id: 1, fromCurrency: 'GHS', toCurrency: 'XOF', rate: 52, date: '2026-08-01' }] };
const p04 = parseBackup(v04)!;
assert.ok(p04 && p04.legacy && p04.droppedRates === 1);
assert.equal(p04.tables.conversions.length, 0); assert.equal(p04.tables.settings.length, 0); assert.equal(p04.tables.expenses.length, 1);

// 0.5.x backup: adds conversions + settings, and "exchange" audit lines for saved rates
const v05 = { ...v04, version: '0.5.1',
  conversions: [{ id: 1, date: '2026-08-05', fromCurrency: 'GHS', fromAmount: 100, toCurrency: 'XOF', rate: 55, toAmount: 5500, notes: '' }],
  settings: [{ key: 'openings', value: { GHS: 250 } }],
  auditLog: [...v04.auditLog, { id: 2, entity: 'exchange', entityId: 1, action: 'created', summary: '', title: 'GHS → XOF = 52', at: 'y' }, { id: 3, entity: 'conversion', entityId: 1, action: 'created', summary: '', title: '100 GHS → 5500 XOF', at: 'z' }] };
const p05 = parseBackup(v05)!;
assert.ok(p05.legacy); assert.equal(p05.tables.conversions.length, 1); assert.equal(p05.tables.settings.length, 1);
assert.equal(p05.droppedAudit, 1); assert.deepEqual((p05.tables.auditLog as { entity: string }[]).map((a) => a.entity), ['expense', 'conversion']);   // the saved-rate history line is dropped

// 0.6/0.7 backup (format 6): numbered ids, no saved rates
const v06 = { ...base, format: 6, version: '0.7.1', expenses: [exp()], categories: cats, auditLog: [], budgets: [], income: [], conversions: [], settings: [] };
const p06 = parseBackup(v06)!; assert.ok(p06 && p06.legacy && p06.droppedRates === 0);
// current format (7): ids are already unique and are kept exactly as they are
const v07 = { ...v06, format: 7, version: '0.8.0', expenses: [exp({ id: 4503599627370496 })] };
const p07 = parseBackup(v07)!; assert.ok(p07 && !p07.legacy); assert.equal((p07.tables.expenses[0] as { id: number }).id, 4503599627370496);

// older ids are rewritten so that data from several devices can never collide, and the links between records follow
const rich = { ...base, format: 6, version: '0.7.1',
  categories: [{ id: 1, name: 'Food & groceries', color: '#f59e0b', createdAt: 'x' }, { id: 7, name: 'Budget overrun', color: '#d9453a', createdAt: 'x' }, { id: 9, name: 'Family events', color: '#123456', createdAt: 'x' }],
  expenses: [exp({ id: 1, recurring: true, recurringFrequency: 'monthly', categoryId: 9 }),
    exp({ id: 2, recurringParentId: 1, date: '2026-09-30', categoryId: 9 }),
    exp({ id: 3, autoOverrun: '2026-08', outsideBudget: true, categoryId: 7, title: 'Budget overrun' }),
    exp({ id: 4, categoryId: 1 }), exp({ id: 5, categoryId: 42, title: 'Orphan' })],
  auditLog: [{ id: 1, entity: 'expense', entityId: 1, action: 'created', summary: '', title: 'Rent', at: 'x' }, { id: 2, entity: 'category', entityId: 9, action: 'created', summary: '', title: 'Family events', at: 'x' }],
  budgets: [{ id: 1, month: '2026-08', amount: 1000, currency: 'GHS' }, { id: 2, month: '2026-08', amount: 1200, currency: 'GHS' }],
  income: [{ id: 1, title: 'Salary', amount: 3000, currency: 'GHS', date: '2026-08-01', notes: '' }] };
const pr = parseBackup(rich)!; assert.ok(pr.legacy);
type R = Record<string, number | string | undefined>;
const ex = pr.tables.expenses as R[], byTitle = (t: string) => ex.filter((e) => e.title === t);
const tpl = ex.find((e) => e.recurring)!, occ = ex.find((e) => e.recurringParentId !== undefined)!, over = ex.find((e) => e.autoOverrun)!;
assert.ok((tpl.id as number) >= 1000 && tpl.id !== 1);
assert.equal(occ.recurringParentId, tpl.id); assert.equal(occ.id, occurrenceId(tpl.id as number, '2026-09-30'));      // generated entries: same id on every device
assert.equal(over.id, overrunId('2026-08')); assert.equal(over.categoryId, OVERRUN_CATEGORY_ID);
const catsOut = pr.tables.categories as R[];
const custom = catsOut.find((c) => c.name === 'Family events')!;
assert.ok((custom.id as number) >= 1000); assert.equal(tpl.categoryId, custom.id); assert.equal(occ.categoryId, custom.id);   // custom category: new id, expenses follow
assert.equal(catsOut.find((c) => c.name === 'Food & groceries')!.id, 1);                                              // built-in category: its fixed id
assert.equal(byTitle('Orphan').length, 1); assert.equal(byTitle('Orphan')[0].categoryId, 6);                       // an expense with a dangling category falls back to "Other"
assert.equal(new Set(ex.map((e) => e.id)).size, ex.length);
const bud = pr.tables.budgets as R[]; assert.equal(bud.length, 1); assert.equal(bud[0].id, budgetId('2026-08')); assert.equal(bud[0].amount, 1200);   // one budget per month
const alw = pr.tables.allowances as R[]; assert.equal(alw.length, 1); assert.deepEqual([alw[0].startDate, alw[0].endDate, alw[0].amount], ['2026-08-01', '2026-08-31', 1200]);   // old backup: the month's budget became an allowance
const aud = pr.tables.auditLog as R[]; assert.equal(aud[0].entityId, tpl.id); assert.equal(aud[1].entityId, custom.id);
assert.ok(((pr.tables.income as R[])[0].id as number) >= 1000);

// rejected: foreign, damaged or newer files
assert.equal(parseBackup(null), null); assert.equal(parseBackup('text'), null); assert.equal(parseBackup([]), null);
assert.equal(parseBackup({ ...v04, app: 'something-else' }), null);
assert.equal(parseBackup({ ...v04, income: undefined }), null);                                     // required table missing
assert.equal(parseBackup({ ...v04, expenses: [exp({ amount: 'lots' })] }), null);                   // damaged row
assert.equal(parseBackup({ ...v05, conversions: [{ id: 1, date: 'x' }] }), null);
assert.equal(parseBackup({ ...v06, format: 8 }), null);                                             // from a newer version than this app
assert.equal(parseBackup({ ...v06, format: 'six' }), null);

// restore an old backup into the database, then catch up recurring expenses
await db.expenses.add({ ...exp({ id: 5555, title: 'Leftover' }), recurring: false } as never);
await applyBackup(p05);
assert.equal(await db.expenses.count(), 1); assert.equal((await db.expenses.toArray())[0].title, 'Rent');   // replaced, not merged
assert.ok((await db.expenses.toArray())[0].id! >= 1000);                                                      // restored with a unique id
assert.equal(await db.conversions.count(), 1); assert.deepEqual((await db.settings.get('openings'))?.value, { GHS: 250 });
assert.equal(await db.income.count(), 1); assert.equal(await db.budgets.count(), 1);
const made = await generateRecurring('2026-11-14');
assert.equal(made, 2);                                                                              // Rent was due on Sep 30 and Oct 31
// round trip: what this version exports, this version can restore
const out = await buildBackup('0.7.0');
const again = parseBackup(JSON.parse(JSON.stringify(out)))!;
assert.ok(again && !again.legacy && again.tables.expenses.length === 3);

// who may restore: not linked = free; linked = owner only; unknown status = wait
for (const st of ['unconfigured', 'signedOut', 'noFamily', 'needsLink']) for (const role of [undefined, null, 'owner', 'member'] as const) assert.equal(restoreGate(st, role), 'free', `${st}/${role}`);
for (const st of ['idle', 'syncing', 'offline', 'error']) {
  assert.equal(restoreGate(st, 'owner'), 'owner', st);
  assert.equal(restoreGate(st, 'member'), 'member', st);
  assert.equal(restoreGate(st, undefined), 'member', st + ' (role unknown: treated as member)');
}
assert.equal(restoreGate('loading', 'owner'), 'wait'); assert.equal(restoreGate('loading'), 'wait');
console.log('backup tests passed');
