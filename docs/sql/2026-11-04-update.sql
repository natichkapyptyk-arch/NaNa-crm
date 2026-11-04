-- Оновлення бази 04.11.2026: ціна «від» + обʼєднання дублів клієнтів.
-- Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf). Можна запускати повторно.

-- 1) ціна «від»
alter table services add column if not exists price_from boolean not null default false;

create or replace function pub_catalog() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'pay_link' from settings s where id = 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'name', name, 'descr', descr,
                 'dur', dur, 'price', price, 'price_from', price_from, 'sort', sort, 'photos', photos) order by sort, name) from services where is_active), '[]'),
    'masters', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
                 'photo_url', m.photo_url, 'bio', m.bio, 'experience', m.experience) order by m.sort, m.first_name)
                 from staff m where m.is_active and m.is_bookable), '[]'),
    'ms', coalesce((select jsonb_agg(jsonb_build_object('staff_id', ms.staff_id, 'service_id', ms.service_id, 'dur', ms.dur, 'price', ms.price))
                 from master_services ms join services s on s.id = ms.service_id join staff m on m.id = ms.staff_id
                 where ms.is_active and s.is_active and m.is_active and m.is_bookable), '[]'),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('m', staff_id, 'w', weekday, 's', to_char(start_time, 'HH24:MI'),
                 'e', to_char(end_time, 'HH24:MI'))) from work_hours), '[]'),
    'now', now())
$$;

-- 2) обʼєднання дублів клієнтів
create or replace function client_merge(p_from uuid, p_to uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare f clients;
begin
  if not coalesce(is_boss(), false) then raise exception 'Обʼєднувати клієнтів може лише власниця або адміністратор'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Оберіть дві різні картки клієнтів'; end if;
  select * into f from clients where id = p_from for update;
  if not found or not exists (select 1 from clients where id = p_to) then raise exception 'Клієнта не знайдено'; end if;
  -- усе з картки-дубля переходить до основної
  update visits set client_id = p_to where client_id = p_from;
  update appointments set client_id = p_to where client_id = p_from;
  update tg_chats set client_id = p_to where client_id = p_from;
  delete from clients where id = p_from;
  -- порожні поля основної картки доповнюються; номер і нотатки дубля — у нотатки
  update clients t set instagram = coalesce(t.instagram, f.instagram), birthday = coalesce(t.birthday, f.birthday),
    tg_chat_id = coalesce(t.tg_chat_id, f.tg_chat_id), demo = t.demo and f.demo,
    note = nullif(concat_ws(E'\n', t.note, 'Інший номер: ' || f.phone || ' (картка «' || f.name || '»)',
                            case when f.note is distinct from t.note then f.note end), '')
  where t.id = p_to;
  return p_to;
end $$;
revoke execute on function client_merge(uuid,uuid) from public, anon;
grant execute on function client_merge(uuid,uuid) to authenticated;
