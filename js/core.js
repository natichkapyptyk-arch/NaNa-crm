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

/* ---------- тема: світла / темна / як у системі (зберігається на цьому пристрої) ---------- */
const THEMES = { auto: ['🖥', 'Як у системі'], light: ['☀️', 'Світла'], dark: ['🌙', 'Темна'] };
const themeNow = () => { const t = ls.get('theme', 'auto'); return THEMES[t] ? t : 'auto'; };
const _darkMq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(t = themeNow()) {
  const r = document.documentElement; if (t === 'auto') delete r.dataset.theme; else r.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && !!_darkMq?.matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => (m.content = dark ? '#1F1F1D' : '#4E4E4C'));
}
function setTheme(t) { ls.set('theme', t); applyTheme(t); }
_darkMq?.addEventListener?.('change', () => applyTheme());
applyTheme();
function themeSheet(onChange) {
  const s = sheet({ title: 'Тема оформлення', body: `<p class="mut sm" style="margin:0 0 12px">Запамʼятовується на цьому пристрої.</p><div class="chips">${Object.entries(THEMES).map(([k, [ic, n]]) =>
    `<button class="chip ${themeNow() === k ? 'on' : ''}" data-th="${k}" title="Тема: ${n}">${ic} ${n}</button>`).join('')}</div>` });
  $$('[data-th]', s.el).forEach((b) => (b.onclick = () => { setTheme(b.dataset.th); onChange && onChange(b.dataset.th); $$('[data-th]', s.el).forEach((x) => x.classList.toggle('on', x === b)); }));
}

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
  if (/^0\d{9}$/.test(d)) return '+38' + d; if (/^380\d{9}$/.test(d)) return '+' + d;
  if (/^3800\d{9}$/.test(d)) return '+380' + d.slice(4); if (/^80\d{9}$/.test(d)) return '+3' + d; if (/^380/.test(d)) return null; if (d.length >= 10 && d.length <= 15) return '+' + d; return null;
}
// поля телефону (усі type="tel"):
// • при натисканні вже стоїть +380 — далі лише решта цифр; якщо нічого не дописали — поле знову порожнє
// • під час набору пробіли ставляться самі: +380 97 111 22 33
// • червона рамка: забагато цифр — одразу, замало — коли виходиш з поля (і зникає, щойно номер правильний)
const isTel = (el) => !!el?.matches?.('input[type="tel"]');
function phoneTyping(v) {
  const d = v.replace(/\D/g, '');
  if (!/^\+?\s*380/.test(v.trim()) || !/^380/.test(d)) return v;   // інші формати (закордонні, 0XX…) не чіпаємо
  const r = d.slice(3), g = [r.slice(0, 2), r.slice(2, 5), r.slice(5, 7), r.slice(7, 9), r.slice(9)].filter(Boolean);
  return '+380' + (g.length ? ' ' + g.join(' ') : '');
}
function phoneCheck(el, leaving) {
  const d = el.value.replace(/\D/g, ''), ua = /^380/.test(d), empty = !d || d === '380';
  let bad = '';
  if (ua && d.length > 12) bad = 'Забагато цифр: після +380 має бути 9';
  else if (!empty && (leaving || el.dataset.pbad)) bad = ua ? (d.length < 12 ? 'Замало цифр: після +380 має бути 9' : '') : (normPhone(el.value) ? '' : 'Перевірте номер');
  if (bad) { el.classList.add('err'); el.dataset.pbad = '1'; el.title = bad; }
  else if (el.dataset.pbad || (!empty && normPhone(el.value))) { el.classList.remove('err'); delete el.dataset.pbad; el.removeAttribute('title'); }
}
function caretAfterDigits(el, n) { let i = 0, k = 0; const v = el.value; while (i < v.length && k < n) { if (/\d/.test(v[i])) k++; i++; } try { el.setSelectionRange(i, i); } catch (x) { /* деякі браузери */ } }
document.addEventListener('focusin', (e) => { const el = e.target;
  if (!isTel(el) || el.disabled || el.readOnly) return;
  el.value = el.value ? phoneTyping(el.value) : '+380'; el.dataset.pd = el.value.replace(/\D/g, '');
  requestAnimationFrame(() => { try { el.setSelectionRange(el.value.length, el.value.length); } catch (x) { /* деякі браузери */ } }); });
