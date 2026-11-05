-- Оновлення бази 05.11.2026 (9) — містить і оновлення 7 та 8 (їх окремо запускати не треба).
-- 1) Розклад на день у Telegram зранку: майстрині — її записи, власниці й адміну — усі (settings.daily_hour, кнопка «Надіслати зараз»).
-- 2) Звідки прийшла клієнтка (Instagram, Google Maps…): visits.ref + book_visit(…, p_ref).
-- 3) Сповіщення: онлайн-запис і скасування клієнтом — усім; власні дії з панелі — сірим «Ви записали…», без Telegram.
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.

alter table visits add column if not exists ref text;   -- insta, gmaps, google, tiktok, facebook, direct…

drop function if exists book_visit(jsonb, text, text, text, text, text);
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
grant execute on function book_visit(jsonb,text,text,text,text,text,text) to anon, authenticated;

create or replace function trg_appt_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; t text; ts text; b text; v_src text; v_old uuid; v_client boolean := false;
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
  select s.name || ' · ' || to_char(new.starts_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI') || '–'
         || to_char(new.ends_at at time zone 'Europe/Kyiv', 'HH24:MI') || ' · ' || m.first_name || ' · ' || c.name || ' ' || c.phone
    into b from services s, staff m, clients c where s.id = new.service_id and m.id = new.staff_id and c.id = new.client_id;
  -- онлайн-запис і скасування клієнтом — сповіщення всім (навіть якщо робили з пристрою, де відкрита панель);
  -- дія з панелі — автору сірий рядок «Ви записали…» (одразу прочитаний, без Telegram), іншим — звичайне сповіщення
  insert into notifications (staff_id, kind, title, body, appointment_id, day, read_at)
  select x.id, k, case when me then ts else t end, b, new.id, (new.starts_at at time zone 'Europe/Kyiv')::date, case when me then now() end
  from (select x.*, (not v_client and x.user_id is not null and x.user_id = auth.uid()) as me from staff x) x
   where x.is_active and (x.id = new.staff_id or x.id = v_old or x.role in ('owner','admin') or x.me)
     and coalesce((x.notify->>k)::boolean, true);
  return new;
end $$;

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

-- онлайн-записи за останні 2 дні, про які сповіщення загубилось: доставити зараз (раз; повторний запуск не дублює)
insert into notifications (staff_id, kind, title, body, appointment_id, day)
select x.id, 'new', 'Новий онлайн-запис',
       s.name || ' · ' || to_char(a.starts_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI') || '–' || to_char(a.ends_at at time zone 'Europe/Kyiv', 'HH24:MI')
         || ' · ' || m.first_name || ' · ' || c.name || ' ' || c.phone,
       a.id, (a.starts_at at time zone 'Europe/Kyiv')::date
from appointments a
join visits v on v.id = a.visit_id and v.source = 'online'
join services s on s.id = a.service_id join staff m on m.id = a.staff_id join clients c on c.id = a.client_id
join staff x on x.is_active and (x.id = a.staff_id or x.role in ('owner','admin')) and coalesce((x.notify->>'new')::boolean, true)
where not a.demo and a.status = 'booked' and a.created_at > now() - interval '2 days'
  and not exists (select 1 from notifications n where n.appointment_id = a.id and n.staff_id = x.id and n.kind = 'new');

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

select (select count(*) from information_schema.columns where table_name = 'visits' and column_name = 'ref') = 1 as ref_ok,
       position('p_ref' in pg_get_functiondef('book_visit(jsonb,text,text,text,text,text,text)'::regprocedure)) > 0 as booking_ok,
       position('ts := ' in pg_get_functiondef('trg_appt_notify'::regproc)) > 0 as notify_ok,
       position('read_at is not null' in pg_get_functiondef('trg_notif_tg'::regproc)) > 0 as telegram_ok,
       exists (select 1 from cron.job where jobname = 'nana-daily') as daily_ok;
