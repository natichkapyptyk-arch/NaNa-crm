// Швидкий вхід персоналу за спільним посиланням (#/team/<токен>): список людей → вхід без пароля.
// Посилання вмикає/вимикає/змінює власниця в Налаштуваннях.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { token, staff_id } = await req.json().catch(() => ({}));
    if (!isUuid(token)) return json({ error: 'Посилання недійсне' }, 400);
    const { data: sec } = await db.from('app_secrets').select('team_token, team_enabled').eq('id', 1).single();
    if (!sec || sec.team_token !== token) return json({ error: 'Посилання недійсне або застаріло. Попросіть нове у власниці.' }, 403);
    if (!sec.team_enabled) return json({ error: 'Вхід за посиланням вимкнено. Увійдіть з паролем.' }, 403);
    if (!staff_id) {
      const { data } = await db.from('staff').select('id, first_name, last_name, role, photo_url').eq('is_active', true).not('user_id', 'is', null).order('sort').order('first_name');
      return json({ staff: data ?? [] });
    }
    if (!isUuid(staff_id)) return json({ error: 'Невірний запит' }, 400);
    const { data: s } = await db.from('staff').select('user_id, is_active').eq('id', staff_id).maybeSingle();
    if (!s?.user_id || !s.is_active) return json({ error: 'Співробітника не знайдено' }, 404);
    const { data: u, error: ue } = await db.auth.admin.getUserById(s.user_id);
    if (ue || !u?.user?.email) return json({ error: 'Немає входу для цього співробітника' }, 404);
    const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
    if (error) return json({ error: error.message }, 500);
    return json({ token_hash: link.properties.hashed_token });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
