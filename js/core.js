'use strict';
/* NaNa studio — спільні помічники: база, час (Київ), вікна, підказки */
const SB_URL = 'https://arkwtpihdaqnwhdcjpqf.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFya3d0cGloZGFxbndoZGNqcHFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3NDQwMzAsImV4cCI6MjEwOTMyMDAzMH0.5Zr3uZYUb00QxkbiQzexuEAfrab4tML8yAkcrpzNguY';
const sb = supabase.createClient(SB_URL, SB_KEY);
const TZ = 'Europe/Kyiv';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const money = (n) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(+n || 0)) + ' ₴';
const num = (n) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(+n || 0);
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
const durTxt = (m) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? h + ' год' + (r ? ' ' + r + ' хв' : '') : r + ' хв'; };
const ls = { get(k, d) { try { const v = localStorage.getItem('nana.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('nana.' + k, JSON.stringify(v)); } catch (e) {} } };

/* ---------- час салону: Europe/Kyiv ---------- */
const _kfmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function kParts(d) {
  const o = {}; _kfmt.formatToParts(d instanceof Date ? d : new Date(d)).forEach((x) => (o[x.type] = x.value));
  return { day: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute, hm: `${o.hour}:${o.minute}` };
}
function kOffset(ms) { const t = Math.floor(ms / 60000) * 60000; const p = kParts(new Date(t)); const [y, m, d] = p.day.split('-').map(Number); return (Date.UTC(y, m - 1, d, 0, p.min) - t) / 60000; }
function kDate(day, min) {   // день (YYYY-MM-DD) + хвилини від 00:00 за Києвом → Date
  const [y, m, d] = day.split('-').map(Number); const g = Date.UTC(y, m - 1, d, 0, min);
  let off = kOffset(g); let t = g - off * 60000; const off2 = kOffset(t); if (off2 !== off) t = g - off2 * 60000; return new Date(t);
}
let clockSkew = 0;     // різниця з часом сервера
const nowMs = () => Date.now() + clockSkew;
const today = () => kParts(new Date(nowMs())).day;
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const isoDow = (day) => { const [y, m, d] = day.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; };
const toMin = (s) => { if (!s) return 0; const [h, m] = String(s).split(':'); return +h * 60 + +m; };
const toHM = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const fmtDay = (day, o = { weekday: 'short', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('uk-UA', { timeZone: 'UTC', ...o }).format(new Date(day + 'T12:00:00Z'));
const fmtT = (iso) => kParts(iso).hm;
const dayOf = (iso) => kParts(iso).day;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const WD = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const WDL = ['', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
function relDay(day) {
  const t = today(); const n = daysBetween(t, day);
  if (n === 0) return 'Сьогодні'; if (n === 1) return 'Завтра'; if (n === -1) return 'Вчора';
  return fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
}
function ageOf(bd) { if (!bd) return null; const t = today(); let a = +t.slice(0, 4) - +bd.slice(0, 4); if (t.slice(5) < bd.slice(5)) a--; return a; }
function sinceTxt(d) {
  if (!d) return ''; const t = today(); let m = (+t.slice(0, 4) - +d.slice(0, 4)) * 12 + (+t.slice(5, 7) - +d.slice(5, 7)); if (+t.slice(8) < +d.slice(8)) m--;
  if (m < 1) return 'менше місяця'; const y = Math.floor(m / 12), r = m % 12;
  return (y ? y + ' ' + plural(y, 'рік', 'роки', 'років') : '') + (y && r ? ' ' : '') + (r ? r + ' міс.' : '');
}

/* ---------- телефон і контакти ---------- */
function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return '+38' + d; if (/^380\d{9}$/.test(d)) return '+' + d; if (d.length >= 10 && d.length <= 15) return '+' + d; return null;
}
function fmtPhone(p) { const m = String(p || '').match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/); return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p || ''; }
const IC = {
  tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.5l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6l19.2-7.4c.9-.3 1.7.2 1.4 1.3z"/></svg>',
  vb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 2C9 2 4.6 2.4 3.1 5.3 2 7.5 2.1 10.8 2.2 12.6c.1 2 .6 5.3 3.2 6.6v2.5c0 .8.9 1.2 1.5.6l2.2-2.3c1 .1 2 .1 2.9 0 2.6-.2 6.7-.8 8.2-3.6 1.1-2.2 1-5.4.9-7.2-.1-2-.6-5.3-3.2-6.6C16.8 2.3 13.8 2 11.4 2zm.2 1.6c2.2 0 4.8.3 6.2 1.1 1.9 1 2.3 3.6 2.4 5.3.1 1.6.2 4.5-.7 6.3-1.1 2.1-4.6 2.6-6.8 2.8-.9.1-2 .1-3-.1l-2.6 2.6v-3c-2.1-.9-2.6-3.6-2.7-5.4-.1-1.6-.2-4.5.7-6.3 1.1-2.2 4.3-3.3 6.5-3.3zM8.3 6.2c-.3 0-.6.1-.9.4-.5.5-1.1 1.2-.8 2.2.6 2 2.4 4.6 4.9 6.3 1.1.7 2.2 1.3 3.1 1.4.8 0 1.5-.6 1.8-1.2.2-.4 0-.8-.3-1l-1.6-1.1c-.4-.3-.9-.2-1.2.2l-.4.5c-.2.2-.5.3-.8.1-1-.6-2.1-1.7-2.7-2.7-.2-.3-.1-.6.1-.8l.5-.4c.4-.3.5-.8.2-1.2L9.1 6.6c-.2-.3-.5-.4-.8-.4zm4.1.1c-.3 0-.3.5 0 .5 2.2.1 3.9 1.8 4 4 0 .3.5.3.5 0-.1-2.5-2-4.4-4.5-4.5zm.2 1.3c-.3 0-.3.5 0 .5 1.3.1 2.3 1.1 2.4 2.4 0 .3.5.3.5 0-.1-1.6-1.4-2.8-2.9-2.9zm.2 1.3c-.3 0-.3.5 0 .5.6 0 1 .5 1.1 1.1 0 .3.5.3.5 0 0-.9-.8-1.6-1.6-1.6z"/></svg>',
  call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.7 2.8 2.4 3 5.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 21h18"/><rect x="5" y="11" width="3.5" height="7" rx="1"/><rect x="10.3" y="6" width="3.5" height="12" rx="1"/><rect x="15.6" y="13" width="3.5" height="5" rx="1"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  out: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
};
const CONTACTS = { telegram: ['Telegram', IC.tg], viber: ['Viber', IC.vb], call: ['Дзвінок', IC.call], instagram: ['Instagram', IC.ig] };
function contactLinks(c) {   // кнопки «зателефонувати / написати»
  const p = String(c.phone || '').replace(/[^\d+]/g, '');
  let h = `<a class="btn sm" href="tel:${esc(p)}" title="Зателефонувати клієнту">${IC.call}<span>Дзвінок</span></a>`;
  h += `<a class="btn sm" href="viber://chat?number=${encodeURIComponent(p)}" title="Відкрити чат у Viber">${IC.vb}<span>Viber</span></a>`;
  h += `<a class="btn sm" href="https://t.me/${esc(p)}" target="_blank" rel="noopener" title="Відкрити чат у Telegram за номером">${IC.tg}<span>Telegram</span></a>`;
  if (c.instagram) h += `<a class="btn sm" href="https://instagram.com/${encodeURIComponent(String(c.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener" title="Профіль в Instagram">${IC.ig}<span>Instagram</span></a>`;
  return `<div class="contact-btns">${h}</div>`;
}
function avatar(p, cls = '') {
  const n = ((p.first_name || p.name || '?').trim()[0] || '?') + ((p.last_name || '').trim()[0] || '');
  return p.photo_url ? `<img class="ava ${cls}" src="${esc(p.photo_url)}" alt="" loading="lazy">` : `<span class="ava ${cls}">${esc(n.toUpperCase())}</span>`;
}
const fullName = (s) => [s.first_name, s.last_name].filter(Boolean).join(' ');
const STATUS = { booked: 'Записано', done: 'Завершено', cancel: 'Скасовано', noshow: 'Не прийшов(ла)' };
const ROLE = { owner: 'Власниця', admin: 'Адміністратор', master: 'Майстер' };

/* ---------- сповіщення внизу ---------- */
function toast(msg, kind = 'ok', ms = 3200) {
  let w = $('#toasts'); if (!w) { w = document.createElement('div'); w.id = 'toasts'; document.body.appendChild(w); }
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = `<span>${esc(msg)}</span>`; w.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}
const errMsg = (e) => { const m = (e && (e.message || e.error_description || e.error)) || String(e || 'Помилка');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Немає звʼязку з сервером. Перевірте інтернет і спробуйте ще раз.';
  if (/JWT|expired/i.test(m)) return 'Сесія завершилась — увійдіть ще раз.';
  if (/permission denied|row-level security/i.test(m)) return 'Недостатньо прав для цієї дії.';
  return m.replace(/^CHECK:/, ''); };

/* ---------- вікна ---------- */
const sheets = [];
function sheet({ title = '', body = '', foot = '', wide = false, onClose = null }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="grab"></div>
    <div class="sh-h"><h2>${title}</h2><button class="btn ghost ico sm" data-x title="Закрити вікно (Esc)">${IC.x}</button></div>
    <div class="sh-b">${body}</div>${foot ? `<div class="sh-f">${foot}</div>` : ''}</div>`;
  document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  const api = { el: ov.firstElementChild, ov, close() {
    if (!ov.isConnected) return; ov.remove(); sheets.splice(sheets.indexOf(api), 1);
    if (!sheets.length) document.body.style.overflow = ''; hideTip(); onClose && onClose(); } };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) api._down = true; });
  ov.addEventListener('click', (e) => { if (e.target === ov && api._down) api.close(); api._down = false; });
  $('[data-x]', ov).onclick = api.close;
  sheets.push(api);
  setTimeout(() => { const f = $('.sh-b [autofocus]', ov); if (f && matchMedia('(min-width:760px)').matches) f.focus(); }, 60);
  return api;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close(); });
function confirmBox(text, { ok = 'Так', cancel = 'Скасувати', danger = false, sub = '' } = {}) {
  return new Promise((res) => {
    let done = false;
    const s = sheet({ title: esc(text), body: sub ? `<p class="mut" style="margin:0">${sub}</p>` : '<p class="mut" style="margin:0">Підтвердіть дію.</p>',
      foot: `<button class="btn" data-c title="Нічого не змінювати">${esc(cancel)}</button><button class="btn ${danger ? 'red' : 'pri'}" data-o title="Підтвердити">${esc(ok)}</button>`,
      onClose: () => { if (!done) res(false); } });
    $('[data-c]', s.el).onclick = () => s.close();
    $('[data-o]', s.el).onclick = () => { done = true; s.close(); res(true); };
  });
}
async function busy(btn, fn) {   // кнопка «крутиться», поки йде запит
  if (btn && btn.disabled) return; const h = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span style="opacity:.7">Зачекайте…</span>'; }
  try { return await fn(); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = h; } }
}

/* ---------- підказки при наведенні (і довгим натиском на телефоні) ---------- */
let tipEl, tipFor, tipTimer;
function showTip(el) {
  const t = el.dataset.tip; if (!t) return;
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'tip'; document.body.appendChild(tipEl); }
  tipEl.textContent = t; tipFor = el; tipEl.classList.add('on');
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(x, innerWidth - w - 8));
  let y = r.top - h - 8; if (y < 6) y = r.bottom + 8;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
function hideTip() { if (tipEl) tipEl.classList.remove('on'); tipFor = null; clearTimeout(tipTimer); }
function prepTip(el) { if (el.title) { el.dataset.tip = el.title; if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.title); el.removeAttribute('title'); } }
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[title],[data-tip]'); if (!el) { if (tipFor) hideTip(); return; }
  prepTip(el); if (tipFor === el) return; clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(el), 280);
});
document.addEventListener('mouseout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); else if (!e.relatedTarget) hideTip(); });
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest('[title],[data-tip]'); if (!el) return; prepTip(el);
  clearTimeout(tipTimer); tipTimer = setTimeout(() => { showTip(el); setTimeout(hideTip, 2200); }, 550);
}, { passive: true });
document.addEventListener('touchend', () => clearTimeout(tipTimer), { passive: true });
document.addEventListener('scroll', hideTip, true);
document.addEventListener('click', () => setTimeout(hideTip, 10));

/* ---------- QR-код (бібліотека вантажиться лише коли потрібна) ---------- */
let _qrLib;
function loadQr() {
  if (window.qrcode) return Promise.resolve();
  return _qrLib ||= new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
}
async function qrSvg(text, cell = 6) { await loadQr(); const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true }); }

/* ---------- маршрути ---------- */
function siteBase() { return location.href.replace(/#.*$/, ''); }
function go(h) { if (location.hash === h) route(); else location.hash = h; }
async function route() {
  hideTip(); while (sheets.length) sheets[sheets.length - 1].close();
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.startsWith('/v/')) return Client.visit(h.slice(3));
  if (h.startsWith('/team/')) return Staff.quick(h.slice(6));
  if (h === 'staff' || h.startsWith('/staff')) return Staff.open(h.replace(/^\/?staff\/?/, ''));
  return Client.book();
}
window.addEventListener('hashchange', route);
