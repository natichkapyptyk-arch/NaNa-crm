-- Оновлення бази 04.11.2026 (3): змінити послугу в записі.
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.
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
  if v_dur < 5 or v_price < 0 then raise exception 'Перевірте тривалість і ціну'; end if;
  perform pg_advisory_xact_lock(hashtext(a.staff_id::text));
  v_err := slot_check(a.staff_id, a.starts_at, a.starts_at + make_interval(mins => v_dur), a.id, false, a.visit_id);
  if v_err is not null and not p_force then raise exception 'CHECK:%', v_err; end if;
  update appointments set service_id = p_service, price = v_price, ends_at = a.starts_at + make_interval(mins => v_dur), updated_at = now()
   where id = a.id;
exception when exclusion_violation then
  raise exception 'У майстра вже є запис на цей час';
end $$;
revoke execute on function appt_service(uuid,uuid,int,numeric,boolean) from public, anon;
grant execute on function appt_service(uuid,uuid,int,numeric,boolean) to authenticated;
