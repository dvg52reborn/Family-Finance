import { hashId, type FinanceDB, type SyncEntry } from '../db';

/** Tables that are shared with the family. "pk" is the primary key field of each. */
export const SYNCED = [
  { tbl: 'expenses', pk: 'id' }, { tbl: 'categories', pk: 'id' }, { tbl: 'auditLog', pk: 'id' }, { tbl: 'budgets', pk: 'id' },
  { tbl: 'income', pk: 'id' }, { tbl: 'conversions', pk: 'id' }, { tbl: 'settings', pk: 'key' },
] as const;
type Tbl = (typeof SYNCED)[number]['tbl'];
const PK: Record<string, 'id' | 'key'> = Object.fromEntries(SYNCED.map((s) => [s.tbl, s.pk]));

export type PushRow = { tbl: string; id: string; data: unknown | null; deleted: boolean; ver: number };
export type RemoteRow = PushRow & { updated_at: string };
/** What the engine needs from the cloud. The real one talks to Supabase; tests use an in-memory copy of the same rules. */
export interface Remote {
  /** Stores rows. A row only replaces what the cloud already has if its ver is not older. */
  push(rows: PushRow[]): Promise<void>;
  /** Rows changed at or after `since` (null = everything), oldest change first. */
  pull(since: string | null, limit: number): Promise<RemoteRow[]>;
}

/** Same data -> same text, whatever the key order; undefined fields count as absent (they vanish in JSON anyway). */
export function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
export const hashOf = (row: unknown) => String(hashId(stable(row)));

/** Pull again slightly before the newest change we saw: a change committed late can carry an older timestamp. Re-applying is harmless. */
export const PULL_OVERLAP_MS = 10_000;

export class SyncEngine {
  constructor(private db: FinanceDB, private now: () => number = Date.now) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private table(tbl: string): any { return (this.db as any)[tbl]; }
  private get allTables() { return [...SYNCED.map((s) => this.table(s.tbl)), this.db.syncState, this.db.syncMeta]; }
  private pkValue(tbl: string, id: string) { return PK[tbl] === 'key' ? id : Number(id); }

  /** Notices what changed on this device since the last look (new, edited, deleted rows) and stamps each change with a version. */
  async detectLocalChanges(): Promise<void> {
    await this.db.transaction('rw', this.allTables, async () => {
      const state = new Map((await this.db.syncState.toArray()).map((e) => [e.key, e]));
      const seen = new Set<string>();
      const writes: SyncEntry[] = [];
      const now = this.now();
      for (const { tbl, pk } of SYNCED) {
        for (const row of await this.table(tbl).toArray()) {
          const id = String(row[pk]), key = `${tbl}:${id}`, hash = hashOf(row), st = state.get(key);
          seen.add(key);
          // ver always goes up from the version this edit was based on, even if this device's clock is behind.
          if (!st) writes.push({ key, tbl, id, hash, pushedHash: null, ver: now });
          else if (st.hash !== hash) writes.push({ ...st, hash, ver: Math.max(now, st.ver + 1) });
        }
      }
      for (const st of state.values()) if (st.hash !== null && !seen.has(st.key)) writes.push({ ...st, hash: null, ver: Math.max(now, st.ver + 1) });
      if (writes.length) await this.db.syncState.bulkPut(writes);
    });
  }

  private async dirtyEntries(): Promise<SyncEntry[]> {
    return (await this.db.syncState.toArray()).filter((e) => e.hash !== e.pushedHash);
  }
  /** Changes made on this device that the cloud has not confirmed yet. */
  async pendingCount(): Promise<number> {
    await this.detectLocalChanges();
    return (await this.dirtyEntries()).length;
  }

