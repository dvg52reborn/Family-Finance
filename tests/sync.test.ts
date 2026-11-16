import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { FinanceDB, seedCategories } from '../src/lib/db';
import { SyncEngine, type PushRow, type Remote, type RemoteRow } from '../src/lib/sync/engine';
import { generateRecurring, syncOverruns } from '../src/lib/finance';

/** The cloud's rules in memory: a pushed row replaces the stored one only if its ver is not older; changes get an increasing server time. */
class FakeRemote implements Remote {
  rows = new Map<string, RemoteRow>(); clock = 0; down = false; pushCalls = 0;
  private ts() { return new Date(Date.UTC(2026, 10, 14, 12, 0, 0) + ++this.clock * 1000).toISOString(); }
  async push(rows: PushRow[]) {
    if (this.down) throw new Error('offline'); this.pushCalls++;
    for (const r of rows) { const k = `${r.tbl}:${r.id}`, ex = this.rows.get(k); if (!ex || r.ver >= ex.ver) this.rows.set(k, { ...r, data: r.data && JSON.parse(JSON.stringify(r.data)), updated_at: this.ts() }); }
  }
  async pull(since: string | null, limit: number) {
    if (this.down) throw new Error('offline');
    return [...this.rows.values()].filter((r) => !since || Date.parse(r.updated_at) >= Date.parse(since))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.tbl.localeCompare(b.tbl) || a.id.localeCompare(b.id)).slice(0, limit).map((r) => ({ ...r }));
  }
  live(tbl: string) { return [...this.rows.values()].filter((r) => r.tbl === tbl && !r.deleted); }
}
let n = 0;
function device() {
  const clock = { t: 1_000_000 + n * 10 }; const db = new FinanceDB(`dev-${n++}`); const eng = new SyncEngine(db, () => clock.t);
  return { db, eng, clock };
}
const exp = (id: number, o: object = {}) => ({ id, title: 'Rice', amount: 10, currency: 'GHS' as const, categoryId: 1, date: '2026-11-03', notes: '', recurring: false, recurringFrequency: '' as const, outsideBudget: false, createdAt: 'x', updatedAt: 'x', ...o });
const amount = async (d: ReturnType<typeof device>, id: number) => (await d.db.expenses.get(id))?.amount;

