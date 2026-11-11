-- 2026-11-11 update-22: захист посилань Telegram співробітників, ліміти онлайн-запису, пароль від 8 символів,
-- обмеження фото, закрито публічне читання старих old_-таблиць. Демо-дані НЕ чіпає (сайт ще в тесті). Запускати ПІСЛЯ update-21. Можна запускати повторно.

-- ===== Захист (update-22): посилання Telegram співробітників, ліміти онлайн-запису =====
-- посилання «підключити Telegram» (tg_link) не читається через API: його видає staff_tg_link() — собі, власниці,
-- адміну — лише для не-власниць. Після підключення бот міняє посилання (одноразове).
revoke select on staff from anon, authenticated;
grant select (id, user_id, role, last_name, first_name, middle_name, birth_date, experience, bio, photo_url, telegram, phone, email,
  login, start_date, is_active, is_bookable, sort, notify, tg_chat_id, demo, created_at, see_money) on staff to authenticated;
-- ⚠ нова колонка в staff → додати її в цей grant, інакше сайт її не побачить

create or replace function staff_tg_link(p_staff uuid, p_regen boolean default false) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare s staff;
begin
  select * into s from staff where id = p_staff;
  if s.id is null then raise exception 'Співробітника не знайдено'; end if;
  if not (p_staff = me() or coalesce(my_role(), '') = 'owner' or (coalesce(is_boss(), false) and s.role <> 'owner')) then
    raise exception 'Немає доступу';
  end if;
  if p_regen then update staff set tg_link = gen_random_uuid() where id = p_staff returning tg_link into s.tg_link; end if;
  return s.tg_link;
end $$;
revoke execute on function staff_tg_link(uuid, boolean) from public, anon;
grant execute on function staff_tg_link(uuid, boolean) to authenticated;

-- онлайн-запис: імʼя, яке ввела людина (щоб «Мій запис» не показував, як клієнтку записано в салоні)
alter table visits add column if not exists booked_name text;

-- фото: до 5 МБ і лише картинки
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'] where id = 'photos';

create or replace function book_visit(p_items jsonb, p_name text, p_phone text, p_contact text,
  p_instagram text default null, p_comment text default null, p_ref text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text; v_client uuid; v_visit uuid; v_token uuid; it jsonb; v_staff uuid; v_service uuid;
  v_start timestamptz; v_end timestamptz; v_dur int; v_price numeric; v_err text; v_ranges tstzrange[] := '{}'; n int;
  v_addon boolean; v_ends text[] := '{}'; v_main int := 0;
begin
  v_phone := norm_phone(p_phone);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Вкажіть ваше ім’я'; end if;
  if v_phone is null then raise exception 'Вкажіть правильний номер телефону'; end if;
  if coalesce(p_contact, '') not in ('telegram','viber','call','instagram') then raise exception 'Оберіть, як з вами зв’язатись'; end if;
  -- захист від спаму: на один номер — не більше 3 майбутніх онлайн-візитів і 3 нових за годину; на весь салон — 20 онлайн-записів за годину
  select id into v_client from clients where phone = v_phone;
  if v_client is not null then
    if (select count(distinct a.visit_id) from appointments a join visits v on v.id = a.visit_id
         where a.client_id = v_client and v.source = 'online' and a.status = 'booked' and a.starts_at > now()) >= 3 then
      raise exception 'На цей номер уже є 3 майбутні записи. Щоб додати ще, зателефонуйте нам, будь ласка.';
    end if;
    if (select count(*) from visits where client_id = v_client and source = 'online' and created_at > now() - interval '1 hour') >= 3 then
      raise exception 'Забагато записів з цього номера за годину. Спробуйте пізніше або зателефонуйте нам.';
    end if;
    v_client := null;
  end if;
  if (select count(*) from visits where source = 'online' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Зараз забагато онлайн-записів. Спробуйте за кілька хвилин або зателефонуйте нам.';
  end if;
  n := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if n < 1 or n > 8 then raise exception 'Оберіть від 1 до 8 послуг'; end if;
  -- щоб двоє не зайняли той самий час одночасно
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e->>'staff' x from jsonb_array_elements(p_items) e order by 1) q;
  for it in select * from jsonb_array_elements(p_items) loop
    v_staff := (it->>'staff')::uuid; v_service := (it->>'service')::uuid; v_start := (it->>'start')::timestamptz;
    v_dur := null;
    select ms.dur into v_dur from master_services ms join services s on s.id = ms.service_id join staff m on m.id = ms.staff_id
     where ms.staff_id = v_staff and ms.service_id = v_service and ms.is_active and s.is_active and m.is_active and m.is_bookable;
    if v_dur is null then raise exception 'Цей майстер не виконує обрану послугу'; end if;
    v_end := v_start + make_interval(mins => v_dur);
    select coalesce(s.is_addon, false) into v_addon from services s where s.id = v_service;
    if not v_addon then v_main := v_main + 1; end if;
    -- «додатково» одразу після іншої послуги цього ж майстра у візиті: без правил онлайн-запису (час початку, «останній запис»)
    if v_addon and (v_staff::text || '|' || v_start::text) = any(v_ends) then
      v_err := slot_check(v_staff, v_start, v_end, null, false, null);
    else
      v_err := slot_check(v_staff, v_start, v_end, null, true, null);
    end if;
    v_ends := v_ends || (v_staff::text || '|' || v_end::text);
    if v_err is not null then
      raise exception '% (%)', v_err, to_char(v_start at time zone 'Europe/Kyiv', 'DD.MM HH24:MI');
    end if;
    if exists (select 1 from unnest(v_ranges) r where r && tstzrange(v_start, v_end)) then
      raise exception 'Послуги у візиті накладаються за часом — оберіть інший час';
    end if;
    v_ranges := v_ranges || tstzrange(v_start, v_end);
  end loop;
  if v_main = 0 then raise exception 'Додаткові послуги записуються разом з основною — оберіть, будь ласка, основну послугу'; end if;

  insert into clients (name, phone, contact, instagram) values (trim(p_name), v_phone, p_contact, nullif(trim(coalesce(p_instagram, '')), ''))
    on conflict (phone) do update set contact = excluded.contact, instagram = coalesce(clients.instagram, excluded.instagram)   -- наявний Instagram не перезаписуємо
    returning id into v_client;
  insert into visits (client_id, source, comment, created_by, ref, booked_name)
    values (v_client, 'online', nullif(trim(coalesce(p_comment, '')), ''), null, nullif(left(lower(regexp_replace(coalesce(p_ref, ''), '[^a-zA-Z0-9._-]', '', 'g')), 40), ''), left(trim(p_name), 80))
    returning id, token into v_visit, v_token;
  for it in select * from jsonb_array_elements(p_items) loop
    v_staff := (it->>'staff')::uuid; v_service := (it->>'service')::uuid; v_start := (it->>'start')::timestamptz;
    select ms.dur, ms.price into v_dur, v_price from master_services ms where ms.staff_id = v_staff and ms.service_id = v_service;
    insert into appointments (visit_id, client_id, staff_id, service_id, starts_at, ends_at, price, created_by)
      values (v_visit, v_client, v_staff, v_service, v_start, v_start + make_interval(mins => v_dur), v_price, null);
  end loop;
  return jsonb_build_object('token', v_token);
exception when exclusion_violation then
  raise exception 'Цей час щойно зайняли. Оберіть інший, будь ласка.';
end $$;

create or replace function client_visit(p_token uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'token', v.token, 'created_at', v.created_at, 'comment', v.comment,
    'client', jsonb_build_object('name', coalesce(v.booked_name, c.name), 'phone', c.phone, 'tg', c.tg_chat_id is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'staff_id', a.staff_id, 'service_id', a.service_id,
        'service', s.name, 'master', trim(m.first_name || ' ' || m.last_name), 'photo_url', m.photo_url,
        'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price', a.price, 'status', a.status) order by a.starts_at)
      from appointments a join services s on s.id = a.service_id join staff m on m.id = a.staff_id where a.visit_id = v.id), '[]'),
    'cancel_hours', (select cancel_hours from settings where id = 1),
    'now', now())
  from visits v join clients c on c.id = v.client_id where v.token = p_token
