-- Оновлення бази 05.11.2026 (13): вечірня перевірка «чи позакривала записи за день».
-- О settings.close_hour (за замовч. 21:00 за Києвом) кожній майстрині з підключеним ботом, у якої сьогодні були записи,
-- бот надсилає питання з кнопкою «Так, усе закрила». Після натискання бот перевіряє, чи не лишилось записів у стані «Записано».
-- Можна запускати повторно.

alter table settings add column if not exists close_hour int default 21 check (close_hour between 0 and 23);   -- null — не надсилати
alter table settings add column if not exists close_sent date;                                                  -- коли вже надіслали (щоб не двічі)

create or replace function nana_priv.close_tick(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare st settings; k uuid; d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv');
  x record; n int := 0;
begin
  select * into st from settings where id = 1;
  if not p_force and (st.close_hour is null or hh < st.close_hour or hh > st.close_hour + 1 or st.close_sent is not distinct from d) then return 0; end if;
  update settings set close_sent = d where id = 1;
  select hook_key into k from app_secrets where id = 1;
  for x in select s.id from staff s
            where s.is_active and s.tg_chat_id is not null
              and coalesce((s.notify->>'tg')::boolean, true) and coalesce((s.notify->>'close')::boolean, true)
              and exists (select 1 from appointments a where a.staff_id = s.id and not a.demo and a.status <> 'cancel'
                            and (a.starts_at at time zone 'Europe/Kyiv')::date = d)
            order by s.sort loop
    perform net.http_post(
      url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
      body := jsonb_build_object('action', 'close_ask', 'staff_id', x.id, 'day', d),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function nana_priv.close_tick(boolean) from public, anon, authenticated;

-- «Надіслати перевірку зараз» з Налаштувань (лише власниця/адмін)
create or replace function close_send_now() returns int language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  return nana_priv.close_tick(true);
end $$;
revoke execute on function close_send_now() from public, anon;
grant execute on function close_send_now() to authenticated;

select cron.schedule('nana-close', '*/15 * * * *', 'select nana_priv.close_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-close');

-- бот має отримувати натискання кнопок (callback_query) — оновлюємо вебхук (функцію tg-bot треба задеплоїти ДО цього)
select net.http_post(
  url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
  body := jsonb_build_object('action', 'setup', 'webhook', true),
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', (select hook_key from app_secrets where id = 1)::text));

-- перевірка
select (select close_hour from settings where id = 1) as close_hour,
       exists (select 1 from cron.job where jobname = 'nana-close') as cron_ok,
       to_regprocedure('close_send_now()') is not null as fn_ok;
