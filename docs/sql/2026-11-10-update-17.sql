-- Оновлення бази 10.11.2026 (17): повторні візити через бота — журнал і статистика, тест у Налаштуваннях,
-- без знижки тим, хто часто скасовує (3+) або не приходить (2+): їм — «скучили за вами» без знижки. Можна запускати повторно.

-- повторні візити через бота, доповнення (10.11.2026, update-17): журнал надісланого (для статистики на дашборді),
-- тест у Налаштуваннях (обидва повідомлення собі в бот), без знижки тим, хто часто скасовує або не приходить
create table if not exists nudge_log (
  id bigserial primary key,
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null check (kind in ('renew', 'promo', 'back')),   -- «час оновити» / знижка / «скучили» (без знижки)
  sent_at timestamptz not null default now()
);
create index if not exists nudge_log_sent on nudge_log (sent_at);
alter table nudge_log enable row level security;
revoke all on nudge_log from anon, authenticated;

-- текст і кнопка одного повідомлення; надсилає бот
create or replace function nana_priv.nudge_send(p_chat bigint, p_kind text, p_name text, p_what text, p_days int, p_pct int, p_until date)
returns void language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; site text; txt text; btn text; url text;
begin
  select * into st from settings where id = 1;
  select hook_key into k from app_secrets where id = 1;
  site := regexp_replace(coalesce(nullif(st.site_url, ''), 'https://nana-studio.pages.dev/'), '[?#].*$', '');
  if p_kind = 'promo' then
    txt := '💛 ' || p_name || ', ми помітили, що ви давно не відвідували нашу студію 🥺' || chr(10)
        || 'Тому хочемо запропонувати вам знижку <b>' || p_pct || '%</b> на будь-яку послугу студії 🎁' || chr(10) || chr(10)
        || 'Знижка діє до ' || to_char(p_until, 'DD.MM') || '. Запишіться зручним часом — майстриня врахує її під час оплати.';
    btn := '📅 Записатися зі знижкою'; url := site || '?from=telegram&promo=' || p_pct;
  elsif p_kind = 'back' then
    txt := '💛 ' || p_name || ', ми скучили за вами в NaNa studio — давно не бачились 🥺' || chr(10) || chr(10)
        || 'Запишіться зручним часом, будемо раді вам 👇';
    btn := '📅 Записатися'; url := site || '?from=telegram';
  else
    txt := '💛 ' || p_name || ', від вашої останньої процедури в NaNa studio минуло вже ' || p_days || ' днів.' || chr(10)
        || 'Саме зараз найкращий час, щоб оновити ' || p_what || ' ✨' || chr(10) || chr(10)
        || 'Записуйтесь, поки є зручні віконця 👇';
    btn := '📅 Записатися'; url := site || '?from=telegram';
  end if;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'send', 'chat_id', p_chat, 'text', txt,
      'buttons', jsonb_build_array(jsonb_build_array(jsonb_build_object('text', btn, 'url', url)))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
end $$;
revoke execute on function nana_priv.nudge_send(bigint, text, text, text, int, int, date) from public, anon, authenticated;

create or replace function nana_priv.nudge_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; tz constant text := 'Europe/Kyiv';
  d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  x record; n int := 0; days int; what text; nm text; until date;
