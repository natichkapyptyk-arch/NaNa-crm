-- Оновлення бази 10.11.2026 (19): тижневий підсумок у Telegram — щопонеділка о 10:00 власниці й адміну
-- виторг, візити, нові клієнти, скасування й найкраща майстриня за минулий тиждень з порівнянням. Можна запускати повторно.

-- тижневий підсумок у Telegram (10.11.2026, update-19): щопонеділка о 10:00 власниці й адміну — цифри за минулий тиждень
alter table settings add column if not exists weekly_on boolean not null default true;
alter table settings add column if not exists weekly_sent date;

create or replace function nana_priv.weekly_post(p_from date, p_to date, p_chats bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(array_length(p_chats, 1), 0) = 0 then return; end if;
  select hook_key into k from app_secrets where id = 1;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'weekly_summary', 'from', p_from, 'to', p_to, 'chats', to_jsonb(p_chats)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text),
    timeout_milliseconds := 30000);
end $$;
revoke execute on function nana_priv.weekly_post(date, date, bigint[]) from public, anon, authenticated;

create or replace function nana_priv.weekly_tick() returns int
language plpgsql security definer set search_path = public as $$
declare st settings; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv'); ch bigint[];
begin
  select * into st from settings where id = 1;
  if not st.weekly_on or extract(isodow from d) <> 1 or hh < 10 or st.weekly_sent is not distinct from d then return 0; end if;
  update settings set weekly_sent = d where id = 1;
  select array_agg(tg_chat_id) into ch from staff
   where is_active and role in ('owner', 'admin') and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'weekly')::boolean, true);
  perform nana_priv.weekly_post(d - 7, d - 1, ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.weekly_tick() from public, anon, authenticated;

-- «Тиждень зараз» у Налаштуваннях: за минулий тиждень (пн–нд) — у бот того, хто натиснув
create or replace function weekly_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff; d date := (now() at time zone 'Europe/Kyiv')::date; mon date;
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  mon := d - (extract(isodow from d)::int - 1);   -- понеділок цього тижня
  perform nana_priv.weekly_post(mon - 7, mon - 1, array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function weekly_send_now() from public, anon;
grant execute on function weekly_send_now() to authenticated;

select cron.schedule('nana-weekly', '*/15 * * * *', 'select nana_priv.weekly_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-weekly');

-- перевірка
select (select weekly_on from settings where id = 1) as weekly_on,
       exists (select 1 from cron.job where jobname = 'nana-weekly') as cron_ok,
       to_regprocedure('weekly_send_now()') is not null as fn_ok;
