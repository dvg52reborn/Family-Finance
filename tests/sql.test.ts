import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Runs the real setup.sql on a real Postgres (PGlite) with a stand-in for Supabase's "auth" schema.
const pg = new PGlite();
await pg.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
  create role anon nologin; create role authenticated nologin;
  create publication supabase_realtime;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
`);
const sql = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
await pg.exec(sql); await pg.exec(sql);                                    // running it twice must be harmless

const users: Record<string, string> = {};
for (const [name, email] of [['ann', 'ann@x.com'], ['ben', 'ben@x.com'], ['cy', 'cy@x.com'], ['dee', 'dee@x.com']]) {
  users[name] = (await pg.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
}
/** Run statements as a signed-in user (role "authenticated"), like the Supabase API does. */
async function as<T = unknown>(who: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  if (who) await pg.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.email', $2, false)`, [users[who], `${who}@x.com`]);
  else await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
  try { return await fn(); } finally { await pg.exec('reset role'); }
}
const call = (who: string | null, q: string, params: unknown[] = []) => as(who, async () => (await pg.query(q, params)).rows as Record<string, unknown>[]);
const fails = async (who: string | null, q: string, params: unknown[], msg: RegExp) => assert.rejects(call(who, q, params), msg);

// ---- family: create, join, roles ----
const fam = (await call('ann', `select public.create_family('Mensah family', 'Ann') as f`))[0].f as { id: string; role: string; invite_code: string; members: { email: string }[] };
assert.equal(fam.role, 'owner'); assert.match(fam.invite_code, /^[A-HJ-NP-Z2-9]{10}$/); assert.equal(fam.members[0].email, 'ann@x.com');
await fails('ann', `select public.create_family('Second', 'Ann')`, [], /already_in_family/);
await fails('ben', `select public.join_family('WRONGCODE1', 'Ben')`, [], /invalid_code/);
await fails(null, `select public.my_family()`, [], /permission denied|not_signed_in/);                          // anonymous visitors are shut out
const joined = (await call('ben', `select public.join_family(lower($1), 'Ben') as f`, [fam.invite_code]))[0].f as { role: string; invite_code: unknown; members: unknown[] };
assert.equal(joined.role, 'member'); assert.equal(joined.invite_code, null); assert.equal(joined.members.length, 2);   // members do not see the code
await fails('ann', `select public.join_family('X', 'x')`, [], /already_in_family/);
await fails('ben', `select public.regenerate_invite()`, [], /not_owner/);
const newCode = (await call('ann', `select public.regenerate_invite() as c`))[0].c as string;
assert.notEqual(newCode, fam.invite_code); await fails('cy', `select public.join_family($1, 'Cy')`, [fam.invite_code], /invalid_code/);   // old code is dead
await call('cy', `select public.join_family($1, 'Cy')`, [newCode]);

