-- 2026-11-16 update-27: підсумок дня не надсилається автоматично, якщо за день нічого не було (кнопка «Підсумок зараз» — коротке «без змін»). Можна запускати повторно.

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
  -- тестові (демо) — поки увімкнені тестові сповіщення
  select coalesce(demo_notify, true) into demo_on from settings where id = 1;
  dn := 0; dc := 0; dm := 0;
  if demo_on then
    select count(distinct n.appointment_id) filter (where n.kind = 'new'), count(distinct n.appointment_id) filter (where n.kind = 'cancel'),
           count(distinct n.appointment_id) filter (where n.kind = 'move')
      into dn, dc, dm
      from notifications n join appointments a on a.id = n.appointment_id where a.demo and n.created_at >= f and n.created_at < t;
  end if;
  -- за день нічого не було — порожньо (автоматичний підсумок тоді не надсилається)
  if n_new + n_cancel + n_move + n_done + n_noshow + n_open = 0 and rev = 0 and dn + dc + dm = 0 then return ''; end if;
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
  if dn + dc + dm > 0 then txt := txt || E'\n\n🧪 Тестові (демо): нових ' || dn || ', скасовано ' || dc || ', перенесено ' || dm; end if;
  return txt;
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
    -- нічого не було: автоматично — не надсилаємо; «Підсумок зараз» (p_staff) — коротке повідомлення
    if coalesce(case when r.money then tm else tn end, '') = '' then
      if p_staff is null then continue; end if;
      tm := '📋 <b>Підсумок дня, ' || to_char(d, 'DD.MM') || E'</b>\nСьогодні без записів, скасувань і перенесень.'; tn := tm;
    end if;
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'send', 'chat_id', r.tg_chat_id, 'text', case when r.money then tm else tn end),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
    n := n + 1;
  end loop;
  return n;
end $$;

notify pgrst, 'reload schema';
