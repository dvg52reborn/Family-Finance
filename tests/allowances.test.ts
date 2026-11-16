import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { MIGRATED_KEY, RENEWAL_KEY, addDays, allowanceFor, allowanceForMonth, amountAsOf, amountLeft, changeAmount, checkEndDate, checkNewAmount, closeAllowance, migrateBudgets, monthEnd, planNewAllowance, renewalFor, runRenewal, spentOn, startAmount } from '../src/lib/allowances';
import { allowanceId, db } from '../src/lib/db';
import { BACKUP_FORMAT, applyBackup, buildBackup, parseBackup } from '../src/lib/backup';
import type { Allowance, Expense } from '../src/types/finance';

const NOW = '2026-10-30T00:00:00.000Z';
const exp = (date: string, amount: number, extra: Partial<Expense> = {}): Expense => ({
  title: 'x', amount, currency: 'GHS', categoryId: 1, date, notes: '', recurring: false, recurringFrequency: '', outsideBudget: false, createdAt: '', updatedAt: '', ...extra,
});
const A = (startDate: string, endDate: string, amount: number): Allowance => ({ id: allowanceId(startDate), startDate, endDate, amount, note: '', createdAt: '', updatedAt: '' });

// dates: month and year ends
assert.equal(addDays('2026-01-31', 1), '2026-02-01');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(addDays('2028-02-28', 1), '2028-02-29');

// which allowance a day belongs to
const oct = A('2026-10-01', '2026-10-31', 1000);
const open = A('2026-11-01', '', 800);
assert.equal(allowanceFor('2026-10-15', [oct])?.amount, 1000);
assert.equal(allowanceFor('2026-11-01', [oct]), undefined);
assert.equal(allowanceFor('2026-12-25', [open])?.amount, 800);
assert.equal(allowanceFor('2026-10-31', [oct, open])?.amount, 1000); // both ends are inclusive

// spending: in-budget, inside the period only
const ex = [
  exp('2026-10-03', 300),
  exp('2026-10-20', 200, { outsideBudget: true }),           // paid from funds, not from the allowance
  exp('2026-10-31', 50, { autoOverrun: '2026-10' }),          // automatic overrun entry, never counted twice
  exp('2026-11-01', 999),                                      // next period
];
assert.equal(spentOn(oct, ex), 300);
assert.equal(amountLeft(oct, ex), 700);
assert.equal(amountLeft(A('2026-10-01', '2026-10-31', 100), ex), -200); // overspent: negative is allowed

// changing the amount: not below what is spent
assert.equal(checkNewAmount(oct, 299, ex), 'below_spent');
assert.equal(checkNewAmount(oct, 300, ex), 'ok');
assert.equal(checkNewAmount(oct, 0, ex), 'invalid');

// closing: unspent back to funds, overspend becomes an overrun on the end date
assert.deepEqual(closeAllowance(oct, '2026-10-31', ex), { endDate: '2026-10-31', spent: 300, returnToFunds: 700, overrun: 0 });
assert.deepEqual(closeAllowance(A('2026-10-01', '2026-10-31', 200), '2026-10-31', ex), { endDate: '2026-10-31', spent: 300, returnToFunds: 0, overrun: 100 });

// taking a new allowance closes the open one the day before
const first = planNewAllowance([], { startDate: '2026-10-01', amount: 1000 }, [], NOW);
assert.ok(first.ok && first.closed === null && first.closing === null && first.create.endDate === '');
const openOct = first.ok ? first.create : A('x', '', 0);
const second = planNewAllowance([openOct], { startDate: '2026-11-01', amount: 800 }, [exp('2026-10-03', 300)], NOW);
assert.ok(second.ok);
if (second.ok) {
  assert.equal(second.closed?.endDate, '2026-10-31');
  assert.equal(second.closing?.returnToFunds, 700);
  assert.equal(second.create.id, allowanceId('2026-11-01'));
  assert.equal(second.create.amount, 800);
}

