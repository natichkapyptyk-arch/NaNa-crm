-- 2026-11-11 update-23: пароль знову від 4 символів (як було) — на прохання власниці. Можна запускати повторно.
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
  if p_password is not null and length(p_password) < 4 then raise exception 'Пароль — щонайменше 4 символи'; end if;
  if s.user_id is null and p_password is null then raise exception 'Вкажіть пароль'; end if;
  v_email := case when v_login like '%@%' then v_login else v_login || '@nana.local' end;
  if exists (select 1 from auth.users where lower(email) = v_email and id is distinct from s.user_id) then
    raise exception 'Такий логін уже зайнятий';
  end if;
  v_uid := nana_priv.auth_upsert(s.user_id, v_email, p_password);
  update staff set user_id = v_uid, login = v_login, email = case when v_login like '%@%' then v_login else email end where id = p_staff;
end $$;

notify pgrst, 'reload schema';
