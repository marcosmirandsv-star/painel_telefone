-- Fotos dos analistas do telefone e do chat.
alter table public.analysts
  add column if not exists photo_url text;

alter table public.chat_analysts
  add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'analyst-photos',
  'analyst-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "analyst_photos_public_read" on storage.objects;
drop policy if exists "analyst_photos_management_insert" on storage.objects;
drop policy if exists "analyst_photos_management_update" on storage.objects;
drop policy if exists "analyst_photos_management_delete" on storage.objects;

create policy "analyst_photos_public_read"
on storage.objects for select
using (bucket_id = 'analyst-photos');

create policy "analyst_photos_management_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'analyst-photos'
  and public.is_management_user()
);

create policy "analyst_photos_management_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'analyst-photos'
  and public.is_management_user()
)
with check (
  bucket_id = 'analyst-photos'
  and public.is_management_user()
);

create policy "analyst_photos_management_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'analyst-photos'
  and public.is_management_user()
);
