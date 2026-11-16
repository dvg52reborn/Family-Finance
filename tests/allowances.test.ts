import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { addDays, allowanceFor, amountLeft, checkNewAmount, closeAllowance, planNewAllowance, renewalFor, spentOn } from '../src/lib/allowances';
import { allowanceId, db } from '../src/lib/db';
import { BACKUP_FORMAT, buildBackup, parseBackup } from '../src/lib/backup';
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

console.log('allowance tests passed');
