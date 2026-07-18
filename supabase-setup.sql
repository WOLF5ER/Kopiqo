-- ============================================================================
-- Kopiqo — настройка Supabase.
-- Выполните этот скрипт целиком в Supabase Dashboard → SQL Editor → Run.
-- Скрипт идемпотентен: его можно безопасно запускать повторно.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Таблица финансовых данных: одна строка на пользователя,
--    всё состояние приложения — в jsonb-поле data.
-- ----------------------------------------------------------------------------
create table if not exists public.finance_data (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.finance_data is
  'Состояние приложения Kopiqo: одна строка на пользователя (auth.uid()).';

-- Автоматическое обновление updated_at при каждом изменении строки.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_finance_data_updated_at on public.finance_data;
create trigger trg_finance_data_updated_at
  before update on public.finance_data
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Row Level Security: пользователь видит и изменяет только свои записи.
-- ----------------------------------------------------------------------------
alter table public.finance_data enable row level security;

drop policy if exists "finance_data_select_own" on public.finance_data;
create policy "finance_data_select_own"
  on public.finance_data
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "finance_data_insert_own" on public.finance_data;
create policy "finance_data_insert_own"
  on public.finance_data
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "finance_data_update_own" on public.finance_data;
create policy "finance_data_update_own"
  on public.finance_data
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "finance_data_delete_own" on public.finance_data;
create policy "finance_data_delete_own"
  on public.finance_data
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Анонимным пользователям доступ к таблице не выдаётся вовсе
-- (политик для роли anon нет — RLS запрещает всё по умолчанию).

-- ----------------------------------------------------------------------------
-- 3. Проверка занятости никнейма перед регистрацией.
--    Функция security definer заглядывает в auth.users и возвращает только
--    true/false — сами email наружу не отдаются.
-- ----------------------------------------------------------------------------
create or replace function public.nickname_exists(nick text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where email = lower(trim(nick)) || '@kopiqo.app'
  );
$$;

revoke all on function public.nickname_exists(text) from public;
grant execute on function public.nickname_exists(text) to anon, authenticated;
