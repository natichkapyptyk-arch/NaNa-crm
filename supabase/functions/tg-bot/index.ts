// Telegram-бот NaNa studio: сповіщення персоналу, нагадування клієнтам.
// Токен бота — секрет TELEGRAM_BOT_TOKEN (або TG_BOT_TOKEN) у Supabase (у репозиторій не додавати).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as XLSX from 'npm:xlsx@0.18.5';

const TOKEN = (Deno.env.get('TG_BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim().replace(/^bot/i, '').replace(/^['"]|['"]$/g, '');
const SB_URL = 'https://arkwtpihdaqnwhdcjpqf.supabase.co';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const API = `https://api.telegram.org/bot${TOKEN}`;
const TZ = 'Europe/Kyiv';
const CONTACT: Record<string, string> = { telegram: 'Telegram', viber: 'Viber', call: 'дзвінок', instagram: 'Instagram' };

async function tg(method: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return await r.json();
}
type Btn = { text: string; url?: string; callback_data?: string };
const send = (chat_id: number, text: string, buttons?: Btn[][]) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });

async function webhookSecret() {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nana:' + TOKEN));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, ...o }).format(new Date(iso));
const day = (iso: string) => f(iso, { weekday: 'short', day: 'numeric', month: 'long' });
const hm = (iso: string) => f(iso, { hour: '2-digit', minute: '2-digit' });
const money = (n: number) => new Intl.NumberFormat('uk-UA').format(Math.round(Number(n) || 0)) + ' ₴';
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

async function settings() {
  const { data } = await db.from('settings').select('*').eq('id', 1).single();
  return data ?? {};
}
const site = (st: any) => String(st.site_url || 'https://vapors.app/nana/').replace(/#.*$/, '');

// ---------- вечірня перевірка: чи закрила майстриня записи за день ----------
const kDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function kRange(d: string) {   // доба за Києвом → [початок, кінець) в UTC
  const noon = new Date(d + 'T12:00:00Z');
  const off = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(noon) - 12;
  const s = Date.parse(d + 'T00:00:00Z') - off * 3600e3;
  return [new Date(s).toISOString(), new Date(s + 864e5).toISOString()];
}
const plural = (n: number, a: string, b: string, c: string) => { const m = Math.abs(n) % 100, d = m % 10; return m > 10 && m < 20 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
async function dayAppts(staffId: string, d: string) {
  const [from, to] = kRange(d);
  const { data } = await db.from('appointments').select('starts_at, status, services(name), clients(name)')
    .eq('staff_id', staffId).eq('demo', false).neq('status', 'cancel').gte('starts_at', from).lt('starts_at', to).order('starts_at');
  return (data ?? []) as any[];
}
const calBtn = (st: any, d: string): Btn[] => [{ text: '📅 Відкрити календар', url: site(st) + '#/staff/cal/' + d }];

async function closeAsk(staffId: string, d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { skip: 'bad day' };
  const { data: s } = await db.from('staff').select('first_name, tg_chat_id, is_active, notify').eq('id', staffId).single();
  if (!s?.tg_chat_id || !s.is_active || s.notify?.tg === false || s.notify?.close === false) return { skip: 'no telegram' };
  const all = await dayAppts(staffId, d);
  if (!all.length) return { skip: 'no appointments' };
  const st = await settings();
  const r = await send(s.tg_chat_id,
    `🌙 ${esc(s.first_name)}, перевір, будь ласка, чи позакривала записи за сьогодні (${all.length}).\nКожен візит має бути «Завершено» (з оплатою) або «Не прийшла».\n\nУсе закрила?`,
    [[{ text: '✅ Так, усе закрила', callback_data: 'cl:' + d }], calBtn(st, d)]);
  return { ok: r.ok };
}

// ---------- графік на наступний місяць: нагадування з 22 числа, кнопка «Готово» перевіряє month_open ----------
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const monName = (mo: string) => MONTHS[+mo.slice(5, 7) - 1] ?? mo;
const schedBtn = (st: any): Btn[] => [{ text: '🗓 Відкрити «Графік»', url: site(st) + '#/staff/sched' }];
async function isOpen(staffId: string, mo: string) {
  const { data } = await db.from('month_open').select('staff_id').eq('staff_id', staffId).eq('month', mo + '-01').maybeSingle();
  return !!data;
}
async function monthAsk(staffId: string, mo: string, first: boolean) {
  if (!/^\d{4}-\d{2}$/.test(mo)) return { skip: 'bad month' };
  const { data: s } = await db.from('staff').select('first_name, tg_chat_id, is_active, notify').eq('id', staffId).single();
  if (!s?.tg_chat_id || !s.is_active || s.notify?.tg === false || s.notify?.open === false) return { skip: 'no telegram' };
  if (await isOpen(staffId, mo)) return { skip: 'already open' };
  const st = await settings(), m = monName(mo);
  const t = first
    ? `📅 ${esc(s.first_name)}, відкрий, будь ласка, графік на <b>${m}</b> 🙏\nЗайди на сайт → «Графік», перевір вихідні й особливі дні та натисни «Відкрити графік на ${m}».\nПотім натисни «Готово» тут.`
    : `⏰ ${esc(s.first_name)}, нагадую: графік на <b>${m}</b> ще не відкрито — клієнтки не можуть записатись до тебе онлайн на ${m}.\nЗайди в «Графік», натисни «Відкрити графік на ${m}», а потім «Готово» тут.`;
  const r = await send(s.tg_chat_id, t, [[{ text: '✅ Готово', callback_data: 'mo:' + mo }], schedBtn(st)]);
  return { ok: r.ok };
}
async function onMonthDone(cq: any, chat: number, mo: string) {
  const { data: s } = await db.from('staff').select('id, first_name').eq('tg_chat_id', chat).eq('is_active', true).maybeSingle();
  if (!s) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Не знайшли вас серед персоналу', show_alert: true });
  const st = await settings(), m = monName(mo);
  if (cq.message) await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  if (await isOpen(s.id, mo)) {
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Дякую! 💛' });
    return send(chat, `✅ Дякую, ${esc(s.first_name)}! Графік на ${m} відкрито — клієнтки вже можуть записуватись 💛`);
  }
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Графік ще не відкрито' });
  return send(chat, `😬 Упс, графік на <b>${m}</b> ще не відкрито.\nЗайди в «Графік», перевір вихідні й натисни «Відкрити графік на ${m}», потім повтори спробу й натисни «Готово».`,
    [[{ text: '✅ Готово', callback_data: 'mo:' + mo }], schedBtn(st)]);
}

// клієнтка натиснула «✅ Так, я буду»
async function onVisitConfirm(cq: any, chat: number, visitId: string) {
  const { data: r } = await db.rpc('visit_confirm_tg', { p_visit: visitId, p_chat: chat });
  const res: any = r ?? {};
  const keepUrl = (cq.message?.reply_markup?.inline_keyboard ?? []).flat().filter((b: any) => b.url).map((b: any) => [b]);
  if (cq.message) await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: keepUrl } });
  if (res.ok || res.already) {
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Дякуємо! 💛' });
    if (res.already) return { ok: true };
    return send(chat, `✅ Дякуємо, що підтвердили! Чекаємо вас ${day(res.starts_at)} о ${hm(res.starts_at)} 💛`);
  }
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: res.err === 'no_active' ? 'Цей запис уже змінено або скасовано' : 'Не вдалося підтвердити', show_alert: true });
  return { ok: false };
}

