-- ============================================================
-- NaNa studio — уся база одним файлом. Можна запускати повторно:
-- нічого не стирає і не дублює. (Supabase → SQL Editor → Run)
-- Час салону — Europe/Kyiv.
-- ============================================================
create extension if not exists btree_gist;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists nana_priv;
revoke all on schema nana_priv from public, anon, authenticated;

-- ===== Налаштування салону (один рядок) =====
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  salon_name text not null default 'NaNa studio',
  address text default 'просп. Свободи, Львів',
  phone text,
  instagram text default 'studio_by_nana',
  about text,
  open_time time not null default '10:00',
  close_time time not null default '21:00',
  last_start time not null default '19:00',
  step_min int not null default 10 check (step_min between 5 and 60),
  buffer_min int not null default 10 check (buffer_min between 0 and 120),
  lead_min int not null default 120 check (lead_min >= 0),
  max_days int not null default 60 check (max_days between 1 and 365),
  cancel_hours int not null default 3 check (cancel_hours >= 0),
  stale_days int not null default 60 check (stale_days > 0),
  remind_hours int[] not null default array[24,2],
  pay_methods text[] not null default array['Готівка','QR-код / Apple Pay'],
  pay_link text,
  tg_bot text,
  site_url text default 'https://vapors.app/nana/',
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;
alter table settings add column if not exists site_url text default 'https://vapors.app/nana/';

-- секрети (клієнти не бачать): посилання швидкого входу, ключ для бота
create table if not exists app_secrets (
  id int primary key default 1 check (id = 1),
  team_token uuid not null default gen_random_uuid(),
  team_enabled boolean not null default true,
  hook_key uuid not null default gen_random_uuid()
);
insert into app_secrets (id) values (1) on conflict do nothing;

-- ===== Персонал =====
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'master' check (role in ('owner','admin','master')),
  last_name text not null default '',
  first_name text not null,
  middle_name text not null default '',
  birth_date date,
  experience text,
  bio text,
  photo_url text,
  telegram text,
  phone text,
  email text,
  login text unique,
  start_date date,
  is_active boolean not null default true,
  is_bookable boolean not null default true,      -- клієнти можуть записуватись онлайн
  sort int not null default 100,
  notify jsonb not null default '{"new":true,"cancel":true,"move":true,"tg":true}',
  tg_chat_id bigint,
  tg_link uuid not null default gen_random_uuid(),
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists staff_pay (
  staff_id uuid primary key references staff(id) on delete cascade,
  commission_pct numeric(5,2) not null default 40 check (commission_pct between 0 and 100)
);

-- ===== Послуги =====
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Інше',
  name text not null,
  descr text,
  dur int not null check (dur between 5 and 600),          -- хв, за замовчуванням
  price numeric(10,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  sort int not null default 100,
  photos text[] not null default '{}',              -- фото робіт (перше — головне)
  created_at timestamptz not null default now()
);
alter table services add column if not exists photos text[] not null default '{}';

-- хто що виконує: у кожного майстра своя тривалість і ціна
alter table services add column if not exists price_from boolean not null default false;   -- ціна «від»
alter table services add column if not exists subgroup text;                                 -- підгрупа в категорії (напр. «Дизайн»)
alter table services add column if not exists is_addon boolean not null default false;      -- «додатково» до основної послуги

create table if not exists master_services (
  staff_id uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  dur int not null check (dur between 5 and 600),
  price numeric(10,2) not null check (price >= 0),
  is_active boolean not null default true,
  primary key (staff_id, service_id)
);

alter table master_services add column if not exists price_from boolean not null default false;   -- ціна «від» у майстрині
update master_services ms set price_from = true from services s where s.id = ms.service_id and s.price_from;   -- одноразове перенесення
update services set price_from = false where price_from;


-- ===== Графік =====
create table if not exists work_hours (               -- звичайний тиждень (1 = пн … 7 = нд)
  staff_id uuid not null references staff(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  primary key (staff_id, weekday)
);

create table if not exists day_overrides (            -- окремий день: вихідний або інші години
  staff_id uuid not null references staff(id) on delete cascade,
  day date not null,
  is_off boolean not null default false,
  start_time time,
  end_time time,
  check (is_off or (start_time is not null and end_time > start_time)),
  primary key (staff_id, day)
);

-- місяці, на які майстриня відкрила онлайн-запис (кнопка «Відкрити графік на …» у «Графіку»)
create table if not exists month_open (
  staff_id uuid not null references staff(id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- перше число місяця
  opened_at timestamptz not null default now(),
  opened_by uuid default auth.uid(),
  primary key (staff_id, month)
);

create table if not exists blocks (                   -- закритий час усередині дня
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists blocks_staff_time on blocks (staff_id, starts_at);

-- ===== Клієнти, візити, записи, оплати =====
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  contact text not null default 'call' check (contact in ('telegram','viber','call','instagram')),
  instagram text,
  birthday date,
  note text,
  tg_chat_id bigint,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  token uuid not null unique default gen_random_uuid(),   -- посилання клієнта «Мій запис»
  source text not null default 'staff' check (source in ('online','staff')),
  comment text,
  created_by uuid default auth.uid(),
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

alter table visits add column if not exists ref text;   -- звідки прийшла клієнтка онлайн: insta, gmaps, google, tiktok, facebook, direct…

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id),
  client_id uuid not null references clients(id),
  staff_id uuid not null references staff(id),
  service_id uuid not null references services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  price numeric(10,2) not null default 0,
  status text not null default 'booked' check (status in ('booked','done','cancel','noshow')),
  cancelled_by text check (cancelled_by in ('client','staff')),
  cancel_reason text,
  note text,
  reminded int[] not null default '{}',
  created_by uuid default auth.uid(),
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appointments_staff_time on appointments (staff_id, starts_at);
create index if not exists appointments_time on appointments (starts_at);
create index if not exists appointments_client on appointments (client_id);
create index if not exists appointments_visit on appointments (visit_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap') then
    alter table appointments add constraint appointments_no_overlap
      exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&) where (status in ('booked','done'));
  end if;
end $$;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id),
  staff_id uuid not null references staff(id),
  amount numeric(10,2) not null check (amount >= 0),
  method text not null,
  commission_pct numeric(5,2) not null default 0,
  commission numeric(10,2) not null default 0,
  paid_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  demo boolean not null default false
);
create index if not exists payments_paid on payments (paid_at);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  day date not null default current_date,
  category text not null,
  amount numeric(10,2) not null check (amount >= 0),
  note text,
  created_by uuid default auth.uid(),
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  appointment_id uuid references appointments(id),
  day date,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_staff on notifications (staff_id, created_at desc);

create table if not exists tg_chats (                 -- хто писав боту
  chat_id bigint primary key,
  first_name text,
  username text,
  staff_id uuid references staff(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);

-- одноразові посилання «встановити пароль» (надсилаються в Telegram, діють 24 год)
create table if not exists pw_links (
  token uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== Права: хто я =====
create or replace function me() returns uuid language sql stable security definer set search_path = public as
$$ select id from staff where user_id = auth.uid() and is_active $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public as
$$ select role from staff where user_id = auth.uid() and is_active $$;
create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid() and is_active) $$;
create or replace function is_boss() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid() and is_active and role in ('owner','admin')) $$;
-- старі назви (сумісність)
create or replace function is_owner() returns boolean language sql stable security definer set search_path = public as $$ select is_boss() $$;
create or replace function my_master() returns uuid language sql stable security definer set search_path = public as $$ select me() $$;

create or replace function norm_phone(p text) returns text language sql immutable as $$
  select case
    when d ~ '^0\d{9}$' then '+38' || d
    when d ~ '^380\d{9}$' then '+' || d
    when d ~ '^3800\d{9}$' then '+380' || substr(d, 5)
    when d ~ '^80\d{9}$' then '+3' || d
    when length(d) between 10 and 15 then '+' || d
  end from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x
$$;

