-- Оновлення бази 04.11.2026 (5): підгрупа послуги (напр. «Дизайн») і «додатково» до основної послуги.
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.
alter table services add column if not exists subgroup text;                                 -- підгрупа в категорії (напр. «Дизайн»)
alter table services add column if not exists is_addon boolean not null default false;      -- «додатково» до основної послуги

create or replace function pub_catalog() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'pay_link' from settings s where id = 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'name', name, 'descr', descr,
                 'dur', dur, 'price', price, 'price_from', price_from, 'subgroup', subgroup, 'is_addon', is_addon, 'sort', sort, 'photos', photos) order by sort, name) from services where is_active), '[]'),
    'masters', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
                 'photo_url', m.photo_url, 'bio', m.bio, 'experience', m.experience) order by m.sort, m.first_name)
                 from staff m where m.is_active and m.is_bookable), '[]'),
    'ms', coalesce((select jsonb_agg(jsonb_build_object('staff_id', ms.staff_id, 'service_id', ms.service_id, 'dur', ms.dur, 'price', ms.price, 'price_from', ms.price_from))
                 from master_services ms join services s on s.id = ms.service_id join staff m on m.id = ms.staff_id
                 where ms.is_active and s.is_active and m.is_active and m.is_bookable), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('m', staff_id, 'w', weekday, 's', to_char(start_time, 'HH24:MI'),
                 'e', to_char(end_time, 'HH24:MI'))) from work_hours), '[]'),
    'now', now())
$$;

create or replace function book_visit(p_items jsonb, p_name text, p_phone text, p_contact text,
  p_instagram text default null, p_comment text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text; v_client uuid; v_visit uuid; v_token uuid; it jsonb; v_staff uuid; v_service uuid;
  v_start timestamptz; v_end timestamptz; v_dur int; v_price numeric; v_err text; v_ranges tstzrange[] := '{}'; n int;
  v_addon boolean; v_ends text[] := '{}'; v_main int := 0;
begin
  v_phone := norm_phone(p_phone);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Вкажіть ваше ім’я'; end if;
  if v_phone is null then raise exception 'Вкажіть правильний номер телефону'; end if;
  if coalesce(p_contact, '') not in ('telegram','viber','call','instagram') then raise exception 'Оберіть, як з вами зв’язатись'; end if;
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
    on conflict (phone) do update set contact = excluded.contact, instagram = coalesce(excluded.instagram, clients.instagram)
    returning id into v_client;
  insert into visits (client_id, source, comment, created_by) values (v_client, 'online', nullif(trim(coalesce(p_comment, '')), ''), null)
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

select (select count(*) from information_schema.columns where table_name = 'services' and column_name in ('subgroup','is_addon')) as new_columns,
       position('is_addon' in pg_get_functiondef('pub_catalog'::regproc)) > 0 as catalog_ok,
       position('v_addon' in pg_get_functiondef('book_visit(jsonb,text,text,text,text,text)'::regprocedure)) > 0 as booking_ok;
