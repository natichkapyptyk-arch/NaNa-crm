-- База СРМ салону. Можна запускати повторно: нічого не стирає і не дублює.
-- Supabase → SQL Editor → New query → вставити весь файл → Run.

-- ===== Таблиці =====
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','master'))
);

create table if not exists masters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id uuid unique references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dur int not null check (dur > 0),          -- тривалість, хв
  price numeric(10,2) not null default 0,
  is_active boolean not null default true
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references masters(id),
  service_id uuid not null references services(id),
  client_id uuid not null references clients(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'planned' check (status in ('planned','done','cancel')),
  paid_amount numeric(10,2),
  pay_method text,
  source text not null default 'staff' check (source in ('online','staff')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists appointments_master_time on appointments (master_id, starts_at);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references masters(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists blocks_master_time on blocks (master_id, starts_at);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id),
  rating int not null check (rating between 1 and 5),
  text text,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  day date not null default current_date,
  category text not null,
  amount numeric(10,2) not null,
  note text,
  created_at timestamptz not null default now()
);

-- ===== Допоміжні функції прав =====
create or replace function is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where user_id = auth.uid() and role = 'owner') $$;

create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where user_id = auth.uid()) $$;

create or replace function my_master() returns uuid language sql stable security definer set search_path = public as
$$ select id from masters where user_id = auth.uid() $$;

