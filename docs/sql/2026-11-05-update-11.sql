-- Оновлення бази 05.11.2026 (11): майстриня, яка створила запис до іншої майстрині, може його перенести або скасувати (виправити помилку).
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.
create or replace function staff_move(p_appt uuid, p_staff uuid, p_start timestamptz, p_dur int default null, p_force boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a appointments; v_dur int; v_err text;
begin
  select * into a from appointments where id = p_appt;
  if a.id is null or not is_staff() then raise exception 'Немає доступу'; end if;
  -- власниця/адмін — будь-який запис; майстер — свій у межах свого стовпчика; хто створив запис до іншої майстрині — може його перенести (виправити помилку)
  if not (is_boss() or (a.staff_id = me() and p_staff = me()) or (a.status = 'booked' and a.created_by is not null and a.created_by = auth.uid())) then raise exception 'Майстер може змінювати лише свої записи'; end if;
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

create or replace function appt_status(p_appt uuid, p_status text, p_amount numeric default null, p_method text default null, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare a appointments; pct numeric;
begin
  select * into a from appointments where id = p_appt;
  if a.id is null or not is_staff() then raise exception 'Немає доступу'; end if;
  -- хто створив запис до іншої майстрині — може лише скасувати його (якщо помилився)
  if not (is_boss() or a.staff_id = me() or (p_status = 'cancel' and a.status = 'booked' and a.created_by is not null and a.created_by = auth.uid())) then raise exception 'Майстер може змінювати лише свої записи'; end if;
  if p_status not in ('booked','done','cancel','noshow') then raise exception 'Невідомий статус'; end if;
  if a.status = 'done' and not is_boss() then raise exception 'Змінити завершений візит може лише власниця або адмін'; end if;
  if p_status = 'done' then
    if p_amount is null or p_amount < 0 then raise exception 'Вкажіть суму'; end if;
    if coalesce(p_method, '') = '' then raise exception 'Оберіть спосіб оплати'; end if;
    select commission_pct into pct from staff_pay where staff_id = a.staff_id;
    pct := coalesce(pct, 0);
    insert into payments (appointment_id, staff_id, amount, method, commission_pct, commission, demo)
      values (a.id, a.staff_id, p_amount, p_method, pct, round(p_amount * pct / 100, 2), a.demo)
      on conflict (appointment_id) do update set amount = excluded.amount, method = excluded.method,
        staff_id = excluded.staff_id, commission_pct = excluded.commission_pct, commission = excluded.commission;
  else
    perform nana_priv.payment_remove(a.id);
  end if;
  update appointments set status = p_status, updated_at = now(),
    cancelled_by = case when p_status = 'cancel' then 'staff' end,
    cancel_reason = case when p_status = 'cancel' then nullif(trim(coalesce(p_reason, '')), '') end
  where id = a.id;
exception when exclusion_violation then
  raise exception 'На цей час у майстра вже є інший запис';
end $$;

select position('created_by = auth.uid()' in pg_get_functiondef('staff_move(uuid,uuid,timestamptz,int,boolean)'::regprocedure)) > 0 as move_ok,
       position('created_by = auth.uid()' in pg_get_functiondef('appt_status(uuid,text,numeric,text,text)'::regprocedure)) > 0 as cancel_ok;
