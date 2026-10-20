begin;

create table if not exists public.research_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_task_id text not null,
  claim text not null,
  company_name text,
  company_code text,
  current_period text,
  comparison_period text,
  metric_keys text[] not null default '{}',
  status text not null default 'researching',
  schema_version integer not null check (schema_version > 0),
  version integer not null default 1 check (version > 0),
  subquestions jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  conclusions jsonb not null default '[]'::jsonb,
  model_status jsonb not null default '{}'::jsonb,
  rule_result jsonb not null default '{}'::jsonb,
  data_snapshot jsonb not null default '{}'::jsonb,
  task_payload jsonb not null,
  last_researched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_task_id)
);

create index if not exists research_tasks_user_id_idx on public.research_tasks using btree (user_id);
create index if not exists research_tasks_user_updated_idx on public.research_tasks using btree (user_id, updated_at desc);

create or replace function public.set_research_task_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists research_tasks_set_updated_at on public.research_tasks;
create trigger research_tasks_set_updated_at
before update on public.research_tasks
for each row execute function public.set_research_task_updated_at();

alter table public.research_tasks enable row level security;
alter table public.research_tasks force row level security;

revoke all on table public.research_tasks from anon;
grant select, insert, update, delete on table public.research_tasks to authenticated;

drop policy if exists research_tasks_select_own on public.research_tasks;
create policy research_tasks_select_own on public.research_tasks
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists research_tasks_insert_own on public.research_tasks;
create policy research_tasks_insert_own on public.research_tasks
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists research_tasks_update_own on public.research_tasks;
create policy research_tasks_update_own on public.research_tasks
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists research_tasks_delete_own on public.research_tasks;
create policy research_tasks_delete_own on public.research_tasks
for delete to authenticated
using ((select auth.uid()) = user_id);

commit;
