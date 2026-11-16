import assert from 'node:assert/strict';
import { FUNCTION_ERRORS, errorCode, loadCloudConfig, saveCloudConfig } from '../src/lib/sync/cloud';
import { messages } from '../src/lib/i18n';

/* ---------- errorCode ---------- */
// errors raised by setup.sql arrive as { message: 'invalid_code' } (Supabase wraps them), sometimes with extra text around
for (const code of FUNCTION_ERRORS) {
  assert.equal(errorCode({ message: code }), code);
  assert.equal(errorCode(new Error(`P0001: ${code} (hint)`)), code);
}
assert.equal(errorCode({ message: 'Invalid login credentials' }), 'bad_login');
assert.equal(errorCode({ message: 'User already registered' }), 'email_taken');
assert.equal(errorCode({ message: 'A user with this email address has already been registered' }), 'email_taken');
assert.equal(errorCode({ message: 'Password should be at least 6 characters' }), 'weak_password');
assert.equal(errorCode({ message: 'Email not confirmed' }), 'email_unconfirmed');
assert.equal(errorCode({ message: 'email rate limit exceeded' }), 'rate_limited');   // Supabase's built-in e-mail sender: only a few mails per hour
assert.equal(errorCode({ message: 'For security purposes, you can only request this after 45 seconds. Too many requests' }), 'rate_limited');
for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Network request failed']) assert.equal(errorCode(new TypeError(m)), 'network', m);
assert.equal(errorCode({ message: 'JWT expired' }), 'auth_expired');
assert.equal(errorCode({ message: 'Not authenticated' }), 'auth_expired');
assert.equal(errorCode('invalid_code'), 'invalid_code');                                // a bare string works too
for (const odd of [null, undefined, 42, {}, { message: '' }, { message: 'something nobody planned for' }]) assert.equal(errorCode(odd), 'unknown', String(odd));
// every code that errorCode can return has a message in both languages (a missing one would show the generic text, or nothing)
const allCodes = [...FUNCTION_ERRORS, 'bad_login', 'email_taken', 'weak_password', 'email_unconfirmed', 'rate_limited', 'network', 'auth_expired', 'unknown'];
for (const lang of ['en', 'fr'] as const) for (const c of allCodes) assert.ok((messages[lang] as Record<string, string>)[`cloudErr_${c}`]?.trim(), `${lang}: missing cloudErr_${c}`);

/* ---------- loadCloudConfig: order is pasted in the app > config.json > build-time variables ---------- */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) } });
let file: { status: number; body: unknown } | 'throw' = { status: 404, body: null };
let fetched = 0;
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string) => {
  fetched++; assert.equal(url, './config.json');
  if (file === 'throw') throw new TypeError('Failed to fetch');
  const f = file; return { ok: f.status === 200, json: async () => { if (f.body === 'not json') throw new SyntaxError('bad json'); return f.body; } };
} });
const KEY = 'k'.repeat(40), URL = 'https://abcd.supabase.co';
const reset = () => { store.clear(); file = { status: 404, body: null }; fetched = 0; };

reset(); assert.equal(await loadCloudConfig(), null);                                    // nothing configured: the app is local-only
reset(); file = { status: 200, body: { supabaseUrl: URL, supabaseAnonKey: KEY } };
assert.deepEqual(await loadCloudConfig(), { url: URL, anonKey: KEY });                  // names used in public/config.json
reset(); file = { status: 200, body: { url: URL, anonKey: KEY } };
assert.deepEqual(await loadCloudConfig(), { url: URL, anonKey: KEY });                  // short names also accepted
reset(); file = { status: 200, body: { supabaseUrl: `  ${URL}  `, supabaseAnonKey: `\n${KEY} ` } };
assert.deepEqual(await loadCloudConfig(), { url: URL, anonKey: KEY });                  // pasted with stray spaces
reset(); saveCloudConfig({ url: 'https://saved.supabase.co', anonKey: 'S'.repeat(30) }); file = { status: 200, body: { supabaseUrl: URL, supabaseAnonKey: KEY } };
assert.deepEqual(await loadCloudConfig(), { url: 'https://saved.supabase.co', anonKey: 'S'.repeat(30) }); assert.equal(fetched, 0);   // pasted in the app wins, config.json is not even read
reset(); store.set('ffm-cloud-config', JSON.stringify({ url: 'http://insecure.example', anonKey: KEY })); file = { status: 200, body: { supabaseUrl: URL, supabaseAnonKey: KEY } };
assert.deepEqual(await loadCloudConfig(), { url: URL, anonKey: KEY });                  // saved value is invalid (not https): fall through to config.json
reset(); store.set('ffm-cloud-config', '{broken'); file = { status: 200, body: { supabaseUrl: URL, supabaseAnonKey: KEY } };
assert.deepEqual(await loadCloudConfig(), { url: URL, anonKey: KEY });                  // damaged saved value is ignored, no crash
reset(); file = { status: 200, body: { supabaseUrl: 'http://x.example', supabaseAnonKey: KEY } }; assert.equal(await loadCloudConfig(), null);   // https only
reset(); file = { status: 200, body: { supabaseUrl: URL, supabaseAnonKey: 'k'.repeat(20) } }; assert.equal(await loadCloudConfig(), null);      // key must be longer than 20 characters
reset(); file = { status: 200, body: { supabaseUrl: URL, supabaseAnonKey: 'k'.repeat(21) } }; assert.ok(await loadCloudConfig());
reset(); file = { status: 200, body: { supabaseUrl: URL } }; assert.equal(await loadCloudConfig(), null);                                        // key missing
reset(); file = { status: 200, body: { supabaseUrl: '', supabaseAnonKey: '' } }; assert.equal(await loadCloudConfig(), null);                  // example file left blank
reset(); file = { status: 200, body: 'not json' }; assert.equal(await loadCloudConfig(), null);                                                // broken config.json
reset(); file = { status: 200, body: null }; assert.equal(await loadCloudConfig(), null);                                                      // empty config.json
reset(); file = 'throw'; assert.equal(await loadCloudConfig(), null);                                                                           // offline with no config: local-only, no crash
// save / remove round trip
reset(); saveCloudConfig({ url: URL, anonKey: KEY }); assert.deepEqual(await loadCloudConfig(), { url: URL, anonKey: KEY });
saveCloudConfig(null); assert.equal(store.has('ffm-cloud-config'), false); assert.equal(await loadCloudConfig(), null);

console.log('cloud tests passed');
