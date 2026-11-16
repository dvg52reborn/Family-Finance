import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { PushRow, Remote, RemoteRow } from './engine';

export type CloudConfig = { url: string; anonKey: string };
export type FamilyInfo = {
  id: string; name: string; role: 'owner' | 'member'; invite_code: string | null;
  members: { user_id: string; display_name: string; email: string; role: 'owner' | 'member'; joined_at: string }[];
};
const LS_KEY = 'ffm-cloud-config';

/** Where the Supabase project comes from: pasted in the app > config.json next to index.html > build-time variables. */
export async function loadCloudConfig(): Promise<CloudConfig | null> {
  const ok = (c: unknown): c is CloudConfig => !!c && typeof (c as CloudConfig).url === 'string' && /^https:\/\//.test((c as CloudConfig).url) && typeof (c as CloudConfig).anonKey === 'string' && (c as CloudConfig).anonKey.length > 20;
  try { const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (ok(saved)) return saved; } catch { /* ignore */ }
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) { const j = await res.json(); const c = { url: String(j.supabaseUrl ?? j.url ?? '').trim(), anonKey: String(j.supabaseAnonKey ?? j.anonKey ?? '').trim() }; if (ok(c)) return c; }
  } catch { /* no config.json: normal for a local-only install */ }
  const env = { url: String(import.meta.env?.VITE_SUPABASE_URL ?? '').trim(), anonKey: String(import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '').trim() };   // "?.": there is no import.meta.env outside Vite (tests)
  return ok(env) ? env : null;
}
export const saveCloudConfig = (c: CloudConfig | null) => { if (c) localStorage.setItem(LS_KEY, JSON.stringify(c)); else localStorage.removeItem(LS_KEY); };

export function makeClient(c: CloudConfig): SupabaseClient {
  return createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ffm-auth' } });
}

/** Error messages thrown by setup.sql -> keys in the translations. */
export const FUNCTION_ERRORS = ['not_signed_in', 'already_in_family', 'invalid_code', 'not_owner', 'cannot_remove_self', 'owner_has_members', 'no_family', 'bad_request'] as const;
export function errorCode(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e);
  const known = FUNCTION_ERRORS.find((c) => msg.includes(c));
  if (known) return known;
  if (/invalid login credentials/i.test(msg)) return 'bad_login';
  if (/already registered|already been registered/i.test(msg)) return 'email_taken';
  if (/password should be at least|weak password/i.test(msg)) return 'weak_password';
  if (/email not confirmed/i.test(msg)) return 'email_unconfirmed';
  if (/rate limit|too many/i.test(msg)) return 'rate_limited';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return 'network';
  if (/jwt|not authenticated|401/i.test(msg)) return 'auth_expired';
  return 'unknown';
}

export class SupabaseRemote implements Remote {
  constructor(private client: SupabaseClient, private familyId: string) {}
  async push(rows: PushRow[]) {
    const { error } = await this.client.rpc('push_records', { p_rows: rows });
    if (error) throw error;
  }
  async pull(since: string | null, limit: number): Promise<RemoteRow[]> {
    let q = this.client.from('records').select('tbl,id,data,deleted,ver,updated_at').eq('family_id', this.familyId)
      .order('updated_at', { ascending: true }).order('tbl', { ascending: true }).order('id', { ascending: true }).limit(limit);
    if (since) q = q.gte('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => ({ ...r, ver: Number(r.ver) })) as RemoteRow[];
  }
}

/** Thin wrappers so the screens never touch the Supabase API directly. */
export const api = (client: SupabaseClient) => ({
  async signUp(email: string, password: string) { const { data, error } = await client.auth.signUp({ email, password }); if (error) throw error; return data.session as Session | null; },
  async signIn(email: string, password: string) { const { error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error; },
  async signOut() { const { error } = await client.auth.signOut(); if (error) throw error; },
  async resetPassword(email: string) { const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; },
  async setPassword(password: string) { const { error } = await client.auth.updateUser({ password }); if (error) throw error; },
  async myFamily(): Promise<FamilyInfo | null> { const { data, error } = await client.rpc('my_family'); if (error) throw error; return (data as FamilyInfo | null) ?? null; },
  async createFamily(name: string, display: string): Promise<FamilyInfo> { const { data, error } = await client.rpc('create_family', { p_name: name, p_display: display }); if (error) throw error; return data as FamilyInfo; },
  async joinFamily(code: string, display: string): Promise<FamilyInfo> { const { data, error } = await client.rpc('join_family', { p_code: code, p_display: display }); if (error) throw error; return data as FamilyInfo; },
  async regenerateInvite(): Promise<string> { const { data, error } = await client.rpc('regenerate_invite'); if (error) throw error; return data as string; },
  async removeMember(userId: string) { const { error } = await client.rpc('remove_member', { p_user: userId }); if (error) throw error; },
  async leaveFamily() { const { error } = await client.rpc('leave_family'); if (error) throw error; },
});
