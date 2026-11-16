import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';

// Data from earlier versions must NOT be carried into this version.
const old = new Dexie('family-finance-manager');
old.version(1).stores({ expenses: '++id,date', categories: '++id,name', auditLog: '++id', budgets: '++id,month', income: '++id,date', exchanges: '++id,date' });
await old.table('expenses').add({ title: 'Old rent', amount: 400, date: '2026-09-01' });
await old.table('income').add({ title: 'Old salary', amount: 3000, currency: 'GHS', date: '2026-09-01', notes: '' });
old.close();

const { db, DB_NAME } = await import('../src/lib/db');
assert.notEqual(DB_NAME, 'family-finance-manager');
for (const table of [db.expenses, db.income, db.categories, db.budgets, db.conversions, db.settings, db.auditLog]) assert.equal(await table.count(), 0);
assert.ok(!db.tables.some((t) => t.name === 'exchanges'), 'no saved reference-rate table any more');
const { seedCategories } = await import('../src/lib/db');
await seedCategories(); assert.equal(await db.categories.count(), 6);

// the old database is left exactly as it was (not deleted, not read)
const again = new Dexie('family-finance-manager'); again.version(1).stores({ expenses: '++id,date', categories: '++id,name', auditLog: '++id', budgets: '++id,month', income: '++id,date', exchanges: '++id,date' });
assert.equal(await again.table('expenses').count(), 1); assert.equal(await again.table('income').count(), 1);
console.log('fresh database test passed');
