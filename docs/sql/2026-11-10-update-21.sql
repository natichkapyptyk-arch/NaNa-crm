-- 2026-11-10 update-21: захист карток власниць, «адмін без грошей», журнал змін
-- Можна запускати повторно.

-- гроші (виторг, прибуток, заробіток, витрати) бачать власниця й адмін, якому власниця не вимкнула «бачить гроші»
alter table staff add column if not exists see_money boolean not null default true;
create or replace function sees_money() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid() and is_active and (role = 'owner' or (role = 'admin' and see_money))) $$;

revoke execute on function sees_money() from public, anon;
grant execute on function sees_money() to authenticated;

-- майстер не може сам собі змінити роль, доступ, логін;
-- картку власниці (роль, доступ, вхід), призначення власниці й «бачить гроші» змінює лише власниця
create or replace function trg_staff_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return new; end if;
  r := coalesce(my_role(), '');
  if tg_op = 'INSERT' then
    if new.role = 'owner' and r <> 'owner' then raise exception 'Призначити власницю може лише власниця'; end if;
    if r <> 'owner' then new.see_money := true; end if;
    return new;
  end if;
  if r <> 'owner' then
    if old.role = 'owner' and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
       or new.user_id is distinct from old.user_id or new.login is distinct from old.login) then
      raise exception 'Роль, доступ і вхід власниці змінює лише власниця';
    end if;
    if new.role = 'owner' and old.role is distinct from 'owner' then raise exception 'Призначити власницю може лише власниця'; end if;
    if new.see_money is distinct from old.see_money then raise exception 'Доступ до грошей змінює лише власниця'; end if;
  end if;
  if is_boss() then return new; end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.is_bookable is distinct from old.is_bookable
     or new.user_id is distinct from old.user_id or new.login is distinct from old.login or new.sort is distinct from old.sort
     or new.tg_chat_id is distinct from old.tg_chat_id or new.demo is distinct from old.demo then
    raise exception 'Це може змінити лише власниця або адмін';
  end if;
  return new;
end $$;
drop trigger if exists staff_guard on staff;
create trigger staff_guard before insert or update on staff for each row execute function trg_staff_guard();

