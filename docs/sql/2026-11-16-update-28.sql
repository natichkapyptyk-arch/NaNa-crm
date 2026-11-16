-- update-28 (16.11.2026): щотижнева резервна копія бази в Telegram + кнопка «Копія зараз»
-- можна запускати повторно

-- резервна копія в Telegram (16.11.2026, update-28): щонеділі о 21:00 власниці й адміну з доступом до грошей — Excel з усіма основними таблицями
alter table settings add column if not exists backup_on boolean not null default true;
alter table settings add column if not exists backup_sent date;

create or replace function nana_priv.backup_post(p_chats bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare k uuid;
begin
  if coalesce(array_length(p_chats, 1), 0) = 0 then return; end if;
  select hook_key into k from app_secrets where id = 1;
  perform net.http_post(
    url := 'https://arkwtpihdaqnwhdcjpqf.supabase.co/functions/v1/tg-bot',
    body := jsonb_build_object('action', 'backup', 'chats', to_jsonb(p_chats)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-key', k::text),
    timeout_milliseconds := 60000);
end $$;
revoke execute on function nana_priv.backup_post(bigint[]) from public, anon, authenticated;

create or replace function nana_priv.backup_tick() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Kyiv')::date; hh int := extract(hour from now() at time zone 'Europe/Kyiv'); ch bigint[];
begin
  if extract(isodow from d) <> 7 or hh < 21 then return 0; end if;
  -- позначка «надіслано сьогодні» ставиться одним оновленням — двічі не надішле
  update settings set backup_sent = d where id = 1 and backup_on and backup_sent is distinct from d;
  if not found then return 0; end if;
  select array_agg(distinct tg_chat_id) into ch from staff
   where is_active and (role = 'owner' or (role = 'admin' and see_money)) and tg_chat_id is not null
     and coalesce((notify->>'tg')::boolean, true) and coalesce((notify->>'backup')::boolean, true);
  perform nana_priv.backup_post(ch);
  return coalesce(array_length(ch, 1), 0);
end $$;
revoke execute on function nana_priv.backup_tick() from public, anon, authenticated;

-- «Копія зараз» у Налаштуваннях: свіжа копія — у бот того, хто натиснув
create or replace function backup_send_now() returns int language plpgsql security definer set search_path = public as $$
declare me staff;
begin
  if not coalesce(sees_money(), false) then raise exception 'Резервну копію отримують лише власниця або адмін з доступом до грошей'; end if;
  select * into me from staff where user_id = auth.uid() and is_active;
  if me.tg_chat_id is null then raise exception 'Спершу підключіть Telegram-бота у своїй картці («Персонал» → ваша картка)'; end if;
  perform nana_priv.backup_post(array[me.tg_chat_id]);
  return 1;
end $$;
revoke execute on function backup_send_now() from public, anon;
grant execute on function backup_send_now() to authenticated;

select cron.schedule('nana-backup', '*/15 * * * *', 'select nana_priv.backup_tick()')
 where not exists (select 1 from cron.job where jobname = 'nana-backup');

-- журнал змін: назва нового налаштування
create or replace function trg_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; r jsonb; w text; l text; area text; d text[] := '{}'; k text;
  skip text[] := array['id', 'created_at', 'updated_at', 'sort', 'tg_link', 'photos', 'photo_url', 'demo',
    'daily_sent', 'close_sent', 'open_sent', 'nudge_sent', 'report_sent', 'weekly_sent', 'backup_sent', 'dsum_sent', 'commission', 'commission_pct', 'paid_at', 'appointment_id', 'staff_id', 'service_id'];
  nm jsonb := '{"name":"назва","price":"ціна","dur":"тривалість, хв","is_active":"увімкнено","category":"категорія","description":"опис",
    "price_from":"ціна «від»","subgroup":"підгрупа","is_addon":"додаткова","role":"роль","first_name":"імʼя","last_name":"прізвище",
    "middle_name":"по батькові","phone":"телефон","email":"пошта","telegram":"Telegram","login":"логін","is_bookable":"онлайн-запис",
    "notify":"сповіщення","tg_chat_id":"Telegram-бот","user_id":"вхід","see_money":"бачить гроші","bio":"про себе","experience":"посада",
    "birth_date":"день народження","start_date":"працює з","amount":"сума","method":"спосіб оплати","day":"дата","note":"коментар",
    "open_time":"відкриття","close_time":"закриття","pay_methods":"способи оплати","salon_name":"назва салону","address":"адреса",
    "remind_hours":"нагадування, год","instagram":"Instagram","about":"про салон","last_start":"останній запис о","step_min":"крок запису, хв",
    "buffer_min":"перерва між записами, хв","lead_min":"запис не раніше ніж за, хв","max_days":"запис наперед, днів","cancel_hours":"скасування не пізніше ніж за, год","pay_link":"посилання на оплату","daily_hour":"розклад о","close_hour":"вечірня перевірка о","open_day":"нагадати відкрити графік з",
    "report_on":"щомісячний звіт","weekly_on":"підсумок тижня","backup_on":"резервна копія в Telegram","nudge1_days":"нагадати через, днів","nudge2_days":"«давно не були» через, днів",
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