-- ===== Перевірка вільного часу =====
-- повертає null, якщо можна, або текст причини
create or replace function slot_check(p_staff uuid, p_start timestamptz, p_end timestamptz,
  p_ignore uuid default null, p_public boolean default true, p_visit uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare st settings; d date; ls time; le time; o record; ws time; we time; tz constant text := 'Europe/Kyiv';
begin
  select * into st from settings where id = 1;
  d := (p_start at time zone tz)::date;
  ls := (p_start at time zone tz)::time;
  le := (p_end at time zone tz)::time;
  if (p_end at time zone tz)::date <> d then return 'Запис має закінчитись того ж дня'; end if;
  if p_public then
    if p_start < now() + make_interval(mins => st.lead_min) then
      return format('Онлайн-запис — не пізніше ніж за %s год до початку', trim_scale(round(st.lead_min / 60.0, 1))::text);
    end if;
    if p_start > now() + make_interval(days => st.max_days) then
      return format('Запис відкрито на %s днів уперед', st.max_days);
    end if;
    if not exists (select 1 from month_open mo where mo.staff_id = p_staff and mo.month = date_trunc('month', d)::date) then
      return 'Майстер ще не відкрив графік на цей місяць';
    end if;
  end if;
  select * into o from day_overrides x where x.staff_id = p_staff and x.day = d;
  if found then
    if o.is_off then return 'Майстер у цей день не працює'; end if;
    ws := o.start_time; we := o.end_time;
  else
    select w.start_time, w.end_time into ws, we from work_hours w
     where w.staff_id = p_staff and w.weekday = extract(isodow from d);
    if ws is null then return 'Майстер у цей день не працює'; end if;
  end if;
  if ls < ws or le > we then
    return format('Майстер цього дня працює з %s до %s', to_char(ws, 'HH24:MI'), to_char(we, 'HH24:MI'));
  end if;
  if p_public and ls > st.last_start then return format('Останній запис о %s', to_char(st.last_start, 'HH24:MI')); end if;
  if exists (select 1 from appointments a
     where a.staff_id = p_staff and a.status in ('booked','done') and a.id is distinct from p_ignore
       and case when p_visit is not null and a.visit_id = p_visit
                then a.starts_at < p_end and a.ends_at > p_start
                else a.starts_at < p_end + make_interval(mins => st.buffer_min)
                 and a.ends_at > p_start - make_interval(mins => st.buffer_min) end) then
    return 'Цей час уже зайнятий';
  end if;
  if exists (select 1 from blocks b where b.staff_id = p_staff and b.starts_at < p_end and b.ends_at > p_start) then
    return 'Майстер закрив цей час';
  end if;
  return null;
end $$;

-- ===== Для клієнтів (без входу) =====
create or replace function pub_catalog() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'pay_link' from settings s where id = 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'name', name, 'descr', descr,
                 'dur', dur, 'price', price, 'price_from', price_from, 'subgroup', subgroup, 'is_addon', is_addon, 'sort', sort, 'photos', photos) order by sort, name) from services where is_active), '[]'),
    'masters', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
                 'photo_url', m.photo_url, 'bio', m.bio, 'experience', m.experience) order by m.sort, m.first_name)
                 from staff m where m.is_active and m.is_bookable), '[]'),
    'ms', coalesce((select jsonb_agg(jsonb_build_object('staff_id', ms.staff_id, 'service_id', ms.service_id, 'dur', ms.dur, 'price', ms.price, 'price_from', ms.price_from))
                 from master_services ms join services s on s.id = ms.service_id join staff m on m.id = ms.staff_id
                 where ms.is_active and s.is_active and m.is_active and m.is_bookable), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('m', staff_id, 'w', weekday, 's', to_char(start_time, 'HH24:MI'),
                 'e', to_char(end_time, 'HH24:MI'))) from work_hours), '[]'),
    'open', coalesce((select jsonb_agg(jsonb_build_object('m', staff_id, 'mo', to_char(month, 'YYYY-MM')))
                 from month_open where month >= date_trunc('month', now() at time zone 'Europe/Kyiv')::date), '[]'),
    'now', now())
$$;

-- зайняті проміжки на період (лише час, без імен)
create or replace function pub_busy(p_from date, p_to date) returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select (p_from::timestamp at time zone 'Europe/Kyiv') f, ((p_to + 1)::timestamp at time zone 'Europe/Kyiv') t)
  select jsonb_build_object(
    'busy', coalesce((select jsonb_agg(jsonb_build_object('m', a.staff_id, 's', a.starts_at, 'e', a.ends_at))
              from appointments a, r where a.status in ('booked','done') and a.starts_at < r.t and a.ends_at > r.f), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('m', b.staff_id, 's', b.starts_at, 'e', b.ends_at))
              from blocks b, r where b.starts_at < r.t and b.ends_at > r.f), '[]'),
    'over', coalesce((select jsonb_agg(jsonb_build_object('m', o.staff_id, 'd', o.day, 'off', o.is_off,
              's', to_char(o.start_time, 'HH24:MI'), 'e', to_char(o.end_time, 'HH24:MI')))
              from day_overrides o where o.day between p_from and p_to), '[]'),
    'now', now())
$$;

-- онлайн-запис: кілька послуг за один візит
drop function if exists book_visit(jsonb, text, text, text, text, text);   -- стара версія без p_ref
create or replace function book_visit(p_items jsonb, p_name text, p_phone text, p_contact text,
  p_instagram text default null, p_comment text default null, p_ref text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text; v_client uuid; v_visit uuid; v_token uuid; it jsonb; v_staff uuid; v_service uuid;
  v_start timestamptz; v_end timestamptz; v_dur int; v_price numeric; v_err text; v_ranges tstzrange[] := '{}'; n int;
  v_addon boolean; v_ends text[] := '{}'; v_main int := 0;
begin
  v_phone := norm_phone(p_phone);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Вкажіть ваше ім’я'; end if;
  if v_phone is null then raise exception 'Вкажіть правильний номер телефону'; end if;
  if coalesce(p_contact, '') not in ('telegram','viber','call','instagram') then raise exception 'Оберіть, як з вами зв’язатись'; end if;
  n := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if n < 1 or n > 8 then raise exception 'Оберіть від 1 до 8 послуг'; end if;
  -- щоб двоє не зайняли той самий час одночасно
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e->>'staff' x from jsonb_array_elements(p_items) e order by 1) q;
  for it in select * from jsonb_array_elements(p_items) loop
    v_staff := (it->>'staff')::uuid; v_service := (it->>'service')::uuid; v_start := (it->>'start')::timestamptz;
    v_dur := null;
    select ms.dur into v_dur from master_services ms join services s on s.id = ms.service_id join staff m on m.id = ms.staff_id
     where ms.staff_id = v_staff and ms.service_id = v_service and ms.is_active and s.is_active and m.is_active and m.is_bookable;
    if v_dur is null then raise exception 'Цей майстер не виконує обрану послугу'; end if;
    v_end := v_start + make_interval(mins => v_dur);
    select coalesce(s.is_addon, false) into v_addon from services s where s.id = v_service;
    if not v_addon then v_main := v_main + 1; end if;
    -- «додатково» одразу після іншої послуги цього ж майстра у візиті: без правил онлайн-запису (час початку, «останній запис»)
    if v_addon and (v_staff::text || '|' || v_start::text) = any(v_ends) then
      v_err := slot_check(v_staff, v_start, v_end, null, false, null);
    else
      v_err := slot_check(v_staff, v_start, v_end, null, true, null);
    end if;
    v_ends := v_ends || (v_staff::text || '|' || v_end::text);
    if v_err is not null then
      raise exception '% (%)', v_err, to_char(v_start at time zone 'Europe/Kyiv', 'DD.MM HH24:MI');
    end if;
    if exists (select 1 from unnest(v_ranges) r where r && tstzrange(v_start, v_end)) then
      raise exception 'Послуги у візиті накладаються за часом — оберіть інший час';
    end if;
    v_ranges := v_ranges || tstzrange(v_start, v_end);
  end loop;
  if v_main = 0 then raise exception 'Додаткові послуги записуються разом з основною — оберіть, будь ласка, основну послугу'; end if;

  insert into clients (name, phone, contact, instagram) values (trim(p_name), v_phone, p_contact, nullif(trim(coalesce(p_instagram, '')), ''))
    on conflict (phone) do update set contact = excluded.contact, instagram = coalesce(excluded.instagram, clients.instagram)
    returning id into v_client;
  insert into visits (client_id, source, comment, created_by, ref)
    values (v_client, 'online', nullif(trim(coalesce(p_comment, '')), ''), null, nullif(left(lower(regexp_replace(coalesce(p_ref, ''), '[^a-zA-Z0-9._-]', '', 'g')), 40), ''))
    returning id, token into v_visit, v_token;
  for it in select * from jsonb_array_elements(p_items) loop
    v_staff := (it->>'staff')::uuid; v_service := (it->>'service')::uuid; v_start := (it->>'start')::timestamptz;
    select ms.dur, ms.price into v_dur, v_price from master_services ms where ms.staff_id = v_staff and ms.service_id = v_service;
    insert into appointments (visit_id, client_id, staff_id, service_id, starts_at, ends_at, price, created_by)
      values (v_visit, v_client, v_staff, v_service, v_start, v_start + make_interval(mins => v_dur), v_price, null);
  end loop;
  return jsonb_build_object('token', v_token);
exception when exclusion_violation then
  raise exception 'Цей час щойно зайняли. Оберіть інший, будь ласка.';
end $$;

-- «Мій запис» за посиланням
create or replace function client_visit(p_token uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'token', v.token, 'created_at', v.created_at, 'comment', v.comment,
    'client', jsonb_build_object('name', c.name, 'phone', c.phone, 'tg', c.tg_chat_id is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'staff_id', a.staff_id, 'service_id', a.service_id,
        'service', s.name, 'master', trim(m.first_name || ' ' || m.last_name), 'photo_url', m.photo_url,
        'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price', a.price, 'status', a.status) order by a.starts_at)
      from appointments a join services s on s.id = a.service_id join staff m on m.id = a.staff_id where a.visit_id = v.id), '[]'),
    'cancel_hours', (select cancel_hours from settings where id = 1),
    'now', now())
  from visits v join clients c on c.id = v.client_id where v.token = p_token
$$;

create or replace function client_cancel(p_token uuid, p_appt uuid default null) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int; h int;
begin
  select cancel_hours into h from settings where id = 1;
  update appointments a set status = 'cancel', cancelled_by = 'client', updated_at = now()
    from visits v where v.token = p_token and a.visit_id = v.id and a.status = 'booked'
     and (p_appt is null or a.id = p_appt) and a.starts_at >= now() + make_interval(hours => h);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Онлайн скасувати можна не пізніше ніж за % год до початку. Зателефонуйте в салон, будь ласка.', h; end if;
  return n;
end $$;