// ---- records: push, last edit wins, tombstones, paging order ----
const push = (who: string, rows: unknown[]) => call(who, `select public.push_records($1::jsonb) as n`, [JSON.stringify(rows)]);
const row = (id: string, amount: number, ver: number, extra: object = {}) => ({ tbl: 'expenses', id, data: { id: Number(id), amount }, deleted: false, ver, ...extra });
assert.equal((await push('ann', [row('1', 10, 100), row('2', 20, 100)]))[0].n, 2);
assert.equal((await push('ben', [row('1', 11, 50)]))[0].n, 0);                                                    // older edit is ignored
assert.equal((await push('ben', [row('1', 12, 200)]))[0].n, 1);                                                   // later edit wins
assert.equal((await push('cy', [row('1', 13, 200)]))[0].n, 1);                                                    // equal ver is accepted (same device re-sending)
assert.equal((await push('ann', [row('2', 0, 300, { deleted: true, data: null })]))[0].n, 1);                    // deletion
assert.equal((await push('ann', [row('2', 21, 250)]))[0].n, 0);                                                   // an older edit cannot undo a newer deletion
assert.equal((await push('ann', [row('3', 1, 5), row('3', 2, 9)]))[0].n, 1);                                     // same record twice in one push: the later one is stored
const rec = async (who: string) => call(who, `select tbl, id, data, deleted, ver::int as ver from public.records order by id`);
const seen = await rec('ben');
assert.deepEqual(seen.map((r) => [r.id, r.deleted, r.ver]), [['1', false, 200], ['2', true, 300], ['3', false, 9]]);
assert.deepEqual((seen[0].data as { amount: number }).amount, 13); assert.equal(seen[1].data, null);
await fails('ann', `select public.push_records('[{"tbl":"evil","id":"1","data":{},"deleted":false,"ver":1}]'::jsonb)`, [], /records_tbl_check|violates check/);
await fails('ann', `select public.push_records('[{"tbl":"expenses","id":"9","data":"text","deleted":false,"ver":1}]'::jsonb)`, [], /violates check/);
await fails('ann', `select public.push_records('{"not":"an array"}'::jsonb)`, [], /bad_request/);
await fails('dee', `select public.push_records('[]'::jsonb)`, [], /no_family/);                                      // not in any family

// pulling in order: later changes have later timestamps, and "changed since" returns them
const changed = await call('ben', `select id from public.records order by updated_at, tbl, id`);
assert.equal(changed.at(-1)!.id, '3');
const t0 = (await call('ben', `select updated_at from public.records where id = '1'`))[0].updated_at as Date;
assert.ok((await call('ben', `select id from public.records where updated_at >= $1`, [t0])).length >= 2);

// ---- privacy ----
assert.equal((await rec('dee')).length, 0);                                                                       // outsider sees nothing
const fam2 = (await call('dee', `select public.create_family('Other family', 'Dee') as f`))[0].f as { id: string };
await push('dee', [row('1', 999, 1)]);
assert.equal((await rec('dee')).length, 1); assert.deepEqual((await rec('ann')).map((r) => r.id), ['1', '2', '3']);   // families never see each other
assert.equal((await call('ann', `select data from public.records where id = '1'`))[0].data !== null, true);
assert.equal(((await call('ann', `select data->>'amount' as a from public.records where id = '1'`))[0].a), '13');   // Ann still sees her family's value, not Dee's 999
await fails('ann', `insert into public.records (family_id, tbl, id, data, ver) values ('${fam.id}', 'expenses', '55', '{}', 1)`, [], /permission denied/);   // no direct writes
await fails('ann', `update public.records set data = '{}'`, [], /permission denied/);
await fails('ann', `delete from public.records`, [], /permission denied/);
await fails('ann', `update public.families set name = 'hacked'`, [], /permission denied/);
await fails('ann', `insert into public.members (family_id, user_id) values ('${fam2.id}', '${users.ann}')`, [], /permission denied/);
await fails(null, `select * from public.records`, [], /permission denied/);
assert.equal((await call('ben', `select count(*)::int as n from public.families`))[0].n, 1);

// ---- membership management ----
await fails('ben', `select public.remove_member('${users.cy}')`, [], /not_owner/);
await fails('ann', `select public.remove_member('${users.ann}')`, [], /cannot_remove_self/);
await call('ann', `select public.remove_member('${users.cy}')`);
assert.equal((await rec('cy')).length, 0);                                                                        // removed: access gone at once
await fails('ann', `select public.leave_family()`, [], /owner_has_members/);
await call('ben', `select public.leave_family()`); assert.equal((await rec('ben')).length, 0);
await call('ann', `select public.leave_family()`);                                                                // last one out deletes the family
assert.equal((await pg.query(`select count(*)::int as n from public.records where family_id = '${fam.id}'`)).rows[0].n, 0);
assert.equal((await pg.query(`select count(*)::int as n from public.families`)).rows[0].n, 1);
console.log('sql tests passed');
