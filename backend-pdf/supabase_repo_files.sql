create table if not exists public.repo_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  repo_url text not null,
  repo_name text not null,
  path text not null,
  sha text,
  size integer not null default 0,
  content text not null,
  indexed_at bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, repo_name, path)
);

create index if not exists repo_files_user_repo_idx
  on public.repo_files (user_id, repo_name);

create index if not exists repo_files_user_path_idx
  on public.repo_files (user_id, path);