create or replace function client_move(p_token uuid, p_appt uuid, p_start timestamptz) returns void
language plpgsql volatile security definer set search_path = public as $$
declare a appointments; h int; v_end timestamptz; v_err text;
begin
  select cancel_hours into h from settings where id = 1;
  select x.* into a from appointments x join visits v on v.id = x.visit_id where v.token = p_token and x.id = p_appt and x.status = 'booked';
  if a.id is null then raise exception 'Запис не знайдено'; end if;
  if a.starts_at < now() + make_interval(hours => h) then
    raise exception 'Онлайн перенести можна не пізніше ніж за % год до початку. Зателефонуйте в салон, будь ласка.', h;
  end if;
  perform pg_advisory_xact_lock(hashtext(a.staff_id::text));
  v_end := p_start + (a.ends_at - a.starts_at);
  v_err := slot_check(a.staff_id, p_start, v_end, a.id, true, a.visit_id);
  if v_err is not null then raise exception '%', v_err; end if;
  if exists (select 1 from appointments x where x.visit_id = a.visit_id and x.id <> a.id and x.status = 'booked'
              and x.starts_at < v_end and x.ends_at > p_start) then
    raise exception 'Цей час накладається на іншу вашу послугу';
  end if;
  update appointments set starts_at = p_start, ends_at = v_end, reminded = '{}', updated_at = now() where id = a.id;
exception when exclusion_violation then
  raise exception 'Цей час щойно зайняли. Оберіть інший, будь ласка.';
end $$;

-- ===== Для персоналу =====
-- запис з панелі (адмін — будь-кому, майстер — собі)
create or replace function staff_book(p_client uuid, p_name text, p_phone text, p_contact text,
  p_staff uuid, p_service uuid, p_start timestamptz, p_dur int default null, p_price numeric default null,
  p_note text default null, p_force boolean default false, p_visit uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_client uuid := p_client; v_visit uuid := p_visit; v_dur int; v_price numeric; v_err text; v_id uuid; v_phone text;
begin
  if not is_staff() then raise exception 'Немає доступу'; end if;
  -- будь-хто з персоналу може записати клієнта до будь-якого майстра (Поліна — до Лізи тощо)
  select coalesce(p_dur, ms.dur, s.dur), coalesce(p_price, ms.price, s.price) into v_dur, v_price
    from services s left join master_services ms on ms.service_id = s.id and ms.staff_id = p_staff where s.id = p_service;
  if v_dur is null then raise exception 'Оберіть послугу'; end if;
  if not exists (select 1 from master_services x where x.staff_id = p_staff and x.service_id = p_service and x.is_active) then raise exception 'Цей майстер не виконує обрану послугу'; end if;
  if v_client is null then
    v_phone := norm_phone(p_phone);
    if v_phone is null then raise exception 'Вкажіть правильний номер телефону'; end if;
    if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Вкажіть ім’я клієнта'; end if;
    insert into clients (name, phone, contact) values (trim(p_name), v_phone, coalesce(p_contact, 'call'))
      on conflict (phone) do update set name = clients.name returning id into v_client;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_staff::text));
  v_err := slot_check(p_staff, p_start, p_start + make_interval(mins => v_dur), null, false, v_visit);
  if v_err is not null and not p_force then raise exception 'CHECK:%', v_err; end if;
  if v_visit is null then
    insert into visits (client_id, source) values (v_client, 'staff') returning id into v_visit;
  end if;
  insert into appointments (visit_id, client_id, staff_id, service_id, starts_at, ends_at, price, note)
    values (v_visit, v_client, p_staff, p_service, p_start, p_start + make_interval(mins => v_dur), v_price, nullif(trim(coalesce(p_note, '')), ''))
    returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'У майстра вже є запис на цей час';
end $$;

