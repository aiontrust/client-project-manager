-- Access rule tests for supabase/migrations. Each check raises an error on
-- failure, so psql (run with ON_ERROR_STOP) stops at the first broken rule.
--
-- People: Olivia owns Acme; Mark is a member of Acme; Nina is outside;
-- Ivy has been invited to Acme; Una has an unverified email.

\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'Olivia@Example.com', now(), '{"full_name":"Olivia Owner"}'),
  ('00000000-0000-0000-0000-00000000000b', 'mark@example.com', now(), '{"name":"Mark Member"}'),
  ('00000000-0000-0000-0000-00000000000c', 'nina@example.com', now(), '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'ivy@example.com', now(), '{}'),
  ('00000000-0000-0000-0000-00000000000e', 'una@example.com', null, '{}');

create function pg_temp.act_as(who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case who
      when 'olivia' then '{"sub":"00000000-0000-0000-0000-00000000000a"}'
      when 'mark'   then '{"sub":"00000000-0000-0000-0000-00000000000b"}'
      when 'nina'   then '{"sub":"00000000-0000-0000-0000-00000000000c"}'
      when 'ivy'    then '{"sub":"00000000-0000-0000-0000-00000000000d"}'
      when 'una'    then '{"sub":"00000000-0000-0000-0000-00000000000e"}'
      else '' end, false);
end;
$$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok   %', what;
end;
$$;
-- Runs a statement and reports whether it was refused with an error.
create function pg_temp.refused(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end;
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated, anon;

set client_min_messages = notice;
set role authenticated;

-- Creating a workspace -------------------------------------------------------
select pg_temp.act_as('olivia');
insert into ids select 'acme', public.create_workspace('  Acme Studio ');
select pg_temp.check((select count(*) = 1 from public.my_workspaces() where name = 'Acme Studio' and role = 'owner'),
  'creator becomes owner of a trimmed-name workspace');
select pg_temp.check((select email = 'olivia@example.com' and name = 'Olivia Owner' from public.workspace_members
  where user_id = '00000000-0000-0000-0000-00000000000a'), 'owner email is lower-cased and name copied');

select pg_temp.act_as('nina');
insert into ids select 'other', public.create_workspace('Nina Co');

select pg_temp.act_as('');
select pg_temp.check(pg_temp.refused($$ select public.create_workspace('Ghost') $$), 'signed-out people cannot create a workspace');

-- Data belongs to members only -------------------------------------------
select pg_temp.act_as('olivia');
insert into public.contacts (workspace_id, id, name) select id, 'c1', 'Maya' from ids where name = 'acme';
insert into public.projects (workspace_id, id, name, client_id, start_date, end_date, links)
  select id, 'p1', 'Website', 'c1', '2026-10-01', '2026-10-30', '[{"label":"Drive","url":"https://drive.google.com/x"}]' from ids where name = 'acme';
insert into public.entries (workspace_id, id, title, date, project_id) select id, 'e1', 'Review', '2026-10-14', 'p1' from ids where name = 'acme';
select pg_temp.check((select count(*) = 1 from public.projects), 'owner reads their projects');

select pg_temp.act_as('nina');
select pg_temp.check((select count(*) = 0 from public.contacts) and (select count(*) = 0 from public.projects)
  and (select count(*) = 0 from public.entries), 'outsider sees no Acme data');
select pg_temp.check((select count(*) = 0 from public.workspace_members where workspace_id = (select id from ids where name = 'acme')),
  'outsider cannot list Acme members');
select pg_temp.check(pg_temp.refused($$ insert into public.contacts (workspace_id, id, name) select id, 'x', 'Spy' from ids where name = 'acme' $$),
  'outsider cannot add a client to Acme');
update public.contacts set name = 'Hacked' where id = 'c1';
delete from public.projects where id = 'p1';
select pg_temp.act_as('olivia');
select pg_temp.check((select name = 'Maya' from public.contacts where id = 'c1') and (select count(*) = 1 from public.projects),
  'outsider updates and deletes change nothing');

select pg_temp.act_as('');
select pg_temp.check((select count(*) = 0 from public.contacts), 'signed-out people see nothing');
reset role;
set role anon;
select pg_temp.check(pg_temp.refused($$ select * from public.contacts $$), 'anonymous role has no table access');
reset role;
set role authenticated;

-- Invites ----------------------------------------------------------------
select pg_temp.act_as('mark');
select pg_temp.check(pg_temp.refused($$ insert into public.workspace_invites (workspace_id, email) select id, 'x@example.com' from ids where name = 'acme' $$),
  'non-members cannot invite');

select pg_temp.act_as('olivia');
insert into public.workspace_invites (workspace_id, email) select id, 'mark@example.com' from ids where name = 'acme';
insert into public.workspace_invites (workspace_id, email) select id, 'ivy@example.com' from ids where name = 'acme';
insert into public.workspace_invites (workspace_id, email) select id, 'una@example.com' from ids where name = 'acme';
select pg_temp.check(pg_temp.refused($$ insert into public.workspace_invites (workspace_id, email) select id, 'Not An Email' from ids where name = 'acme' $$),
  'invites need a valid lower-case email');
select pg_temp.check(pg_temp.refused($$ insert into public.workspace_invites (workspace_id, email) select id, 'z@example.com' from ids where name = 'other' $$),
  'owners cannot invite into someone else''s workspace');

select pg_temp.act_as('nina');
select pg_temp.check((select count(*) = 0 from public.workspace_invites), 'outsiders cannot see invites');

select pg_temp.act_as('mark');
select pg_temp.check(public.accept_invites() = 1, 'invited person joins on sign-in');
select pg_temp.check((select role = 'member' from public.my_workspaces() where id = (select id from ids where name = 'acme')), 'they join as a member');
select pg_temp.check((select count(*) = 1 from public.projects), 'new member reads workspace data');
update public.projects set status = 'in progress' where id = 'p1';
select pg_temp.check((select status = 'in progress' and updated_by = '00000000-0000-0000-0000-00000000000b' from public.projects where id = 'p1'),
  'member edits are saved and stamped with who made them');
select pg_temp.check((select count(*) = 0 from public.workspace_invites where email = 'mark@example.com'), 'accepted invite is cleared');
select pg_temp.check(pg_temp.refused($$ insert into public.workspace_invites (workspace_id, email) select id, 'y@example.com' from ids where name = 'acme' $$),
  'members cannot invite, only owners');
select pg_temp.check(public.accept_invites() = 0, 'accepting again is harmless');

select pg_temp.act_as('una');
select pg_temp.check(public.accept_invites() = 0 and (select count(*) = 0 from public.my_workspaces()),
  'unverified email cannot claim an invite');

-- Removing people -------------------------------------------------------
select pg_temp.act_as('mark');
delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.act_as('olivia');
select pg_temp.check((select count(*) = 1 from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000a'),
  'members cannot remove the owner');
delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) = 1 from public.my_workspaces()), 'the owner cannot remove themselves');
delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.act_as('mark');
select pg_temp.check((select count(*) = 0 from public.projects) and (select count(*) = 0 from public.my_workspaces()),
  'removed member loses access');

