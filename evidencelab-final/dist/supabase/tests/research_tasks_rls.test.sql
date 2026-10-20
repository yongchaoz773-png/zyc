-- Run with a linked/local Supabase project: supabase test db
begin;
select plan(8);

select tests.create_supabase_user('owner');
select tests.create_supabase_user('other_user');

select tests.authenticate_as('owner');
insert into public.research_tasks (user_id, client_task_id, claim, schema_version, task_payload)
values (tests.get_supabase_uid('owner'), 'TASK-RLS-1', 'owner claim', 2, '{"schemaVersion":2}'::jsonb);

select is((select count(*)::integer from public.research_tasks), 1, 'owner can select own task');
select lives_ok($$ update public.research_tasks set status = 'completed' where client_task_id = 'TASK-RLS-1' $$, 'owner can update own task');

select tests.authenticate_as('other_user');
select is((select count(*)::integer from public.research_tasks), 0, 'other user cannot select owner task');
select lives_ok($$ update public.research_tasks set status = 'stolen' where client_task_id = 'TASK-RLS-1' $$, 'other user update is filtered by RLS');
select is((select count(*)::integer from public.research_tasks where status = 'stolen'), 0, 'other user changed no owner rows');
select lives_ok($$ delete from public.research_tasks where client_task_id = 'TASK-RLS-1' $$, 'other user delete is filtered by RLS');

select tests.clear_authentication();
select is((select count(*)::integer from public.research_tasks), 0, 'anon cannot select tasks');
select throws_ok(
  $$ insert into public.research_tasks (user_id, client_task_id, claim, schema_version, task_payload) values (tests.get_supabase_uid('other_user'), 'TASK-RLS-2', 'anon claim', 2, '{}'::jsonb) $$,
  '42501', null, 'anon cannot insert tasks'
);

select * from finish();
rollback;
