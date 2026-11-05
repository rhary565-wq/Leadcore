-- ═══════════════════════════════════════════════════════════════════════════
-- Leadcore (YodSales Pro × LeadGen) — schema additions
-- Run ONCE in the Supabase SQL editor of the LeadGen data project.
-- Safe to re-run (IF NOT EXISTS everywhere). Existing LeadGen tables
-- (scrape_jobs, leads, key_contacts, apollo_enrichment_runs) are kept as-is.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- 1. Leads: map coordinates, email and Thai territory (province/district/sub-district)
alter table public.leads add column if not exists latitude     double precision;
alter table public.leads add column if not exists longitude    double precision;
alter table public.leads add column if not exists email        text;
alter table public.leads add column if not exists province     text;
alter table public.leads add column if not exists district     text;
alter table public.leads add column if not exists sub_district text;
create index if not exists idx_leads_province on public.leads(province);
create index if not exists idx_leads_created  on public.leads(created_at desc);

-- Pending item from the July snapshot README
alter table public.apollo_enrichment_runs add column if not exists candidates_json jsonb default '[]';

-- 2. User profiles (YodSales login). id = Supabase Auth user id.
create table if not exists public.profiles (
  id          uuid primary key,
  email       text,
  full_name   text,
  role        text not null default 'Sales Rep',   -- admin | Manager | Sales Rep | disabled
  language    text not null default 'EN',
  theme       text not null default 'Light',
  phone       text,
  territory   text,
  targets     jsonb not null default '{"daily":10,"weekly":50,"monthly":200}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- If profiles already existed from the old YodSales database.sql, add new columns
alter table public.profiles add column if not exists theme     text not null default 'Light';
alter table public.profiles add column if not exists phone     text;
alter table public.profiles add column if not exists territory text;
alter table public.profiles add column if not exists targets   jsonb not null default '{"daily":10,"weekly":50,"monthly":200}';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- 3. Activity / traffic log (Admin Portal)
create table if not exists public.activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  user_email    text,
  event_type    text not null,
  ip_address    text,
  device_info   text,
  location_text text,
  created_at    timestamptz not null default now()
);
alter table public.activity_logs add column if not exists user_email text;
create index if not exists idx_activity_created on public.activity_logs(created_at desc);
create index if not exists idx_activity_user    on public.activity_logs(user_id);

-- 4. Support tickets
create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  name       text,
  email      text,
  subject    text,
  message    text not null,
  status     text not null default 'open',   -- open | in_progress | closed
  created_at timestamptz not null default now()
);

-- 5. Sales Hub pipeline (replaces the old localStorage "My Local Pipeline")
create table if not exists public.pipeline_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  lead_id        uuid references public.leads(id) on delete set null,
  company_name   text not null,
  phone          text,
  website        text,
  industry       text,
  city           text,
  province       text,
  lead_score     integer,
  lead_status    text,
  stage          text not null default 'new',  -- new|contacted|meeting|proposal|won|lost
  deal_value     numeric default 0,
  next_follow_up date,
  notes          text default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, lead_id)
);
create index if not exists idx_pipeline_user on public.pipeline_items(user_id);

-- 6. Saved search templates (from the Cipher "New search" app)
create table if not exists public.search_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  name       text not null,
  config     jsonb not null,
  created_at timestamptz not null default now()
);

-- The backend uses the service-role key, so RLS can stay on with no public policies.
alter table public.profiles         enable row level security;
alter table public.activity_logs    enable row level security;
alter table public.support_tickets  enable row level security;
alter table public.pipeline_items   enable row level security;
alter table public.search_templates enable row level security;