select pg_temp.act_as('ivy');
select pg_temp.check(public.accept_invites() = 1, 'second invitee joins');
delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check((select count(*) = 0 from public.my_workspaces()), 'members can leave');

-- Data rules ------------------------------------------------------------
select pg_temp.act_as('olivia');
select pg_temp.check(pg_temp.refused($$ insert into public.projects (workspace_id, id, name, client_id, start_date, end_date) select id, 'p2', 'Bad', 'c1', '2026-10-10', '2026-10-01' from ids where name = 'acme' $$),
  'due date cannot be before start date');
select pg_temp.check(pg_temp.refused($$ insert into public.projects (workspace_id, id, name, client_id, status) select id, 'p3', 'Bad', 'c1', 'done' from ids where name = 'acme' $$),
  'status must be one of the three statuses');
select pg_temp.check(pg_temp.refused($$ insert into public.projects (workspace_id, id, name, client_id) select id, 'p4', 'Orphan', 'nope' from ids where name = 'acme' $$),
  'a project needs an existing client');
select pg_temp.act_as('nina');
insert into public.contacts (workspace_id, id, name) select id, 'c1', 'Nina''s own c1' from ids where name = 'other';
select pg_temp.check((select count(*) = 1 from public.contacts where id = 'c1'), 'ids only need to be unique within a workspace');

select pg_temp.act_as('olivia');
delete from public.projects where id = 'p1';
select pg_temp.check((select project_id is null from public.entries where id = 'e1'), 'deleting a project keeps its entries, unlinked');
insert into public.projects (workspace_id, id, name, client_id) select id, 'p5', 'Logo', 'c1' from ids where name = 'acme';
delete from public.contacts where id = 'c1';
select pg_temp.check((select count(*) = 0 from public.projects), 'deleting a client deletes their projects');

-- Drive preview images -------------------------------------------------
reset role;
select pg_temp.check((select public = false and allowed_mime_types = array['image/jpeg'] from storage.buckets where id = 'previews'),
  'previews bucket is private and only takes JPEGs');
set role authenticated;
create temp table paths (who text primary key, path text);
grant all on paths to authenticated;
insert into paths select 'acme', id || '/' || gen_random_uuid() || '.jpg' from ids where name = 'acme';
insert into paths select 'other', id || '/' || gen_random_uuid() || '.jpg' from ids where name = 'other';

select pg_temp.act_as('olivia');
insert into storage.objects (bucket_id, name) select 'previews', path from paths where who = 'acme';
select pg_temp.check((select count(*) = 1 from storage.objects), 'members add and see previews in their workspace');
select pg_temp.check(pg_temp.refused($$ insert into storage.objects (bucket_id, name) select 'previews', path from paths where who = 'other' $$),
  'members cannot add previews to another workspace');
select pg_temp.check(pg_temp.refused($$ insert into storage.objects (bucket_id, name) select 'previews', id || '/../escape.jpg' from ids where name = 'acme' $$),
  'preview paths must be <workspace>/<id>.jpg');
select pg_temp.check(pg_temp.refused($$ insert into storage.objects (bucket_id, name) values ('previews', 'not-a-workspace/' || gen_random_uuid() || '.jpg') $$),
  'previews outside any workspace are refused');

select pg_temp.act_as('nina');
select pg_temp.check((select count(*) = 0 from storage.objects), 'outsiders cannot see a workspace''s previews');
delete from storage.objects;
select pg_temp.act_as('mark');
select pg_temp.check((select count(*) = 0 from storage.objects), 'removed members lose access to previews');
select pg_temp.act_as('olivia');
select pg_temp.check((select count(*) = 1 from storage.objects), 'outsider deletes change nothing');
delete from storage.objects;
select pg_temp.check((select count(*) = 0 from storage.objects), 'members delete their workspace''s previews');

select pg_temp.act_as('');
select pg_temp.check(pg_temp.refused($$ insert into storage.objects (bucket_id, name) select 'previews', path from paths where who = 'acme' $$),
  'signed-out visitors cannot add previews');

reset role;
select pg_temp.check((select count(*) = 3 from pg_publication_tables where pubname = 'supabase_realtime'),
  'clients, projects and entries broadcast live changes');
do $$ begin raise notice 'All database checks passed.'; end $$;
