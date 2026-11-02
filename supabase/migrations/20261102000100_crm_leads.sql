-- CRM only. Apply to an isolated Supabase Preview/branch database, never shared Production without approval.
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '',
  channel text not null,
  work_type text not null default '',
  address text not null default '',
  notes text not null default '',
  status text not null default 'new' check (status in ('new','contact_due','qualified','measurement','estimate','negotiation','won','lost')),
  next_contact_at timestamptz,
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_leads_contact check (length(trim(name)) > 0 or length(trim(phone)) > 0),
  constraint crm_leads_lengths check (length(name) <= 240 and length(phone) <= 240 and length(channel) <= 240 and length(work_type) <= 240 and length(address) <= 240 and length(notes) <= 2000)
);
create index if not exists crm_leads_status_created_idx on public.crm_leads(status, created_at desc);
create index if not exists crm_leads_next_contact_idx on public.crm_leads(next_contact_at) where next_contact_at is not null;
alter table public.crm_leads enable row level security;
revoke all on table public.crm_leads from anon, authenticated;
grant select, insert, update on table public.crm_leads to service_role;
-- No anon/authenticated RLS policies: only authenticated application server using service_role can access.