-- ===== Зайняті проміжки (для клієнтів без входу): лише час, без імен =====
create or replace function busy_slots(p_master uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.starts_at, a.ends_at from appointments a
   where a.master_id = p_master and a.status <> 'cancel' and a.starts_at < p_to and a.ends_at > p_from
  union all
  select b.starts_at, b.ends_at from blocks b
   where b.master_id = p_master and b.starts_at < p_to and b.ends_at > p_from
$$;

-- ===== Онлайн-запис клієнта =====
create or replace function book(p_master uuid, p_service uuid, p_start timestamptz, p_name text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_dur int; v_end timestamptz; v_phone text; v_client uuid; v_id uuid;
begin
  v_phone := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Вкажіть ваше ім’я'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then raise exception 'Вкажіть правильний номер телефону'; end if;
  if p_start is null or p_start < now() then raise exception 'Оберіть час у майбутньому'; end if;
  if p_start > now() + interval '61 days' then raise exception 'Запис можливий не більше ніж на 2 місяці вперед'; end if;

  select dur into v_dur from services where id = p_service and is_active;
  if v_dur is null then raise exception 'Послугу не знайдено'; end if;
  if not exists (select 1 from masters where id = p_master and is_active) then raise exception 'Майстра не знайдено'; end if;
  v_end := p_start + make_interval(mins => v_dur);

  -- щоб двоє не записались на той самий час одночасно
  perform pg_advisory_xact_lock(hashtext(p_master::text));
  if exists (select 1 from busy_slots(p_master, p_start, v_end)) then
    raise exception 'Цей час щойно зайняли. Оберіть інший, будь ласка.';
  end if;

  insert into clients (name, phone) values (trim(p_name), v_phone)
    on conflict (phone) do update set phone = excluded.phone
    returning id into v_client;

  insert into appointments (master_id, service_id, client_id, starts_at, ends_at, source, created_by)
    values (p_master, p_service, v_client, p_start, v_end, 'online', null)
    returning id into v_id;
  return v_id;
end $$;

-- ===== Права (RLS) =====
alter table profiles     enable row level security;
alter table masters      enable row level security;
alter table services     enable row level security;
alter table clients      enable row level security;
alter table appointments enable row level security;
alter table blocks       enable row level security;
alter table reviews      enable row level security;
alter table expenses     enable row level security;

grant usage on schema public to anon, authenticated;
grant select on masters, services to anon, authenticated;
grant select, insert, update, delete on profiles, masters, services, clients, appointments, blocks, reviews, expenses to authenticated;
revoke all on function book(uuid,uuid,timestamptz,text,text) from public;
grant execute on function busy_slots(uuid,timestamptz,timestamptz) to anon, authenticated;
grant execute on function book(uuid,uuid,timestamptz,text,text) to anon, authenticated;
grant execute on function is_owner(), is_staff(), my_master() to authenticated;

-- профілі: кожен бачить свій, власник — усі
drop policy if exists p_profiles_read on profiles;
create policy p_profiles_read on profiles for select to authenticated using (user_id = (select auth.uid()) or (select is_owner()));
drop policy if exists p_profiles_owner on profiles;
create policy p_profiles_owner on profiles for all to authenticated using ((select is_owner())) with check ((select is_owner()));

-- майстри й послуги: бачать усі (і клієнти), змінює власник
drop policy if exists p_masters_read on masters;
create policy p_masters_read on masters for select to anon, authenticated using (is_active or (select is_staff()));
drop policy if exists p_masters_owner on masters;
create policy p_masters_owner on masters for all to authenticated using ((select is_owner())) with check ((select is_owner()));

drop policy if exists p_services_read on services;
create policy p_services_read on services for select to anon, authenticated using (is_active or (select is_staff()));
drop policy if exists p_services_owner on services;
create policy p_services_owner on services for all to authenticated using ((select is_owner())) with check ((select is_owner()));

-- клієнти: лише персонал
drop policy if exists p_clients_staff on clients;
create policy p_clients_staff on clients for select to authenticated using ((select is_staff()));
drop policy if exists p_clients_ins on clients;
create policy p_clients_ins on clients for insert to authenticated with check ((select is_staff()));
drop policy if exists p_clients_upd on clients;
create policy p_clients_upd on clients for update to authenticated using ((select is_staff())) with check ((select is_staff()));

-- записи: персонал бачить усі; майстер змінює лише свої, власник — усі
drop policy if exists p_appt_read on appointments;
create policy p_appt_read on appointments for select to authenticated using ((select is_staff()));
drop policy if exists p_appt_ins on appointments;
create policy p_appt_ins on appointments for insert to authenticated
  with check ((select is_owner()) or master_id = (select my_master()));
drop policy if exists p_appt_upd on appointments;
create policy p_appt_upd on appointments for update to authenticated
  using ((select is_owner()) or master_id = (select my_master()))
  with check ((select is_owner()) or master_id = (select my_master()));

-- закритий час: персонал бачить усе; майстер відкриває/закриває лише свій
drop policy if exists p_blocks_read on blocks;
create policy p_blocks_read on blocks for select to authenticated using ((select is_staff()));
drop policy if exists p_blocks_write on blocks;
create policy p_blocks_write on blocks for all to authenticated
  using ((select is_owner()) or master_id = (select my_master()))
  with check ((select is_owner()) or master_id = (select my_master()));

-- відгуки: бачить персонал (додавання — пізніше, через кабінет клієнта)
drop policy if exists p_reviews_read on reviews;
create policy p_reviews_read on reviews for select to authenticated using ((select is_staff()));

-- витрати: лише власник
drop policy if exists p_expenses_owner on expenses;
create policy p_expenses_owner on expenses for all to authenticated using ((select is_owner())) with check ((select is_owner()));

-- ===== Стартові дані (лише якщо порожньо — потім змінити на свої) =====
insert into masters (name) select x from unnest(array['Майстер 1','Майстер 2']) x
  where not exists (select 1 from masters);
insert into services (name, dur, price)
  select * from (values ('Стрижка жіноча',60,600),('Манікюр',90,500),('Фарбування',120,1800)) v(n,d,p)
  where not exists (select 1 from services);

-- власниця (спрацює, коли в Authentication → Users є акаунт з цією поштою)
insert into profiles (user_id, role)
  select id, 'owner' from auth.users where email = 'natichkapyptyk@gmail.com'
  on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
