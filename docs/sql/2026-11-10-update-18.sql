-- Оновлення бази 10.11.2026 (18): щомісячний звіт у Telegram — 1 числа о 10:00 власниці й адміну
-- Excel з клієнтками за минулий місяць (від найранішої дати) і цифри (виторг, візити, нові клієнти). Можна запускати повторно.

-- щомісячний звіт у Telegram (10.11.2026, update-18): 1 числа о 10:00 власниці й адміну — Excel з клієнтками за минулий місяць + цифри
alter table settings add column if not exists report_on boolean not null default true;
alter table settings add column if not exists report_sent date;

create or replace function nana_priv.report_post(p_from date, p_to date, p_chats bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(array_length(p_chats, 1), 0) = 0 then return; end if;
  select hook_key into k from app_secrets where id = 1;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'monthly_report', 'from', p_from, 'to', p_to, 'chats', to_jsonb(p_chats)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text),
    timeout_milliseconds := 60000);
end $$;
revoke execute on function nana_priv.report_post(date, date, bigint[]) from public, anon, authenticated;

create or replace function nana_priv.report_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  pm date := (date_trunc('month', (now() at time zone 'Europe/Kyiv')::date) - interval '1 month')::date; ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.report_on or extract(day from d) <> 1 or hh < 10 or st.report_sent is not distinct from d then return 0; end if;
  update settings set report_sent = d where id = 1;
  select array_agg(tg_chat_id) into ch from staff
   where is_active and role in ('owner', 'admin') and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'report')::boolean, true);
  perform nana_priv.report_post(pm, (pm + interval '1 month' - interval '1 day')::date, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.report_tick() from public, anon, authenticated;

-- «Надіслати звіт зараз» у Налаштуваннях: за цей місяць (з 1 числа по сьогодні) — у бот того, хто натиснув
create or replace function report_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff; d date := (now() at time zone 'Europe/Kyiv')::date;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  perform nana_priv.report_post(date_trunc('month', d)::date, d, array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function report_send_now() from public, anon;
grant execute on function report_send_now() to authenticated;

select cron.schedule('nana-report', '*/15 * * * *', 'select nana_priv.report_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-report');

-- перевірка
select (select report_on from settings where id = 1) as report_on,
       exists (select 1 from cron.job where jobname = 'nana-report') as cron_ok,
       to_regprocedure('report_send_now()') is not null as fn_ok;