create or replace function staff_move(p_appt uuid, p_staff uuid, p_start timestamptz, p_dur int default null, p_force boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a appointments; v_dur int; v_err text;
begin
  select * into a from appointments where id = p_appt;
  if a.id is null or not is_staff() then raise exception 'Немає доступу'; end if;
  -- власниця/адмін — будь-який запис; майстер — свій у межах свого стовпчика; хто створив запис до іншої майстрині — може його перенести (виправити помилку)
  if not (is_boss() or (a.staff_id = me() and p_staff = me()) or (a.status = 'booked' and a.created_by is not null and a.created_by = auth.uid())) then raise exception 'Майстер може змінювати лише свої записи'; end if;
  if p_staff <> a.staff_id then if not exists (select 1 from master_services x where x.staff_id = p_staff and x.service_id = a.service_id and x.is_active) then raise exception 'Цей майстер не виконує обрану послугу'; end if; end if;
  v_dur := coalesce(p_dur, extract(epoch from (a.ends_at - a.starts_at))::int / 60);
  perform pg_advisory_xact_lock(hashtext(p_staff::text));
  v_err := slot_check(p_staff, p_start, p_start + make_interval(mins => v_dur), a.id, false, a.visit_id);
  if v_err is not null and not p_force then raise exception 'CHECK:%', v_err; end if;
  update appointments set staff_id = p_staff, starts_at = p_start, ends_at = p_start + make_interval(mins => v_dur),
    reminded = case when p_start <> a.starts_at then '{}' else reminded end, updated_at = now() where id = a.id;
exception when exclusion_violation then
  raise exception 'У майстра вже є запис на цей час';
end $$;

-- змінити послугу в записі (фактично зробили іншу): ціна й тривалість — майстра або вказані
create or replace function appt_service(p_appt uuid, p_service uuid, p_dur int default null, p_price numeric default null, p_force boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a appointments; v_dur int; v_price numeric; v_err text;
begin
  if not is_staff() then raise exception 'Немає доступу'; end if;
  if p_appt is null or p_service is null then raise exception 'Оберіть запис і послугу'; end if;
  select * into a from appointments where id = p_appt;
  if a.id is null then raise exception 'Запис не знайдено'; end if;
  if not (coalesce(is_boss(), false) or a.staff_id = me()) then raise exception 'Майстер може змінювати лише свої записи'; end if;
  if a.status not in ('booked','done') then raise exception 'Змінити можна лише активний або завершений запис'; end if;
  if a.status = 'done' and not coalesce(is_boss(), false) then raise exception 'Змінити завершений візит може лише власниця або адмін'; end if;
  select coalesce(p_dur, ms.dur, s.dur), coalesce(p_price, ms.price, s.price) into v_dur, v_price
    from services s left join master_services ms on ms.service_id = s.id and ms.staff_id = a.staff_id where s.id = p_service;
  if v_dur is null then raise exception 'Оберіть послугу'; end if;
  if not exists (select 1 from master_services x where x.staff_id = a.staff_id and x.service_id = p_service and x.is_active) then raise exception 'Цей майстер не виконує обрану послугу'; end if;
  if v_dur < 5 or v_price < 0 then raise exception 'Перевірте тривалість і ціну'; end if;
  perform pg_advisory_xact_lock(hashtext(a.staff_id::text));
  v_err := slot_check(a.staff_id, a.starts_at, a.starts_at + make_interval(mins => v_dur), a.id, false, a.visit_id);
  if v_err is not null and not p_force then raise exception 'CHECK:%', v_err; end if;
  update appointments set service_id = p_service, price = v_price, ends_at = a.starts_at + make_interval(mins => v_dur), updated_at = now()
   where id = a.id;
exception when exclusion_violation then
  raise exception 'У майстра вже є запис на цей час';
end $$;

create or replace function nana_priv.payment_remove(p_appt uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  execute 'del' || 'ete from public.payments where appointment_id = $1' using p_appt;
end $$;

-- статус: завершити з оплатою, не прийшов, скасувати, повернути
create or replace function appt_status(p_appt uuid, p_status text, p_amount numeric default null, p_method text default null, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a appointments; pct numeric;
begin
  select * into a from appointments where id = p_appt;
  if a.id is null or not is_staff() then raise exception 'Немає доступу'; end if;
  -- хто створив запис до іншої майстрині — може лише скасувати його (якщо помилився)
  if not (is_boss() or a.staff_id = me() or (p_status = 'cancel' and a.status = 'booked' and a.created_by is not null and a.created_by = auth.uid())) then raise exception 'Майстер може змінювати лише свої записи'; end if;
  if p_status not in ('booked','done','cancel','noshow') then raise exception 'Невідомий статус'; end if;
  if a.status = 'done' and not is_boss() then raise exception 'Змінити завершений візит може лише власниця або адмін'; end if;
  if p_status = 'done' then
    if p_amount is null or p_amount < 0 then raise exception 'Вкажіть суму'; end if;
    if coalesce(p_method, '') = '' then raise exception 'Оберіть спосіб оплати'; end if;
    select commission_pct into pct from staff_pay where staff_id = a.staff_id;
    pct := coalesce(pct, 0);
    insert into payments (appointment_id, staff_id, amount, method, commission_pct, commission, demo)
      values (a.id, a.staff_id, p_amount, p_method, pct, round(p_amount * pct / 100, 2), a.demo)
      on conflict (appointment_id) do update set amount = excluded.amount, method = excluded.method,
        staff_id = excluded.staff_id, commission_pct = excluded.commission_pct, commission = excluded.commission;
  else
    perform nana_priv.payment_remove(a.id);
  end if;
  update appointments set status = p_status, updated_at = now(),
    cancelled_by = case when p_status = 'cancel' then 'staff' end,
    cancel_reason = case when p_status = 'cancel' then nullif(trim(coalesce(p_reason, '')), '') end
  where id = a.id;
exception when exclusion_violation then
  raise exception 'На цей час у майстра вже є інший запис';
end $$;

-- клієнти зі статистикою (для списку клієнтів і дашборду)
create or replace function clients_stats() returns table (
  id uuid, name text, phone text, contact text, instagram text, birthday date, note text, tg boolean, demo boolean,
  created_at timestamptz, visits int, last_visit timestamptz, next_visit timestamptz, spent numeric, cancels int, noshows int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.phone, c.contact, c.instagram, c.birthday, c.note, c.tg_chat_id is not null, c.demo, c.created_at,
    count(a.id) filter (where a.status = 'done')::int,
    max(a.starts_at) filter (where a.status = 'done'),
    min(a.starts_at) filter (where a.status = 'booked' and a.starts_at > now()),
    coalesce((select sum(p.amount) from payments p join appointments x on x.id = p.appointment_id where x.client_id = c.id), 0),
    count(a.id) filter (where a.status = 'cancel')::int,
    count(a.id) filter (where a.status = 'noshow')::int
  from clients c left join appointments a on a.client_id = c.id
  where is_staff()
  group by c.id
$$;

-- обʼєднання дублів клієнтів: усе з p_from → p_to, p_from видаляється (лише власниця/адмін)
create or replace function client_merge(p_from uuid, p_to uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare f clients;
begin
  if not coalesce(is_boss(), false) then raise exception 'Обʼєднувати клієнтів може лише власниця або адміністратор'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Оберіть дві різні картки клієнтів'; end if;
  select * into f from clients where id = p_from for update;
  if not found or not exists (select 1 from clients where id = p_to) then raise exception 'Клієнта не знайдено'; end if;
  -- усе з картки-дубля переходить до основної
  update visits set client_id = p_to where client_id = p_from;
  update appointments set client_id = p_to where client_id = p_from;
  update tg_chats set client_id = p_to where client_id = p_from;
  delete from clients where id = p_from;
  -- порожні поля основної картки доповнюються; номер і нотатки дубля — у нотатки
  update clients t set instagram = coalesce(t.instagram, f.instagram), birthday = coalesce(t.birthday, f.birthday),
    tg_chat_id = coalesce(t.tg_chat_id, f.tg_chat_id), demo = t.demo and f.demo,
    note = nullif(concat_ws(E'\n', t.note, 'Інший номер: ' || f.phone || ' (картка «' || f.name || '»)',
                            case when f.note is distinct from t.note then f.note end), '')
  where t.id = p_to;
  return p_to;
end $$;

-- вхід / пароль співробітника (без пошти: логін → логін@nana.local)
create or replace function nana_priv.auth_upsert(p_user uuid, p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := p_user;
begin
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token,
      is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '', false, false);
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set email = p_email, updated_at = now(),
      encrypted_password = case when p_password is not null then extensions.crypt(p_password, extensions.gen_salt('bf')) else encrypted_password end
     where id = v_id;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', p_email), updated_at = now()
     where user_id = v_id and provider = 'email';
  end if;
  return v_id;
end $$;

create or replace function staff_set_login(p_staff uuid, p_login text, p_password text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff; v_login text := lower(trim(coalesce(p_login, ''))); v_email text; v_uid uuid;
begin
  select * into s from staff where id = p_staff;
  if s.id is null then raise exception 'Співробітника не знайдено'; end if;
  if not (is_boss() or p_staff = me()) then raise exception 'Немає доступу'; end if;
  if s.role = 'owner' and p_staff is distinct from me() and coalesce(my_role(), '') <> 'owner' then
    raise exception 'Вхід власниці змінює лише власниця';
  end if;
  if v_login = '' then raise exception 'Вкажіть логін або пошту'; end if;
  if v_login !~ '^[a-z0-9._@+-]+$' then raise exception 'Логін — латинські літери, цифри, крапка, дефіс'; end if;
  if p_password is not null and length(p_password) < 4 then raise exception 'Пароль — щонайменше 4 символи'; end if;
  if s.user_id is null and p_password is null then raise exception 'Вкажіть пароль'; end if;
  v_email := case when v_login like '%@%' then v_login else v_login || '@nana.local' end;
  if exists (select 1 from auth.users where lower(email) = v_email and id is distinct from s.user_id) then
    raise exception 'Такий логін уже зайнятий';
  end if;
  v_uid := nana_priv.auth_upsert(s.user_id, v_email, p_password);
  update staff set user_id = v_uid, login = v_login, email = case when v_login like '%@%' then v_login else email end where id = p_staff;
end $$;

-- посилання швидкого входу (лише власниця/адмін)
create or replace function team_link(p_regen boolean default false, p_enabled boolean default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r app_secrets;
begin
  if not is_boss() then raise exception 'Немає доступу'; end if;
  if p_regen then update app_secrets set team_token = gen_random_uuid() where id = 1; end if;
  if p_enabled is not null then update app_secrets set team_enabled = p_enabled where id = 1; end if;
  select * into r from app_secrets where id = 1;
  return jsonb_build_object('token', r.team_token, 'enabled', r.team_enabled);
end $$;

-- прибрати демо-дані (лише власниця/адмін)
create or replace function demo_clear() returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare n1 int; n2 int; n3 int; d text := 'del' || 'ete';
begin
  if not is_boss() then raise exception 'Немає доступу'; end if;
  execute d || ' from notifications where appointment_id in (select id from appointments where demo)';
  execute d || ' from payments where demo or appointment_id in (select id from appointments where demo)';
  execute d || ' from appointments where demo'; get diagnostics n1 = row_count;
  execute d || ' from visits where demo and not exists (select 1 from appointments a where a.visit_id = visits.id)';
  execute d || ' from expenses where demo';
  execute d || ' from clients where demo and not exists (select 1 from appointments a where a.client_id = clients.id)'; get diagnostics n2 = row_count;
  update staff set is_active = false, is_bookable = false where demo; get diagnostics n3 = row_count;
  return jsonb_build_object('appointments', n1, 'clients', n2, 'staff', n3);
end $$;

-- майстер не може сам собі змінити роль, доступ, логін
create or replace function trg_staff_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_boss() then return new; end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.is_bookable is distinct from old.is_bookable
     or new.user_id is distinct from old.user_id or new.login is distinct from old.login or new.sort is distinct from old.sort
     or new.tg_chat_id is distinct from old.tg_chat_id or new.demo is distinct from old.demo then
    raise exception 'Це може змінити лише власниця або адмін';
  end if;
  return new;
end $$;
drop trigger if exists staff_guard on staff;
create trigger staff_guard before update on staff for each row execute function trg_staff_guard();

-- ===== Сповіщення =====
create or replace function trg_appt_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; t text; ts text; b text; v_src text; v_old uuid; v_client boolean := false; v_actor text;
begin
  if new.demo then return new; end if;
  if tg_op = 'INSERT' then
    select source into v_src from visits where id = new.visit_id;
    k := 'new'; t := case when v_src = 'online' then 'Новий онлайн-запис' else 'Новий запис' end; ts := 'Ви записали';
    v_client := v_src = 'online';
  elsif new.status = 'cancel' and old.status <> 'cancel' then
    k := 'cancel'; t := case when new.cancelled_by = 'client' then 'Клієнт скасував запис' else 'Запис скасовано' end; ts := 'Ви скасували запис';
    v_client := new.cancelled_by = 'client';
  elsif new.starts_at <> old.starts_at or new.staff_id <> old.staff_id then
    k := 'move'; t := 'Запис перенесено'; ts := 'Ви перенесли запис'; v_old := old.staff_id;
  else
    return new;
  end if;
  -- хто зробив зміну в панелі (для інших — «Запис перенесено — Поліна»)
  if not v_client and auth.uid() is not null then select first_name into v_actor from staff where user_id = auth.uid() limit 1; end if;
  select s.name || ' · ' || to_char(new.starts_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI') || '–'
         || to_char(new.ends_at at time zone 'Europe/Kyiv', 'HH24:MI') || ' · ' || m.first_name || ' · ' || c.name || ' ' || c.phone
    into b from services s, staff m, clients c where s.id = new.service_id and m.id = new.staff_id and c.id = new.client_id;
  -- онлайн-запис і скасування клієнтом — сповіщення всім (навіть якщо робили з пристрою, де відкрита панель);
  -- дія з панелі — автору сірий рядок «Ви записали…» (одразу прочитаний, без Telegram), іншим — звичайне сповіщення
  insert into notifications (staff_id, kind, title, body, appointment_id, day, read_at)
  select x.id, k, case when me then ts when v_actor is not null then t || ' — ' || v_actor else t end, b, new.id, (new.starts_at at time zone 'Europe/Kyiv')::date, case when me then now() end
  from (select x.*, (not v_client and x.user_id is not null and x.user_id = auth.uid()) as me from staff x) x
   where x.is_active and (x.id = new.staff_id or x.id = v_old or x.role in ('owner','admin') or x.me)
     and coalesce((x.notify->>k)::boolean, true);
  return new;
end $$;
drop trigger if exists appt_notify on appointments;
create trigger appt_notify after insert or update on appointments for each row execute function trg_appt_notify();

-- ===== Історія змін запису: хто й коли створив, переніс, скасував, змінив послугу чи ціну =====
create table if not exists appt_log (
  id bigserial primary key,
  appointment_id uuid not null references appointments(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  who text,                 -- імʼя працівника або «клієнт(ка) онлайн»
  what text not null
);
create index if not exists appt_log_appt on appt_log (appointment_id, at);
alter table appt_log enable row level security;
revoke all on appt_log from anon, authenticated;
grant select on appt_log to authenticated;
drop policy if exists p_appt_log_read on appt_log;
create policy p_appt_log_read on appt_log for select to authenticated using ((select is_staff()));

create or replace function trg_appt_log() returns trigger language plpgsql security definer set search_path = public as $$
declare w text; l text[] := '{}'; tz constant text := 'Europe/Kyiv';
  om text; nm text; os text; ns text;
begin
  if new.demo then return new; end if;
  if auth.uid() is null then w := 'клієнт(ка) онлайн';
  else select first_name into w from staff where user_id = auth.uid() limit 1; end if;
  select first_name into nm from staff where id = new.staff_id;
  if tg_op = 'INSERT' then
    l := array['Створено: ' || to_char(new.starts_at at time zone tz, 'DD.MM HH24:MI') || ', ' || coalesce(nm, '')];
  else
    if new.starts_at <> old.starts_at or new.staff_id <> old.staff_id then
      select first_name into om from staff where id = old.staff_id;
      l := l || ('Перенесено: ' || to_char(old.starts_at at time zone tz, 'DD.MM HH24:MI') || case when new.staff_id <> old.staff_id then ', ' || coalesce(om, '') else '' end
        || ' → ' || to_char(new.starts_at at time zone tz, 'DD.MM HH24:MI') || case when new.staff_id <> old.staff_id then ', ' || coalesce(nm, '') else '' end);
    elsif (new.ends_at - new.starts_at) <> (old.ends_at - old.starts_at) then
      l := l || ('Тривалість: ' || (extract(epoch from old.ends_at - old.starts_at) / 60)::int || ' → ' || (extract(epoch from new.ends_at - new.starts_at) / 60)::int || ' хв');
    end if;
    if new.service_id <> old.service_id then
      select name into os from services where id = old.service_id; select name into ns from services where id = new.service_id;
      l := l || ('Послуга: ' || coalesce(os, '') || ' → ' || coalesce(ns, ''));
    end if;
    if new.price <> old.price then l := l || ('Ціна: ' || trim_scale(old.price)::text || ' → ' || trim_scale(new.price)::text || ' ₴'); end if;
    if new.status <> old.status then
      l := l || (case new.status when 'done' then 'Завершено й оплачено' when 'noshow' then 'Позначено «не прийшов(ла)»'
        when 'cancel' then 'Скасовано' || coalesce(': ' || nullif(new.cancel_reason, ''), '') when 'booked' then 'Відновлено (знову «Записано»)' else new.status end);
    end if;
  end if;
  if coalesce(array_length(l, 1), 0) > 0 then insert into appt_log (appointment_id, who, what) select new.id, w, x from unnest(l) x; end if;
  return new;
end $$;
drop trigger if exists appt_log on appointments;
create trigger appt_log after insert or update on appointments for each row execute function trg_appt_log();

-- нове сповіщення → у Telegram (якщо співробітник підключив бота)
create or replace function trg_notif_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if new.read_at is not null then return new; end if;   -- «Ви записали…» (власна дія) — без Telegram
  if exists (select 1 from staff where id = new.staff_id and tg_chat_id is not null and coalesce((notify->>'tg')::boolean, true)) then
    select hook_key into k from app_secrets where id = 1;
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'notify', 'id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
  end if;
  return new;
end $$;
drop trigger if exists notif_tg on notifications;
create trigger notif_tg after insert on notifications for each row execute function trg_notif_tg();

-- нагадування клієнтам (кожні 10 хв)
create or replace function nana_priv.remind_tick() returns void language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  select hook_key into k from app_secrets where id = 1;
  if exists (select 1 from appointments a join clients c on c.id = a.client_id
             where a.status = 'booked' and c.tg_chat_id is not null and a.starts_at > now() and a.starts_at < now() + interval '25 hours') then
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'remind'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
  end if;
end $$;
select cron.schedule('nana-remind', '*/10 * * * *', 'select nana_priv.remind_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-remind');

-- ===== Розклад на день у Telegram (зранку кожному: майстрині — її записи, власниці й адміну — усі) =====
alter table settings add column if not exists daily_hour int default 8 check (daily_hour between 0 and 23);   -- о котрій (за Києвом); null — не надсилати
alter table settings add column if not exists daily_sent date;                                                  -- коли вже надіслали (щоб не двічі)

create or replace function nana_priv.h(t text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- текст розкладу на день: p_all — усі майстри (для власниці/адміна), інакше лише записи p_staff; null — якщо записів немає
create or replace function nana_priv.daily_text(p_staff uuid, p_all boolean, p_day date) returns text
language sql stable security definer set search_path = public as $$
  with a as (
    select a.starts_at, a.ends_at, a.staff_id, s.name sname, m.first_name mname, m.sort msort, c.name cname, c.phone cphone, v.comment vcomment
      from appointments a join services s on s.id = a.service_id join staff m on m.id = a.staff_id
      join clients c on c.id = a.client_id join visits v on v.id = a.visit_id
     where not a.demo and a.status in ('booked', 'done') and (a.starts_at at time zone 'Europe/Kyiv')::date = p_day
       and (p_all or a.staff_id = p_staff)),
  l as (
    select msort, mname, starts_at,
      case when p_all and lag(staff_id) over (order by msort, mname, starts_at) is distinct from staff_id
           then chr(10) || '👩 <b>' || nana_priv.h(mname) || '</b>' || chr(10) else '' end
      || '• <b>' || to_char(starts_at at time zone 'Europe/Kyiv', 'HH24:MI') || '–' || to_char(ends_at at time zone 'Europe/Kyiv', 'HH24:MI') || '</b> '
      || nana_priv.h(cname) || ' — ' || nana_priv.h(sname)
      || case when not p_all then ' · ' || nana_priv.h(cphone) else '' end
      || case when not p_all and nullif(trim(vcomment), '') is not null then chr(10) || '   💬 ' || nana_priv.h(vcomment) else '' end as line
    from a)
  select case when count(*) = 0 then null else
    (case when p_all then 'Записи в салоні на сьогодні' else 'Твої записи на сьогодні' end) || ', '
    || (array['понеділок','вівторок','середа','четвер','пʼятниця','субота','неділя'])[extract(isodow from p_day)::int] || ', '
    || extract(day from p_day)::int || ' ' || (array['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'])[extract(month from p_day)::int]
    || ' — ' || count(*) || ':' || chr(10) || string_agg(line, chr(10) order by msort, mname, starts_at) end
  from l
$$;

-- раз на день о settings.daily_hour (за Києвом): кожному з підключеним Telegram — його розклад
create or replace function nana_priv.daily_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  x record; t text; n int := 0; site text;
begin
  select * into st from settings where id = 1;
  if not p_force and (st.daily_hour is null or hh < st.daily_hour or hh > st.daily_hour + 2 or st.daily_sent is not distinct from d) then return 0; end if;
  update settings set daily_sent = d where id = 1;
  select hook_key into k from app_secrets where id = 1;
  site := regexp_replace(coalesce(nullif(st.site_url, ''), 'https://nana-studio.pages.dev/'), '#.*$', '');
  for x in select s.* from staff s where s.is_active and s.tg_chat_id is not null
             and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'daily')::boolean, true) order by s.sort loop
    t := nana_priv.daily_text(x.id, x.role in ('owner', 'admin'), d);
    if t is null then continue; end if;
    t := '🌅 Доброго ранку, ' || nana_priv.h(x.first_name) || '!' || chr(10) || t || chr(10) || chr(10) || '<a href="' || site || '#/staff/cal/' || d || '">Відкрити календар</a>';
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'send', 'chat_id', x.tg_chat_id, 'text', t),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function nana_priv.daily_tick(boolean) from public, anon, authenticated;
revoke execute on function nana_priv.daily_text(uuid, boolean, date) from public, anon, authenticated;

-- «Надіслати розклад зараз» з Налаштувань (лише власниця/адмін)
create or replace function daily_send_now() returns int language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  return nana_priv.daily_tick(true);
end $$;
revoke execute on function daily_send_now() from public, anon;
grant execute on function daily_send_now() to authenticated;

select cron.schedule('nana-daily', '*/15 * * * *', 'select nana_priv.daily_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-daily');

-- вечірня перевірка «чи позакривала записи» (05.11.2026, update-13): о settings.close_hour бот питає майстриню, кнопка «Так, усе закрила» → перевірка в tg-bot
alter table settings add column if not exists close_hour int default 21 check (close_hour between 0 and 23);   -- null — не надсилати
alter table settings add column if not exists close_sent date;                                                  -- коли вже надіслали (щоб не двічі)

create or replace function nana_priv.close_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  x record; n int := 0;
begin
  select * into st from settings where id = 1;
  if not p_force and (st.close_hour is null or hh < st.close_hour or hh > st.close_hour + 1 or st.close_sent is not distinct from d) then return 0; end if;
  update settings set close_sent = d where id = 1;
  select hook_key into k from app_secrets where id = 1;
  for x in select s.id from staff s
            where s.is_active and s.tg_chat_id is not null
              and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'close')::boolean, true)
              and exists (select 1 from appointments a where a.staff_id = s.id and not a.demo and a.status <> 'cancel'
                            and (a.starts_at at time zone 'Europe/Kyiv')::date = d)
            order by s.sort loop
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'close_ask', 'staff_id', x.id, 'day', d),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function nana_priv.close_tick(boolean) from public, anon, authenticated;

-- «Надіслати перевірку зараз» з Налаштувань (лише власниця/адмін)
create or replace function close_send_now() returns int language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  return nana_priv.close_tick(true);
end $$;
revoke execute on function close_send_now() from public, anon;
grant execute on function close_send_now() to authenticated;

select cron.schedule('nana-close', '*/15 * * * *', 'select nana_priv.close_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-close');

-- графік на наступний місяць (05.11.2026, update-14): онлайн-запис на місяць відкривається кнопкою в «Графіку»;
-- з settings.open_day (22) щодня о 12:00 бот нагадує майстриням, які ще не відкрили наступний місяць (кнопка «Готово» → перевірка),
-- власниці/адміну з open_day+3 — хто ще не відкрив
alter table month_open enable row level security;
drop policy if exists p_mo_read on month_open;
create policy p_mo_read on month_open for select to authenticated using ((select is_staff()));
revoke insert, update, delete on month_open from anon, authenticated;
grant select on month_open to authenticated;

alter table settings add column if not exists open_day int default 22 check (open_day between 1 and 28);   -- з якого числа нагадувати; null — не нагадувати
alter table settings add column if not exists open_sent date;

-- відкрити / закрити місяць: майстриня — свій, власниця/адмін — будь-кого
create or replace function month_open_set(p_staff uuid, p_month date, p_open boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not (coalesce(is_boss(), false) or exists (select 1 from staff s where s.id = p_staff and s.user_id = auth.uid() and s.is_active)) then
    raise exception 'Можна відкривати лише свій графік';
  end if;
  if p_open then
    insert into month_open (staff_id, month) values (p_staff, m) on conflict do nothing;
  else
    delete from month_open where staff_id = p_staff and month = m;
  end if;
  return p_open;
end $$;
revoke execute on function month_open_set(uuid, date, boolean) from public, anon;
grant execute on function month_open_set(uuid, date, boolean) to authenticated;

create or replace function nana_priv.open_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  cm date := date_trunc('month', d)::date; nm date := (date_trunc('month', d) + interval '1 month')::date;
  dd int := extract(day from d); x record; mo date; n int := 0; late text; site text;
  mn text[] := array['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень'];
begin
  select * into st from settings where id = 1;
  if st.open_day is null and not p_force then return 0; end if;
  if not p_force and (hh < 12 or st.open_sent is not distinct from d) then return 0; end if;
  update settings set open_sent = d where id = 1;
  select hook_key into k from app_secrets where id = 1;
  site := regexp_replace(coalesce(nullif(st.site_url, ''), 'https://nana-studio.pages.dev/'), '#.*$', '');
  -- майстриням: поточний місяць (якщо раптом закритий) і наступний — з open_day
  for x in select s.* from staff s where s.is_active and s.is_bookable and s.tg_chat_id is not null
             and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'open')::boolean, true) order by s.sort loop
    foreach mo in array array[cm, nm] loop
      if mo = nm and dd < coalesce(st.open_day, 22) and not p_force then continue; end if;
      if exists (select 1 from month_open o where o.staff_id = x.id and o.month = mo) then continue; end if;
      perform net.http_post(
        url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
        body := jsonb_build_object('action', 'month_ask', 'staff_id', x.id, 'month', to_char(mo, 'YYYY-MM'), 'first', mo = nm and dd = coalesce(st.open_day, 22)),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
      n := n + 1;
    end loop;
  end loop;
  -- власниці / адміну: хто ще не відкрив наступний місяць (з open_day + 3)
  if dd >= coalesce(st.open_day, 22) + 3 or p_force then
    select string_agg('• ' || nana_priv.h(s.first_name || coalesce(' ' || nullif(trim(s.last_name), ''), '')) || case when s.tg_chat_id is null then ' (бот не підключено)' else '' end, chr(10) order by s.sort)
      into late from staff s where s.is_active and s.is_bookable
       and not exists (select 1 from month_open o where o.staff_id = s.id and o.month = nm);
    if late is not null then
      for x in select s.* from staff s where s.is_active and s.role in ('owner', 'admin') and s.tg_chat_id is not null
                 and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'open')::boolean, true) loop
        perform net.http_post(
          url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
          body := jsonb_build_object('action', 'send', 'chat_id', x.tg_chat_id, 'text',
            '📅 Ще не відкрили графік на ' || mn[extract(month from nm)::int] || ':' || chr(10) || late || chr(10) || chr(10)
            || 'Поки графік закритий, клієнтки не можуть записатись до них онлайн на ' || mn[extract(month from nm)::int] || '.' || chr(10)
            || '<a href="' || site || '#/staff/sched">Відкрити «Графік»</a>'),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
        n := n + 1;
      end loop;
    end if;
  end if;
  return n;
end $$;
revoke execute on function nana_priv.open_tick(boolean) from public, anon, authenticated;

-- «Надіслати нагадування зараз» з Налаштувань (лише власниця/адмін)
create or replace function open_send_now() returns int language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  return nana_priv.open_tick(true);
end $$;
revoke execute on function open_send_now() from public, anon;
grant execute on function open_send_now() to authenticated;

select cron.schedule('nana-open', '*/15 * * * *', 'select nana_priv.open_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-open');

-- підтвердження візиту клієнтом у Telegram (06.11.2026, update-15): у нагадуванні кнопка «✅ Так, я буду»
alter table visits add column if not exists confirmed_at timestamptz;   -- коли клієнт(ка) натиснув(ла) «Так, я буду»

-- викликає лише бот (service_role): перевіряє, що натиснула саме клієнтка цього візиту, ставить позначку й сповіщає персонал
create or replace function visit_confirm_tg(p_visit uuid, p_chat bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v visits; c clients; a appointments; b text; tz constant text := 'Europe/Kyiv';
begin
  select * into v from visits where id = p_visit;
  if v.id is null then return jsonb_build_object('err', 'not_found'); end if;
  select * into c from clients where id = v.client_id;
  if c.tg_chat_id is distinct from p_chat then return jsonb_build_object('err', 'not_yours'); end if;
  select * into a from appointments where visit_id = v.id and status = 'booked' order by starts_at limit 1;
  if a.id is null then return jsonb_build_object('err', 'no_active'); end if;
  if v.confirmed_at is not null then return jsonb_build_object('already', true, 'starts_at', a.starts_at); end if;
  update visits set confirmed_at = now() where id = v.id;
  insert into appt_log (appointment_id, actor, who, what) values (a.id, null, 'клієнт(ка)', 'підтвердив(ла) візит у Telegram');
  if not a.demo then
    select string_agg(s.name, ', ' order by x.starts_at) || ' · ' || to_char(min(x.starts_at) at time zone tz, 'DD.MM HH24:MI') || ' · ' || c.name || ' ' || c.phone
      into b from appointments x join services s on s.id = x.service_id where x.visit_id = v.id and x.status = 'booked';
    insert into notifications (staff_id, kind, title, body, appointment_id, day)
    select m.id, 'confirm', 'Клієнт підтвердив візит', b, a.id, (a.starts_at at time zone tz)::date
      from staff m
     where m.is_active and coalesce((m.notify->>'confirm')::boolean, true)
       and (m.role in ('owner', 'admin') or m.id in (select staff_id from appointments where visit_id = v.id and status = 'booked'));
  end if;
  return jsonb_build_object('ok', true, 'starts_at', a.starts_at);
end $$;
revoke execute on function visit_confirm_tg(uuid, bigint) from public, anon, authenticated;
grant execute on function visit_confirm_tg(uuid, bigint) to service_role;

-- перенесли час — підтвердження знімається (нове нагадування знову попросить підтвердити)
create or replace function trg_visit_unconfirm() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.starts_at <> old.starts_at then update visits set confirmed_at = null where id = new.visit_id and confirmed_at is not null; end if;
  return new;
end $$;
drop trigger if exists visit_unconfirm on appointments;
create trigger visit_unconfirm after update of starts_at on appointments for each row execute function trg_visit_unconfirm();

-- повторні візити через бота (10.11.2026, update-16): клієнткам з підключеним ботом
-- через settings.nudge1_days (28) днів після останнього візиту — «час оновити манікюр / брівки / вії» з кнопкою «Записатися»,
-- через settings.nudge2_days (60) — «давно не були, знижка nudge_pct (10%)» з кнопкою; знижка зберігається в clients.promo_* на 30 днів
alter table clients add column if not exists promo_pct int check (promo_pct between 1 and 90);   -- активна знижка, %
alter table clients add column if not exists promo_until date;                                    -- до якого дня діє
alter table clients add column if not exists nudge1_for timestamptz;   -- для якого останнього візиту вже надіслали «час оновити»
alter table clients add column if not exists nudge2_for timestamptz;   -- … і «знижку»
alter table settings add column if not exists nudge1_days int default 28 check (nudge1_days between 7 and 180);   -- null — не надсилати
alter table settings add column if not exists nudge2_days int default 60 check (nudge2_days between 14 and 365);
alter table settings add column if not exists nudge_pct int default 10 check (nudge_pct between 1 and 50);
alter table settings add column if not exists nudge_sent date;

-- nana_priv.nudge_tick — див. нижче (update-17)

select cron.schedule('nana-nudge', '*/15 * * * *', 'select nana_priv.nudge_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-nudge');

-- повторні візити через бота, доповнення (10.11.2026, update-17): журнал надісланого (для статистики на дашборді),
-- тест у Налаштуваннях (обидва повідомлення собі в бот), без знижки тим, хто часто скасовує або не приходить
create table if not exists nudge_log (
  id bigserial primary key,
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null check (kind in ('renew', 'promo', 'back')),   -- «час оновити» / знижка / «скучили» (без знижки)
  sent_at timestamptz not null default now()
);
create index if not exists nudge_log_sent on nudge_log (sent_at);
alter table nudge_log enable row level security;
revoke all on nudge_log from anon, authenticated;

-- текст і кнопка одного повідомлення; надсилає бот
create or replace function nana_priv.nudge_send(p_chat bigint, p_kind text, p_name text, p_what text, p_days int, p_pct int, p_until date)
returns void language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; site text; txt text; btn text; url text;
begin
  select * into st from settings where id = 1;
  select hook_key into k from app_secrets where id = 1;
  site := regexp_replace(coalesce(nullif(st.site_url, ''), 'https://nana-studio.pages.dev/'), '[?#].*$', '');
  if p_kind = 'promo' then
    txt := '💛 ' || p_name || ', ми помітили, що ви давно не відвідували нашу студію 🥺' || chr(10)
        || 'Тому хочемо запропонувати вам знижку <b>' || p_pct || '%</b> на будь-яку послугу студії 🎁' || chr(10) || chr(10)
        || 'Знижка діє до ' || to_char(p_until, 'DD.MM') || '. Запишіться зручним часом — майстриня врахує її під час оплати.';
    btn := '📅 Записатися зі знижкою'; url := site || '?from=telegram&promo=' || p_pct;
  elsif p_kind = 'back' then
    txt := '💛 ' || p_name || ', ми скучили за вами в NaNa studio — давно не бачились 🥺' || chr(10) || chr(10)
        || 'Запишіться зручним часом, будемо раді вам 👇';
    btn := '📅 Записатися'; url := site || '?from=telegram';
  else
    txt := '💛 ' || p_name || ', від вашої останньої процедури в NaNa studio минуло вже ' || p_days || ' днів.' || chr(10)
        || 'Саме зараз найкращий час, щоб оновити ' || p_what || ' ✨' || chr(10) || chr(10)
        || 'Записуйтесь, поки є зручні віконця 👇';
    btn := '📅 Записатися'; url := site || '?from=telegram';
  end if;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'send', 'chat_id', p_chat, 'text', txt,
      'buttons', jsonb_build_array(jsonb_build_array(jsonb_build_object('text', btn, 'url', url)))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
end $$;
revoke execute on function nana_priv.nudge_send(bigint, text, text, text, int, int, date) from public, anon, authenticated;

create or replace function nana_priv.nudge_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; tz constant text := 'Europe/Kyiv';
  d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  x record; n int := 0; days int; what text; nm text; until date;
begin
  select * into st from settings where id = 1;
  if st.nudge1_days is null and st.nudge2_days is null then return 0; end if;
  if not p_force and (hh < 11 or hh >= 20 or st.nudge_sent is not distinct from d) then return 0; end if;
  update settings set nudge_sent = d where id = 1;
  for x in
    select c.id, c.name, c.tg_chat_id, c.nudge1_for, c.nudge2_for, l.last_at, l.cancels, l.noshows
      from clients c
      join lateral (select max(a.starts_at) filter (where a.status = 'done') as last_at,
                           count(*) filter (where a.status = 'cancel') as cancels, count(*) filter (where a.status = 'noshow') as noshows
                      from appointments a where a.client_id = c.id) l on true
     where c.tg_chat_id is not null and not c.demo and l.last_at is not null
       and not exists (select 1 from appointments b where b.client_id = c.id and b.status = 'booked' and b.starts_at > now())
  loop
    days := d - (x.last_at at time zone tz)::date;
    nm := nana_priv.h(split_part(trim(x.name), ' ', 1));
    if st.nudge2_days is not null and days >= st.nudge2_days and days <= st.nudge2_days + 30 and x.nudge2_for is distinct from x.last_at then
      if x.noshows >= 2 or x.cancels >= 3 then   -- часто не приходить / скасовує — без знижки
        update clients set nudge2_for = x.last_at, nudge1_for = x.last_at where id = x.id;
        perform nana_priv.nudge_send(x.tg_chat_id, 'back', nm, null, days, null, null);
        insert into nudge_log (client_id, kind) values (x.id, 'back');
      else
        until := d + 30;
        update clients set promo_pct = st.nudge_pct, promo_until = until, nudge2_for = x.last_at, nudge1_for = x.last_at where id = x.id;
        perform nana_priv.nudge_send(x.tg_chat_id, 'promo', nm, null, days, st.nudge_pct, until);
        insert into nudge_log (client_id, kind) values (x.id, 'promo');
      end if;
      n := n + 1;
    elsif st.nudge1_days is not null and days >= st.nudge1_days and days < coalesce(st.nudge2_days, 100000) and days <= st.nudge1_days + 14
          and x.nudge1_for is distinct from x.last_at then
      update clients set nudge1_for = x.last_at where id = x.id;
      select string_agg(w, ' та ' order by array_position(array['манікюр', 'педикюр', 'брівки', 'нарощення вій'], w)) into what from (
        select distinct case s.category when 'Манікюр' then 'манікюр' when 'Педикюр' then 'педикюр' when 'Брови та ламі вій' then 'брівки'
                                        when 'Нарощення вій' then 'нарощення вій' end as w
          from appointments a join services s on s.id = a.service_id
         where a.client_id = x.id and a.status = 'done' and (a.starts_at at time zone tz)::date = (x.last_at at time zone tz)::date) q
       where w is not null;
      if what is null then continue; end if;
      perform nana_priv.nudge_send(x.tg_chat_id, 'renew', nm, what, days, null, null);
      insert into nudge_log (client_id, kind) values (x.id, 'renew');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function nana_priv.nudge_tick(boolean) from public, anon, authenticated;

-- «Тест» у Налаштуваннях: усі три повідомлення — у бот того, хто натиснув (власниця/адмін)
create or replace function nudge_test() returns int language plpgsql security definer set search_path = public as $$
declare st settings; me staff; nm text;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  select * into st from settings where id = 1;
  nm := nana_priv.h(me.first_name);
  perform nana_priv.nudge_send(me.tg_chat_id, 'renew', nm, 'манікюр та брівки', coalesce(st.nudge1_days, 28), null, null);
  perform nana_priv.nudge_send(me.tg_chat_id, 'promo', nm, null, coalesce(st.nudge2_days, 60), coalesce(st.nudge_pct, 10), (now() at time zone 'Europe/Kyiv')::date + 30);
  perform nana_priv.nudge_send(me.tg_chat_id, 'back', nm, null, coalesce(st.nudge2_days, 60), null, null);
  return 3;
end $$;
revoke execute on function nudge_test() from public, anon;
grant execute on function nudge_test() to authenticated;

-- статистика для дашборду: скільки надіслано за період і скільки після цього записались (протягом 30 днів)
create or replace function nudge_stats(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (
    select n.*, c.name, c.phone,
      (select min(a.created_at) from appointments a where a.client_id = n.client_id and a.created_at > n.sent_at
          and a.created_at < n.sent_at + interval '30 days' and a.status <> 'cancel') as booked_at
      from nudge_log n join clients c on c.id = n.client_id
     where coalesce(is_boss(), false)
       and (n.sent_at at time zone 'Europe/Kyiv')::date between p_from and p_to)
  select jsonb_build_object(
    'sent', count(*), 'booked', count(booked_at),
    'renew', count(*) filter (where kind = 'renew'), 'promo', count(*) filter (where kind = 'promo'), 'back', count(*) filter (where kind = 'back'),
    'list', coalesce(jsonb_agg(jsonb_build_object('client_id', client_id, 'name', name, 'phone', phone, 'kind', kind, 'sent_at', sent_at, 'booked_at', booked_at)
                     order by sent_at desc), '[]'))
  from l
$$;
revoke execute on function nudge_stats(date, date) from public, anon;
grant execute on function nudge_stats(date, date) to authenticated;

-- щомісячний звіт у Telegram (10.11.2026, update-18): 1 числа о 10:00 власниці й адміну — Excel з клієнтками за минулий місяць + цифри
alter table settings add column if not exists report_on boolean not null default true;
alter table settings add column if not exists report_sent date;

create or replace function nana_priv.report_post(p_from date, p_to date, p_chats bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(array_length(p_chats, 1), 0) = 0 then return; end if;
  select hook_key into k from app_secrets where id = 1;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'monthly_report', 'from', p_from, 'to', p_to, 'chats', to_jsonb(p_chats)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text),
    timeout_milliseconds := 60000);
end $$;
revoke execute on function nana_priv.report_post(date, date, bigint[]) from public, anon, authenticated;

create or replace function nana_priv.report_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  pm date := (date_trunc('month', (now() at time zone 'Europe/Kyiv')::date) - interval '1 month')::date; ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.report_on or extract(day from d) <> 1 or hh < 10 or st.report_sent is not distinct from d then return 0; end if;
  update settings set report_sent = d where id = 1;
  select array_agg(tg_chat_id) into ch from staff
   where is_active and role in ('owner', 'admin') and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'report')::boolean, true);
  perform nana_priv.report_post(pm, (pm + interval '1 month' - interval '1 day')::date, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.report_tick() from public, anon, authenticated;

-- «Надіслати звіт зараз» у Налаштуваннях: за цей місяць (з 1 числа по сьогодні) — у бот того, хто натиснув
create or replace function report_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff; d date := (now() at time zone 'Europe/Kyiv')::date;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  perform nana_priv.report_post(date_trunc('month', d)::date, d, array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function report_send_now() from public, anon;
grant execute on function report_send_now() to authenticated;

select cron.schedule('nana-report', '*/15 * * * *', 'select nana_priv.report_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-report');

-- тижневий підсумок у Telegram (10.11.2026, update-19): щопонеділка о 10:00 власниці й адміну — цифри за минулий тиждень
alter table settings add column if not exists weekly_on boolean not null default true;
alter table settings add column if not exists weekly_sent date;

create or replace function nana_priv.weekly_post(p_from date, p_to date, p_chats bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(array_length(p_chats, 1), 0) = 0 then return; end if;
  select hook_key into k from app_secrets where id = 1;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'weekly_summary', 'from', p_from, 'to', p_to, 'chats', to_jsonb(p_chats)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text),
    timeout_milliseconds := 30000);
end $$;
revoke execute on function nana_priv.weekly_post(date, date, bigint[]) from public, anon, authenticated;

create or replace function nana_priv.weekly_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv'); ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.weekly_on or extract(isodow from d) <> 1 or hh < 10 or st.weekly_sent is not distinct from d then return 0; end if;
  update settings set weekly_sent = d where id = 1;
  select array_agg(tg_chat_id) into ch from staff
   where is_active and role in ('owner', 'admin') and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'weekly')::boolean, true);
  perform nana_priv.weekly_post(d - 7, d - 1, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.weekly_tick() from public, anon, authenticated;

-- «Тиждень зараз» у Налаштуваннях: за минулий тиждень (пн–нд) — у бот того, хто натиснув
create or replace function weekly_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff; d date := (now() at time zone 'Europe/Kyiv')::date; mon date;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  mon := d - (extract(isodow from d)::int - 1);   -- понеділок цього тижня
  perform nana_priv.weekly_post(mon - 7, mon - 1, array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function weekly_send_now() from public, anon;
grant execute on function weekly_send_now() to authenticated;

select cron.schedule('nana-weekly', '*/15 * * * *', 'select nana_priv.weekly_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-weekly');

-- ===== RLS і доступ =====
do $$ declare t text; begin
  foreach t in array array['settings','app_secrets','staff','staff_pay','services','master_services','work_hours','day_overrides',
    'blocks','clients','visits','appointments','payments','expenses','notifications','tg_chats','pw_links'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on settings, services, master_services, work_hours to anon;
grant select, update on settings, app_secrets to authenticated;
grant select, insert, update on staff, staff_pay, services, master_services, clients, expenses to authenticated;
grant select, insert, update, delete on work_hours, day_overrides, blocks to authenticated;
grant delete on master_services, expenses to authenticated;
grant select on visits, appointments, payments, notifications, tg_chats to authenticated;
grant update (comment) on visits to authenticated;
grant update (note) on appointments to authenticated;
grant update (read_at) on notifications to authenticated;

drop policy if exists p_settings_read on settings;
create policy p_settings_read on settings for select to anon, authenticated using (true);
drop policy if exists p_settings_boss on settings;
create policy p_settings_boss on settings for update to authenticated using ((select is_boss())) with check ((select is_boss()));

drop policy if exists p_secrets_boss on app_secrets;
create policy p_secrets_boss on app_secrets for all to authenticated using ((select is_boss())) with check ((select is_boss()));

drop policy if exists p_staff_read on staff;
create policy p_staff_read on staff for select to authenticated using ((select is_staff()));
drop policy if exists p_staff_boss on staff;
create policy p_staff_boss on staff for insert to authenticated with check ((select is_boss()));
drop policy if exists p_staff_upd on staff;
create policy p_staff_upd on staff for update to authenticated using ((select is_boss()) or id = (select me())) with check ((select is_boss()) or id = (select me()));

drop policy if exists p_pay_read on staff_pay;
create policy p_pay_read on staff_pay for select to authenticated using ((select is_boss()) or staff_id = (select me()));
drop policy if exists p_pay_ins on staff_pay;
create policy p_pay_ins on staff_pay for insert to authenticated with check ((select is_boss()));
drop policy if exists p_pay_upd on staff_pay;
create policy p_pay_upd on staff_pay for update to authenticated using ((select is_boss())) with check ((select is_boss()));

drop policy if exists p_services_read on services;
create policy p_services_read on services for select to anon, authenticated using (is_active or (select is_staff()));
drop policy if exists p_services_ins on services;
create policy p_services_ins on services for insert to authenticated with check ((select is_boss()));
drop policy if exists p_services_upd on services;
create policy p_services_upd on services for update to authenticated using ((select is_boss())) with check ((select is_boss()));

drop policy if exists p_ms_read on master_services;
create policy p_ms_read on master_services for select to anon, authenticated using (true);
drop policy if exists p_ms_ins on master_services;
create policy p_ms_ins on master_services for insert to authenticated with check ((select is_boss()));
drop policy if exists p_ms_upd on master_services;
create policy p_ms_upd on master_services for update to authenticated using ((select is_boss())) with check ((select is_boss()));
drop policy if exists p_ms_del on master_services;
create policy p_ms_del on master_services for delete to authenticated using ((select is_boss()));

drop policy if exists p_wh_read on work_hours;
create policy p_wh_read on work_hours for select to anon, authenticated using (true);
drop policy if exists p_wh_write on work_hours;
create policy p_wh_write on work_hours for all to authenticated
  using ((select is_boss()) or staff_id = (select me())) with check ((select is_boss()) or staff_id = (select me()));

drop policy if exists p_do_read on day_overrides;
create policy p_do_read on day_overrides for select to authenticated using ((select is_staff()));
drop policy if exists p_do_write on day_overrides;
create policy p_do_write on day_overrides for all to authenticated
  using ((select is_boss()) or staff_id = (select me())) with check ((select is_boss()) or staff_id = (select me()));

drop policy if exists p_blocks_read on blocks;
create policy p_blocks_read on blocks for select to authenticated using ((select is_staff()));
drop policy if exists p_blocks_write on blocks;
create policy p_blocks_write on blocks for all to authenticated
  using ((select is_boss()) or staff_id = (select me())) with check ((select is_boss()) or staff_id = (select me()));

drop policy if exists p_clients_read on clients;
create policy p_clients_read on clients for select to authenticated using ((select is_staff()));
drop policy if exists p_clients_ins on clients;
create policy p_clients_ins on clients for insert to authenticated with check ((select is_staff()));
drop policy if exists p_clients_upd on clients;
create policy p_clients_upd on clients for update to authenticated using ((select is_staff())) with check ((select is_staff()));

drop policy if exists p_visits_read on visits;
create policy p_visits_read on visits for select to authenticated using ((select is_staff()));
drop policy if exists p_visits_upd on visits;
create policy p_visits_upd on visits for update to authenticated using ((select is_staff())) with check ((select is_staff()));

drop policy if exists p_appt_read on appointments;
create policy p_appt_read on appointments for select to authenticated using ((select is_staff()));
drop policy if exists p_appt_upd on appointments;
create policy p_appt_upd on appointments for update to authenticated
  using ((select is_boss()) or staff_id = (select me())) with check ((select is_boss()) or staff_id = (select me()));

drop policy if exists p_payments_read on payments;
create policy p_payments_read on payments for select to authenticated using ((select is_boss()) or staff_id = (select me()));

drop policy if exists p_expenses_boss on expenses;
create policy p_expenses_boss on expenses for all to authenticated using ((select is_boss())) with check ((select is_boss()));

drop policy if exists p_notif_own on notifications;
create policy p_notif_own on notifications for all to authenticated using (staff_id = (select me())) with check (staff_id = (select me()));

drop policy if exists p_tgchats_boss on tg_chats;
create policy p_tgchats_boss on tg_chats for select to authenticated using ((select is_boss()));

-- функції: клієнтам — лише запис; решта перевіряє права всередині
revoke execute on all functions in schema nana_priv from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['slot_check(uuid,timestamptz,timestamptz,uuid,boolean,uuid)','staff_book(uuid,text,text,text,uuid,uuid,timestamptz,int,numeric,text,boolean,uuid)',
    'staff_move(uuid,uuid,timestamptz,int,boolean)','appt_service(uuid,uuid,int,numeric,boolean)','appt_status(uuid,text,numeric,text,text)','clients_stats()','client_merge(uuid,uuid)','staff_set_login(uuid,text,text)',
    'team_link(boolean,boolean)','demo_clear()','daily_send_now()','me()','my_role()','is_boss()','is_owner()','my_master()'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['pub_catalog()','pub_busy(date,date)','book_visit(jsonb,text,text,text,text,text,text)',
    'client_visit(uuid)','client_cancel(uuid,uuid)','client_move(uuid,uuid,timestamptz)','is_staff()','norm_phone(text)'] loop
    execute 'grant execute on function ' || f || ' to anon, authenticated';
  end loop;
end $$;

-- ===== Фото персоналу =====
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists p_photos_ins on storage.objects;
create policy p_photos_ins on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (select public.is_staff()));
drop policy if exists p_photos_read on storage.objects;
create policy p_photos_read on storage.objects for select to authenticated using (bucket_id = 'photos');
drop policy if exists p_photos_upd on storage.objects;
create policy p_photos_upd on storage.objects for update to authenticated using (bucket_id = 'photos' and (select public.is_staff()));

notify pgrst, 'reload schema';
