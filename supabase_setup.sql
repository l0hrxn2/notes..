-- Run this once in your Supabase project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run)

create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null references pages(id) on delete cascade,
  word text not null,
  meaning text default '',
  is_favorite boolean not null default false,
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table pages enable row level security;
alter table words enable row level security;

-- Each user can only see/edit their own rows
create policy "own pages" on pages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own words" on words
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Helpful indexes
create index if not exists words_page_id_idx on words(page_id);
create index if not exists words_user_id_favorite_idx on words(user_id, is_favorite);
