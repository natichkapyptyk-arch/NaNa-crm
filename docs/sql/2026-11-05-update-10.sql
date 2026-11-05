-- Оновлення бази 05.11.2026 (10): кожен майстер може записувати клієнтів до будь-якого майстра (не лише до себе).
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.
create or replace function staff_book(p_client uuid, p_name text, p_phone text, p_contact text,
  p_staff uuid, p_service uuid, p_start timestamptz, p_dur int default null, p_price numeric default null,
  p_note text default null, p_force boolean default false, p_visit uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_client uuid := p_client; v_visit uuid := p_visit; v_dur int; v_price numeric; v_err text; v_id uuid; v_phone text;
begin
  if not is_staff() then raise exception 'Немає доступу'; end if;
  -- будь-хто з персоналу може записати клієнта до будь-якого майстра (Поліна — до Лізи тощо)
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

select position('лише до себе' in pg_get_functiondef('staff_book(uuid,text,text,text,uuid,uuid,timestamptz,int,numeric,text,boolean,uuid)'::regprocedure)) = 0 as any_master_ok;