async function onCallback(cq: any) {
  const chat = (cq.message?.chat?.id ?? cq.from?.id) as number;
  const vc = String(cq.data ?? '').match(/^vc:([0-9a-f-]{36})$/)?.[1];
  if (vc) return onVisitConfirm(cq, chat, vc);
  const mo = String(cq.data ?? '').match(/^mo:(\d{4}-\d{2})$/)?.[1];
  if (mo) return onMonthDone(cq, chat, mo);
  const d = String(cq.data ?? '').match(/^cl:(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!d) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  const { data: s } = await db.from('staff').select('id, first_name').eq('tg_chat_id', chat).eq('is_active', true).maybeSingle();
  if (!s) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Не знайшли вас серед персоналу', show_alert: true });
  const st = await settings();
  const open = (await dayAppts(s.id, d)).filter((a) => a.status === 'booked');   // усі незакриті записи за день, навіть пізніші
  if (cq.message) await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  if (!open.length) {
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Дякую! 💛' });
    return send(chat, `✅ Чудово, ${esc(s.first_name)}! Усі записи за ${day(d + 'T12:00:00Z')} закриті. Гарного вечора 💛`);
  }
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Ще не все закрито' });
  const lines = open.map((a) => `• ${hm(a.starts_at)} — ${esc(a.clients?.name)}, ${esc(a.services?.name)}`).join('\n');
  return send(chat, `😬 Упс, ти не закрила ${open.length} ${plural(open.length, 'запис', 'записи', 'записів')}:\n${lines}\n\nЗакрий ${open.length > 1 ? 'їх' : 'його'} у програмі, повтори спробу й натисни «Готово».`,
    [[{ text: '✅ Готово', callback_data: 'cl:' + d }], calBtn(st, d)]);
}

// ---------- щомісячний звіт власниці: Excel з клієнтками за місяць (від найранішої дати) + коротко цифри ----------
async function pageAll(make: () => any) {
  let out: any[] = [], i = 0;
  for (;;) { const { data, error } = await make().range(i, i + 999); if (error) throw error; out = out.concat(data ?? []); if ((data ?? []).length < 1000) break; i += 1000; }
  return out;
}
const xd = (iso: string) => {   // дата-час за Києвом → число Excel
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => +(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) / 864e5 + 25569;
};
const phoneFmt = (p: string) => { const d = String(p || '').replace(/\D/g, ''); return /^380\d{9}$/.test(d) ? `+380 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : (p || ''); };
// цифри за період [fa, ta): виторг, візити (клієнтка × день), клієнтки, нові клієнти, скасування / неявки, по майстрах
async function periodStats(fa: string, ta: string) {
  const pays = await pageAll(() => db.from('payments').select('amount, commission, staff_id').eq('demo', false).gte('paid_at', fa).lt('paid_at', ta));
  const ap = await pageAll(() => db.from('appointments').select('client_id, staff_id, starts_at, status').eq('demo', false).in('status', ['done', 'cancel', 'noshow']).gte('starts_at', fa).lt('starts_at', ta));
  const { count: newCl } = await db.from('clients').select('id', { count: 'exact', head: true }).eq('demo', false).gte('created_at', fa).lt('created_at', ta);
  const done = ap.filter((a: any) => a.status === 'done');
  const per: Record<string, { rev: number; com: number; vis: Set<string> }> = {};
  pays.forEach((x: any) => { const m = (per[x.staff_id] ||= { rev: 0, com: 0, vis: new Set() }); m.rev += +x.amount; m.com += +x.commission; });
  done.forEach((a: any) => { (per[a.staff_id] ||= { rev: 0, com: 0, vis: new Set() }).vis.add(a.client_id + '|' + kDay(new Date(a.starts_at))); });
  return {
    rev: pays.reduce((t: number, x: any) => t + +x.amount, 0),
    visits: new Set(done.map((a: any) => a.client_id + '|' + kDay(new Date(a.starts_at)))).size,
    clients: new Set(done.map((a: any) => a.client_id)).size,
    newCl: newCl ?? 0,
    cancels: ap.filter((a: any) => a.status === 'cancel').length, noshows: ap.filter((a: any) => a.status === 'noshow').length,
    per,
  };
}
const cmp = (a: number, b: number, what: string) => {   // «(+12% до жовтня)»
  if (!b) return a ? ` (було 0 ${what})` : '';
  const p = Math.round(((a - b) / b) * 100); return ` (${p > 0 ? '+' : ''}${p}% ${what})`;
};
const dif = (a: number, b: number, what: string) => (a === b ? '' : ` (${a > b ? '+' : ''}${a - b} ${what})`);
const MONTHS_GEN = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
async function monthlyReport(from: string, to: string, chats: number[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !chats.length) return { skip: 'bad args' };
  const [fa] = kRange(from), [, ta] = kRange(to);
  const ap = await pageAll(() => db.from('appointments').select('client_id, starts_at, services(name), staff(first_name), clients(name, phone, instagram), payments(amount)')
    .eq('status', 'done').eq('demo', false).gte('starts_at', fa).lt('starts_at', ta).order('starts_at'));
  const ids = [...new Set(ap.map((a: any) => a.client_id))];
  const last: Record<string, string> = {}, cnt: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const h = await pageAll(() => db.from('appointments').select('client_id, starts_at').eq('status', 'done').in('client_id', ids.slice(i, i + 200)));
    h.forEach((x: any) => { if (!last[x.client_id] || x.starts_at > last[x.client_id]) last[x.client_id] = x.starts_at; });
    const days = new Set(h.map((x: any) => x.client_id + '|' + kDay(new Date(x.starts_at)))); days.forEach((k) => { const c = String(k).split('|')[0]; cnt[c] = (cnt[c] || 0) + 1; });
  }
  const G = new Map<string, any>();
  for (const a of ap as any[]) {
    const k = a.client_id + '|' + kDay(new Date(a.starts_at));
    if (!G.has(k)) G.set(k, { a, sv: [] as string[], ms: new Set<string>(), sum: 0 });
    const g = G.get(k); g.sv.push(a.services?.name ?? ''); if (a.staff?.first_name) g.ms.add(a.staff.first_name);
    g.sum += +(Array.isArray(a.payments) ? a.payments[0]?.amount : a.payments?.amount) || 0;
  }
  const head = ['Дата візиту', 'ПІБ', 'Телефон', 'Instagram', 'Послуги', 'Майстер', 'Сума, ₴', 'Останній візит', 'Візитів усього'];
  const rows = [...G.values()].map((g) => { const c = g.a.clients ?? {}, nick = String(c.instagram || '').replace(/^@/, '');
    return [null, c.name ?? '', phoneFmt(c.phone), nick ? 'https://instagram.com/' + nick : '', g.sv.join(', '), [...g.ms].join(', '), g.sum, null, cnt[g.a.client_id] || 0]; });
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  [...G.values()].forEach((g, i) => {
    ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })] = { t: 'n', v: xd(g.a.starts_at), z: 'dd.mm.yyyy hh:mm' };
    const l = last[g.a.client_id]; if (l) ws[XLSX.utils.encode_cell({ r: i + 1, c: 7 })] = { t: 'n', v: xd(l), z: 'dd.mm.yyyy' };
    const ic = ws[XLSX.utils.encode_cell({ r: i + 1, c: 3 })]; if (ic?.v) ic.l = { Target: ic.v };
  });
  ws['!cols'] = [17, 26, 18, 34, 44, 16, 10, 14, 12].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: head.length - 1 } }) };
  // цифри: цей період і такий самий попереднього місяця (повний місяць → повний; 1–10 листопада → 1–10 жовтня)
  const whole = from.slice(8) === '01' && +to.slice(8) >= 28 && to.slice(0, 7) === from.slice(0, 7);
  const pmFrom = (() => { const [y, m] = from.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); })();
  const pmLast = (() => { const [y, m] = from.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10); })();
  const pmTo = whole ? pmLast : (() => { const d = pmFrom.slice(0, 8) + to.slice(8); return d > pmLast ? pmLast : d; })();
  const [S1, S0] = await Promise.all([periodStats(fa, ta), periodStats(kRange(pmFrom)[0], kRange(pmTo)[1])]);
  const pmName = MONTHS_GEN[+pmFrom.slice(5, 7) - 1], vs = whole ? `до ${pmName.replace(/ень$/, 'ня').replace(/ий$/, 'ого').replace(/ад$/, 'ада')}` : `до тих самих днів ${pmName.replace(/ень$/, 'ня').replace(/ий$/, 'ого').replace(/ад$/, 'ада')}`;
  // аркуш «Майстри»
  const { data: staffRows } = await db.from('staff').select('id, first_name, last_name, sort').order('sort');
  const mHead = ['Майстер', 'Виторг, ₴', 'Візитів', 'Середній чек, ₴', 'Заробіток майстра, ₴'];
  const mRows = (staffRows ?? []).map((m: any) => { const p = S1.per[m.id]; if (!p || (!p.rev && !p.vis.size)) return null;
    return [[m.first_name, m.last_name].filter(Boolean).join(' '), Math.round(p.rev), p.vis.size, p.vis.size ? Math.round(p.rev / p.vis.size) : 0, Math.round(p.com)]; })
    .filter(Boolean).sort((a: any, b: any) => b[1] - a[1]) as any[];
  mRows.push(['Разом', Math.round(S1.rev), S1.visits, S1.visits ? Math.round(S1.rev / S1.visits) : 0, Math.round(Object.values(S1.per).reduce((t, p) => t + p.com, 0))]);
  const ws2 = XLSX.utils.aoa_to_sheet([mHead, ...mRows]); ws2['!cols'] = [24, 14, 10, 16, 20].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Клієнти'); XLSX.utils.book_append_sheet(wb, ws2, 'Майстри');
  const file = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const label = whole ? `${MONTHS_GEN[+from.slice(5, 7) - 1]} ${from.slice(0, 4)}` : `${from.split('-').reverse().join('.')}–${to.split('-').reverse().join('.')}`;
  const caption = `📊 Звіт NaNa studio за ${label}\n💰 Виторг: ${money(S1.rev)}${cmp(S1.rev, S0.rev, vs)}\n✅ Візитів: ${S1.visits}${dif(S1.visits, S0.visits, vs)}\n👩 Клієнток: ${S1.clients}\n🆕 Нових клієнтів: ${S1.newCl}${dif(S1.newCl, S0.newCl, vs)}`
    + `\n\nУ файлі: «Клієнти» — хто був у салоні, від найранішої дати; «Майстри» — виторг, візити, середній чек.`;
  const name = `NaNa клієнти ${from.split('-').reverse().join('.')}–${to.split('-').reverse().join('.')}.xlsx`;
  let sent = 0;
  for (const chat of chats) {
    const fd = new FormData();
    fd.append('chat_id', String(chat)); fd.append('caption', caption);
    fd.append('document', new Blob([file], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    const r = await (await fetch(`${API}/sendDocument`, { method: 'POST', body: fd })).json();
    if (r.ok) sent++;
  }
  return { sent, rows: rows.length };
}

// ---------- тижневий підсумок (понеділок зранку): цифри за минулий тиждень і порівняння з попереднім ----------
async function weeklySummary(from: string, to: string, chats: number[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !chats.length) return { skip: 'bad args' };
  const sh = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
  const [S1, S0] = await Promise.all([periodStats(kRange(from)[0], kRange(to)[1]), periodStats(kRange(sh(from, -7))[0], kRange(sh(to, -7))[1])]);
  const { data: staffRows } = await db.from('staff').select('id, first_name');
  const top = Object.entries(S1.per).sort((a, b) => b[1].rev - a[1].rev)[0];
  const topName = top && top[1].rev ? (staffRows ?? []).find((m: any) => m.id === top[0])?.first_name : '';
  const dm = (d: string) => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  const vs = 'до минулого тижня';
  const range = from.slice(0, 7) === to.slice(0, 7) ? `${+from.slice(8)}–${dm(to)}` : `${dm(from)} – ${dm(to)}`;
  const text = `📅 Підсумок тижня ${range}\n💰 Виторг: ${money(S1.rev)}${cmp(S1.rev, S0.rev, vs)}\n✅ Візитів: ${S1.visits}${dif(S1.visits, S0.visits, vs)}`
    + `\n🆕 Нових клієнтів: ${S1.newCl}${dif(S1.newCl, S0.newCl, vs)}\n❌ Скасовано / не прийшли: ${S1.cancels} / ${S1.noshows}`
    + (topName ? `\n🏆 Найбільший виторг: ${esc(topName)} — ${money(top![1].rev)}` : '');
  let sent = 0; for (const c of chats) { const r = await send(c, text); if (r.ok) sent++; }
  return { sent };
}

// ---------- повідомлення від людей ----------
async function onUpdate(up: any) {
  if (up.callback_query) return onCallback(up.callback_query);
  const m = up.message;
  if (!m?.chat || m.chat.type !== 'private') return;
  const chat = m.chat.id as number;
  const text = String(m.text ?? '').trim();
  await db.from('tg_chats').upsert({ chat_id: chat, first_name: m.from?.first_name ?? null, username: m.from?.username ?? null, last_at: new Date().toISOString() });
  const st = await settings();
  const p = text.match(/^\/start\s+(\S+)/)?.[1] ?? '';

  if (p.startsWith('s_') && isUuid(p.slice(2))) {
    const { data: s } = await db.from('staff').select('id, first_name, tg_chat_id').eq('tg_link', p.slice(2)).eq('is_active', true).maybeSingle();
    if (!s) return send(chat, 'Посилання застаріло. Відкрийте свою картку в програмі й натисніть «Підключити Telegram» ще раз.');
    // посилання одноразове: після підключення — нове; якщо картку вже було підключено в іншому Telegram — попереджаємо той чат
    await db.from('staff').update({ tg_chat_id: chat, tg_link: crypto.randomUUID() }).eq('id', s.id);
    if (s.tg_chat_id && Number(s.tg_chat_id) !== chat) {
      await send(Number(s.tg_chat_id), `⚠️ Сповіщення картки «${esc(s.first_name)}» тепер надходять в інший Telegram. Якщо це були не ви — відкрийте свою картку в програмі й підключіть Telegram знову, і скажіть власниці.`);
    }
    await db.from('tg_chats').update({ staff_id: s.id }).eq('chat_id', chat);
    return send(chat, `Готово, ${esc(s.first_name)}! 🙌\nСюди приходитимуть сповіщення про нові записи, скасування й перенесення. Що саме надсилати — у вашій картці в програмі.`,
      [[{ text: 'Відкрити програму', url: site(st) + '#/staff' }]]);
  }

  if (p.startsWith('v_') && isUuid(p.slice(2))) {
    const token = p.slice(2);
    const { data: v } = await db.from('visits').select('id, client_id, token, clients(name)').eq('token', token).maybeSingle();
    if (!v) return send(chat, 'Запис не знайдено. Перевірте посилання або зателефонуйте в салон.');
    await db.from('clients').update({ tg_chat_id: chat }).eq('id', v.client_id);
    await db.from('tg_chats').update({ client_id: v.client_id }).eq('chat_id', chat);
    const { data: items } = await db.from('appointments').select('id, starts_at, ends_at, price, reminded, services(name), staff(first_name)')
      .eq('visit_id', v.id).eq('status', 'booked').order('starts_at');
    const hours: number[] = (st.remind_hours ?? [24, 2]).slice().sort((a: number, b: number) => b - a);
    for (const a of items ?? []) {   // нагадування, час яких уже минув, не дублюємо
      const left = (new Date(a.starts_at).getTime() - Date.now()) / 3600e3;
      const done = hours.filter((h) => left <= h);
      if (done.length) await db.from('appointments').update({ reminded: done }).eq('id', a.id);
    }
    const lines = (items ?? []).map((a: any) => `• <b>${esc(a.services?.name)}</b> — ${day(a.starts_at)}, ${hm(a.starts_at)}–${hm(a.ends_at)}, майстер ${esc(a.staff?.first_name)}`);
    return send(chat, `Вітаємо, ${esc((v as any).clients?.name)}! 💛\nВи підключили нагадування від ${esc(st.salon_name || 'NaNa studio')}.\n\n${lines.join('\n') || 'Активних записів немає.'}\n\nНагадаємо за ${hours.join(' і ')} год до початку.`,
      [[{ text: 'Мій запис (перенести / скасувати)', url: site(st) + '#/v/' + token }]]);
  }

  const { data: s } = await db.from('staff').select('first_name').eq('tg_chat_id', chat).eq('is_active', true).maybeSingle();
  if (s) return send(chat, `${esc(s.first_name)}, ви підключені — сповіщення приходять сюди.`, [[{ text: 'Відкрити програму', url: site(st) + '#/staff' }]]);
  return send(chat, `Вітаємо в ${esc(st.salon_name || 'NaNa studio')}! 💛\nЗаписатися онлайн — за кнопкою нижче. Після запису натисніть «Нагадування в Telegram», і ми нагадаємо про візит.`,
    [[{ text: 'Записатися онлайн', url: site(st) }]]);
}

// ---------- сповіщення персоналу ----------
async function notify(id: string) {
  const { data: n } = await db.from('notifications').select('id, kind, title, staff_id, appointment_id, day').eq('id', id).single();
  if (!n) return { skip: 'no notification' };
  const { data: s } = await db.from('staff').select('tg_chat_id, notify, is_active').eq('id', n.staff_id).single();
  if (!s?.tg_chat_id || !s.is_active || s.notify?.tg === false) return { skip: 'no telegram' };
  const st = await settings();
  const { data: a } = await db.from('appointments')
    .select('starts_at, ends_at, price, note, cancel_reason, cancelled_by, services(name), staff(first_name, last_name), clients(name, phone, contact, instagram), visits(source, comment)')
    .eq('id', n.appointment_id).single();
  const icon: Record<string, string> = { new: '🆕', cancel: '❌', move: '🔁', confirm: '✅' };
  let t = `${icon[n.kind] ?? '🔔'} <b>${esc(n.title)}</b>`;
  if (a) {
    const c: any = a.clients, v: any = a.visits;
    t += `\n💅 ${esc((a as any).services?.name)} — ${money(a.price)}`;
    t += `\n📅 ${day(a.starts_at)}, ${hm(a.starts_at)}–${hm(a.ends_at)}`;
    t += `\n👩 Майстер: ${esc((a as any).staff?.first_name)}`;
    t += `\n🙋 ${esc(c?.name)}, ${esc(c?.phone)} (${CONTACT[c?.contact] ?? 'дзвінок'}${c?.instagram ? ', @' + esc(c.instagram) : ''})`;
    if (v?.comment) t += `\n💬 ${esc(v.comment)}`;
    if (n.kind === 'cancel' && a.cancel_reason) t += `\nПричина: ${esc(a.cancel_reason)}`;
  }
  const r = await send(s.tg_chat_id, t, [[{ text: 'Відкрити в програмі', url: site(st) + '#/staff/cal/' + (n.day ?? '') }]]);
  return { ok: r.ok };
}

// ---------- нагадування клієнтам ----------
async function remind() {
  const st = await settings();
  const hours: number[] = (st.remind_hours ?? [24, 2]).slice().sort((a: number, b: number) => a - b);
  const now = Date.now();
  const { data: rows } = await db.from('appointments')
    .select('id, visit_id, starts_at, ends_at, reminded, services(name), staff(first_name), clients!inner(name, tg_chat_id), visits(*)')
    .eq('status', 'booked').not('clients.tg_chat_id', 'is', null)
    .gt('starts_at', new Date(now).toISOString()).lt('starts_at', new Date(now + (Math.max(...hours) + 1) * 3600e3).toISOString())
    .order('starts_at');
  // одне нагадування на візит (усі послуги разом), з кнопкою «Так, я буду», поки клієнтка не підтвердила
  const groups = new Map<string, { h: number; items: any[] }>();
  for (const a of rows ?? []) {
    const left = (new Date(a.starts_at).getTime() - now) / 3600e3;
    const h = hours.find((x) => left <= x);
    if (h === undefined || (a.reminded ?? []).includes(h)) continue;
    const k = (a.visit_id ?? a.id) + '|' + h;
    if (!groups.has(k)) groups.set(k, { h, items: [] });
    groups.get(k)!.items.push(a);
  }
  let sent = 0;
  for (const { h, items } of groups.values()) {
    const a: any = items[0], c: any = a.clients, v: any = a.visits ?? {};
    const left = (new Date(a.starts_at).getTime() - now) / 3600e3;
    const when = left <= 3 ? `сьогодні о ${hm(a.starts_at)}` : `${day(a.starts_at)} о ${hm(a.starts_at)}`;
    const masters = [...new Set(items.map((x: any) => x.staff?.first_name).filter(Boolean))].join(', ');
    const svc = items.map((x: any) => `💅 <b>${esc(x.services?.name)}</b>`).join('\n');
    const ask = v.id && !v.confirmed_at;
    const btns: Btn[][] = [];
    if (ask) btns.push([{ text: '✅ Так, я буду', callback_data: 'vc:' + v.id }]);
    btns.push([{ text: 'Перенести / скасувати', url: site(st) + '#/v/' + v.token }]);
    const r = await send(c.tg_chat_id,
      `⏰ ${esc(c.name)}, нагадуємо про запис у ${esc(st.salon_name || 'NaNa studio')}\n${svc}\n📅 ${when}\n👩 Майстер: ${esc(masters)}\n📍 ${esc(st.address || '')}`
      + (ask ? '\n\nБудь ласка, підтвердіть, що прийдете 👇' : ''), btns);
    if (r.ok) { sent++; for (const x of items) await db.from('appointments').update({ reminded: hours.filter((y) => y >= h) }).eq('id', x.id); }
  }
  return { sent };
}

// ---------- налаштування бота ----------
async function setup(b: any) {
  const me = await tg('getMe');
  if (!me.ok) return { error: 'Невірний TG_BOT_TOKEN', me };
  await db.from('settings').update({ tg_bot: me.result.username }).eq('id', 1);
  const out: any = { bot: me.result.username };
  if (b.updates) {
    await tg('deleteWebhook', { drop_pending_updates: false });
    const u = await tg('getUpdates', { timeout: 0, allowed_updates: ['message'] });
    out.chats = [];
    for (const x of u.result ?? []) {
      const m = x.message; if (!m?.chat || m.chat.type !== 'private') continue;
      await db.from('tg_chats').upsert({ chat_id: m.chat.id, first_name: m.from?.first_name ?? null, username: m.from?.username ?? null, last_at: new Date(m.date * 1000).toISOString() });
      out.chats.push({ chat_id: m.chat.id, name: m.from?.first_name, username: m.from?.username, text: m.text });
    }
  }
  if (b.webhook) {
    out.webhook = await tg('setWebhook', { url: `${SB_URL}/functions/v1/tg-bot`, secret_token: await webhookSecret(), allowed_updates: ['message', 'callback_query'] });
    await tg('setMyCommands', { commands: [{ command: 'start', description: 'Почати' }] });
    await tg('setMyShortDescription', { short_description: 'NaNa studio, Львів — онлайн-запис і нагадування про візит' });
    await tg('setMyDescription', { description: 'Бот салону NaNa studio (просп. Свободи, Львів).\nНагадує клієнтам про запис, а майстрам — про нові записи.' });
  }
  return out;
}

async function avatar(url: string) {
  const img = await fetch(url);
  if (!img.ok) return { error: 'logo not found' };
  const fd = new FormData();
  fd.append('photo', JSON.stringify({ type: 'static', photo: 'attach://logo' }));
  fd.append('logo', new Blob([await img.arrayBuffer()], { type: 'image/jpeg' }), 'logo.jpg');
  const r = await fetch(`${API}/setMyProfilePhoto`, { method: 'POST', body: fd });
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } });
  if (req.method !== 'POST') return json({ ok: true });
  const body = await req.json().catch(() => ({}));

  // 1) Telegram
  const tgSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (tgSecret !== null) {
    if (tgSecret !== await webhookSecret()) return json({ error: 'forbidden' }, 403);
    try { await onUpdate(body); } catch (e) { console.error(e); }
    return json({ ok: true });
  }

  // 2) з програми: перевірка сповіщень («Надіслати тест»)
  const auth = req.headers.get('authorization') ?? '';
  if (body.action === 'test' && auth.startsWith('Bearer ')) {
    const { data: u } = await db.auth.getUser(auth.slice(7));
    if (!u?.user) return json({ error: 'Увійдіть у програму' }, 401);
    const { data: s } = await db.from('staff').select('first_name, tg_chat_id').eq('user_id', u.user.id).eq('is_active', true).maybeSingle();
    if (!s?.tg_chat_id) return json({ error: 'Telegram ще не підключено' }, 400);
    const r = await send(s.tg_chat_id, `✅ ${esc(s.first_name)}, сповіщення працюють.`);
    return json({ ok: r.ok }, r.ok ? 200 : 500);
  }

  // 3) з бази даних (тригери, нагадування) і для налаштування — за ключем
  const key = req.headers.get('x-hook-key');
  const { data: sec } = await db.from('app_secrets').select('hook_key').eq('id', 1).single();
  if (!key || !sec || key !== sec.hook_key) return json({ error: 'forbidden' }, 403);
  try {
    switch (body.action) {
      case 'notify': return json(await notify(body.id));
      case 'remind': return json(await remind());
      case 'setup': return json(await setup(body));
      case 'avatar': return json(await avatar(body.url));
      case 'diag': {   // перевірка секрету без показу самого токена
        const raw = Deno.env.get('TG_BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
        return json({ names: Object.keys(Deno.env.toObject()).filter((k) => /TG|TELEGRAM|BOT/i.test(k)), len: raw.length, trimmed: TOKEN.length,
          shape: /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(TOKEN), spaces: /\s/.test(raw) });
      }
      case 'send': {   // довільне повідомлення; buttons — [[{text, url}]] (лише посилання)
        const kb = Array.isArray(body.buttons) ? body.buttons.map((r: any) => (Array.isArray(r) ? r : []).filter((x: any) => x?.text && /^https:\/\//.test(String(x.url ?? ''))).map((x: any) => ({ text: String(x.text).slice(0, 60), url: String(x.url) }))).filter((r: any[]) => r.length) : undefined;
        return json(await send(Number(body.chat_id), String(body.text ?? ''), kb?.length ? kb : undefined));
      }
      case 'weekly_summary': return json(await weeklySummary(String(body.from ?? ''), String(body.to ?? ''), (Array.isArray(body.chats) ? body.chats : []).map(Number).filter(Boolean)));
      case 'monthly_report': return json(await monthlyReport(String(body.from ?? ''), String(body.to ?? ''), (Array.isArray(body.chats) ? body.chats : []).map(Number).filter(Boolean)));
      case 'month_ask': return json(await monthAsk(String(body.staff_id), String(body.month ?? ''), !!body.first));
      case 'close_ask': return json(await closeAsk(String(body.staff_id), String(body.day ?? kDay())));
      default: return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
