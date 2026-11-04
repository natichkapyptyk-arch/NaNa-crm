-- Оновлення бази 04.11.2026 (4): майстру — лише закріплені за ним послуги (новий запис, додати/змінити послугу, перенести на іншого майстра).
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.
create or replace function staff_book(p_client uuid, p_name text, p_phone text, p_contact text,
  p_staff uuid, p_service uuid, p_start timestamptz, p_dur int default null, p_price numeric default null,
  p_note text default null, p_force boolean default false, p_visit uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_client uuid := p_client; v_visit uuid := p_visit; v_dur int; v_price numeric; v_err text; v_id uuid; v_phone text;
begin
  if not is_staff() then raise exception 'Немає доступу'; end if;
  if not (is_boss() or p_staff = me()) then raise exception 'Майстер може записувати лише до себе'; end if;
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
  if not (is_boss() or (a.staff_id = me() and p_staff = me())) then raise exception 'Майстер може змінювати лише свої записи'; end if;
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

select (select count(*) from pg_proc where proname in ('staff_book','staff_move','appt_service') and prosrc like '%не виконує обрану послугу%') as functions_updated;