// 1. first device uploads, second device receives everything; nothing bounces back
{
  const cloud = new FakeRemote(), A = device(), B = device();
  await seedCategories(A.db); await A.db.expenses.put(exp(101)); await A.db.budgets.put({ id: 5, month: '2026-11', amount: 500, currency: 'GHS' });
  await A.db.settings.put({ key: 'openings', value: { GHS: 250 } });
  const r1 = await A.eng.syncOnce(cloud); assert.equal(r1.pushed, 9);            // 6 categories + expense + budget + settings
  const r2 = await B.eng.syncOnce(cloud); assert.equal(r2.pulled, 9); assert.equal(r2.pushed, 0);
  assert.equal(await B.db.categories.count(), 6); assert.equal(await amount(B, 101), 10); assert.deepEqual((await B.db.settings.get('openings'))?.value, { GHS: 250 });
  assert.equal((await A.eng.syncOnce(cloud)).pushed, 0); assert.equal((await B.eng.syncOnce(cloud)).pushed, 0);   // no echo
  assert.equal(await A.eng.pendingCount(), 0); assert.equal(await B.eng.pendingCount(), 0);

  // 2. edits and deletes travel
  A.clock.t += 1000; await A.db.expenses.update(101, { amount: 99 });
  assert.equal(await A.eng.pendingCount(), 1);
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud); assert.equal(await amount(B, 101), 99);
  A.clock.t += 1000; await A.db.expenses.delete(101);
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  assert.equal(await B.db.expenses.get(101), undefined); assert.equal(await B.eng.pendingCount(), 0);

  // 3. offline edits of the same record on both devices: the later edit wins, whichever reaches the cloud first
  await A.db.expenses.put(exp(102)); await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  A.clock.t += 100; await A.db.expenses.update(102, { amount: 111 }); await A.eng.detectLocalChanges();     // A edits first ...
  B.clock.t = A.clock.t + 500; await B.db.expenses.update(102, { amount: 222 }); await B.eng.detectLocalChanges();   // ... B edits later
  await B.eng.syncOnce(cloud); await A.eng.syncOnce(cloud);                                                     // B reaches the cloud first
  await B.eng.syncOnce(cloud);
  assert.equal(await amount(A, 102), 222); assert.equal(await amount(B, 102), 222);
  A.clock.t += 1000; await A.db.expenses.update(102, { amount: 1 }); await A.eng.detectLocalChanges();
  B.clock.t = A.clock.t - 700; await B.db.expenses.update(102, { amount: 2 }); await B.eng.detectLocalChanges();     // A is the later edit now
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud); await A.eng.syncOnce(cloud);                        // A reaches the cloud first
  assert.equal(await amount(A, 102), 1); assert.equal(await amount(B, 102), 1);

  // 4. delete versus edit: the later action wins
  A.clock.t += 5000; await A.db.expenses.delete(102); await A.eng.detectLocalChanges();
  B.clock.t = A.clock.t - 1000; await B.db.expenses.update(102, { amount: 7 }); await B.eng.detectLocalChanges();   // B's edit is older than A's delete
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  assert.equal(await B.db.expenses.get(102), undefined);
  B.clock.t += 9000; await B.db.expenses.put(exp(102, { amount: 8 })); await B.eng.syncOnce(cloud); await A.eng.syncOnce(cloud);  // B brings it back later
  assert.equal(await amount(A, 102), 8);

  // 5. a device whose clock runs behind can still edit what a faster clock wrote
  B.clock.t += 100_000; await B.db.expenses.update(102, { amount: 30 }); await B.eng.syncOnce(cloud); await A.eng.syncOnce(cloud);
  A.clock.t = 5; await A.db.expenses.update(102, { amount: 31 }); await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  assert.equal(await amount(B, 102), 31);

  // 6. a failed push keeps the change waiting and retries later; pulling still works afterwards
  A.clock.t += 1000; await A.db.expenses.put(exp(103, { title: 'Offline buy' }));
  cloud.down = true; await assert.rejects(A.eng.syncOnce(cloud)); assert.equal(await A.eng.pendingCount(), 1);
  cloud.down = false; await A.eng.syncOnce(cloud); assert.equal(await A.eng.pendingCount(), 0);
  await B.eng.syncOnce(cloud); assert.equal((await B.db.expenses.get(103))?.title, 'Offline buy');

  // 7. restoring a backup (everything replaced) deletes what is no longer there, for everyone
  await A.db.expenses.clear(); await A.db.expenses.put(exp(900, { title: 'From backup' }));
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  assert.deepEqual((await B.db.expenses.toArray()).map((e) => e.id), [900]);
}

// 8. paging through a large change history (including many rows with the same timestamp)
{
  const cloud = new FakeRemote(), B = device();
  const rows: PushRow[] = Array.from({ length: 1200 }, (_, i) => ({ tbl: 'expenses', id: String(2000 + i), data: exp(2000 + i), deleted: false, ver: 1 }));
  await cloud.push(rows.slice(0, 600)); await cloud.push(rows.slice(600));
  assert.equal(await B.eng.pullChanges(cloud, 500), 1200); assert.equal(await B.db.expenses.count(), 1200);
  const same = new FakeRemote(); same['ts'] = () => '2026-11-14T12:00:00.000Z'; await same.push(rows.slice(0, 700));
  const C = device(); assert.equal(await C.eng.pullChanges(same, 200), 700);                                    // 700 rows, one timestamp, pages of 200
}

// 9. things two devices create independently converge instead of duplicating
{
  const cloud = new FakeRemote(), A = device(), B = device();
  await A.db.expenses.put(exp(300, { title: 'Rent', amount: 400, date: '2026-08-31', recurring: true, recurringFrequency: 'monthly' }));
  await A.db.budgets.put({ id: 77, month: '2026-11', amount: 100, currency: 'GHS' });
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  for (const d of [A, B]) { await seedCategories(d.db); await generateRecurring('2026-11-14', d.db); }          // both open the app the same day
  await B.db.expenses.put(exp(301, { amount: 150, date: '2026-11-02' })); await B.db.expenses.put(exp(302, { amount: 90, date: '2026-11-09' }));
  for (const d of [A, B]) await syncOverruns(d.db);                                                              // 240 on a 100 budget
  for (let i = 0; i < 2; i++) for (const d of [A, B]) { await d.eng.syncOnce(cloud); await generateRecurring('2026-11-14', d.db); await syncOverruns(d.db); }
  for (const d of [A, B]) await d.eng.syncOnce(cloud);
  const occurrences = (await A.db.expenses.toArray()).filter((e) => e.recurringParentId === 300);
  assert.equal(occurrences.length, 2); assert.equal(await B.db.expenses.where('recurringParentId').equals(300).count(), 2);   // Sep 30 and Oct 31, once each
  assert.equal((await A.db.expenses.toArray()).filter((e) => e.autoOverrun === '2026-11').length, 1);
  assert.equal(await A.db.categories.count(), 7);                                                                // 6 built-in + "Budget overrun", each once
  assert.equal(cloud.live('categories').length, 7);
  assert.deepEqual((await A.db.expenses.toArray()).map((e) => e.id).sort(), (await B.db.expenses.toArray()).map((e) => e.id).sort());
  assert.equal(await A.eng.pendingCount(), 0); assert.equal(await B.eng.pendingCount(), 0);
}

