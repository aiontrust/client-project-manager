-- Preview images for photos attached from Google Drive.
--
-- When someone attaches a Drive photo, the app saves a small JPEG copy at
-- previews/<workspace id>/<random id>.jpg so everyone in the workspace can
-- see it, on any device, without needing access to the Drive file. Only
-- members of that workspace can read, add or delete its previews.
--
-- Run this once in the Supabase SQL editor, after 0001. See
-- docs/google-drive-setup.md.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', false, 262144, array['image/jpeg'])
on conflict (id) do nothing;

-- The workspace a preview belongs to: the first folder of its path, or
-- null when the path doesn't start with a workspace id.
create function public.preview_workspace(object_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return folder::uuid;
  end if;
  return null;
end;
$$;
revoke execute on function public.preview_workspace(text) from anon, public;
grant execute on function public.preview_workspace(text) to authenticated;

create policy "Members see their workspace's previews" on storage.objects
  for select to authenticated
  using (bucket_id = 'previews' and public.is_member(public.preview_workspace(name)));

create policy "Members add previews to their workspace" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'previews'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
    and public.is_member(public.preview_workspace(name))
  );

create policy "Members delete their workspace's previews" on storage.objects
  for delete to authenticated
  using (bucket_id = 'previews' and public.is_member(public.preview_workspace(name)));
