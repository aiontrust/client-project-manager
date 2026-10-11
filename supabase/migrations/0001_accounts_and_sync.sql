-- Accounts and sync for Client & Project Manager.
--
-- A workspace is one company's shared data. People join a workspace as its
-- owner (whoever created it) or as a member (invited by email). Row level
-- security lets only members read or change a workspace's clients, projects
-- and calendar entries.
--
-- Run this once in the Supabase SQL editor. See docs/supabase-setup.md.

-- ---------------------------------------------------------------------------
-- Workspaces, members and invites
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  email text not null,
  name text,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invites (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
create index workspace_invites_email_idx on public.workspace_invites (email);

-- Membership checks used by the policies. SECURITY DEFINER so a policy on
-- workspace_members can call them without recursing into its own policy.
create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Create a workspace with the signed-in person as its owner.
create function public.create_workspace(ws_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  me record;
begin
  select u.id, lower(u.email) as email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as name
    into me
    from auth.users u where u.id = auth.uid();
  if me.id is null then
    raise exception 'Sign in to create a workspace' using errcode = '42501';
  end if;
  insert into public.workspaces (name, created_by) values (trim(ws_name), me.id) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role, email, name)
    values (new_id, me.id, 'owner', me.email, me.name);
  return new_id;
end;
$$;

-- Join every workspace that has invited the signed-in person's verified
-- email address. Returns how many workspaces were joined.
create function public.accept_invites() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me record;
  joined integer;
begin
  select u.id, lower(u.email) as email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as name
    into me
    from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if me.id is null then
    return 0;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, email, name)
    select i.workspace_id, me.id, 'member', me.email, me.name
      from public.workspace_invites i where i.email = me.email
    on conflict (workspace_id, user_id) do nothing;
  get diagnostics joined = row_count;
  delete from public.workspace_invites i where i.email = me.email;
  return joined;
end;
$$;

-- The workspaces the signed-in person belongs to.
create function public.my_workspaces()
returns table (id uuid, name text, role text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.name, m.role
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
   where m.user_id = auth.uid()
   order by w.created_at;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

create policy "Members see their workspace" on public.workspaces
  for select to authenticated using (public.is_member(id));
create policy "Owners rename their workspace" on public.workspaces
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

create policy "Members see who else is in the workspace" on public.workspace_members
  for select to authenticated using (public.is_member(workspace_id));
-- Owners remove members; members can leave. Owners can't remove themselves,
-- so a workspace always keeps an owner.
create policy "Owners remove members, members leave" on public.workspace_members
  for delete to authenticated using (
    (public.is_owner(workspace_id) and role = 'member')
    or (user_id = auth.uid() and role = 'member')
  );

create policy "Members see pending invites" on public.workspace_invites
  for select to authenticated using (public.is_member(workspace_id));
create policy "Owners invite people" on public.workspace_invites
  for insert to authenticated with check (public.is_owner(workspace_id) and invited_by = auth.uid());
create policy "Owners cancel invites" on public.workspace_invites
  for delete to authenticated using (public.is_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- Clients, projects and calendar entries
-- ---------------------------------------------------------------------------
-- Ids are chosen by the app (UUIDs, or fixed ids for example data), so they
-- are unique per workspace rather than globally.

create table public.contacts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(trim(name)) between 1 and 200),
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  notes text not null default '',
  example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  primary key (workspace_id, id)
);

create table public.projects (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(trim(name)) between 1 and 200),
  client_id text not null,
  start_date date,
  end_date date,
  status text not null default 'pending' check (status in ('pending', 'in progress', 'completed')),
  links jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.contacts (workspace_id, id) on delete cascade,
  check (start_date is null or end_date is null or end_date >= start_date)
);
create index projects_client_idx on public.projects (workspace_id, client_id);

create table public.entries (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  title text not null check (char_length(trim(title)) between 1 and 200),
  date date not null,
  project_id text,
  notes text not null default '',
  links jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  primary key (workspace_id, id),
  -- Deleting a project keeps its calendar entries, unlinked.
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete set null (project_id)
);
create index entries_project_idx on public.entries (workspace_id, project_id);

create function public.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger contacts_touch before update on public.contacts for each row execute function public.touch_row();
create trigger projects_touch before update on public.projects for each row execute function public.touch_row();
create trigger entries_touch before update on public.entries for each row execute function public.touch_row();

alter table public.contacts enable row level security;
alter table public.projects enable row level security;
alter table public.entries enable row level security;

create policy "Members work with clients" on public.contacts
  for all to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "Members work with projects" on public.projects
  for all to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "Members work with entries" on public.entries
  for all to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Privileges: signed-in people only; nothing for anonymous visitors.
-- ---------------------------------------------------------------------------

revoke all on public.workspaces, public.workspace_members, public.workspace_invites,
  public.contacts, public.projects, public.entries from anon, public;
grant select, update on public.workspaces to authenticated;
grant select, delete on public.workspace_members to authenticated;
grant select, insert, delete on public.workspace_invites to authenticated;
grant select, insert, update, delete on public.contacts, public.projects, public.entries to authenticated;

revoke execute on function public.is_member(uuid), public.is_owner(uuid), public.create_workspace(text),
  public.accept_invites(), public.my_workspaces(), public.touch_row() from anon, public;
grant execute on function public.is_member(uuid), public.is_owner(uuid), public.create_workspace(text),
  public.accept_invites(), public.my_workspaces() to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates: broadcast changes to these tables to signed-in members.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.contacts, public.projects, public.entries;
  end if;
end;
$$;