$$;

create or replace function staff_set_login(p_staff uuid, p_login text, p_password text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff; v_login text := lower(trim(coalesce(p_login, ''))); v_email text; v_uid uuid;
begin
  select * into s from staff where id = p_staff;
  if s.id is null then raise exception 'Співробітника не знайдено'; end if;
  if not (is_boss() or p_staff = me()) then raise exception 'Немає доступу'; end if;
  if s.role = 'owner' and p_staff is distinct from me() and coalesce(my_role(), '') <> 'owner' then
    raise exception 'Вхід власниці змінює лише власниця';
  end if;
  if v_login = '' then raise exception 'Вкажіть логін або пошту'; end if;
  if v_login !~ '^[a-z0-9._@+-]+$' then raise exception 'Логін — латинські літери, цифри, крапка, дефіс'; end if;
  if p_password is not null and length(p_password) < 8 then raise exception 'Пароль — щонайменше 8 символів'; end if;
  if s.user_id is null and p_password is null then raise exception 'Вкажіть пароль'; end if;
  v_email := case when v_login like '%@%' then v_login else v_login || '@nana.local' end;
  if exists (select 1 from auth.users where lower(email) = v_email and id is distinct from s.user_id) then
    raise exception 'Такий логін уже зайнятий';
  end if;
  v_uid := nana_priv.auth_upsert(s.user_id, v_email, p_password);
  update staff set user_id = v_uid, login = v_login, email = case when v_login like '%@%' then v_login else email end where id = p_staff;
end $$;

-- старі таблиці першої версії (old_*): на них посилаються інші old_-таблиці, тому не видаляємо —
-- лише прибираємо публічне читання old_masters і old_services (для персоналу все лишається як було)
do $$ begin
  if to_regclass('public.old_masters') is not null then
    drop policy if exists p_masters_read on old_masters;
    create policy p_masters_read on old_masters for select to authenticated using ((select is_staff()));
    revoke all on old_masters from anon;
  end if;
  if to_regclass('public.old_services') is not null then
    drop policy if exists p_services_read on old_services;
    create policy p_services_read on old_services for select to authenticated using ((select is_staff()));
    revoke all on old_services from anon;
  end if;
end $$;

notify pgrst, 'reload schema';
