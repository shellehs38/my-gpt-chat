-- Initial Supabase schema for ООО «СВОИ ЛЮДИ». Applied 2026-10-19.
-- Never expose service_role to the browser. RLS enabled, no public policies.
create extension if not exists pgcrypto;
create table if not exists public.clients (id uuid primary key default gen_random_uuid(),full_name text not null check(length(trim(full_name))>0),phone text,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.objects (id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id) on delete restrict,address text not null,work_type text not null,contract_amount numeric(14,2) check(contract_amount is null or contract_amount>=0),status text not null default 'new' check(status in ('new','planned','in_progress','completed','cancelled')),created_at timestamptz not null default now());
create index if not exists idx_objects_client on public.objects(client_id);
create table if not exists public.expenses (id uuid primary key default gen_random_uuid(),object_id uuid not null references public.objects(id) on delete restrict,category text not null,description text,amount numeric(14,2) not null check(amount>0),incurred_on date not null default current_date,external_source text,external_id text,created_at timestamptz not null default now(),unique(external_source,external_id));
create index if not exists idx_expenses_object on public.expenses(object_id);
create table if not exists public.receipts (id uuid primary key default gen_random_uuid(),object_id uuid not null references public.objects(id) on delete restrict,amount numeric(14,2) not null check(amount>0),received_on date not null default current_date,method text,note text,external_source text,external_id text,created_at timestamptz not null default now(),unique(external_source,external_id));
create index if not exists idx_receipts_object on public.receipts(object_id);
create table if not exists public.estimates (id uuid primary key default gen_random_uuid(),object_id uuid not null references public.objects(id) on delete restrict,title text not null,status text not null default 'draft' check(status in ('draft','approved','rejected')),created_at timestamptz not null default now());
create table if not exists public.estimate_lines (id uuid primary key default gen_random_uuid(),estimate_id uuid not null references public.estimates(id) on delete cascade,line_type text not null check(line_type in ('work','material','other')),title text not null,unit text,quantity numeric(16,3) check(quantity is null or quantity>=0),unit_price numeric(14,2) check(unit_price is null or unit_price>=0),created_at timestamptz not null default now());
create table if not exists public.tasks (id uuid primary key default gen_random_uuid(),object_id uuid references public.objects(id) on delete restrict,title text not null,status text not null default 'open' check(status in ('open','in_progress','done','cancelled')),due_on date,created_at timestamptz not null default now());
create table if not exists public.import_batches (id uuid primary key default gen_random_uuid(),source text not null,source_reference text,status text not null default 'staged' check(status in ('staged','validated','imported','failed')),created_at timestamptz not null default now());
create table if not exists public.operation_log (id uuid primary key default gen_random_uuid(),operation_key text not null unique,action text not null,entity_type text,entity_id uuid,payload_hash text,created_at timestamptz not null default now());
alter table public.clients enable row level security;
alter table public.objects enable row level security;
alter table public.expenses enable row level security;
alter table public.receipts enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;
alter table public.tasks enable row level security;
alter table public.import_batches enable row level security;
alter table public.operation_log enable row level security;
