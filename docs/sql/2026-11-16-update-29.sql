-- update-29 (16.11.2026): картка «Місце в базі» в Налаштуваннях. Можна запускати повторно.

-- місце в базі (16.11.2026, update-29): картка «Місце в базі» в Налаштуваннях — скільки зайнято з безкоштовного тарифу Supabase
create or replace function db_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(is_boss(), false) then raise exception 'Лише для власниці або адміністратора'; end if;
  return jsonb_build_object(
    'db', pg_database_size(current_database()),                                   -- уся база (разом зі службовим Supabase)
    'own', (select coalesce(sum(pg_total_relation_size(c.oid)), 0) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'm')),               -- лише таблиці салону
    'files', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
    'files_n', (select count(*) from storage.objects),
    'clients', (select count(*) from clients where not demo),
    'appts', (select count(*) from appointments where not demo));
end $$;
revoke execute on function db_usage() from public, anon;
grant execute on function db_usage() to authenticated;
