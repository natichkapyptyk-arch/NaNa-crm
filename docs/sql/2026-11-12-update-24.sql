-- 2026-11-12 update-24: сповіщення для демо-записів (з позначкою 🧪) і «Мої власні дії теж у Telegram» (notify.self).
-- Наталії «Мої власні дії» вмикаємо одразу (попросила). Можна запускати повторно.
create or replace function trg_appt_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; t text; ts text; b text; v_src text; v_old uuid; v_client boolean := false; v_actor text;
begin
  -- демо-записи теж сповіщають (поки сайт у тесті), з позначкою «🧪»
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
drop trigger if exists appt_notify on appointments;
create trigger appt_notify after insert or update on appointments for each row execute function trg_appt_notify();

create or replace function trg_notif_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  -- «Ви записали…» (власна дія) — у Telegram лише тим, хто увімкнув «Мої власні дії» (notify.self)
  if new.read_at is not null and not exists (select 1 from staff where id = new.staff_id and coalesce((notify->>'self')::boolean, false)) then return new; end if;
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

update staff set notify = coalesce(notify, '{}'::jsonb) || '{"self": true}'::jsonb where role = 'owner' and first_name = 'Наталія' and not demo;

notify pgrst, 'reload schema';
