-- Оновлення бази 10.11.2026 (20): знижка при оплаті — відсоток і коментар «за що знижка» в оплаті, запис в історії змін.
-- Можна запускати повторно.

-- знижка при оплаті (10.11.2026, update-20): відсоток і коментар «за що» зберігаються в оплаті
alter table payments add column if not exists discount_pct numeric(5,2) check (discount_pct > 0 and discount_pct <= 100);
alter table payments add column if not exists discount_note text;

-- записати / прибрати знижку оплаченої послуги: власниця/адмін — будь-яку, майстриня — свою
create or replace function payment_discount(p_appt uuid, p_pct numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; me staff; p numeric := nullif(round(coalesce(p_pct, 0), 2), 0); n text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into a from appointments where id = p_appt;
  select * into me from staff where user_id = auth.uid() and is_active;
  if a.id is null or me.id is null then raise exception 'Немає доступу'; end if;
  if not (coalesce(is_boss(), false) or a.staff_id = me.id) then raise exception 'Можна змінювати лише свої оплати'; end if;
  if p is not null and (p < 0 or p > 100) then raise exception 'Знижка має бути від 0 до 100%%'; end if;
  if p is not null and n is null then raise exception 'Напишіть, за що знижка'; end if;
  update payments set discount_pct = p, discount_note = case when p is null then null else left(n, 200) end where appointment_id = p_appt;
  if not found then raise exception 'Оплату не знайдено'; end if;
  insert into appt_log (appointment_id, who, what)
  values (p_appt, me.first_name, case when p is null then 'прибрав(ла) знижку' else 'знижка ' || trim(to_char(p, 'FM990.##')) || '%: ' || left(n, 200) end);
end $$;
revoke execute on function payment_discount(uuid, numeric, text) from public, anon;
grant execute on function payment_discount(uuid, numeric, text) to authenticated;

-- перевірка
select exists (select 1 from information_schema.columns where table_name = 'payments' and column_name = 'discount_pct') as col_ok,
       to_regprocedure('payment_discount(uuid,numeric,text)') is not null as fn_ok;
