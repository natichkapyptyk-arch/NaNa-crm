-- Обʼєднання дублів клієнтів (04.11.2026). Запустити один раз у Supabase → SQL Editor (проєкт arkwtpihdaqnwhdcjpqf).
-- Те саме вже є в schema.sql; цей файл — щоб не запускати всю базу.
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
