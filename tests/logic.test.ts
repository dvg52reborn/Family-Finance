import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { addPeriods, auditText, budgetState, generateRecurring, incomeIn, diffFields, fundsAsOf, fundsIn, monthSplit, syncOverruns, OVERRUN_CATEGORY } from '../src/lib/finance';
import { convertLive, fetchLiveRates, liveRate, loadCachedLive } from '../src/lib/liveRates';
import { allowanceId, db } from '../src/lib/db';
import { messages } from '../src/lib/i18n';

// date arithmetic
assert.equal(addPeriods('2026-01-31', 'monthly', 1), '2026-02-28');
assert.equal(addPeriods('2026-01-31', 'monthly', 2), '2026-03-31');
assert.equal(addPeriods('2024-02-29', 'yearly', 1), '2025-02-28');
assert.equal(addPeriods('2026-12-30', 'weekly', 1), '2027-01-06');
assert.equal(addPeriods('2026-11-15', 'monthly', 3), '2027-02-15');

// budgets
assert.equal(budgetState(0, 0), 'none'); assert.equal(budgetState(79, 100), 'ok');
assert.equal(budgetState(80, 100), 'warn'); assert.equal(budgetState(100, 100), 'warn'); assert.equal(budgetState(101, 100), 'over');

// i18n parity and audit text in both languages
assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.fr).sort());
for (const k of Object.keys(messages.en) as (keyof typeof messages.en)[]) assert.ok(messages.fr[k].trim(), `empty fr ${k}`);
const rec = { entity: 'expense' as const, entityId: 1, action: 'updated' as const, summary: '', title: 'Rice', at: 'x',
  changes: diffFields({ amount: '10', category: 'Food & groceries', recurring: 'false' }, { amount: '12', category: 'Transport', recurring: 'true' }) };
console.log(auditText(rec, messages.en, 'en')); console.log(auditText(rec, messages.fr, 'fr'));
assert.equal(auditText({ ...rec, title: undefined, summary: 'Added “Rice”', changes: undefined }, messages.fr, 'fr'), 'Ajout : “Rice”');

// recurring generation against a real (fake) IndexedDB
const mk = (o: object) => ({ title: 'Rent', amount: 500, currency: 'GHS' as const, categoryId: 1, date: '2026-01-31', notes: '', recurring: true,
  recurringFrequency: 'monthly' as const, outsideBudget: false, createdAt: 'x', updatedAt: 'x', ...o });