begin
  select * into st from settings where id = 1;
  if st.nudge1_days is null and st.nudge2_days is null then return 0; end if;
  if not p_force and (hh < 11 or hh >= 20 or st.nudge_sent is not distinct from d) then return 0; end if;
  update settings set nudge_sent = d where id = 1;
  for x in
    select c.id, c.name, c.tg_chat_id, c.nudge1_for, c.nudge2_for, l.last_at, l.cancels, l.noshows
      from clients c
      join lateral (select max(a.starts_at) filter (where a.status = 'done') as last_at,
                           count(*) filter (where a.status = 'cancel') as cancels, count(*) filter (where a.status = 'noshow') as noshows
                      from appointments a where a.client_id = c.id) l on true
     where c.tg_chat_id is not null and not c.demo and l.last_at is not null
       and not exists (select 1 from appointments b where b.client_id = c.id and b.status = 'booked' and b.starts_at > now())
  loop
    days := d - (x.last_at at time zone tz)::date;
    nm := nana_priv.h(split_part(trim(x.name), ' ', 1));
    if st.nudge2_days is not null and days >= st.nudge2_days and days <= st.nudge2_days + 30 and x.nudge2_for is distinct from x.last_at then
      if x.noshows >= 2 or x.cancels >= 3 then   -- часто не приходить / скасовує — без знижки
        update clients set nudge2_for = x.last_at, nudge1_for = x.last_at where id = x.id;
        perform nana_priv.nudge_send(x.tg_chat_id, 'back', nm, null, days, null, null);
        insert into nudge_log (client_id, kind) values (x.id, 'back');
      else
        until := d + 30;
        update clients set promo_pct = st.nudge_pct, promo_until = until, nudge2_for = x.last_at, nudge1_for = x.last_at where id = x.id;
        perform nana_priv.nudge_send(x.tg_chat_id, 'promo', nm, null, days, st.nudge_pct, until);
        insert into nudge_log (client_id, kind) values (x.id, 'promo');
      end if;
      n := n + 1;
    elsif st.nudge1_days is not null and days >= st.nudge1_days and days < coalesce(st.nudge2_days, 100000) and days <= st.nudge1_days + 14
          and x.nudge1_for is distinct from x.last_at then
      update clients set nudge1_for = x.last_at where id = x.id;
      select string_agg(w, ' та ' order by array_position(array['манікюр', 'педикюр', 'брівки', 'нарощення вій'], w)) into what from (
        select distinct case s.category when 'Манікюр' then 'манікюр' when 'Педикюр' then 'педикюр' when 'Брови та ламі вій' then 'брівки'
                                        when 'Нарощення вій' then 'нарощення вій' end as w
          from appointments a join services s on s.id = a.service_id
         where a.client_id = x.id and a.status = 'done' and (a.starts_at at time zone tz)::date = (x.last_at at time zone tz)::date) q
       where w is not null;
      if what is null then continue; end if;
      perform nana_priv.nudge_send(x.tg_chat_id, 'renew', nm, what, days, null, null);
      insert into nudge_log (client_id, kind) values (x.id, 'renew');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function nana_priv.nudge_tick(boolean) from public, anon, authenticated;

-- «Тест» у Налаштуваннях: усі три повідомлення — у бот того, хто натиснув (власниця/адмін)
create or replace function nudge_test() returns int language plpgsql security definer set search_path = public as $$
declare st settings; me staff; nm text;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  select * into st from settings where id = 1;
  nm := nana_priv.h(me.first_name);
  perform nana_priv.nudge_send(me.tg_chat_id, 'renew', nm, 'манікюр та брівки', coalesce(st.nudge1_days, 28), null, null);
  perform nana_priv.nudge_send(me.tg_chat_id, 'promo', nm, null, coalesce(st.nudge2_days, 60), coalesce(st.nudge_pct, 10), (now() at time zone 'Europe/Kyiv')::date + 30);
  perform nana_priv.nudge_send(me.tg_chat_id, 'back', nm, null, coalesce(st.nudge2_days, 60), null, null);
  return 3;
end $$;
revoke execute on function nudge_test() from public, anon;
grant execute on function nudge_test() to authenticated;

-- статистика для дашборду: скільки надіслано за період і скільки після цього записались (протягом 30 днів)
create or replace function nudge_stats(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (
    select n.*, c.name, c.phone,
      (select min(a.created_at) from appointments a where a.client_id = n.client_id and a.created_at > n.sent_at
          and a.created_at < n.sent_at + interval '30 days' and a.status <> 'cancel') as booked_at
      from nudge_log n join clients c on c.id = n.client_id
     where coalesce(is_boss(), false)
       and (n.sent_at at time zone 'Europe/Kyiv')::date between p_from and p_to)
  select jsonb_build_object(
    'sent', count(*), 'booked', count(booked_at),
    'renew', count(*) filter (where kind = 'renew'), 'promo', count(*) filter (where kind = 'promo'), 'back', count(*) filter (where kind = 'back'),
    'list', coalesce(jsonb_agg(jsonb_build_object('client_id', client_id, 'name', name, 'phone', phone, 'kind', kind, 'sent_at', sent_at, 'booked_at', booked_at)
                     order by sent_at desc), '[]'))
  from l
$$;
revoke execute on function nudge_stats(date, date) from public, anon;
grant execute on function nudge_stats(date, date) to authenticated;

-- перевірка
select to_regclass('nudge_log') is not null as log_ok, to_regprocedure('nudge_test()') is not null as test_ok,
       to_regprocedure('nudge_stats(date,date)') is not null as stats_ok;
