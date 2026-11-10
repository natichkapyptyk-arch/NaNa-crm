-- Оновлення бази 10.11.2026 (16): повторні візити через Telegram-бота.
-- Через 28 днів після останнього візиту — «час оновити манікюр / брівки / вії», через 60 — знижка 10%; під обома кнопка «Записатися».
-- Надсилається щодня об 11:00 лише клієнткам з підключеним ботом і без майбутнього запису. Можна запускати повторно.

-- повторні візити через бота (10.11.2026, update-16): клієнткам з підключеним ботом
-- через settings.nudge1_days (28) днів після останнього візиту — «час оновити манікюр / брівки / вії» з кнопкою «Записатися»,
-- через settings.nudge2_days (60) — «давно не були, знижка nudge_pct (10%)» з кнопкою; знижка зберігається в clients.promo_* на 30 днів
alter table clients add column if not exists promo_pct int check (promo_pct between 1 and 90);   -- активна знижка, %
alter table clients add column if not exists promo_until date;                                    -- до якого дня діє
alter table clients add column if not exists nudge1_for timestamptz;   -- для якого останнього візиту вже надіслали «час оновити»
alter table clients add column if not exists nudge2_for timestamptz;   -- … і «знижку»
alter table settings add column if not exists nudge1_days int default 28 check (nudge1_days between 7 and 180);   -- null — не надсилати
alter table settings add column if not exists nudge2_days int default 60 check (nudge2_days between 14 and 365);
alter table settings add column if not exists nudge_pct int default 10 check (nudge_pct between 1 and 50);
alter table settings add column if not exists nudge_sent date;

create or replace function nana_priv.nudge_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; tz constant text := 'Europe/Kyiv';
  d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  x record; n int := 0; days int; what text; txt text; site text; nm text; until date;
begin
  select * into st from settings where id = 1;
  if st.nudge1_days is null and st.nudge2_days is null then return 0; end if;
  if not p_force and (hh < 11 or hh >= 20 or st.nudge_sent is not distinct from d) then return 0; end if;
  update settings set nudge_sent = d where id = 1;
  select hook_key into k from app_secrets where id = 1;
  site := regexp_replace(coalesce(nullif(st.site_url, ''), 'https://nana-studio.pages.dev/'), '[?#].*$', '');
  for x in
    select c.id, c.name, c.tg_chat_id, c.nudge1_for, c.nudge2_for, l.last_at
      from clients c
      join lateral (select max(a.starts_at) as last_at from appointments a where a.client_id = c.id and a.status = 'done') l on true
     where c.tg_chat_id is not null and not c.demo and l.last_at is not null
       and not exists (select 1 from appointments b where b.client_id = c.id and b.status = 'booked' and b.starts_at > now())
  loop
    days := d - (x.last_at at time zone tz)::date;
    nm := nana_priv.h(split_part(trim(x.name), ' ', 1));
    if st.nudge2_days is not null and days >= st.nudge2_days and days <= st.nudge2_days + 30 and x.nudge2_for is distinct from x.last_at then
      until := d + 30;
      update clients set promo_pct = st.nudge_pct, promo_until = until, nudge2_for = x.last_at, nudge1_for = x.last_at where id = x.id;
      txt := '💛 ' || nm || ', ми помітили, що ви давно не відвідували нашу студію 🥺' || chr(10)
          || 'Тому хочемо запропонувати вам знижку <b>' || st.nudge_pct || '%</b> на будь-яку послугу студії 🎁' || chr(10) || chr(10)
          || 'Знижка діє до ' || to_char(until, 'DD.MM') || '. Запишіться зручним часом — майстриня врахує її під час оплати.';
      perform net.http_post(
        url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
        body := jsonb_build_object('action', 'send', 'chat_id', x.tg_chat_id, 'text', txt,
          'buttons', jsonb_build_array(jsonb_build_array(jsonb_build_object('text', '📅 Записатися зі знижкою', 'url', site || '?from=telegram&promo=' || st.nudge_pct)))),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
      n := n + 1;
    elsif st.nudge1_days is not null and days >= st.nudge1_days and days < coalesce(st.nudge2_days, 100000) and days <= st.nudge1_days + 14
          and x.nudge1_for is distinct from x.last_at then
      update clients set nudge1_for = x.last_at where id = x.id;
      -- що оновлювати — за категоріями послуг останнього візиту (макіяж і укладку не нагадуємо)
      select string_agg(w, ' та ' order by array_position(array['манікюр', 'педикюр', 'брівки', 'нарощення вій'], w)) into what from (
        select distinct case s.category when 'Манікюр' then 'манікюр' when 'Педикюр' then 'педикюр' when 'Брови та ламі вій' then 'брівки'
                                        when 'Нарощення вій' then 'нарощення вій' end as w
          from appointments a join services s on s.id = a.service_id
         where a.client_id = x.id and a.status = 'done' and (a.starts_at at time zone tz)::date = (x.last_at at time zone tz)::date) q
       where w is not null;
      if what is null then continue; end if;
      txt := '💛 ' || nm || ', від вашої останньої процедури в NaNa studio минуло вже ' || days || ' днів.' || chr(10)
          || 'Саме зараз найкращий час, щоб оновити ' || what || ' ✨' || chr(10) || chr(10)
          || 'Записуйтесь, поки є зручні віконця 👇';
      perform net.http_post(
        url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
        body := jsonb_build_object('action', 'send', 'chat_id', x.tg_chat_id, 'text', txt,
          'buttons', jsonb_build_array(jsonb_build_array(jsonb_build_object('text', '📅 Записатися', 'url', site || '?from=telegram')))),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function nana_priv.nudge_tick(boolean) from public, anon, authenticated;

select cron.schedule('nana-nudge', '*/15 * * * *', 'select nana_priv.nudge_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-nudge');

-- перевірка
select (select nudge1_days from settings where id = 1) as d1, (select nudge2_days from settings where id = 1) as d2,
       (select nudge_pct from settings where id = 1) as pct,
       exists (select 1 from cron.job where jobname = 'nana-nudge') as cron_ok;
