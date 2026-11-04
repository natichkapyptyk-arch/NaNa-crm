-- Оновлення бази 04.11.2026 (7) — замінює оновлення 6 (6 окремо запускати не треба).
-- Сповіщення: онлайн-запис і скасування клієнтом приходять усім (навіть якщо робили з пристрою, де відкрита панель);
-- власні дії з панелі — сірим рядком «Ви записали / скасували / перенесли…» (одразу прочитані, без Telegram).
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.
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

select position('ts := ' in pg_get_functiondef('trg_appt_notify'::regproc)) > 0 as notify_ok,
       position('read_at is not null' in pg_get_functiondef('trg_notif_tg'::regproc)) > 0 as telegram_ok;
