-- 2026-11-13 update-25: підсумок дня в Telegram увечері; «Прибрати демо-дані» вимикає тестові сповіщення 🧪. Можна запускати повторно.

-- підсумок дня в Telegram (13.11.2026, update-25): увечері власниці й адміну — скільки записів, скасувань, перенесень за сьогодні
alter table settings add column if not exists dsum_hour int check (dsum_hour between 0 and 23) default 22;   -- null — не надсилати
alter table settings add column if not exists dsum_sent date;
-- тестові сповіщення 🧪 для демо-записів; кнопка «Прибрати демо-дані» вимикає їх разом з даними
alter table settings add column if not exists demo_notify boolean not null default true;

create or replace function nana_priv.dsum_text(d date, p_money boolean) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  f timestamptz := d::timestamp at time zone 'Europe/Kyiv'; t timestamptz := (d + 1)::timestamp at time zone 'Europe/Kyiv';
  n_new int; n_online int; n_cancel int; n_ccl int; n_move int; n_done int; n_noshow int; n_open int; rev numeric;
  dn int; dc int; dm int; demo_on boolean; txt text; per text;
begin
  -- нові записи (візити), створені сьогодні
  select count(distinct a.visit_id), count(distinct a.visit_id) filter (where v.source = 'online') into n_new, n_online
    from appointments a join visits v on v.id = a.visit_id where not a.demo and a.created_at >= f and a.created_at < t;
  -- скасування й перенесення сьогодні (з історії записів)
  select count(distinct l.appointment_id) filter (where l.what like 'Скасовано%'),
         count(distinct l.appointment_id) filter (where l.what like 'Скасовано%' and a.cancelled_by = 'client'),
         count(distinct l.appointment_id) filter (where l.what like 'Перенесено%')
    into n_cancel, n_ccl, n_move
    from appt_log l join appointments a on a.id = l.appointment_id where not a.demo and l.at >= f and l.at < t;
  -- візити сьогодні: завершено, не прийшли, не закрито
  select count(distinct a.client_id) filter (where a.status = 'done'), count(*) filter (where a.status = 'noshow'),
         count(*) filter (where a.status = 'booked' and a.ends_at < now())
    into n_done, n_noshow, n_open
    from appointments a where not a.demo and a.starts_at >= f and a.starts_at < t;
  select coalesce(sum(p.amount), 0) into rev from payments p join appointments a on a.id = p.appointment_id where not a.demo and p.paid_at >= f and p.paid_at < t;
  txt := '📋 <b>Підсумок дня, ' || to_char(d, 'DD.MM') || '</b>'
    || E'\n✅ Завершено візитів: ' || n_done || case when p_money then ' · 💰 ' || replace(trim(to_char(rev, 'FM999G999G990')), ',', ' ') || ' ₴' else '' end
    || E'\n🆕 Нових записів: ' || n_new || case when n_online > 0 then ' (онлайн ' || n_online || ')' else '' end
    || E'\n🔁 Перенесено: ' || n_move
    || E'\n❌ Скасовано: ' || n_cancel || case when n_ccl > 0 then ' (клієнтом ' || n_ccl || ')' else '' end
    || case when n_noshow > 0 then E'\n🚫 Не прийшли: ' || n_noshow else '' end
    || case when n_open > 0 then E'\n⏳ Не закрито: ' || n_open || ' — закрийте в календарі' else '' end;
  -- по майстрах (лише ті, в кого щось було)
  select string_agg('• ' || m.first_name || ': ' || concat_ws(', ',
           nullif(x.done, 0) || ' зав.', nullif(x.canc, 0) || ' скас.', nullif(x.mv, 0) || ' перен.'), E'\n' order by m.sort, m.first_name)
    into per
    from staff m join lateral (
      select (select count(distinct a.client_id) from appointments a where a.staff_id = m.id and not a.demo and a.status = 'done' and a.starts_at >= f and a.starts_at < t) done,
             (select count(distinct l.appointment_id) from appt_log l join appointments a on a.id = l.appointment_id where a.staff_id = m.id and not a.demo and l.what like 'Скасовано%' and l.at >= f and l.at < t) canc,
             (select count(distinct l.appointment_id) from appt_log l join appointments a on a.id = l.appointment_id where a.staff_id = m.id and not a.demo and l.what like 'Перенесено%' and l.at >= f and l.at < t) mv
    ) x on true
   where m.is_active and not m.demo and (x.done + x.canc + x.mv) > 0;
  if per is not null then txt := txt || E'\n\n' || per; end if;
  -- тестові (демо) — поки увімкнені тестові сповіщення
  select coalesce(demo_notify, true) into demo_on from settings where id = 1;
  if demo_on then
    select count(distinct n.appointment_id) filter (where n.kind = 'new'), count(distinct n.appointment_id) filter (where n.kind = 'cancel'),
           count(distinct n.appointment_id) filter (where n.kind = 'move')
      into dn, dc, dm
      from notifications n join appointments a on a.id = n.appointment_id where a.demo and n.created_at >= f and n.created_at < t;
    if dn + dc + dm > 0 then txt := txt || E'\n\n🧪 Тестові (демо): нових ' || dn || ', скасовано ' || dc || ', перенесено ' || dm; end if;
  end if;
  return txt;
end $$;
revoke execute on function nana_priv.dsum_text(date, boolean) from public, anon, authenticated;

-- надіслати підсумок: p_staff = null — усім, хто має отримувати; інакше — лише цьому співробітнику
create or replace function nana_priv.dsum_post(d date, p_staff uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare k uuid; r record; n int := 0; tm text; tn text;
begin
  select hook_key into k from app_secrets where id = 1;
  for r in select id, tg_chat_id, (role = 'owner' or (role = 'admin' and see_money)) as money from staff
    where is_active and tg_chat_id is not null and (
      (p_staff is null and role in ('owner', 'admin') and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'dsum')::boolean, true))
      or id = p_staff)
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
revoke execute on function nana_priv.dsum_post(date, uuid) from public, anon, authenticated;

create or replace function nana_priv.dsum_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
begin
  select * into st from settings where id = 1;
  if st.dsum_hour is null or hh < st.dsum_hour or st.dsum_sent is not distinct from d then return 0; end if;
  update settings set dsum_sent = d where id = 1;
  return nana_priv.dsum_post(d);
end $$;
revoke execute on function nana_priv.dsum_tick() from public, anon, authenticated;

-- «Підсумок зараз» у Налаштуваннях: за сьогодні — у бот того, хто натиснув
create or replace function dsum_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  return nana_priv.dsum_post((now() at time zone 'Europe/Kyiv')::date, me.id);
end $$;
revoke execute on function dsum_send_now() from public, anon;
grant execute on function dsum_send_now() to authenticated;

select cron.schedule('nana-dsum', '*/15 * * * *', 'select nana_priv.dsum_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-dsum');

create or replace function trg_appt_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; t text; ts text; b text; v_src text; v_old uuid; v_client boolean := false; v_actor text;
begin
  -- демо-записи теж сповіщають (поки сайт у тесті), з позначкою «🧪»; «Прибрати демо-дані» вимикає це (settings.demo_notify)
  if new.demo and not coalesce((select demo_notify from settings where id = 1), true) then return new; end if;
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
  if new.demo then t := '🧪 ' || t; ts := '🧪 ' || ts; end if;
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
  update settings set demo_notify = false where id = 1;   -- тестові сповіщення 🧪 більше не потрібні
  return jsonb_build_object('appointments', n1, 'clients', n2, 'staff', n3);
end $$;

notify pgrst, 'reload schema';