document.addEventListener('input', (e) => { const el = e.target; if (!isTel(el)) return;
  let v = el.value; const pos = el.selectionStart ?? v.length; let before = v.slice(0, pos).replace(/\D/g, '').length;
  const d = v.replace(/\D/g, ''), prev = el.dataset.pd ?? d;
  if ((e.inputType || '').startsWith('delete') && d === prev && d.length) {   // стерли лише пробіл — стираємо й сусідню цифру
    const k = e.inputType === 'deleteContentForward' ? before : before - 1;
    if (k >= 0) { let i = -1, n = -1; while (n < k && ++i < v.length) if (/\d/.test(v[i])) n++; if (n === k) { v = v.slice(0, i) + v.slice(i + 1); if (k < before) before--; } }
  }
  const f = phoneTyping(v);
  if (f !== el.value) { el.value = f; caretAfterDigits(el, before); }
  el.dataset.pd = el.value.replace(/\D/g, '');
  phoneCheck(el, false); });
document.addEventListener('focusout', (e) => { const el = e.target; if (!isTel(el)) return;
  if (/^\+?380$/.test(el.value.replace(/\s/g, ''))) el.value = '';
  phoneCheck(el, true); });
document.addEventListener('paste', (e) => { const el = e.target;
  if (!isTel(el) || el.value.replace(/\s/g, '') !== '+380') return;
  const n = normPhone(e.clipboardData?.getData('text') || ''); if (!n) return;
  e.preventDefault(); el.value = phoneTyping(n); el.dispatchEvent(new Event('input', { bubbles: true })); });
