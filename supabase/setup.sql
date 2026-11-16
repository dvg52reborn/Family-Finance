-- Family Finance Manager: cloud setup for Supabase.
-- Run ONCE: Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- It is safe to run again (it only adds what is missing and refreshes the functions).
--
-- How it keeps your data private: nothing here is readable without signing in, and a signed-in person can only read the
-- records of the family they belong to. Writing goes through the functions below, never straight into the tables.

-- ============ tables ============
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  invite_code text not null unique,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  family_id    uuid not null references public.families (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  display_name text not null default '',
  email        text not null default '',
  joined_at    timestamptz not null default now(),
  primary key (family_id, user_id),
  unique (user_id)                      -- one family per account
);

-- Every shared record of the app (expenses, income, budgets, ...) is one row here. "ver" is the time of the edit on the
-- device that made it: when two devices edit the same record, the later edit wins. Deleted records stay as "deleted" rows
-- so that devices that were offline still learn about the deletion.
create table if not exists public.records (
  family_id  uuid not null references public.families (id) on delete cascade,
  tbl        text not null check (tbl in ('expenses', 'categories', 'auditLog', 'budgets', 'income', 'conversions', 'settings')),
  id         text not null check (length(id) between 1 and 200),
  data       jsonb,
  deleted    boolean not null default false,
  ver        bigint not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (family_id, tbl, id),
  check (deleted or jsonb_typeof(data) = 'object')
);
create index if not exists records_family_updated_idx on public.records (family_id, updated_at);

-- ============ access rules ============
alter table public.families enable row level security;
alter table public.members  enable row level security;
alter table public.records  enable row level security;

create or replace function public.is_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.family_id = fam and m.user_id = auth.uid())
$$;

drop policy if exists "members read their family"  on public.families;
drop policy if exists "members read their members" on public.members;
drop policy if exists "members read their records" on public.records;
create policy "members read their family"  on public.families for select to authenticated using (public.is_member(id));
create policy "members read their members" on public.members  for select to authenticated using (public.is_member(family_id));
create policy "members read their records" on public.records  for select to authenticated using (public.is_member(family_id));

revoke all on public.families, public.members, public.records from anon, authenticated;
grant select on public.families, public.members, public.records to authenticated;

-- ============ functions the app calls ============
create or replace function public.gen_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- no 0/O/1/I to avoid typing mistakes
  code text; i int;
begin
  loop
    code := '';
    for i in 1..10 loop
      code := code || substr(alphabet, 1 + (get_byte(decode(substr(replace(gen_random_uuid()::text, '-', ''), 1, 2), 'hex'), 0) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.families where invite_code = code);
  end loop;
  return code;
end $$;

create or replace function public.my_family() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); fam public.families; me public.members;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into me from public.members where user_id = uid;
  if not found then return null; end if;
  select * into fam from public.families where id = me.family_id;
  return jsonb_build_object(
    'id', fam.id, 'name', fam.name, 'role', me.role,
    'invite_code', case when me.role = 'owner' then fam.invite_code else null end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name, 'email', m.email, 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
                from public.members m where m.family_id = fam.id));
end $$;

create or replace function public.create_family(p_name text, p_display text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); fid uuid;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'bad_request'; end if;
  if exists (select 1 from public.members where user_id = uid) then raise exception 'already_in_family'; end if;
  insert into public.families (name, invite_code, created_by) values (trim(p_name), public.gen_invite_code(), uid) returning id into fid;
  insert into public.members (family_id, user_id, role, display_name, email)
    values (fid, uid, 'owner', left(trim(coalesce(p_display, '')), 60), coalesce(auth.jwt() ->> 'email', ''));
  return public.my_family();
end $$;

create or replace function public.join_family(p_code text, p_display text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); fid uuid;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.members where user_id = uid) then raise exception 'already_in_family'; end if;
  select id into fid from public.families where invite_code = upper(trim(coalesce(p_code, '')));
  if fid is null then raise exception 'invalid_code'; end if;
  insert into public.members (family_id, user_id, role, display_name, email)
    values (fid, uid, 'member', left(trim(coalesce(p_display, '')), 60), coalesce(auth.jwt() ->> 'email', ''));
  return public.my_family();
end $$;

create or replace function public.regenerate_invite() returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); fid uuid; code text;
begin
  select family_id into fid from public.members where user_id = uid and role = 'owner';
  if fid is null then raise exception 'not_owner'; end if;
  code := public.gen_invite_code();
  update public.families set invite_code = code where id = fid;
  return code;
end $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); fid uuid;
begin
  select family_id into fid from public.members where user_id = uid and role = 'owner';
  if fid is null then raise exception 'not_owner'; end if;
  if p_user = uid then raise exception 'cannot_remove_self'; end if;
  delete from public.members where family_id = fid and user_id = p_user;
end $$;

-- Members just leave. The owner can leave only when alone, which deletes the family and its records.
create or replace function public.leave_family() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.members;
begin
  select * into me from public.members where user_id = uid;
  if not found then return; end if;
  if me.role = 'owner' then
    if exists (select 1 from public.members where family_id = me.family_id and user_id <> uid) then raise exception 'owner_has_members'; end if;
    delete from public.families where id = me.family_id;
  else
    delete from public.members where user_id = uid;
  end if;
end $$;

-- Stores records sent by a device. A record only replaces what is stored if its ver is not older (later edit wins).
create or replace function public.push_records(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); fid uuid; n integer;
begin
  select family_id into fid from public.members where user_id = uid;
  if fid is null then raise exception 'no_family'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'bad_request'; end if;
  insert into public.records (family_id, tbl, id, data, deleted, ver)
  select distinct on (e ->> 'tbl', e ->> 'id')
         fid, e ->> 'tbl', e ->> 'id',
         case when coalesce((e ->> 'deleted')::boolean, false) then null else e -> 'data' end,
         coalesce((e ->> 'deleted')::boolean, false), (e ->> 'ver')::bigint
  from jsonb_array_elements(p_rows) e
  order by e ->> 'tbl', e ->> 'id', (e ->> 'ver')::bigint desc
  on conflict (family_id, tbl, id) do update
    set data = excluded.data, deleted = excluded.deleted, ver = excluded.ver, updated_at = clock_timestamp()
    where public.records.ver <= excluded.ver;
  get diagnostics n = row_count;
  return n;
end $$;

-- Only signed-in people may call these (never anonymous visitors).
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_member(uuid), public.my_family(), public.create_family(text, text), public.join_family(text, text),
  public.regenerate_invite(), public.remove_member(uuid), public.leave_family(), public.push_records(jsonb) to authenticated;

-- ============ live updates (other devices refresh within a second) ============
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.records;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