// refusals: bad amount, end before start, overlap, same start day
assert.deepEqual(planNewAllowance([], { startDate: '2026-10-01', amount: 0 }, [], NOW), { ok: false, reason: 'invalid' });
assert.deepEqual(planNewAllowance([], { startDate: '2026-10-10', endDate: '2026-10-01', amount: 5 }, [], NOW), { ok: false, reason: 'invalid' });
assert.deepEqual(planNewAllowance([oct], { startDate: '2026-10-15', amount: 5 }, [], NOW), { ok: false, reason: 'overlap' });
assert.deepEqual(planNewAllowance([oct], { startDate: '2026-10-01', amount: 5 }, [], NOW), { ok: false, reason: 'overlap' });

// automatic renewal after the end date
const off = { enabled: false, useDefault: false, defaultAmount: 0 };
const sameAmount = { enabled: true, useDefault: false, defaultAmount: 0 };
const useDefault = { enabled: true, useDefault: true, defaultAmount: 600 };
assert.equal(renewalFor([oct], off, '2026-11-05', NOW), null);
assert.equal(renewalFor([oct], sameAmount, '2026-10-31', NOW), null);      // the end day itself: not yet over
const r1 = renewalFor([oct], sameAmount, '2026-11-01', NOW);
assert.ok(r1 && r1.startDate === '2026-11-01' && r1.endDate === '' && r1.amount === 1000 && r1.id === allowanceId('2026-11-01'));
assert.equal(renewalFor([oct], useDefault, '2026-11-05', NOW)?.amount, 600);
assert.equal(renewalFor([open], sameAmount, '2026-12-05', NOW), null);      // open allowance: nothing to renew


// month ends
assert.equal(monthEnd('2026-02'), '2026-02-28'); assert.equal(monthEnd('2028-02'), '2028-02-29'); assert.equal(monthEnd('2026-12'), '2026-12-31');
assert.equal(allowanceForMonth('2026-10', [oct, open])?.amount, 1000); assert.equal(allowanceForMonth('2026-11', [oct, open])?.amount, 800);
assert.equal(allowanceForMonth('2026-09', [oct, open]), undefined);

// changing the amount is recorded with its date; earlier days keep the old amount
const base0 = A('2026-10-01', '', 1000);
const up = changeAmount(base0, 1300, '2026-10-12', NOW);
assert.equal(up.amount, 1300); assert.equal(startAmount(up), 1000);
assert.equal(amountAsOf(up, '2026-10-11'), 1000); assert.equal(amountAsOf(up, '2026-10-12'), 1300); assert.equal(amountAsOf(up, '2026-09-30'), 0);
const down = changeAmount(up, 1100, '2026-10-20', NOW);
assert.equal(amountAsOf(down, '2026-10-19'), 1300); assert.equal(amountAsOf(down, '2026-10-20'), 1100); assert.equal(down.adjustments?.length, 2);
assert.equal(changeAmount(down, 1100, '2026-10-25', NOW), down);                    // same amount: nothing recorded
assert.equal(amountAsOf(changeAmount(A('2026-11-10', '', 500), 700, '2026-11-01', NOW), '2026-11-10'), 700);   // changed before it starts: counts from the start

// end dates
const lst = [A('2026-10-01', '', 1000), A('2026-11-01', '', 800)];
assert.equal(checkEndDate(lst, lst[1], '2026-11-30'), 'ok');
assert.equal(checkEndDate(lst, lst[1], '2026-10-31'), 'before_start');
assert.equal(checkEndDate(lst, lst[0], '2026-11-05'), 'overlap');                   // reaches into the next allowance
assert.equal(checkEndDate(lst, lst[0], ''), 'overlap');                             // cannot be reopened while another follows
assert.equal(checkEndDate(lst, lst[1], ''), 'ok');