// чи є вже інший клієнт з таким номером: показує попередження з кнопкою (обрати / відкрити картку)
function phoneDupWatch(input, box, { exceptId = null, label, onPick }) {
  let tmr, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(tmr); box.innerHTML = ''; const n = normPhone(input.value); if (!n) return; const my = ++seq;
    tmr = setTimeout(async () => {
      let rq = sb.from('clients').select('id,name,phone,contact,instagram').eq('phone', n).limit(1); if (exceptId) rq = rq.neq('id', exceptId);
      const { data } = await rq; if (my !== seq || !data?.length) return; const x = data[0];
      box.innerHTML = `<div class="dup">⚠️ Цей номер уже є в базі: <b>${esc(x.name)}</b><button type="button" class="btn sm" title="${esc(label)}: ${esc(x.name)}">${esc(label)}</button></div>`;
      $('button', box).onclick = () => onPick(x);
    }, 250);
  });
}
// випадаючий список під полем замість системного (select лишається «джерелом правди»: value, onchange)
function niceSelect(sel) {
  if (!sel || sel._nice) return sel?._nice;
  const wrap = document.createElement('div'); wrap.className = 'nsel';
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); sel.classList.add('nsel-native'); sel.tabIndex = -1;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'inp nsel-btn'; if (sel.id) btn.dataset.for = sel.id;
  const list = document.createElement('div'); list.className = 'nsel-list hide'; list.setAttribute('role', 'listbox');
  wrap.append(btn, list);
  const parts = (t) => { const i = t.indexOf(' — '); return i > 0 ? [t.slice(0, i), t.slice(i + 3)] : [t, '']; };
  const sync = () => { const o = sel.selectedOptions[0]; const [a, b] = parts(o ? o.textContent : '');
    btn.innerHTML = `<span class="nm ${!o || !o.value ? 'ph' : ''}">${esc(a)}</span>${b ? `<span class="sub">${esc(b)}</span>` : ''}<i class="ar">▾</i>`;
    btn.disabled = sel.disabled || !sel.options.length; };
  const close = () => { list.classList.add('hide'); wrap.classList.remove('open'); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const pick = (v) => { sel.value = v; close(); sel.dispatchEvent(new Event('change', { bubbles: true })); btn.focus(); };
  const draw = (q = '') => {
    const ql = q.trim().toLowerCase(), opts = [...sel.options].filter((o) => o.value && (!ql || o.textContent.toLowerCase().includes(ql)));
    const groups = []; opts.forEach((o) => { const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : ''; let G = groups.find((x) => x.g === g); if (!G) groups.push((G = { g, o: [] })); G.o.push(o); });
    const many = [...sel.options].filter((o) => o.value).length > 8;
    list.innerHTML = (many ? `<input class="inp nsel-q" placeholder="Пошук…" value="${esc(q)}">` : '') + (groups.map((G) => (G.g && groups.length > 1 ? `<div class="nsel-g">${esc(G.g)}</div>` : '') + G.o.map((o) => { const [a, b] = parts(o.textContent);
      return `<div class="nsel-o ${o.selected ? 'on' : ''}" role="option" data-v="${esc(o.value)}" title="${esc(o.textContent)}"><span class="nm">${esc(a)}</span>${b ? `<span class="sub">${esc(b)}</span>` : ''}</div>`; }).join('')).join('')
      || `<div class="nsel-e">${esc([...sel.options].find((o) => !o.value)?.textContent || 'Немає варіантів')}</div>`);
    $$('[data-v]', list).forEach((d) => (d.onclick = () => pick(d.dataset.v)));
    const qi = $('.nsel-q', list); if (qi) { qi.oninput = () => { draw(qi.value); const n = $('.nsel-q', list); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }; }
  };
  btn.onclick = () => { if (!list.classList.contains('hide')) return close();
    draw(); list.classList.remove('hide'); wrap.classList.add('open'); document.addEventListener('mousedown', outside, true);
    const on = $('.nsel-o.on', list); if (on) on.scrollIntoView({ block: 'nearest' }); $('.nsel-q', list)?.focus(); };
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.classList.contains('hide')) { e.stopPropagation(); close(); btn.focus(); } }, true);
  // програмна зміна value / списку → оновити кнопку
  for (const k of ['value', 'selectedIndex']) { const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, k);
    Object.defineProperty(sel, k, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } }); }
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sel.addEventListener('change', sync); sync();
  return (sel._nice = { sync, close });
}
// Instagram: з посилання (instagram.com/nick/?igsh=…), «@nick» або «nick» → nick; '' — якщо не схоже на нікнейм
function igNick(v) {
  let s = String(v || '').trim(); const m = s.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/i); if (m) s = m[1];
  s = s.replace(/^@/, '').replace(/[/?#].*$/, ''); return /^[A-Za-z0-9._]{1,30}$/.test(s) && !/^(p|reel|reels|stories|explore)$/i.test(s) ? s : '';
}
const igUrl = (v) => { const n = igNick(v); return n ? 'https://instagram.com/' + n : ''; };
const igDm = (v) => { const n = igNick(v); return n ? 'https://ig.me/m/' + n : ''; };   // одразу відкрити директ
// маленьке посилання-іконка на профіль (у списках, картках)
const igLink = (v, txt = false) => { const u = igUrl(v); return u ? `<a class="ig-l" href="${esc(u)}" target="_blank" rel="noopener" title="Відкрити Instagram @${esc(igNick(v))}" onclick="event.stopPropagation()">${IC.ig}${txt ? `<span>@${esc(igNick(v))}</span>` : ''}</a>` : ''; };
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
  const pref = c.contact === 'instagram' && !c.instagram ? 'call' : c.contact || 'call';   // клієнту так зручніше — кнопка виділена
  const cls = (k) => (k === pref ? 'btn sm pri' : 'btn sm'), tip = (k, t) => esc(t + (k === pref ? ' — клієнту так зручніше' : ''));
  let h = `<a class="${cls('call')}" href="tel:${esc(p)}" title="${tip('call', 'Зателефонувати клієнту')}">${IC.call}<span>Дзвінок</span></a>`;
  h += `<a class="${cls('viber')}" href="viber://chat?number=${encodeURIComponent(p)}" title="${tip('viber', 'Відкрити чат у Viber')}">${IC.vb}<span>Viber</span></a>`;
  h += `<a class="${cls('telegram')}" href="https://t.me/${esc(p)}" target="_blank" rel="noopener" title="${tip('telegram', 'Відкрити чат у Telegram за номером')}">${IC.tg}<span>Telegram</span></a>`;
  if (c.instagram) h += `<a class="${cls('instagram')}" href="${esc(igUrl(c.instagram))}" target="_blank" rel="noopener" title="${tip('instagram', 'Профіль в Instagram')}">${IC.ig}<span>Instagram</span></a>`;
  return `<div class="contact-btns">${h}</div>`;
}
function avatar(p, cls = '') {
  const ini = (x) => (String(x || '').match(/\p{L}/u) || [''])[0];
  const n = (ini(p.first_name || p.name) || '?') + ini(p.last_name);
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

/* ---------- застосунок на телефоні (іконка на головному екрані) ---------- */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Застосунок встановлено — шукайте іконку NaNa на екрані телефона', 'ok', 5000); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
// панель персоналу встановлюється окремим застосунком «NaNa CRM», що відкривається одразу на календарі
function setManifest(staff) { const l = document.getElementById('mf'), h = staff ? 'manifest-staff.webmanifest' : 'manifest.webmanifest'; if (l && l.getAttribute('href') !== h) l.setAttribute('href', h); }
async function installApp(staff = true) {
  if (isStandalone()) return toast('Ви вже в застосунку 🙂');
  if (installEvt) { const e = installEvt; installEvt = null; e.prompt(); await e.userChoice.catch(() => null); return; }
  const what = staff ? 'панель салону' : 'сторінку запису';
  const steps = isIOS()
    ? [`Відкрийте ${what} у <b>Safari</b> (саме цю сторінку).`, 'Натисніть кнопку <b>«Поділитися»</b> — квадрат зі стрілкою вгору внизу екрана.', 'Прогорніть і оберіть <b>«На екран „Додому“»</b>.', 'Натисніть <b>«Додати»</b> — на екрані зʼявиться іконка NaNa.']
    : [`Відкрийте ${what} в <b>Chrome</b> (саме цю сторінку).`, 'Натисніть меню <b>⋮</b> угорі праворуч.', 'Оберіть <b>«Додати на головний екран»</b> або <b>«Установити застосунок»</b>.', 'Підтвердіть — на екрані зʼявиться іконка NaNa.'];
  sheet({ title: 'Встановити на телефон', body: `<p class="mt0">Сайт працюватиме як звичайний застосунок: іконка на екрані, відкривається на весь екран, без адресного рядка${staff ? ', одразу на календарі' : ''}.</p>
    <ol class="inst">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>
    ${staff ? '<div class="hint">Після встановлення один раз увійдіть у застосунку своїм логіном і паролем (або за посиланням швидкого входу).</div>' : ''}` });
}

/* ---------- маршрути ---------- */
function siteBase() { return location.href.replace(/#.*$/, ''); }
// попередня сторінка — щоб кнопка «назад» у картці вела туди, звідки прийшли (календар, персонал…)
let curHash = location.hash, prevHash = '';
function go(h) { if (location.hash === h) route(); else location.hash = h; }
// незбережені зміни: сторінка ставить leaveGuard = { hash, dirty(), save() } — перед переходом спитаємо
let leaveGuard = null;
function leaveBox() {
  return new Promise((res) => {
    const s = sheet({ title: 'Зміни не збережено', body: '<p style="margin:0">Ви змінили дані, але не натиснули «Зберегти». Що зробити?</p>',
      foot: `<button class="btn" data-lv="stay" title="Повернутись до редагування">Залишитись</button><button class="btn red" data-lv="drop" title="Вийти, зміни пропадуть">Не зберігати</button><button class="btn pri" data-lv="save" title="Зберегти зміни й перейти далі">Зберегти й вийти</button>`,
      onClose: () => res(s._v || 'stay') });
    $$('[data-lv]', s.el).forEach((b) => (b.onclick = () => { s._v = b.dataset.lv; s.close(); }));
  });
}
window.addEventListener('beforeunload', (e) => { if (leaveGuard && leaveGuard.dirty()) { e.preventDefault(); e.returnValue = ''; } });
async function route() {
  if (leaveGuard && location.hash !== leaveGuard.hash) {
    const g = leaveGuard;
    if (g.dirty()) {
      const target = location.hash;
      history.replaceState(null, '', g.hash || '#');   // лишаємось на картці, поки не вирішили
      const v = await leaveBox();
      if (v === 'stay' || leaveGuard !== g) return;
      if (v === 'save' && !(await g.save())) return;
      leaveGuard = null; location.hash = target; return;
    }
  }
  leaveGuard = null;
  if (location.hash !== curHash) { prevHash = curHash; curHash = location.hash; }
  hideTip(); while (sheets.length) sheets[sheets.length - 1].close();
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  setManifest(h === 'staff' || h.startsWith('/staff') || h.startsWith('/team/'));
  if (h.startsWith('/v/')) return Client.visit(h.slice(3));
  if (h.startsWith('/team/')) return Staff.quick(h.slice(6));
  if (h.startsWith('/pw/')) return Staff.pwLink(h.slice(4));
  if (h === 'staff' || h.startsWith('/staff')) return Staff.open(h.replace(/^\/?staff\/?/, ''));
  return Client.book();
}
window.addEventListener('hashchange', route);