// 10. signing out and back in must not overwrite what others changed meanwhile; joining replaces local data
{
  const cloud = new FakeRemote(), A = device(), B = device(), C = device();
  await A.db.expenses.put(exp(400, { amount: 5 })); await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  B.clock.t += 5000; await B.db.expenses.update(400, { amount: 6 }); await B.eng.syncOnce(cloud);                // A is signed out meanwhile
  A.clock.t += 9000; await A.eng.syncOnce(cloud);                                                                 // A signs back in (bookkeeping kept)
  assert.equal(await amount(A, 400), 6);
  await C.db.expenses.put(exp(777, { title: 'Local only' })); await C.eng.wipeLocal();                           // C joins the family
  await C.eng.syncOnce(cloud);
  assert.deepEqual((await C.db.expenses.toArray()).map((e) => e.id), [400]); assert.equal(cloud.live('expenses').length, 1);
}

// 11. the owner restores a backup on a synced device: every device ends up with exactly the backup, and restoring the safety copy undoes it
{
  const { applyBackup, buildBackup, parseBackup } = await import('../src/lib/backup');
  const cloud = new FakeRemote(), A = device(), B = device();
  await seedCategories(A.db);
  await A.db.expenses.put(exp(601, { title: 'Keep me', amount: 10 })); await A.db.expenses.put(exp(602, { title: 'Only in current data', amount: 20 }));
  await A.db.settings.put({ key: 'openings', value: { GHS: 100 } });
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud);
  const safety = JSON.parse(JSON.stringify(await buildBackup('0.8.0', A.db)));                       // the automatic safety backup, taken first

  // an older (format 7) backup: one expense that also exists (changed), one new, and 602 missing
  const old = JSON.parse(JSON.stringify(safety));
  old.expenses = [{ ...old.expenses.find((e: { id: number }) => e.id === 601), amount: 11 }, exp(603, { title: 'Back from the backup', amount: 30 })];
  old.settings = [{ key: 'openings', value: { GHS: 5 } }];
  A.clock.t += 5000;
  await applyBackup(parseBackup(old)!, A.db);
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud); await A.eng.syncOnce(cloud);
  for (const d of [A, B]) {
    assert.deepEqual((await d.db.expenses.toArray()).map((e) => e.id).sort(), [601, 603]);       // 602 is gone on both devices
    assert.equal(await amount(d, 601), 11); assert.deepEqual((await d.db.settings.get('openings'))?.value, { GHS: 5 });
    assert.equal(await d.db.categories.count(), 6);                                              // untouched data does not duplicate
  }
  assert.equal(cloud.live('expenses').length, 2); assert.equal(await A.eng.pendingCount(), 0); assert.equal(await B.eng.pendingCount(), 0);

  // undo: restore the safety backup. The records that were deleted come back, on both devices
  A.clock.t += 5000;
  await applyBackup(parseBackup(safety)!, A.db);
  await A.eng.syncOnce(cloud); await B.eng.syncOnce(cloud); await A.eng.syncOnce(cloud);
  for (const d of [A, B]) {
    assert.deepEqual((await d.db.expenses.toArray()).map((e) => e.id).sort(), [601, 602]);
    assert.equal(await amount(d, 601), 10); assert.equal(await amount(d, 602), 20); assert.deepEqual((await d.db.settings.get('openings'))?.value, { GHS: 100 });
  }
  assert.equal(cloud.live('expenses').length, 2); assert.equal(await A.eng.pendingCount(), 0); assert.equal(await B.eng.pendingCount(), 0);
}
console.log('sync tests passed');
