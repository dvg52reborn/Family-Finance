import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dexie from 'dexie';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinanceDB } from '../db';
import { SyncEngine } from './engine';
import { SupabaseRemote, api, errorCode, loadCloudConfig, makeClient, saveCloudConfig, type CloudConfig, type FamilyInfo } from './cloud';

export type SyncStatus =
  | 'loading'      // reading the setup
  | 'unconfigured' // no Supabase project connected: the app works on this device only
  | 'signedOut'
  | 'noFamily'     // signed in, not in a family yet
  | 'needsLink'    // in a family, but this device is not linked to it yet
  | 'idle' | 'syncing' | 'offline' | 'error';

export type CloudState = {
  status: SyncStatus; email: string | null; family: FamilyInfo | null; lastSync: string | null; pending: number;
  error: string | null; recovery: boolean; busy: boolean;
};

export function useCloud(db: FinanceDB, onSynced?: () => void) {
  const engine = useMemo(() => new SyncEngine(db), [db]);
  const [config, setConfig] = useState<CloudConfig | null | undefined>(undefined);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [linked, setLinked] = useState(false);
  const [famLoaded, setFamLoaded] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const running = useRef(false), again = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSyncedRef = useRef(onSynced); onSyncedRef.current = onSynced;

  /* 1. Which Supabase project (if any) */
  useEffect(() => { void loadCloudConfig().then((c) => { setConfig(c); setClient(c ? makeClient(c) : null); }); }, []);

  /* 2. Who is signed in */
  useEffect(() => {
    if (!client) return;
    let alive = true;
    void client.auth.getSession().then(({ data }) => { if (alive) { setEmail(data.session?.user.email ?? null); setUserId(data.session?.user.id ?? null); } });
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      setEmail(session?.user.email ?? null); setUserId(session?.user.id ?? null);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [client]);

  /* 3. Their family, and whether this device is linked to it */
  const refreshFamily = useCallback(async () => {
    if (!client || !userId) { setFamily(null); setLinked(false); setFamLoaded(true); return; }
    try {
      const f = await api(client).myFamily();
      const stored = (await db.syncMeta.get('familyId'))?.value;
      setFamily(f); setLinked(!!f && stored === f.id); setError(null); setOffline(false);
    } catch (e) { const c = errorCode(e); if (c === 'network') setOffline(true); else setError(c); }
    setFamLoaded(true);
  }, [client, userId, db]);
  useEffect(() => { setFamLoaded(false); void refreshFamily(); }, [refreshFamily]);

  /* 4. The sync round: single-flight, repeats if more changes arrive while it runs */
  const runSync = useCallback(async () => {
    if (!client || !family || !linked) return;
    if (running.current) { again.current = true; return; }
    running.current = true; setSyncing(true);
    try {
      do {
        again.current = false;
        const { pulled } = await engine.syncOnce(new SupabaseRemote(client, family.id));
        if (pulled > 0) onSyncedRef.current?.();
      } while (again.current);
      setLastSync(new Date().toISOString()); setError(null); setOffline(false);
    } catch (e) {
      const c = errorCode(e);
      if (c === 'network') setOffline(true);
      else if (c === 'no_family') { void refreshFamily(); setError(c); }
      else setError(c);
    } finally { running.current = false; setSyncing(false); setPending(await engine.pendingCount().catch(() => 0)); }
  }, [client, family, linked, engine, refreshFamily]);
  const request = useCallback((delay = 1200) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void runSync(), delay); }, [runSync]);

  useEffect(() => {
    if (!client || !family || !linked) return;
    request(0);
    const onChange = () => request(1500);
    Dexie.on('storagemutated', onChange);                                  // any local edit, also from another tab
    const onVisible = () => { if (document.visibilityState === 'visible') request(0); };
    window.addEventListener('online', onVisible); document.addEventListener('visibilitychange', onVisible);
    const every = setInterval(() => request(0), 60_000);                   // safety net if live updates are blocked
    const channel = client.channel(`records-${family.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `family_id=eq.${family.id}` }, () => request(300)).subscribe();
    return () => {
      Dexie.on('storagemutated').unsubscribe(onChange);
      window.removeEventListener('online', onVisible); document.removeEventListener('visibilitychange', onVisible);
      clearInterval(every); void client.removeChannel(channel); if (timer.current) clearTimeout(timer.current);
    };
  }, [client, family, linked, request]);

  /* ---------- actions ---------- */
  const guard = async (fn: () => Promise<void>): Promise<string | null> => {
    setBusy(true);
    try { await fn(); return null; } catch (e) { return errorCode(e); } finally { setBusy(false); }
  };
  const link = async (f: FamilyInfo, wipe: boolean) => {
    if (wipe) await engine.wipeLocal(); else await engine.resetState();
    await db.syncMeta.put({ key: 'familyId', value: f.id });
    setFamily(f); setLinked(true); setError(null);
  };

  const actions = {
    saveConfig: (c: CloudConfig | null) => { saveCloudConfig(c); location.reload(); },
    signIn: (e: string, p: string) => guard(async () => { await api(client!).signIn(e.trim(), p); }),
    signUp: (e: string, p: string) => guard(async () => { await api(client!).signUp(e.trim(), p); }),
    signOut: () => guard(async () => { await api(client!).signOut(); setFamily(null); setLinked(false); }),
    resetPassword: (e: string) => guard(async () => { await api(client!).resetPassword(e.trim()); }),
    setPassword: (p: string) => guard(async () => { await api(client!).setPassword(p); setRecovery(false); }),
    /** First device: this device's data becomes the family's data. */
    createFamily: (name: string, display: string) => guard(async () => { const f = await api(client!).createFamily(name, display); await link(f, false); }),
    /** Joining: the family's data replaces what is on this device. */
    joinFamily: (code: string, display: string) => guard(async () => { const f = await api(client!).joinFamily(code, display); await link(f, true); }),
    linkDevice: () => guard(async () => { if (family) await link(family, true); }),
    leaveFamily: () => guard(async () => { await api(client!).leaveFamily(); await engine.resetState(); setFamily(null); setLinked(false); }),
    regenerateInvite: () => guard(async () => { await api(client!).regenerateInvite(); await refreshFamily(); }),
    removeMember: (id: string) => guard(async () => { await api(client!).removeMember(id); await refreshFamily(); }),
    syncNow: () => request(0),
  };

  const status: SyncStatus = config === undefined ? 'loading' : !config ? 'unconfigured' : !userId ? 'signedOut' : !famLoaded ? 'loading'
    : !family ? 'noFamily' : !linked ? 'needsLink' : syncing ? 'syncing' : offline ? 'offline' : error ? 'error' : 'idle';
  const state: CloudState = { status, email, family, lastSync, pending, error, recovery, busy };
  return { state, actions, configured: !!config };
}
