-- APALINK shared backend — run once in Supabase SQL Editor (free)
create table if not exists public.apalink_users (
  username text primary key,
  display_name text not null default '',
  class_name text default '',
  department text default '',
  level text default '',
  pass_hash text not null,
  role text default '',
  created_at date default current_date
);
alter table public.apalink_users enable row level security;
grant select, insert, update, delete on table public.apalink_users to anon, authenticated;
grant usage on schema public to anon, authenticated;
drop policy if exists "nn users read" on public.apalink_users;
drop policy if exists "nn users insert" on public.apalink_users;
drop policy if exists "nn users update" on public.apalink_users;
create policy "nn users read" on public.apalink_users for select using (true);
create policy "nn users insert" on public.apalink_users for insert with check (true);
create policy "nn users update" on public.apalink_users for update using (true) with check (true);

create table if not exists public.apalink_notes (
  id text primary key,
  title text not null,
  subject text not null,
  level text default '',
  author text not null,
  level_class text default '',
  tags text default '',
  description text default '',
  filename text not null,
  filesize text default '',
  mimetype text default '',
  storage_path text default '',
  public_url text default '',
  downloads int default 0,
  views int default 0,
  created_at date default current_date
);
alter table public.apalink_notes enable row level security;
grant select, insert, update, delete on table public.apalink_notes to anon, authenticated;
drop policy if exists "nn notes read" on public.apalink_notes;
drop policy if exists "nn notes insert" on public.apalink_notes;
drop policy if exists "nn notes update" on public.apalink_notes;
drop policy if exists "nn notes delete" on public.apalink_notes;
create policy "nn notes read" on public.apalink_notes for select using (true);
create policy "nn notes insert" on public.apalink_notes for insert with check (true);
create policy "nn notes update" on public.apalink_notes for update using (true) with check (true);
create policy "nn notes delete" on public.apalink_notes for delete using (true);

insert into storage.buckets (id, name, public) values ('apalinks','apalinks', true) on conflict (id) do nothing;
drop policy if exists "nn files read" on storage.objects;
drop policy if exists "nn files upload" on storage.objects;
drop policy if exists "nn files update" on storage.objects;
drop policy if exists "nn files delete" on storage.objects;
create policy "nn files read" on storage.objects for select using (bucket_id='apalinks');
create policy "nn files upload" on storage.objects for insert with check (bucket_id='apalinks');
create policy "nn files update" on storage.objects for update using (bucket_id='apalinks');
create policy "nn files delete" on storage.objects for delete using (bucket_id='apalinks');
