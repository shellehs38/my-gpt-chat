-- Applied to Supabase svoi-lyudi on 2026-10-19.
-- Source record IDs are stored for safe, repeatable migrations.
alter table public.clients add column if not exists legacy_id text unique;
alter table public.objects add column if not exists legacy_id text unique;
alter table public.objects add column if not exists is_demo boolean not null default false;
alter table public.expenses add column if not exists is_demo boolean not null default false;
create index if not exists idx_objects_demo on public.objects(is_demo);
-- Real customer data is NOT committed to GitHub.
