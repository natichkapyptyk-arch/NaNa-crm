-- Оновлення бази 05.11.2026 (12) — містить і оновлення 11 (його окремо запускати не треба).
-- 1) Історія змін запису (appt_log): хто й коли створив, переніс, скасував, змінив послугу/ціну.
-- 2) Сповіщення з іменем того, хто змінив: «Запис перенесено — Поліна».
-- 3) (з оновлення 11) Майстриня, яка створила запис до іншої, може його перенести або скасувати.
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


create or replace function trg_appt_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; t text; ts text; b text; v_src text; v_old uuid; v_client boolean := false; v_actor text;
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

-- ===== Історія змін запису: хто й коли створив, переніс, скасував, змінив послугу чи ціну =====
create table if not exists appt_log (
  id bigserial primary key,
  appointment_id uuid not null references appointments(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  who text,                 -- імʼя працівника або «клієнт(ка) онлайн»
  what text not null
);
create index if not exists appt_log_appt on appt_log (appointment_id, at);
alter table appt_log enable row level security;
revoke all on appt_log from anon, authenticated;
grant select on appt_log to authenticated;
drop policy if exists p_appt_log_read on appt_log;
create policy p_appt_log_read on appt_log for select to authenticated using ((select is_staff()));

create or replace function trg_appt_log() returns trigger language plpgsql security definer set search_path = public as $$
declare w text; l text[] := '{}'; tz constant text := 'Europe/Kyiv';
  om text; nm text; os text; ns text;
begin
  if new.demo then return new; end if;
  if auth.uid() is null then w := 'клієнт(ка) онлайн';
  else select first_name into w from staff where user_id = auth.uid() limit 1; end if;
  select first_name into nm from staff where id = new.staff_id;
  if tg_op = 'INSERT' then
    l := array['Створено: ' || to_char(new.starts_at at time zone tz, 'DD.MM HH24:MI') || ', ' || coalesce(nm, '')];
  else
    if new.starts_at <> old.starts_at or new.staff_id <> old.staff_id then
      select first_name into om from staff where id = old.staff_id;
      l := l || ('Перенесено: ' || to_char(old.starts_at at time zone tz, 'DD.MM HH24:MI') || case when new.staff_id <> old.staff_id then ', ' || coalesce(om, '') else '' end
        || ' → ' || to_char(new.starts_at at time zone tz, 'DD.MM HH24:MI') || case when new.staff_id <> old.staff_id then ', ' || coalesce(nm, '') else '' end);
    elsif (new.ends_at - new.starts_at) <> (old.ends_at - old.starts_at) then
      l := l || ('Тривалість: ' || (extract(epoch from old.ends_at - old.starts_at) / 60)::int || ' → ' || (extract(epoch from new.ends_at - new.starts_at) / 60)::int || ' хв');
    end if;
    if new.service_id <> old.service_id then
      select name into os from services where id = old.service_id; select name into ns from services where id = new.service_id;
      l := l || ('Послуга: ' || coalesce(os, '') || ' → ' || coalesce(ns, ''));
    end if;
    if new.price <> old.price then l := l || ('Ціна: ' || trim_scale(old.price)::text || ' → ' || trim_scale(new.price)::text || ' ₴'); end if;
    if new.status <> old.status then
      l := l || (case new.status when 'done' then 'Завершено й оплачено' when 'noshow' then 'Позначено «не прийшов(ла)»'
        when 'cancel' then 'Скасовано' || coalesce(': ' || nullif(new.cancel_reason, ''), '') when 'booked' then 'Відновлено (знову «Записано»)' else new.status end);
    end if;
  end if;
  if coalesce(array_length(l, 1), 0) > 0 then insert into appt_log (appointment_id, who, what) select new.id, w, x from unnest(l) x; end if;
  return new;
end $$;
drop trigger if exists appt_log on appointments;
create trigger appt_log after insert or update on appointments for each row execute function trg_appt_log();

select position('created_by = auth.uid()' in pg_get_functiondef('staff_move(uuid,uuid,timestamptz,int,boolean)'::regprocedure)) > 0 as move_ok,
       position('v_actor' in pg_get_functiondef('trg_appt_notify'::regproc)) > 0 as names_ok,
       exists (select 1 from pg_trigger where tgname = 'appt_log') as history_ok;
