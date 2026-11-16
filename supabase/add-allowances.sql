-- Run ONCE in the Supabase SQL editor of the existing project (before the allowances version is used with sync).
-- Lets the shared records table store allowances. Safe to run more than once.
alter table public.records drop constraint if exists records_tbl_check;
alter table public.records add constraint records_tbl_check
  check (tbl in ('expenses', 'categories', 'auditLog', 'budgets', 'allowances', 'income', 'conversions', 'settings'));