await db.expenses.add(mk({ id: 1 }));
await db.expenses.add(mk({ id: 2, title: 'Bus', date: '2026-11-10', recurringFrequency: 'weekly' }));
await db.expenses.add(mk({ id: 3, title: 'Off', recurring: false, recurringFrequency: '' }));
const n1 = await generateRecurring('2026-11-14');
const n2 = await generateRecurring('2026-11-14');            // idempotent
const [r1, r2] = await Promise.all([generateRecurring('2026-11-14'), generateRecurring('2026-11-14')]); // StrictMode-style double run
const rent = (await db.expenses.toArray()).filter((e) => e.recurringParentId === 1).map((e) => e.date).sort();
console.log('rent dates:', rent.join(' '));
assert.equal(n1, 9); // Feb..Oct rent (Nov 30 not due yet); Bus first due 11-17
assert.deepEqual(rent, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31']);
assert.equal(n2 + r1 + r2, 0);
const n3 = await generateRecurring('2026-11-17');            // later: weekly bus appears, nov rent not yet
assert.equal(n3, 1);
assert.equal((await db.expenses.toArray()).filter((e) => e.recurringParentId === 2).length, 1);


// ---------- funds (now = Nov 2026) ----------
const E = (o: object) => ({ id: 0, title: 'x', amount: 0, currency: 'GHS' as const, categoryId: 1, date: '2026-10-05', notes: '', recurring: false, recurringFrequency: '' as const, outsideBudget: false, createdAt: '', updatedAt: '', ...o });
const fx = {
  openings: { GHS: 1000 },
  incomes: [{ title: 'a', amount: 500, currency: 'GHS', date: '2026-10-02', notes: '' }, { title: 'b', amount: 100000, currency: 'XOF', date: '2026-11-03', notes: '' }, { title: 'future', amount: 999, currency: 'GHS', date: '2026-12-01', notes: '' }],
  conversions: [{ id: 1, date: '2026-11-04', fromCurrency: 'GHS', fromAmount: 100, toCurrency: 'XOF', rate: 55, toAmount: 5500, notes: '' }],
  expenses: [E({ amount: 300, date: '2026-10-06' }), E({ amount: 50, date: '2026-10-07', outsideBudget: true }), E({ amount: 250, date: '2026-11-02' }), E({ amount: 20, date: '2026-11-08', outsideBudget: true })],
  allowances: [
    { id: 1, startDate: '2026-10-01', endDate: '2026-10-31', amount: 400, note: '', createdAt: '', updatedAt: '' },
    { id: 2, startDate: '2026-11-01', endDate: '', amount: 200, note: '', createdAt: '', updatedAt: '' },
  ],
};
const sp = monthSplit('2026-11', fx.expenses, fx.allowances);
assert.deepEqual([sp.inside, sp.overrun, sp.outside, sp.total], [200, 50, 70, 270]);
assert.equal(sp.used, 250); assert.equal(sp.budget, 200); assert.equal(sp.allowance?.startDate, '2026-11-01');
const f10 = fundsAsOf('2026-10', fx);   // October's allowance has ended: only what was really spent stays spent
assert.equal(f10.GHS, 1000 + 500 - 300 - 50);
const f11 = fundsAsOf('2026-11', fx);   // November's open allowance holds its amount (here the spending is more, so that) + outside + exchange out
assert.equal(f11.GHS, 1000 + 500 - 100 - 70 - 300 - 250);
assert.equal(f11.XOF, 105500);
assert.equal(fundsAsOf('2026-09', fx).GHS, 1000);          // before any activity
assert.equal(fundsAsOf('2026-11', fx).USD, 0);
// December income lands in December only; with no December allowance nothing more is held
assert.equal(fundsAsOf('2026-12', fx).GHS, f11.GHS + 999);
// an open allowance holds its amount; once it has ended the unspent part is back in funds
const al = (startDate: string, endDate: string, amount: number, extra: object = {}) => ({ id: 0, startDate, endDate, amount, note: '', createdAt: '', updatedAt: '', ...extra });
const quiet = { ...fx, expenses: [], allowances: [al('2026-11-01', '', 200)], incomes: [], conversions: [], openings: { GHS: 1000 } };
assert.equal(fundsAsOf('2026-11', quiet).GHS, 800);
assert.equal(fundsAsOf('2026-12', quiet).GHS, 800);
assert.equal(fundsAsOf('2026-11', { ...quiet, allowances: [al('2026-11-01', '2026-11-15', 200)] }).GHS, 1000);
assert.equal(fundsAsOf('2026-10', { ...quiet, allowances: [al('2026-11-01', '', 200)] }).GHS, 1000);   // not started yet
// funds can go negative
assert.equal(fundsAsOf('2026-11', { ...quiet, openings: { GHS: 50 } }).GHS, -150);
// an in-budget expense on a day with no allowance is a normal expense taken straight from funds
assert.equal(fundsAsOf('2026-11', { ...quiet, allowances: [al('2026-11-10', '', 200)], expenses: [E({ amount: 40, date: '2026-11-05' })] }).GHS, 1000 - 200 - 40);
// frozen history: a change of amount counts from the day it was made; earlier months keep their figures
const raised = { ...quiet, allowances: [al('2026-10-01', '', 300, { adjustments: [{ date: '2026-11-20', delta: 100 }] })] };
assert.equal(fundsAsOf('2026-10', raised).GHS, 800);    // October still shows the 200 it had
assert.equal(fundsAsOf('2026-11', raised).GHS, 700);    // from 20 November it is 300
const lowered = { ...quiet, allowances: [al('2026-10-01', '', 250, { adjustments: [{ date: '2026-11-20', delta: 100 }, { date: '2026-12-05', delta: -50 }] })] };
assert.equal(fundsAsOf('2026-11', lowered).GHS, 700);   // 300 held in November
assert.equal(fundsAsOf('2026-12', lowered).GHS, 750);   // 50 deposited back in December
// ---------- automatic overrun entry (one per allowance and month) ----------
await db.allowances.put({ id: allowanceId('2027-03-01'), startDate: '2027-03-01', endDate: '2027-03-31', amount: 200, note: '', createdAt: 'x', updatedAt: 'x' });
const base = { title: 'Groceries', currency: 'GHS' as const, categoryId: 1, notes: '', recurring: false, recurringFrequency: '' as const, outsideBudget: false, createdAt: 'x', updatedAt: 'x' };
const a1 = 9001;
const KEY = '2027-03-01|2027-03';
await db.expenses.add({ id: a1, ...base, amount: 150, date: '2027-03-02' });
await db.expenses.add({ id: 9002, ...base, amount: 100, date: '2027-03-10' });
await db.expenses.add({ id: 9003, ...base, title: 'Budget overrun', amount: 5, outsideBudget: true, autoOverrun: '2027-03', date: '2027-03-31' });   // old per-month entry from before allowances
await syncOverruns(); await syncOverruns();
let autos = (await db.expenses.toArray()).filter((e) => e.autoOverrun);
assert.equal(autos.length, 1, 'the old per-month entry is replaced'); assert.equal(autos[0].autoOverrun, KEY);
assert.equal(autos[0].amount, 50); assert.equal(autos[0].outsideBudget, true); assert.equal(autos[0].date, '2027-03-10');
assert.equal((await db.categories.toArray()).filter((c) => c.name === OVERRUN_CATEGORY).length, 1);
await db.expenses.update(a1, { amount: 170 }); await syncOverruns();                 // overrun grows
autos = (await db.expenses.toArray()).filter((e) => e.autoOverrun === KEY); assert.equal(autos.length, 1); assert.equal(autos[0].amount, 70);
await db.expenses.update(a1, { amount: 50 }); await syncOverruns();                  // back under the amount: entry disappears
assert.equal((await db.expenses.toArray()).filter((e) => e.autoOverrun).length, 0);
// an allowance that runs over two months: the overspend belongs to the month it happened in
await db.allowances.put({ id: allowanceId('2027-04-15'), startDate: '2027-04-15', endDate: '', amount: 100, note: '', createdAt: 'x', updatedAt: 'x' });
await db.expenses.bulkAdd([{ id: 9101, ...base, amount: 80, date: '2027-04-20' }, { id: 9102, ...base, amount: 60, date: '2027-05-03' }, { id: 9103, ...base, amount: 30, date: '2027-05-10' }]);
await syncOverruns();
const multi = (await db.expenses.toArray()).filter((e) => e.autoOverrun?.startsWith('2027-04-15'));
assert.deepEqual(multi.map((e) => [e.autoOverrun, e.amount, e.date]), [['2027-04-15|2027-05', 70, '2027-05-03']]);   // nothing in April
const mp = monthSplit('2027-05', await db.expenses.toArray(), await db.allowances.toArray());
assert.deepEqual([mp.used, mp.overrun, mp.inside], [170, 70, 20]);
// raising the amount makes the overspend disappear (the increase is charged to funds from that day, see the funds tests above)
const open = (await db.allowances.get(allowanceId('2027-04-15')))!;
await db.allowances.put({ ...open, amount: 200, adjustments: [{ date: '2027-05-11', delta: 100 }] });
await syncOverruns();
assert.equal((await db.expenses.toArray()).filter((e) => e.autoOverrun?.startsWith('2027-04-15')).length, 0);

// ---------- display conversions use LIVE market rates only ----------
const live = { rates: { USD: 1, GHS: 12, XOF: 600, EUR: 0.9 }, fetchedAt: '2026-11-14T00:00:00Z' };
assert.equal(liveRate('USD', 'GHS', live), 12);
assert.ok(Math.abs(liveRate('GHS', 'XOF', live)! - 50) < 1e-9);          // 600 / 12, crossed through USD
assert.ok(Math.abs(liveRate('XOF', 'GHS', live)! - 1 / 50) < 1e-12);
assert.equal(liveRate('GHS', 'GHS', null), 1);                              // same currency never needs a rate
assert.equal(liveRate('GHS', 'XOF', null), null);                           // no live rates: not converted, never guessed
assert.equal(liveRate('GHS', 'CAD', live), null);                           // currency missing from the live table
const inc = (amount: number, currency: string) => ({ title: 'x', amount, currency, date: '2020-01-01', notes: '' });
assert.equal(incomeIn(inc(5000, 'XOF'), 'GHS', live), 100);                 // the entry's date is irrelevant: today's market rate
assert.equal(incomeIn(inc(80, 'GHS'), 'GHS', null), 80);
assert.equal(incomeIn(inc(80, 'XOF'), 'GHS', null), null);
const tot = fundsIn({ GHS: 780, XOF: 105500, USD: 10 }, 'GHS', live);
assert.deepEqual(tot.missing, []); assert.ok(Math.abs(tot.total - (780 + 105500 / 50 + 10 * 12)) < 1e-9);
const totUsd = fundsIn({ GHS: 120, USD: 10 }, 'USD', live); assert.ok(Math.abs(totUsd.total - 20) < 1e-9);   // same funds, another currency
assert.deepEqual(fundsIn({ GHS: 100, XOF: 50, EUR: 0 }, 'GHS', null), { total: 100, missing: ['XOF'] });
assert.equal(convertLive(0, 'GHS', 'XOF', live), 0);
// exchange table is independent of market rates: the received amount comes from the family's own rate, funds ignore live rates
assert.equal(fundsAsOf('2026-11', fx, '2026-11').XOF, 105500);

// fetching: success is cached, failures reject and keep the old cache
const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
const ok = { GHS: 12, XOF: 600, USD: 1, EUR: 0.9, GBP: 0.8, NGN: 1500, CAD: 1.4 };
globalThis.fetch = (async () => ({ ok: true, json: async () => ({ rates: ok }) })) as unknown as typeof fetch;
const got = await fetchLiveRates();
assert.equal(got.rates.XOF, 600); assert.deepEqual(loadCachedLive()?.rates, got.rates);
globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
await assert.rejects(fetchLiveRates());
globalThis.fetch = (async () => ({ ok: true, json: async () => ({ rates: {} }) })) as unknown as typeof fetch;
await assert.rejects(fetchLiveRates());
assert.equal(loadCachedLive()?.rates.GHS, 12);                              // failed refreshes never wipe the cached rates
console.log('all logic tests passed');
