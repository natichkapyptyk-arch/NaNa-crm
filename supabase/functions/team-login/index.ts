// Швидкий вхід персоналу за спільним посиланням (#/team/<токен>): список людей → вхід без пароля.
// Посилання вмикає/вимикає/змінює власниця в Налаштуваннях.
// Безпека: за посиланням входять лише майстри; власниці й адмін — тільки з паролем (інакше посилання дає доступ до всього).
// Також: одноразове посилання «встановити пароль» (pw_token, таблиця pw_links) → вхід і картка з полем пароля.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { token, staff_id, pw_token } = await req.json().catch(() => ({}));
    // одноразове посилання «встановити пароль»
    if (pw_token !== undefined) {
      if (!isUuid(pw_token)) return json({ error: 'Посилання недійсне' }, 400);
      const { data: l } = await db.from('pw_links').select('staff_id, expires_at, used_at').eq('token', pw_token).maybeSingle();
      if (!l) return json({ error: 'Посилання недійсне' }, 404);
      if (l.used_at) return json({ error: 'Посилання вже використано. Увійдіть з паролем або попросіть нове.' }, 410);
      if (Date.parse(l.expires_at) < Date.now()) return json({ error: 'Посилання застаріло. Попросіть нове.' }, 410);
      const { data: s } = await db.from('staff').select('user_id, is_active').eq('id', l.staff_id).maybeSingle();
      if (!s?.user_id || !s.is_active) return json({ error: 'Співробітника не знайдено' }, 404);
      const { data: u } = await db.auth.admin.getUserById(s.user_id);
      if (!u?.user?.email) return json({ error: 'Немає входу для цього співробітника' }, 404);
      const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
      if (error) return json({ error: error.message }, 500);
      await db.from('pw_links').update({ used_at: new Date().toISOString() }).eq('token', pw_token);
      return json({ token_hash: link.properties.hashed_token, staff_id: l.staff_id });
    }
    if (!isUuid(token)) return json({ error: 'Посилання недійсне' }, 400);
    const { data: sec } = await db.from('app_secrets').select('team_token, team_enabled').eq('id', 1).single();
    if (!sec || sec.team_token !== token) return json({ error: 'Посилання недійсне або застаріло. Попросіть нове у власниці.' }, 403);
    if (!sec.team_enabled) return json({ error: 'Вхід за посиланням вимкнено. Увійдіть з паролем.' }, 403);
    if (!staff_id) {
      const { data } = await db.from('staff').select('id, first_name, last_name, role, photo_url').eq('is_active', true).eq('role', 'master').not('user_id', 'is', null).order('sort').order('first_name');
      return json({ staff: data ?? [] });
    }
    if (!isUuid(staff_id)) return json({ error: 'Невірний запит' }, 400);
    const { data: s } = await db.from('staff').select('user_id, is_active, role').eq('id', staff_id).maybeSingle();
    if (!s?.user_id || !s.is_active) return json({ error: 'Співробітника не знайдено' }, 404);
    if (s.role !== 'master') return json({ error: 'Власниця й адмін входять лише з паролем.' }, 403);
    const { data: u, error: ue } = await db.auth.admin.getUserById(s.user_id);
    if (ue || !u?.user?.email) return json({ error: 'Немає входу для цього співробітника' }, 404);
    const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
    if (error) return json({ error: error.message }, 500);
    return json({ token_hash: link.properties.hashed_token });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