// one-time migration of the old monthly budgets
await db.allowances.clear(); await db.settings.clear();
await db.budgets.bulkPut([{ id: 1, month: '2026-08', amount: 1000, currency: 'GHS' }, { id: 2, month: '2026-02', amount: 300, currency: 'GHS' }, { id: 3, month: '2026-09', amount: 0, currency: 'GHS' }]);
assert.equal(await migrateBudgets(), 2);
const migrated = (await db.allowances.orderBy('startDate').toArray()).map((a) => [a.startDate, a.endDate, a.amount, a.id]);
assert.deepEqual(migrated, [['2026-02-01', '2026-02-28', 300, allowanceId('2026-02-01')], ['2026-08-01', '2026-08-31', 1000, allowanceId('2026-08-01')]]);
assert.equal(await migrateBudgets(), 0);                                            // runs once
await db.allowances.delete(allowanceId('2026-02-01')); await migrateBudgets();
assert.equal(await db.allowances.count(), 1, 'a deleted allowance is not brought back');
assert.equal(await db.budgets.count(), 3, 'old budgets are left untouched');

// automatic renewal against the real tables
await db.allowances.clear(); await db.settings.clear();
assert.equal(await runRenewal('2026-11-05'), null, 'nothing to renew without allowances');
await db.allowances.put(A('2026-10-01', '2026-10-31', 1000));
assert.equal(await runRenewal('2026-10-31'), null, 'not before the end date has passed');
const ren = await runRenewal('2026-11-05');                                         // default rule: on, same amount
assert.ok(ren && ren.startDate === '2026-11-01' && ren.endDate === '' && ren.amount === 1000);
assert.equal(await runRenewal('2026-11-05'), null, 'only once');
assert.equal(await db.allowances.count(), 2);
await db.allowances.clear(); await db.allowances.put(A('2026-10-01', '2026-10-31', 1000));
await db.settings.put({ key: RENEWAL_KEY, value: { enabled: false, useDefault: false, defaultAmount: 0 } });
assert.equal(await runRenewal('2026-11-05'), null, 'switched off in Settings');
await db.settings.put({ key: RENEWAL_KEY, value: { enabled: true, useDefault: true, defaultAmount: 600 } });
assert.equal((await runRenewal('2026-11-05'))?.amount, 600, 'fixed amount from Settings');
await db.allowances.clear(); await db.settings.clear();

await db.budgets.clear();   // from here on the database has no old monthly budgets
// backups: the new table round-trips, and old backups without it still load
await db.allowances.put(open);
const backup = JSON.parse(JSON.stringify(await buildBackup('0.9.0', db)));
assert.equal(backup.format, BACKUP_FORMAT);
const parsed = parseBackup(backup);
assert.ok(parsed && parsed.tables.allowances.length === 1);
const old = { ...backup };
delete old.allowances;
assert.deepEqual(parseBackup(old)?.tables.allowances, []);
assert.equal(parseBackup({ ...old, allowances: [{ startDate: '2026-01-01' }] }), null); // damaged row refused

// a backup made before allowances (no allowances in it) turns its monthly budgets into allowances
await db.budgets.clear(); await db.allowances.clear();
await db.budgets.bulkPut([{ id: 1, month: '2026-08', amount: 1000, currency: 'GHS' }, { id: 2, month: '2026-09', amount: 1200, currency: 'GHS' }]);
const pre = JSON.parse(JSON.stringify(await buildBackup('0.8.0', db))); delete pre.allowances;
const conv = parseBackup(pre);
assert.deepEqual((conv?.tables.allowances as Allowance[]).map((a) => [a.startDate, a.endDate, a.amount]), [['2026-08-01', '2026-08-31', 1000], ['2026-09-01', '2026-09-30', 1200]]);
// a backup that has allowances is taken as it is: the budgets in it are not converted a second time
const withBoth = JSON.parse(JSON.stringify(await buildBackup('0.9.0', db)));        // allowances is an empty list here, on purpose
assert.deepEqual(parseBackup(withBoth)?.tables.allowances, []);
// restoring marks the device as converted, so the migration cannot bring back anything the backup did not have
await applyBackup(conv!, db);
assert.equal(await db.allowances.count(), 2); assert.equal((await db.settings.get(MIGRATED_KEY))?.value, true);
assert.equal(await migrateBudgets(), 0);

console.log('allowance tests passed');
