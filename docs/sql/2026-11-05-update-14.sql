-- Оновлення бази 05.11.2026 (14): графік на наступний місяць.
-- Онлайн-запис на місяць відкривається, коли майстриня в «Графіку» натисне «Відкрити графік на …».
-- З 22 числа щодня о 12:00 бот нагадує тим, хто ще не відкрив наступний місяць (кнопка «Готово» перевіряє),
-- власниці з 25 числа — хто ще не відкрив. Поточний місяць (листопад) відкривається всім одразу, щоб нічого не зламалось.
-- Можна запускати повторно.

create table if not exists month_open (
  staff_id uuid not null references staff(id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- перше число місяця
  opened_at timestamptz not null default now(),
  opened_by uuid default auth.uid(),
  primary key (staff_id, month)
);

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

-- поточний місяць — відкритий для всіх, хто приймає записи (грудень кожна відкриває сама)
insert into month_open (staff_id, month, opened_by)
select s.id, date_trunc('month', now() at time zone 'Europe/Kyiv')::date, null from staff s where s.is_active and s.is_bookable
on conflict do nothing;

-- перевірка
select (select count(*) from month_open) as opened,
       exists (select 1 from cron.job where jobname = 'nana-open') as cron_ok,
       to_regprocedure('month_open_set(uuid,date,boolean)') is not null as fn_ok,
       (select open_day from settings where id = 1) as open_day;
