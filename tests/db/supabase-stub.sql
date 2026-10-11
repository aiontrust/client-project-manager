set client_min_messages = error;
-- The parts of a Supabase database the migration relies on, so it can be
-- tested on plain Postgres: the anon/authenticated roles, auth.users,
-- auth.uid() (read from the request's JWT claims, as Supabase does) and the
-- realtime publication.

create role anon nologin;
create role authenticated nologin;

create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated;

create publication supabase_realtime;