create or replace function clients_stats() returns table (
  id uuid, name text, phone text, contact text, instagram text, birthday date, note text, tg boolean, demo boolean,
  created_at timestamptz, visits int, last_visit timestamptz, next_visit timestamptz, spent numeric, cancels int, noshows int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.phone, c.contact, c.instagram, c.birthday, c.note, c.tg_chat_id is not null, c.demo, c.created_at,
    count(a.id) filter (where a.status = 'done')::int,
    max(a.starts_at) filter (where a.status = 'done'),
    min(a.starts_at) filter (where a.status = 'booked' and a.starts_at > now()),
    case when sees_money() then coalesce((select sum(p.amount) from payments p join appointments x on x.id = p.appointment_id where x.client_id = c.id), 0) end,
    count(a.id) filter (where a.status = 'cancel')::int,
    count(a.id) filter (where a.status = 'noshow')::int
  from clients c left join appointments a on a.client_id = c.id
  where is_staff()
  group by c.id
$$;

create or replace function nana_priv.report_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  pm date := (date_trunc('month', (now() at time zone 'Europe/Kyiv')::date) - interval '1 month')::date; ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.report_on or extract(day from d) <> 1 or hh < 10 or st.report_sent is not distinct from d then return 0; end if;
  update settings set report_sent = d where id = 1;
  select array_agg(tg_chat_id) into ch from staff
   where is_active and (role = 'owner' or (role = 'admin' and see_money)) and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'report')::boolean, true);
  perform nana_priv.report_post(pm, (pm + interval '1 month' - interval '1 day')::date, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.report_tick() from public, anon, authenticated;

create or replace function report_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff; d date := (now() at time zone 'Europe/Kyiv')::date;
begin
  if not coalesce(sees_money(), false) then raise exception 'Звіт бачать лише власниця або адмін з доступом до грошей'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  perform nana_priv.report_post(date_trunc('month', d)::date, d, array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function report_send_now() from public, anon;
grant execute on function report_send_now() to authenticated;

create or replace function nana_priv.weekly_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv'); ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.weekly_on or extract(isodow from d) <> 1 or hh < 10 or st.weekly_sent is not distinct from d then return 0; end if;
  update settings set weekly_sent = d where id = 1;
  select array_agg(tg_chat_id) into ch from staff
   where is_active and (role = 'owner' or (role = 'admin' and see_money)) and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'weekly')::boolean, true);
  perform nana_priv.weekly_post(d - 7, d - 1, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.weekly_tick() from public, anon, authenticated;

create or replace function weekly_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff; d date := (now() at time zone 'Europe/Kyiv')::date; mon date;
begin
  if not coalesce(sees_money(), false) then raise exception 'Підсумок бачать лише власниця або адмін з доступом до грошей'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  mon := d - (extract(isodow from d)::int - 1);   -- понеділок цього тижня
  perform nana_priv.weekly_post(mon - 7, mon - 1, array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function weekly_send_now() from public, anon;
grant execute on function weekly_send_now() to authenticated;

-- RLS: оплати, відсотки майстрів, витрати — лише тим, хто бачить гроші (майстер — свої)
drop policy if exists p_pay_read on staff_pay;
create policy p_pay_read on staff_pay for select to authenticated using ((select sees_money()) or staff_id = (select me()));
drop policy if exists p_pay_ins on staff_pay;
create policy p_pay_ins on staff_pay for insert to authenticated with check ((select sees_money()));
drop policy if exists p_pay_upd on staff_pay;
create policy p_pay_upd on staff_pay for update to authenticated using ((select sees_money())) with check ((select sees_money()));
drop policy if exists p_payments_read on payments;
create policy p_payments_read on payments for select to authenticated using ((select sees_money()) or staff_id = (select me()));
drop policy if exists p_expenses_boss on expenses;
create policy p_expenses_boss on expenses for all to authenticated using ((select sees_money())) with check ((select sees_money()));

-- ===== Журнал змін (бачить лише власниця): хто й коли змінював послуги, ціни, персонал, ролі, налаштування, оплати, витрати, видаляв клієнтів =====
-- записи (скасування, ціна, знижка…) беруться з appt_log; сюди пишуть тригери нижче. Дії бота / cron (без входу) не пишуться.
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  who text,
  area text not null,      -- Послуги / Персонал / Налаштування / Оплати / Витрати / Клієнти
  label text,              -- що саме: «Корекція брів», «Поліна Краснопольська»…
  what text not null       -- зміни: «ціна: 400 → 450; тривалість, хв: 30 → 45»
);
create index if not exists audit_log_at on audit_log (at desc);
alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;
drop policy if exists p_audit_read on audit_log;
create policy p_audit_read on audit_log for select to authenticated using ((select my_role()) = 'owner');

-- значення для журналу: так/ні, «—», обрізаний текст
create or replace function nana_priv.av(v jsonb) returns text language sql immutable as $$
  select case
    when v is null or v = 'null'::jsonb then '—'
    when jsonb_typeof(v) = 'boolean' then case when v::text = 'true' then 'так' else 'ні' end
    when jsonb_typeof(v) = 'number' then trim_scale((v #>> '{}')::numeric)::text
    when v #>> '{}' in ('owner', 'admin', 'master') then case v #>> '{}' when 'owner' then 'власниця' when 'admin' then 'адмін' else 'майстер' end
    when jsonb_typeof(v) = 'string' then case when length(v #>> '{}') > 60 then left(v #>> '{}', 57) || '…' else coalesce(nullif(v #>> '{}', ''), '—') end
    when jsonb_typeof(v) = 'array' then left((select string_agg(x, ', ') from jsonb_array_elements_text(v) x), 80)
    else left(v::text, 60) end
$$;

create or replace function trg_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; r jsonb; w text; l text; area text; d text[] := '{}'; k text;
  skip text[] := array['id', 'created_at', 'updated_at', 'sort', 'tg_link', 'photos', 'photo_url', 'demo',
    'daily_sent', 'close_sent', 'open_sent', 'nudge_sent', 'report_sent', 'weekly_sent', 'commission', 'commission_pct', 'paid_at', 'appointment_id', 'staff_id', 'service_id'];
  nm jsonb := '{"name":"назва","price":"ціна","dur":"тривалість, хв","is_active":"увімкнено","category":"категорія","description":"опис",
    "price_from":"ціна «від»","subgroup":"підгрупа","is_addon":"додаткова","role":"роль","first_name":"імʼя","last_name":"прізвище",
    "middle_name":"по батькові","phone":"телефон","email":"пошта","telegram":"Telegram","login":"логін","is_bookable":"онлайн-запис",
    "notify":"сповіщення","tg_chat_id":"Telegram-бот","user_id":"вхід","see_money":"бачить гроші","bio":"про себе","experience":"посада",
    "birth_date":"день народження","start_date":"працює з","amount":"сума","method":"спосіб оплати","day":"дата","note":"коментар",
    "open_time":"відкриття","close_time":"закриття","pay_methods":"способи оплати","salon_name":"назва салону","address":"адреса",
    "remind_hours":"нагадування, год","instagram":"Instagram","about":"про салон","last_start":"останній запис о","step_min":"крок запису, хв",
    "buffer_min":"перерва між записами, хв","lead_min":"запис не раніше ніж за, хв","max_days":"запис наперед, днів","cancel_hours":"скасування не пізніше ніж за, год","pay_link":"посилання на оплату","daily_hour":"розклад о","close_hour":"вечірня перевірка о","open_day":"нагадати відкрити графік з",
    "report_on":"щомісячний звіт","weekly_on":"підсумок тижня","nudge1_days":"нагадати через, днів","nudge2_days":"«давно не були» через, днів",
    "nudge_pct":"знижка «давно не були», %","stale_days":"застарілі після, днів","site_url":"адреса сайту","tg_bot":"Telegram-бот салону"}';
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r := coalesce(n, o);
  if coalesce((r->>'demo')::boolean, false) then return coalesce(new, old); end if;
  select first_name into w from staff where user_id = auth.uid() limit 1;
  if tg_table_name = 'services' then area := 'Послуги'; l := r->>'name';
  elsif tg_table_name = 'master_services' then area := 'Послуги';
    select s.name || ' — ' || m.first_name into l from services s, staff m where s.id = (r->>'service_id')::uuid and m.id = (r->>'staff_id')::uuid;
  elsif tg_table_name = 'staff' then area := 'Персонал'; l := trim(coalesce(r->>'first_name', '') || ' ' || coalesce(r->>'last_name', ''));
  elsif tg_table_name = 'staff_pay' then area := 'Персонал';
    select trim(first_name || ' ' || last_name) into l from staff where id = (r->>'staff_id')::uuid;
    if tg_op = 'UPDATE' and (o->'commission_pct') is distinct from (n->'commission_pct') then
      d := array['відсоток майстра: ' || nana_priv.av(o->'commission_pct') || ' → ' || nana_priv.av(n->'commission_pct') || '%']; end if;
    if tg_op = 'INSERT' then d := array['відсоток майстра: ' || nana_priv.av(n->'commission_pct') || '%']; end if;
  elsif tg_table_name = 'settings' then area := 'Налаштування'; l := 'Налаштування салону';
  elsif tg_table_name = 'expenses' then area := 'Витрати'; l := coalesce(r->>'category', 'Витрата') || ' · ' || to_char((r->>'day')::date, 'DD.MM.YYYY');
  elsif tg_table_name = 'clients' then area := 'Клієнти'; l := coalesce(r->>'name', '') || ' · ' || coalesce(r->>'phone', '');
  elsif tg_table_name = 'payments' then area := 'Оплати';
    select c.name || ' · ' || s.name || ' · ' || to_char(a.starts_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI') into l
      from appointments a join clients c on c.id = a.client_id join services s on s.id = a.service_id where a.id = (r->>'appointment_id')::uuid;
  else area := tg_table_name; end if;

  if tg_table_name <> 'staff_pay' then
    if tg_op = 'INSERT' then
      d := array['додано' || case when tg_table_name = 'expenses' then ': ' || nana_priv.av(n->'amount') || ' ₴'
                                  when tg_table_name = 'services' then ': ' || nana_priv.av(n->'price') || ' ₴, ' || nana_priv.av(n->'dur') || ' хв'
                                  when tg_table_name = 'staff' then ', роль: ' || nana_priv.av(n->'role') else '' end];
    elsif tg_op = 'DELETE' then
      d := array['видалено' || case when tg_table_name in ('expenses', 'payments') then ': ' || nana_priv.av(o->'amount') || ' ₴' else '' end];
    else
      for k in select jsonb_object_keys(n) loop
        continue when k = any(skip);
        continue when tg_table_name = 'payments' and k not in ('amount', 'method');
        if (o->k) is distinct from (n->k) then
          d := d || (coalesce(nm->>k, k) || case when k in ('notify', 'bio', 'description', 'about', 'user_id', 'tg_chat_id') then ' змінено'
                     else ': ' || nana_priv.av(o->k) || ' → ' || nana_priv.av(n->k) end);
        end if;
      end loop;
    end if;
  end if;
  if coalesce(cardinality(d), 0) = 0 then return coalesce(new, old); end if;
  insert into audit_log (who, area, label, what) values (w, area, l, left(array_to_string(d, '; '), 1000));
  return coalesce(new, old);
end $$;
revoke execute on function trg_audit() from public, anon, authenticated;

drop trigger if exists audit on services;
create trigger audit after insert or update or delete on services for each row execute function trg_audit();
drop trigger if exists audit on master_services;
create trigger audit after insert or update or delete on master_services for each row execute function trg_audit();
drop trigger if exists audit on staff;
create trigger audit after insert or update on staff for each row execute function trg_audit();
drop trigger if exists audit on staff_pay;
create trigger audit after insert or update on staff_pay for each row execute function trg_audit();
drop trigger if exists audit on settings;
create trigger audit after update on settings for each row execute function trg_audit();
drop trigger if exists audit on expenses;
create trigger audit after insert or update or delete on expenses for each row execute function trg_audit();
drop trigger if exists audit on clients;
create trigger audit after delete on clients for each row execute function trg_audit();
drop trigger if exists audit on payments;
create trigger audit after update or delete on payments for each row execute function trg_audit();

-- стрічка журналу за період: зміни з audit_log + важливі дії із записами (скасування, відновлення, ціна, послуга, знижка, неявка)
create or replace function audit_feed(p_from date, p_to date) returns table (at timestamptz, who text, area text, label text, what text)
language sql stable security definer set search_path = public as $$
  select * from (
    select l.at, l.who, l.area, l.label, l.what from audit_log l
     where l.at >= (p_from::timestamp at time zone 'Europe/Kyiv') and l.at < ((p_to + 1)::timestamp at time zone 'Europe/Kyiv')
    union all
    select l.at, l.who, 'Записи', c.name || ' · ' || s.name || ' · ' || to_char(a.starts_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI'), l.what
      from appt_log l join appointments a on a.id = l.appointment_id join clients c on c.id = a.client_id join services s on s.id = a.service_id
     where l.actor is not null and not a.demo
       and (l.what like 'Скасовано%' or l.what like 'Відновлено%' or l.what like 'Ціна:%' or l.what like 'Послуга:%'
            or l.what like 'знижка%' or l.what like 'прибрав(ла) знижку%' or l.what like 'Позначено%')
       and l.at >= (p_from::timestamp at time zone 'Europe/Kyiv') and l.at < ((p_to + 1)::timestamp at time zone 'Europe/Kyiv')
  ) x
  where coalesce(my_role(), '') = 'owner'
  order by x.at desc limit 2000
$$;

revoke execute on function audit_feed(date, date) from public, anon;
grant execute on function audit_feed(date, date) to authenticated;

notify pgrst, 'reload schema';
