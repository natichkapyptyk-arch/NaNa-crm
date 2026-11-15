-- 2026-11-15 update-26: якщо кілька карток співробітників підключені до одного Telegram — одне повідомлення на чат
-- (підсумок дня, ранковий розклад, «відкрийте графік», звіти, сповіщення); підсумок дня атомарно раз на день. Можна запускати повторно.

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
  -- якщо кілька карток підключені до одного Telegram — одне повідомлення на чат (пріоритет власниці / адміна)
  for x in select distinct on (s.tg_chat_id) s.* from staff s where s.is_active and s.tg_chat_id is not null
             and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'daily')::boolean, true)
             order by s.tg_chat_id, (s.role in ('owner', 'admin')) desc, s.sort loop
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
      for x in select distinct on (s.tg_chat_id) s.* from staff s where s.is_active and s.role in ('owner', 'admin') and s.tg_chat_id is not null
                 and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'open')::boolean, true) order by s.tg_chat_id loop
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

create or replace function nana_priv.report_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  pm date := (date_trunc('month', (now() at time zone 'Europe/Kyiv')::date) - interval '1 month')::date; ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.report_on or extract(day from d) <> 1 or hh < 10 or st.report_sent is not distinct from d then return 0; end if;
  update settings set report_sent = d where id = 1;
  select array_agg(distinct tg_chat_id) into ch from staff
   where is_active and (role = 'owner' or (role = 'admin' and see_money)) and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'report')::boolean, true);
  perform nana_priv.report_post(pm, (pm + interval '1 month' - interval '1 day')::date, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;

create or replace function nana_priv.weekly_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv'); ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.weekly_on or extract(isodow from d) <> 1 or hh < 10 or st.weekly_sent is not distinct from d then return 0; end if;
  update settings set weekly_sent = d where id = 1;
  select array_agg(distinct tg_chat_id) into ch from staff
   where is_active and (role = 'owner' or (role = 'admin' and see_money)) and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'weekly')::boolean, true);
  perform nana_priv.weekly_post(d - 7, d - 1, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;

create or replace function nana_priv.dsum_post(d date, p_staff uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare k uuid; r record; n int := 0; tm text; tn text;
begin
  select hook_key into k from app_secrets where id = 1;
  -- один чат — одне повідомлення (якщо кілька карток підключені до того самого Telegram)
  for r in select distinct on (tg_chat_id) id, tg_chat_id, (role = 'owner' or (role = 'admin' and see_money)) as money from staff
    where is_active and tg_chat_id is not null and (
      (p_staff is null and role in ('owner', 'admin') and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'dsum')::boolean, true))
      or id = p_staff)
    order by tg_chat_id, (role = 'owner' or (role = 'admin' and see_money)) desc
  loop
    if r.money then tm := coalesce(tm, nana_priv.dsum_text(d, true)); else tn := coalesce(tn, nana_priv.dsum_text(d, false)); end if;
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'send', 'chat_id', r.tg_chat_id, 'text', case when r.money then tm else tn end),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function nana_priv.dsum_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
begin
  select * into st from settings where id = 1;
  if st.dsum_hour is null or hh < st.dsum_hour or st.dsum_sent is not distinct from d then return 0; end if;
  update settings set dsum_sent = d where id = 1 and dsum_sent is distinct from d;   -- атомарно: двічі за день не надішле
  if not found then return 0; end if;
  return nana_priv.dsum_post(d);
end $$;

create or replace function trg_notif_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  -- «Ви записали…» (власна дія) — у Telegram лише тим, хто увімкнув «Мої власні дії» (notify.self)
  if new.read_at is not null and not exists (select 1 from staff where id = new.staff_id and coalesce((notify->>'self')::boolean, false)) then return new; end if;
  if exists (select 1 from notifications n2 join staff s2 on s2.id = n2.staff_id join staff s1 on s1.id = new.staff_id
     where n2.id <> new.id and s2.id <> s1.id and s2.tg_chat_id = s1.tg_chat_id and n2.kind = new.kind
       and n2.appointment_id is not distinct from new.appointment_id and n2.created_at > now() - interval '2 minutes'
       and (n2.created_at, n2.id::text) < (new.created_at, new.id::text)   -- надсилає лише перший з однакових
       and coalesce((s2.notify->>'tg')::boolean, true) and (n2.read_at is null or coalesce((s2.notify->>'self')::boolean, false))) then
    return new;
  end if;
  if exists (select 1 from staff where id = new.staff_id and tg_chat_id is not null and coalesce((notify->>'tg')::boolean, true)) then
    select hook_key into k from app_secrets where id = 1;
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'notify', 'id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
  end if;
  return new;
end $$;


-- для перевірки: які картки ділять один Telegram
select string_agg(first_name || ' (' || role || ')', ' + ' order by sort) as one_telegram from staff
 where is_active and tg_chat_id is not null group by tg_chat_id having count(*) > 1;
