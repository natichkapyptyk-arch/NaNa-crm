-- Оновлення бази 06.11.2026 (15): клієнтка підтверджує візит у Telegram кнопкою «✅ Так, я буду».
-- Позначка visits.confirmed_at, сповіщення майстрині й власниці «Клієнт підтвердив візит», при перенесенні часу позначка знімається.
-- Можна запускати повторно.

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

-- перевірка
select exists (select 1 from information_schema.columns where table_name = 'visits' and column_name = 'confirmed_at') as col_ok,
       to_regprocedure('visit_confirm_tg(uuid,bigint)') is not null as fn_ok,
       exists (select 1 from pg_trigger where tgname = 'visit_unconfirm') as trg_ok;