  async pushDirty(remote: Remote, chunk = 200): Promise<number> {
    let pushed = 0;
    const dirty = await this.dirtyEntries();
    for (let i = 0; i < dirty.length; i += chunk) {
      const rows: PushRow[] = [], sent: SyncEntry[] = [];
      for (const e of dirty.slice(i, i + chunk)) {
        if (e.hash === null) { rows.push({ tbl: e.tbl, id: e.id, data: null, deleted: true, ver: e.ver }); sent.push(e); continue; }
        const row = await this.table(e.tbl).get(this.pkValue(e.tbl, e.id));
        if (!row || hashOf(row) !== e.hash) continue;          // changed again meanwhile: the next detection stamps it, the next round sends it
        rows.push({ tbl: e.tbl, id: e.id, data: JSON.parse(JSON.stringify(row)), deleted: false, ver: e.ver }); sent.push(e);
      }
      if (!rows.length) continue;
      await remote.push(rows);
      await this.db.transaction('rw', this.db.syncState, async () => {
        for (const e of sent) {
          const cur = await this.db.syncState.get(e.key);
          if (cur && cur.hash === e.hash) await this.db.syncState.put({ ...cur, pushedHash: e.hash });   // untouched since: it is in step now
        }
      });
      pushed += rows.length;
    }
    return pushed;
  }

  private async apply(rows: RemoteRow[]): Promise<number> {
    let applied = 0;
    await this.db.transaction('rw', this.allTables, async () => {
      for (const r of rows) {
        if (!(r.tbl in PK) || (!r.deleted && (typeof r.data !== 'object' || r.data === null))) continue;
        const key = `${r.tbl}:${r.id}`, st = await this.db.syncState.get(key);
        const dirty = !!st && st.hash !== st.pushedHash;
        if (dirty && st!.ver >= r.ver) continue;               // this device's own newer edit wins and will be sent
        const pk = this.pkValue(r.tbl, r.id);
        if (r.deleted) {
          if (st && st.hash === null && st.pushedHash === null) continue;
          await this.table(r.tbl).delete(pk);
          await this.db.syncState.put({ key, tbl: r.tbl, id: r.id, hash: null, pushedHash: null, ver: r.ver });
        } else {
          const data = { ...(r.data as Record<string, unknown>), [PK[r.tbl]]: pk };
          const hash = hashOf(data);
          if (st && !dirty && st.hash === hash) { if (r.ver > st.ver) await this.db.syncState.put({ ...st, ver: r.ver }); continue; }
          await this.table(r.tbl).put(data);
          await this.db.syncState.put({ key, tbl: r.tbl, id: r.id, hash, pushedHash: hash, ver: r.ver });
        }
        applied++;
      }
    });
    return applied;
  }

  async pullChanges(remote: Remote, limit = 500): Promise<number> {
    const cursor = ((await this.db.syncMeta.get('cursor'))?.value as string | null | undefined) ?? null;
    let since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
    let newest = cursor, applied = 0, size = limit;
    for (let guard = 0; guard < 10_000; guard++) {
      const rows = await remote.pull(since, size);
      applied += await this.apply(rows);
      for (const r of rows) if (!newest || Date.parse(r.updated_at) > Date.parse(newest)) newest = r.updated_at;
      if (rows.length < size) break;
      const last = rows[rows.length - 1].updated_at;
      if (last === since) size *= 2; else since = last;        // a full page of identical timestamps: widen the page instead of looping
    }
    if (newest && newest !== cursor) await this.db.syncMeta.put({ key: 'cursor', value: newest });
    return applied;
  }

  /** One full round: notice local changes, send them, fetch everyone else's. */
  async syncOnce(remote: Remote): Promise<{ pushed: number; pulled: number }> {
    await this.detectLocalChanges();
    let pushed = 0, pulled = 0, failure: unknown;
    try { pushed = await this.pushDirty(remote); } catch (e) { failure = e; }
    try { pulled = await this.pullChanges(remote); } catch (e) { failure = failure ?? e; }
    if (failure) throw failure;
    await this.detectLocalChanges();
    return { pushed, pulled };
  }

  /** Forget the sync bookkeeping (data stays). Used when leaving a family. */
  async resetState(): Promise<void> {
    await this.db.transaction('rw', [this.db.syncState, this.db.syncMeta], async () => { await this.db.syncState.clear(); await this.db.syncMeta.clear(); });
  }
  /** Remove all shared data from this device and forget the bookkeeping. Used when joining a family whose data replaces what is here. */
  async wipeLocal(): Promise<void> {
    await this.db.transaction('rw', this.allTables, async () => {
      for (const { tbl } of SYNCED) await this.table(tbl).clear();
      await this.db.syncState.clear(); await this.db.syncMeta.clear();
    });
  }
}
export type { Tbl };
