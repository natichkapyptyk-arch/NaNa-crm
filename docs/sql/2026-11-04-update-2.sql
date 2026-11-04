-- Оновлення бази 04.11.2026 (2): ціна «від» окремо в кожної майстрині.
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Повторний запуск нічого не змінює.

alter table master_services add column if not exists price_from boolean not null default false;   -- ціна «від» у майстрині
update master_services ms set price_from = true from services s where s.id = ms.service_id and s.price_from;   -- одноразове перенесення
update services set price_from = false where price_from;

create or replace function pub_catalog() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'pay_link' from settings s where id = 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'name', name, 'descr', descr,
                 'dur', dur, 'price', price, 'price_from', price_from, 'sort', sort, 'photos', photos) order by sort, name) from services where is_active), '[]'),
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
