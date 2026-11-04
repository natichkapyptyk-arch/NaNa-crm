'use strict';
/* NaNa studio — онлайн-запис для клієнтів і сторінка «Мій запис» */
const Client = (() => {
  let C = null, B = null;               // каталог і зайнятість
  const st = { step: 'masters', cat: '', mid: null, sid: null, day: null, cart: [], edit: -1, done: null };
  let cartK = 0;   // унікальний ключ позиції кошика (для «додатково» до основної послуги)
  const app = () => $('#app');

  /* ---------- дані ---------- */
  async function load(force) {
    if (C && !force) return;
    const { data, error } = await sb.rpc('pub_catalog');
    if (error) throw error;
    C = data; clockSkew = Date.parse(data.now) - Date.now();
    C.svc = new Map(C.services.map((s) => [s.id, s]));
    C.mas = new Map(C.masters.map((m) => [m.id, m]));
    const raw = data.ms; C.ms_raw = raw;
    C.ms = new Map();                    // майстер → (послуга → {dur, price})
    for (const x of raw) { if (!C.ms.has(x.staff_id)) C.ms.set(x.staff_id, new Map()); C.ms.get(x.staff_id).set(x.service_id, x); }
    C.cats = [...new Set(C.services.filter((s) => raw.some((x) => x.service_id === s.id)).map((s) => s.category))];
    await loadBusy();
  }
  async function loadBusy() {
    const t = today();
    const { data, error } = await sb.rpc('pub_busy', { p_from: t, p_to: addDays(t, C.settings.max_days + 1) });
    if (error) throw error;
    B = { busy: new Map(), blocks: new Map(), over: new Map(), base: new Map() };
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    data.busy.forEach((x) => push(B.busy, x.m, [Date.parse(x.s), Date.parse(x.e)]));
    data.blocks.forEach((x) => push(B.blocks, x.m, [Date.parse(x.s), Date.parse(x.e)]));
    data.over.forEach((x) => B.over.set(x.m + '|' + x.d, x));
  }
  const dayBase = (day) => { let b = B.base.get(day); if (b == null) { b = kDate(day, 720).getTime() - 720 * 6e4; B.base.set(day, b); } return b; };
  function hoursOf(mid, day) {
    const o = B.over.get(mid + '|' + day); if (o) return o.off ? null : [toMin(o.s), toMin(o.e)];
    const h = C.hours.find((x) => x.m === mid && x.w === isoDow(day)); return h ? [toMin(h.s), toMin(h.e)] : null;
  }
  // вільні початки (хв від 00:00) для майстра, тривалості і дня
  function slots(mid, dur, day, opt = {}) {
    const hh = hoursOf(mid, day); if (!hh) return [];
    const s = C.settings, step = s.step_min, buf = s.buffer_min * 6e4, last = toMin(s.last_start);
    const lead = nowMs() + s.lead_min * 6e4, maxT = nowMs() + s.max_days * 864e5, base = dayBase(day);
    const skip = opt.skip || [];
    const bz = (B.busy.get(mid) || []).filter((x) => !skip.some((y) => y[0] === x[0] && y[1] === x[1]));
    const bl = B.blocks.get(mid) || [];
    const ig = opt.ignore ?? -1, igK = st.cart[ig]?.k;
    const mine = st.cart.filter((x, i) => i !== ig && !(igK && x.of === igK)).map((x) => [x.s, x.e]).concat(opt.extra || []);
    const out = [];
    for (let m = hh[0]; m + dur <= hh[1] && m <= last; m += step) {
      const a = base + m * 6e4, b = a + dur * 6e4;
      if (a < lead || a > maxT) continue;
      if (bz.some(([x, y]) => x < b + buf && y > a - buf)) continue;
      if (bl.some(([x, y]) => x < b && y > a)) continue;
      if (mine.some(([x, y]) => x < b && y > a)) continue;
      out.push(m);
    }
    return out;
  }
  const masterServices = (mid) => [...(C.ms.get(mid) || new Map()).values()].filter((x) => C.svc.has(x.service_id));
  function nearDays(mid, n = 5, cat = '') {
    const list = masterServices(mid).filter((x) => !cat || C.svc.get(x.service_id).category === cat);
    if (!list.length) return [];
    const dur = Math.min(...list.map((x) => x.dur)); const out = []; const t = today();
    for (let i = 0; i <= C.settings.max_days && out.length < n; i++) { const d = addDays(t, i); if (slots(mid, dur, d).length) out.push(d); }
    return out;
  }
  const cartTotal = () => st.cart.reduce((a, x) => a + +x.price, 0);
  // ціна «від» (кінцева залежить від роботи): у майстрині, а якщо база ще стара — у послуги
  const isFrom = (sid, mid) => { const x = mid && C.ms.get(mid)?.get(sid); return x && 'price_from' in x ? !!x.price_from : !!C.svc.get(sid)?.price_from; };
  const fromTxt = (sid, mid) => (isFrom(sid, mid) ? 'від ' : '');
  const cartFrom = () => (st.cart.some((x) => isFrom(x.sid, x.mid)) ? 'від ' : '');
  const cartDur = () => st.cart.reduce((a, x) => a + x.dur, 0);

  /* ---------- шапка ---------- */
  function hero(small) {
    const s = C.settings; const ph = String(s.phone || '').replace(/[^\d+]/g, '');
    return `<header class="cl-hero"${small ? ' style="padding-bottom:16px"' : ''}>
      <a href="#" title="На головну — онлайн-запис"><img class="logo" src="img/logo.png" alt="${esc(s.salon_name)}"${small ? ' style="height:64px"' : ''}></a>
      <div class="meta">
        ${s.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.salon_name + ' ' + s.address)}" target="_blank" rel="noopener" title="Відкрити адресу на мапі">${IC.pin}${esc(s.address)}</a>` : ''}
        ${ph ? `<a href="tel:${esc(ph)}" title="Зателефонувати в салон">${IC.call.replace('<svg', '<svg width="15" height="15"')}${esc(fmtPhone(ph))}</a>` : ''}
        ${s.instagram ? `<a href="https://instagram.com/${encodeURIComponent(s.instagram)}" target="_blank" rel="noopener" title="Instagram салону — роботи майстрів">${IC.ig.replace('<svg', '<svg width="15" height="15"')}@${esc(s.instagram)}</a>` : ''}
      </div>${small ? '' : '<div class="tag">твій банановий бюті простір 🍌</div>'}</header>`;
  }
  function stepsBar() {
    const order = ['pick', 'cart', 'contacts', 'done'];
    const cur = ['masters', 'services', 'time'].includes(st.step) ? 'pick' : st.step;
    const i = order.indexOf(cur);
    return `<div class="steps" title="Крок ${i + 1} з 4">${order.map((_, k) => `<span class="${k < i ? 'on' : k === i ? 'cur' : ''}"></span>`).join('')}</div>`;
  }
  function bottomBar() {
    if (!st.cart.length || ['cart', 'contacts', 'done'].includes(st.step)) return '';
    // коли візит: день і час від першої до останньої послуги — щоб було видно, на який час додавати ще послугу
    const iso = (ms) => new Date(ms).toISOString(), s0 = Math.min(...st.cart.map((x) => x.s)), e0 = Math.max(...st.cart.map((x) => x.e));
    const d0 = dayOf(iso(s0)), d1 = dayOf(iso(e0 - 1));
    const when = d0 === d1 ? `${fmtDay(d0, { weekday: 'short', day: 'numeric', month: 'long' })}, ${fmtT(iso(s0))}–${fmtT(iso(e0))}`
      : `${fmtDay(d0, { day: 'numeric', month: 'short' })} ${fmtT(iso(s0))} – ${fmtDay(d1, { day: 'numeric', month: 'short' })} ${fmtT(iso(e0))}`;
    return `<div class="bbar"><div class="in"><div class="sum"><div class="bb-when" title="Дата й час вашого візиту">📅 ${esc(when)}</div><div class="sm mut">${st.cart.length} ${plural(st.cart.length, 'послуга', 'послуги', 'послуг')} · ${durTxt(cartDur())} · <b class="bb-sum">${cartFrom()}${money(cartTotal())}</b></div></div>
      <button class="btn pri lg" data-go="cart" title="Переглянути вибрані послуги й перейти до оформлення">Оформити ${IC.fwd}</button></div></div>`;
  }
  function myVisitsCard() {
    const v = (ls.get('visits', []) || []).filter((x) => x.until > nowMs());
    if (!v.length || st.step !== 'masters') return '';
    return `<div class="card mb" style="padding:14px 16px"><div class="row sp wrap"><div><b>Ваші записи</b><div class="sm mut">Перенести або скасувати</div></div>
      <div class="row wrap">${v.slice(-3).map((x) => `<a class="btn sm" href="#/v/${x.token}" title="Відкрити запис: ${esc(x.title)}">${esc(x.title)}</a>`).join('')}</div></div></div>`;
  }

  /* ---------- кроки ---------- */
  function vMasters() {
    const ms = C.masters.filter((m) => masterServices(m.id).some((x) => !st.cat || C.svc.get(x.service_id).category === st.cat));
    const cats = `<div class="chips scroll mb"><button class="chip ${!st.cat ? 'on' : ''}" data-cat="" title="Показати всіх майстрів">Усі</button>${C.cats.map((c) =>
      `<button class="chip ${st.cat === c ? 'on' : ''}" data-cat="${esc(c)}" title="Майстри, які роблять: ${esc(c.toLowerCase())}">${esc(c)}</button>`).join('')}</div>`;
    const cards = ms.map((m) => {
      const list = masterServices(m.id).filter((x) => !st.cat || C.svc.get(x.service_id).category === st.cat);
      const from = Math.min(...list.map((x) => +x.price)); const days = nearDays(m.id, 5, st.cat);
      const cats = [...new Set(list.map((x) => C.svc.get(x.service_id).category))].join(' · ');
      return `<div class="m-card" data-m="${m.id}" title="Обрати майстра ${esc(m.first_name)} і подивитись послуги">
        ${avatar(m, 'l')}<div class="grow"><div class="nm">${esc(fullName(m))}</div><div class="rl">${esc(m.experience || cats)}</div>
        ${m.bio ? `<div class="bio">${esc(m.bio)}</div>` : ''}
        <div class="from">${esc(cats)} · від ${money(from)}</div>
        <div class="days">${days.length ? days.map((d) => `<span class="dchip" data-m="${m.id}" data-day="${d}" title="Найближчий вільний день: ${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}"><span>${esc(relDay(d).split(',')[0])}</span><b>${+d.slice(8)}</b></span>`).join('')
          : '<span class="dchip none">Немає вільного часу</span>'}</div></div></div>`;
    }).join('');
    return `${stepsBar()}<div class="st-title"><h2>${st.cart.length ? 'Додайте ще послугу' : 'Оберіть майстра'}</h2></div>${cats}
      ${cards || '<div class="empty"><div class="big">🍌</div>Поки немає майстрів для онлайн-запису. Зателефонуйте нам, будь ласка.</div>'}`;
  }
  function vServices() {
    const m = C.mas.get(st.mid); if (!m) { st.step = 'masters'; return vMasters(); }
    const list = masterServices(m.id).map((x) => ({ ...C.svc.get(x.service_id), dur: x.dur, price: x.price }));
    const cats = [...new Set(list.map((s) => s.category))];
    const shown = st.cat && cats.includes(st.cat) ? [st.cat] : cats;
    const rows = shown.map((c) => `<div class="s-cat">${esc(c)}</div>` + list.filter((s) => s.category === c).sort((a, b) => a.sort - b.sort).map((s, i, arr) => {
      const sub = s.subgroup && s.subgroup !== arr[i - 1]?.subgroup ? `<div class="s-sub">${esc(s.subgroup)}${s.is_addon ? ' <span>· додається до основної послуги</span>' : ''}</div>` : '';
      const inCart = st.cart.some((x) => x.sid === s.id && x.mid === m.id);
      const ph = (s.photos || [])[0];
      return sub + `<div class="s-row ${inCart ? 'inCart' : ''} ${s.is_addon ? 'addon' : ''}" data-s="${s.id}" title="${s.is_addon ? `Додати «${esc(s.name)}» до основної послуги` : `Обрати «${esc(s.name)}» і подивитись вільний час`}">
        ${ph ? `<button class="s-ph" data-gal="${s.id}" title="Подивитись фото робіт (${s.photos.length})"><img src="${esc(ph)}" alt="" loading="lazy">${s.photos.length > 1 ? `<span>${s.photos.length}</span>` : ''}</button>` : ''}
        <div class="grow"><div class="nm">${s.is_addon ? '<span class="add-plus">+</span> ' : ''}${esc(s.name)}${inCart ? ' <span class="pill booked">у візиті</span>' : ''}</div>${s.descr ? `<div class="ds">${esc(s.descr)}</div>` : ''}</div>
        <div class="pr">${fromTxt(s.id, m.id)}${money(s.price)}<small>${durTxt(s.dur)}</small></div></div>`;
    }).join('')).join('');
    return `${stepsBar()}<div class="st-title"><button class="btn ghost ico" data-back="masters" title="Назад — до вибору майстра">${IC.back}</button>
      ${avatar(m, 's')}<h2>${esc(m.first_name)}: послуги</h2></div>
      ${cats.length > 1 ? `<div class="chips scroll mb"><button class="chip ${!st.cat || !cats.includes(st.cat) ? 'on' : ''}" data-cat2="" title="Усі послуги майстра">Усі</button>${cats.map((c) => `<button class="chip ${st.cat === c ? 'on' : ''}" data-cat2="${esc(c)}" title="Лише ${esc(c.toLowerCase())}">${esc(c)}</button>`).join('')}</div>` : ''}
      ${rows}`;
  }
  function vTime() {
    const m = C.mas.get(st.mid), s = C.svc.get(st.sid), x = C.ms.get(st.mid)?.get(st.sid);
    if (!m || !s || !x) { st.step = 'masters'; return vMasters(); }
    const t = today(), days = [];
    const addDur = st.edit >= 0 ? addonsOf(st.cart[st.edit].k).reduce((t2, a) => t2 + a.dur, 0) : 0;   // основна + її «додатково» мають вміститись разом
    for (let i = 0; i <= C.settings.max_days; i++) { const d = addDays(t, i); days.push([d, slots(m.id, x.dur + addDur, d, { ignore: st.edit }).length]); }
    if (!st.day || !days.find((d) => d[0] === st.day && d[1])) st.day = (days.find((d) => d[1]) || [])[0] || null;
    const strip = days.map(([d, n]) => `<button class="dpill ${d === st.day ? 'on' : ''} ${n ? '' : 'off'}" ${n ? `data-day="${d}"` : 'disabled'} title="${n ? esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' })) + ': вільних віконець — ' + n : 'Немає вільного часу'}">
      <div class="w">${WD[isoDow(d)]}</div><div class="d">${+d.slice(8)}</div><div class="m">${esc(fmtDay(d, { month: 'short' }).replace('.', ''))}</div></button>`).join('');
    let body = '';
    if (!st.day) body = '<div class="empty"><div class="big">🗓</div>У найближчі дні вільного часу немає. Спробуйте іншого майстра або зателефонуйте нам.</div>';
    else {
      const sl = slots(m.id, x.dur + addDur, st.day, { ignore: st.edit });
      const g = [['Ранок', sl.filter((v) => v < 720)], ['День', sl.filter((v) => v >= 720 && v < 1020)], ['Вечір', sl.filter((v) => v >= 1020)]];
      body = `<div class="sm mut" style="margin:2px 0 4px"><b style="color:var(--ink)">${esc(fmtDay(st.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</b></div>` +
        g.filter((v) => v[1].length).map(([n, v]) => `<div class="slots-h">${n}</div><div class="slots">${v.map((mm) => `<button class="slot" data-t="${mm}" title="Записатися на ${toHM(mm)}–${toHM(mm + x.dur)}">${toHM(mm)}</button>`).join('')}</div>`).join('');
    }
    return `${stepsBar()}<div class="st-title"><button class="btn ghost ico" data-back="services" title="Назад — до послуг">${IC.back}</button><h2>Оберіть день і час</h2></div>
      <div class="s-row inCart" style="cursor:default">${(s.photos || [])[0] ? `<button class="s-ph" data-gal="${s.id}" title="Подивитись фото робіт"><img src="${esc(s.photos[0])}" alt=""></button>` : ''}<div class="grow"><div class="nm">${esc(s.name)}</div><div class="ds">Майстер: ${esc(fullName(m))}</div></div><div class="pr">${money(x.price)}<small>${durTxt(x.dur)}</small></div></div>
      <div class="dstrip" id="dstrip">${strip}</div>${body}`;
  }
  function vCart() {
    if (!st.cart.length) { st.step = 'masters'; return vMasters(); }
    st.cart.sort((a, b) => a.s - b.s);
    const days = new Set(st.cart.map((x) => dayOf(x.s)));
    const items = st.cart.map((x, i) => { const s = C.svc.get(x.sid), m = C.mas.get(x.mid);
      if (x.of) return `<div class="cart-item sub"><div class="grow"><div class="b">+ ${esc(s.name)}</div><div class="sm mut">${fmtT(x.s)}–${fmtT(x.e)} · одразу після основної послуги</div>
        <div class="row" style="margin-top:6px;gap:6px"><button class="btn sm red" data-del="${i}" title="Прибрати">Прибрати</button></div></div><div class="b nw">${fromTxt(x.sid, x.mid)}${money(x.price)}</div></div>`;
      const ads = addonsFor(x);
      return `<div class="cart-item">${avatar(m, 's')}<div class="grow"><div class="b">${esc(s.name)}</div>
        <div class="sm mut">${esc(relDay(dayOf(x.s)))}, ${fmtT(x.s)}–${fmtT(x.e)} · ${esc(m.first_name)}</div>
        ${ads.length ? `<div class="add-ons"><span class="sm mut">Додати:</span>${ads.map((a) => `<button class="chip" data-addon="${a.service_id}" data-of="${x.k}" title="Додати «${esc(C.svc.get(a.service_id).name)}» одразу після цієї послуги">+ ${esc(C.svc.get(a.service_id).name)} · ${fromTxt(a.service_id, x.mid)}${money(a.price)}</button>`).join('')}</div>` : ''}
        <div class="row" style="margin-top:6px;gap:6px"><button class="btn sm" data-edit="${i}" title="Обрати інший день або час для цієї послуги">Змінити час</button>
        <button class="btn sm red" data-del="${i}" title="Прибрати послугу з візиту">Прибрати</button></div></div><div class="b nw">${fromTxt(x.sid, x.mid)}${money(x.price)}</div></div>`; }).join('');
    const span = days.size === 1 ? `${fmtT(st.cart[0].s)}–${fmtT(Math.max(...st.cart.map((x) => x.e)))}` : `${days.size} ${plural(days.size, 'день', 'дні', 'днів')}`;
    return `${stepsBar()}<div class="st-title"><h2>Ваш візит</h2></div>
      <div class="card">${items}<div class="cart-tot"><span>Разом <span class="sm mut" style="font-weight:600">· ${durTxt(cartDur())} · ${esc(span)}</span></span><span>${cartFrom()}${money(cartTotal())}</span></div></div>
      <div class="col mt"><button class="btn lg" data-go="masters" title="Додати до візиту ще одну послугу — у цього або іншого майстра">${IC.plus} Додати ще послугу</button>
      <button class="btn pri lg" data-go="contacts" title="Перейти до введення імені й телефону">Далі — контакти ${IC.fwd}</button></div>`;
  }
  function vContacts() {
    if (!st.cart.length) { st.step = 'masters'; return vMasters(); }
    const me = ls.get('me', {}) || {};
    const opts = Object.entries(CONTACTS).map(([k, [n, ic]]) => `<button type="button" class="cm ${me.contact === k ? 'on' : ''}" data-cm="${k}" title="Звʼязатися зі мною через ${n}">${ic}${n}</button>`).join('');
    return `${stepsBar()}<div class="st-title"><button class="btn ghost ico" data-back="cart" title="Назад — до візиту">${IC.back}</button><h2>Ваші контакти</h2></div>
      <form class="card" id="cf" novalidate>
        <label class="lb" for="f-n">Імʼя <span class="req">*</span></label><input class="inp" id="f-n" autocomplete="given-name" value="${esc(me.name || '')}" placeholder="Як до вас звертатись" maxlength="60">
        <label class="lb" for="f-p">Номер телефону <span class="req">*</span></label><input class="inp" id="f-p" type="tel" inputmode="tel" autocomplete="tel" value="${esc(me.phone || '')}" placeholder="+380 __ ___ __ __" maxlength="20">
        <label class="lb">Як з вами звʼязатись <span class="req">*</span></label><div class="cm-opts" id="f-c">${opts}</div>
        <div id="f-ig-w" class="${me.contact === 'instagram' ? '' : 'hide'}"><label class="lb" for="f-ig">Ваш нік в Instagram</label><input class="inp" id="f-ig" value="${esc(me.instagram || '')}" placeholder="@nickname" maxlength="40"></div>
        <label class="lb" for="f-cm">Коментар <span class="mut" style="font-weight:600">(необовʼязково)</span></label><textarea class="inp" id="f-cm" rows="2" maxlength="300" placeholder="Побажання майстру, алергії тощо"></textarea>
        <div class="errtxt hide" id="f-err"></div>
        <div class="cart-tot"><span>${st.cart.length} ${plural(st.cart.length, 'послуга', 'послуги', 'послуг')}</span><span>${cartFrom()}${money(cartTotal())}</span></div>
        <button class="btn pri lg wide mt" id="f-go" title="Підтвердити запис (Ctrl/⌘+Enter)">Записатися · ${cartFrom()}${money(cartTotal())}</button>
        <div class="hint" style="text-align:center">Оплата в салоні після послуги. Скасувати чи перенести можна онлайн не пізніше ніж за ${C.settings.cancel_hours} год.</div>
      </form>`;
  }
  function vDone() {
    const d = st.done; if (!d) { st.step = 'masters'; return vMasters(); }
    const tg = C.settings.tg_bot;
    return `${stepsBar()}<div class="card" style="text-align:center"><div class="done-ico">✓</div><h2 style="margin:0">Ви записані, ${esc(d.name)}!</h2>
      <p class="mut" style="margin:6px 0 14px">Чекаємо вас у ${esc(C.settings.salon_name)} 💛</p>
      <div style="text-align:left">${d.items.map((x) => `<div class="cart-item"><div class="grow"><div class="b">${esc(x.service)}</div><div class="sm mut">${esc(fmtDay(dayOf(x.s), { weekday: 'long', day: 'numeric', month: 'long' }))}, ${fmtT(x.s)}–${fmtT(x.e)} · ${esc(x.master)}</div></div><div class="b">${money(x.price)}</div></div>`).join('')}
      <div class="cart-tot"><span>Разом</span><span>${money(d.total)}</span></div></div>
      <div class="col mt">
        ${tg ? `<a class="btn pri lg" href="https://t.me/${esc(tg)}?start=v_${d.token}" target="_blank" rel="noopener" title="Бот нагадає про візит за добу і за 2 години">${IC.tg} Нагадування в Telegram</a>` : ''}
        <button class="btn lg" id="ics" title="Завантажити подію для календаря телефону">${IC.cal} Додати в календар</button>
        <a class="btn lg" href="#/v/${d.token}" title="Тут можна перенести або скасувати запис">Мій запис — перенести / скасувати</a>
        <button class="btn ghost" data-new title="Почати новий запис">Записатися ще</button></div>
      <p class="hint">Збережіть посилання «Мій запис» — воно знадобиться, щоб змінити час.</p></div>`;
  }

  /* ---------- малювання ---------- */
  function render() {
    const v = { masters: vMasters, services: vServices, time: vTime, cart: vCart, contacts: vContacts, done: vDone }[st.step] || vMasters;
    app().innerHTML = `<div class="cl-wrap">${hero(st.step !== 'masters')}${myVisitsCard()}${v()}</div>${bottomBar()}`;
    bind();
    const on = $('.dpill.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  /* ---------- «додатково» до основної послуги: одразу після неї, без перерви ---------- */
  const isAddon = (sid) => !!C.svc.get(sid)?.is_addon;
  const addonsOf = (k) => st.cart.filter((x) => x.of === k).sort((a, b) => a.s - b.s);
  // чи вільний проміжок [a, b) у майстра: графік дня, чужі записи (з перервою), закритий час, інші послуги кошика
  function fits(mid, a, b, skipKeys = []) {
    const day = dayOf(new Date(a).toISOString()), hh = hoursOf(mid, day); if (!hh) return false;
    const base = dayBase(day); if (a < base + hh[0] * 6e4 || b > base + hh[1] * 6e4) return false;
    const buf = C.settings.buffer_min * 6e4;
    if ((B.busy.get(mid) || []).some(([x, y]) => x < b + buf && y > a - buf)) return false;
    if ((B.blocks.get(mid) || []).some(([x, y]) => x < b && y > a)) return false;
    return !st.cart.some((x) => !skipKeys.includes(x.k) && x.s < b && x.e > a);
  }
  // переставити «додатково» одразу за основною (після зміни часу чи видалення); що не вміщається — прибрати
  function rechain(k) {
    const p = st.cart.find((x) => x.k === k); if (!p) { st.cart = st.cart.filter((x) => x.of !== k); return; }
    let t = p.e; const gone = [];
    for (const a of addonsOf(k)) { a.s = t; a.e = t + a.dur * 6e4;
      if (!fits(a.mid, a.s, a.e, [a.k, ...addonsOf(k).map((x) => x.k)])) gone.push(a); else t = a.e; }
    if (gone.length) { st.cart = st.cart.filter((x) => !gone.includes(x)); toast('Не вмістилось після основної послуги: ' + gone.map((x) => C.svc.get(x.sid).name).join(', '), 'bad', 5000); }
  }
  function addAddon(k, sid) {
    const p = st.cart.find((x) => x.k === k); const x = C.ms.get(p.mid)?.get(sid); if (!p || !x) return;
    if (addonsOf(k).some((a) => a.sid === sid)) return toast('Вже додано', 'bad');
    const s = addonsOf(k).reduce((t, a) => Math.max(t, a.e), p.e), e = s + x.dur * 6e4;
    if (!fits(p.mid, s, e, [])) return toast('Після цієї послуги в майстра немає часу на «' + C.svc.get(sid).name + '». Оберіть інший час основної послуги.', 'bad', 5000);
    st.cart.push({ k: ++cartK, of: k, mid: p.mid, sid, s, e, dur: x.dur, price: +x.price });
    toast('Додано: ' + C.svc.get(sid).name); render();
  }
  // «додатково», які майстер робить у категорії основної послуги
  const addonsFor = (p) => masterServices(p.mid).filter((x) => isAddon(x.service_id) && C.svc.get(x.service_id).category === C.svc.get(p.sid).category && !addonsOf(p.k).some((a) => a.sid === x.service_id));
  function goStep(s) { st.step = s; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
  function bind() {
    const a = app();
    $$('[data-cat]', a).forEach((b) => (b.onclick = () => { st.cat = b.dataset.cat; render(); }));
    $$('[data-cat2]', a).forEach((b) => (b.onclick = () => { st.cat = b.dataset.cat2; render(); }));
    $$('.m-card', a).forEach((c) => (c.onclick = (e) => { const d = e.target.closest('[data-day]'); st.mid = c.dataset.m; st.day = d ? d.dataset.day : null; st.edit = -1; goStep('services'); }));
    const pickSvc = (sid) => {
      if (isAddon(sid)) {   // «додатково» — до останньої основної послуги цього майстра в кошику
        const main = st.cart.filter((x) => !x.of && x.mid === st.mid && C.svc.get(x.sid).category === C.svc.get(sid).category).sort((p, q) => q.s - p.s)[0];
        if (!main) return toast('Це додаткова послуга — спершу оберіть основну (наприклад, манікюр), а потім додайте її одним дотиком', 'bad', 5000);
        return addAddon(main.k, sid); }
      st.sid = sid; goStep('time'); };
    $$('.s-row[data-s]', a).forEach((r) => (r.onclick = (e) => { if (e.target.closest('[data-gal]')) return; pickSvc(r.dataset.s); }));
    $$('[data-gal]', a).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); gallery(C.svc.get(b.dataset.gal), st.step === 'services' ? () => pickSvc(b.dataset.gal) : null); }));
    $$('[data-back]', a).forEach((b) => (b.onclick = () => { if (b.dataset.back === 'masters') st.edit = -1; goStep(b.dataset.back); }));
    $$('[data-go]').forEach((b) => (b.onclick = () => { if (b.dataset.go === 'masters') st.edit = -1; goStep(b.dataset.go); }));
    $$('.dpill[data-day]', a).forEach((b) => (b.onclick = () => { st.day = b.dataset.day; const y = scrollY; render(); scrollTo(0, y); }));
    $$('.slot', a).forEach((b) => (b.onclick = () => {
      const x = C.ms.get(st.mid).get(st.sid); const s = dayBase(st.day) + +b.dataset.t * 6e4;
      const old = st.edit >= 0 ? st.cart[st.edit] : null;
      const item = { k: old?.k || ++cartK, mid: st.mid, sid: st.sid, s, e: s + x.dur * 6e4, dur: x.dur, price: +x.price };
      if (old) { st.cart[st.edit] = item; if (old.mid !== item.mid) st.cart = st.cart.filter((y) => y.of !== item.k); else rechain(item.k); } else st.cart.push(item);
      st.edit = -1; goStep('cart');
    }));
    $$('[data-edit]', a).forEach((b) => (b.onclick = () => { const i = +b.dataset.edit, x = st.cart[i]; st.edit = i; st.mid = x.mid; st.sid = x.sid; st.day = dayOf(x.s); goStep('time'); }));
    $$('[data-del]', a).forEach((b) => (b.onclick = () => { const x = st.cart[+b.dataset.del]; st.cart = st.cart.filter((y) => y !== x && y.of !== x.k); if (x.of) rechain(x.of); render(); }));
    $$('[data-addon]', a).forEach((b) => (b.onclick = () => addAddon(+b.dataset.of, b.dataset.addon)));
    $$('[data-new]', a).forEach((b) => (b.onclick = () => { st.done = null; st.cat = ''; goStep('masters'); }));
    const ics = $('#ics', a); if (ics) ics.onclick = () => downloadIcs(st.done.items, C.settings);
    const f = $('#cf', a); if (f) bindContacts(f);
  }
  function bindContacts(f) {
    let cm = (ls.get('me', {}) || {}).contact || '';
    $$('[data-cm]', f).forEach((b) => (b.onclick = () => { cm = b.dataset.cm; $$('[data-cm]', f).forEach((x) => x.classList.toggle('on', x === b)); $('#f-ig-w', f).classList.toggle('hide', cm !== 'instagram'); }));
    const ph = $('#f-p', f);
    ph.addEventListener('focus', () => { if (!ph.value) ph.value = '+380'; });
    f.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#f-go', f).click(); } });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#f-n', f).value.trim(), phone = normPhone(ph.value), ig = $('#f-ig', f).value.trim().replace(/^@/, ''), cmt = $('#f-cm', f).value.trim();
      const err = $('#f-err', f); const bad = [];
      $('#f-n', f).classList.toggle('err', name.length < 2); if (name.length < 2) bad.push('вкажіть імʼя');
      ph.classList.toggle('err', !phone); if (!phone) bad.push('вкажіть правильний номер телефону');
      if (!cm) bad.push('оберіть, як з вами звʼязатись');
      if (bad.length) { err.textContent = 'Будь ласка, ' + bad.join(', ') + '.'; err.classList.remove('hide'); return; }
      err.classList.add('hide');
      await busy($('#f-go', f), async () => {
        const { data, error } = await sb.rpc('book_visit', { p_items: st.cart.map((x) => ({ staff: x.mid, service: x.sid, start: new Date(x.s).toISOString() })),
          p_name: name, p_phone: phone, p_contact: cm, p_instagram: cm === 'instagram' ? ig : null, p_comment: cmt || null });
        if (error) {
          err.textContent = errMsg(error); err.classList.remove('hide'); toast(errMsg(error), 'bad', 5000);
          try { await loadBusy(); } catch (e2) {}
          return;
        }
        ls.set('me', { name, phone, contact: cm, instagram: ig });
        const items = st.cart.map((x) => ({ ...x, service: C.svc.get(x.sid).name, master: fullName(C.mas.get(x.mid)) }));
        st.done = { token: data.token, name, items, total: cartTotal() };
        const v = (ls.get('visits', []) || []).filter((y) => y.until > nowMs());
        v.push({ token: data.token, until: Math.max(...st.cart.map((x) => x.e)), title: relDay(dayOf(st.cart[0].s)) + ' ' + fmtT(st.cart[0].s) });
        ls.set('visits', v.slice(-5));
        st.cart = []; st.edit = -1;
        loadBusy().catch(() => {});
        goStep('done');
      });
    };
  }
  function gallery(sv, onPick) {   // фото робіт до послуги
    const ph = sv.photos || []; let i = 0;
    const x = st.mid && C.ms.get(st.mid)?.get(sv.id);
    const g = sheet({ title: esc(sv.name), wide: true, body: `<div class="gal"><img id="g-img" src="${esc(ph[0])}" alt="">
        ${ph.length > 1 ? `<button class="btn ico g-prev" title="Попереднє фото">${IC.back}</button><button class="btn ico g-next" title="Наступне фото">${IC.fwd}</button>` : ''}</div>
      ${ph.length > 1 ? `<div class="g-th">${ph.map((u, k) => `<img src="${esc(u)}" data-k="${k}" class="${k ? '' : 'on'}" alt="" title="Фото ${k + 1}">`).join('')}</div>` : ''}
      ${sv.descr ? `<p class="mut" style="margin:10px 0 0">${esc(sv.descr)}</p>` : ''}`,
      foot: onPick ? `<button class="btn pri lg" id="g-ok" title="Обрати цю послугу">Обрати · ${fromTxt(sv.id, st.mid)}${money(x ? x.price : sv.price)}</button>` : '' });
    const show = (k) => { i = (k + ph.length) % ph.length; $('#g-img', g.el).src = ph[i]; $$('.g-th img', g.el).forEach((t) => t.classList.toggle('on', +t.dataset.k === i)); };
    $$('.g-th img', g.el).forEach((t) => (t.onclick = () => show(+t.dataset.k)));
    const pv = $('.g-prev', g.el); if (pv) { pv.onclick = () => show(i - 1); $('.g-next', g.el).onclick = () => show(i + 1); }
    let sx = null; const im = $('#g-img', g.el);
    im.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
    im.addEventListener('touchend', (e) => { if (sx == null || ph.length < 2) return; const d = e.changedTouches[0].clientX - sx; if (Math.abs(d) > 40) show(i + (d < 0 ? 1 : -1)); sx = null; });
    const ok = $('#g-ok', g.el); if (ok) ok.onclick = () => { g.close(); onPick(); };
  }
  function downloadIcs(items, s) {
    const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NaNa studio//UA', 'CALSCALE:GREGORIAN'];
    items.forEach((x, i) => L.push('BEGIN:VEVENT', `UID:${z(x.s)}-${i}@nana-studio`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(x.s)}`, `DTEND:${z(x.e)}`,
      `SUMMARY:${x.service} — ${s.salon_name}`, `LOCATION:${(s.address || '').replace(/,/g, '\\,')}`, `DESCRIPTION:Майстер: ${x.master}`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Нагадування про запис', 'END:VALARM', 'END:VEVENT'));
    L.push('END:VCALENDAR');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' })); a.download = 'nana-studio.ics'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function book() {
    document.title = 'NaNa studio — онлайн-запис';
    if (!C) app().innerHTML = '<div class="spin"></div>';
    try { await load(); } catch (e) { app().innerHTML = `<div class="cl-wrap"><div class="card mt2 empty"><div class="big">😕</div>${esc(errMsg(e))}<div class="mt"><button class="btn" onclick="location.reload()" title="Спробувати ще раз">Оновити</button></div></div></div>`; return; }
    if (st.step === 'done' && !st.done) st.step = 'masters';
    render();
  }

  /* ---------- «Мій запис» ---------- */
  async function visit(token) {
    document.title = 'Мій запис — NaNa studio';
    app().innerHTML = '<div class="spin"></div>';
    let v;
    try {
      await load(true);
      const { data, error } = await sb.rpc('client_visit', { p_token: token }); if (error) throw error; v = data;
    } catch (e) { v = null; }
    if (!v) { app().innerHTML = `<div class="cl-wrap">${C ? hero(true) : ''}<div class="card empty"><div class="big">🔎</div>Запис не знайдено. Перевірте посилання або зателефонуйте нам.<div class="mt"><a class="btn pri" href="#" title="Перейти до онлайн-запису">Записатися онлайн</a></div></div></div>`; return; }
    clockSkew = Date.parse(v.now) - Date.now();
    const lim = v.cancel_hours * 36e5;
    const can = (x) => x.status === 'booked' && Date.parse(x.starts_at) - nowMs() >= lim;
    const live = v.items.filter((x) => x.status === 'booked' && Date.parse(x.starts_at) > nowMs());
    const tg = C.settings.tg_bot; const ph = String(C.settings.phone || '').replace(/[^\d+]/g, '');
    const rows = v.items.map((x) => `<div class="cart-item">${avatar({ first_name: x.master, photo_url: x.photo_url }, 's')}<div class="grow">
      <div class="b">${esc(x.service)} <span class="pill ${x.status}">${STATUS[x.status]}</span></div>
      <div class="sm mut">${esc(fmtDay(dayOf(x.starts_at), { weekday: 'long', day: 'numeric', month: 'long' }))}, ${fmtT(x.starts_at)}–${fmtT(x.ends_at)} · ${esc(x.master)}</div>
      ${x.status === 'booked' && Date.parse(x.starts_at) > nowMs() ? (can(x) ? `<div class="row" style="gap:6px;margin-top:7px"><button class="btn sm" data-mv="${x.id}" title="Обрати інший день або час">Перенести</button><button class="btn sm red" data-cn="${x.id}" title="Скасувати цю послугу">Скасувати</button></div>`
        : `<div class="hint">Змінити онлайн можна не пізніше ніж за ${v.cancel_hours} год — зателефонуйте нам.</div>`) : ''}
      </div><div class="b nw">${money(x.price)}</div></div>`).join('');
    app().innerHTML = `<div class="cl-wrap">${hero(true)}<div class="st-title"><h2>Мій запис</h2><a class="btn sm" href="#" title="Записатися ще на якусь послугу">${IC.plus} Новий запис</a></div>
      <div class="card"><div class="mut sm">${esc(v.client.name)} · ${esc(fmtPhone(v.client.phone))}</div>${rows}</div>
      <div class="col mt">
        ${tg && !v.client.tg && live.length ? `<a class="btn pri lg" href="https://t.me/${esc(tg)}?start=v_${v.token}" target="_blank" rel="noopener" title="Бот нагадає про візит">${IC.tg} Нагадування в Telegram</a>` : ''}
        ${live.length ? `<button class="btn lg" id="ics" title="Завантажити подію для календаря">${IC.cal} Додати в календар</button>` : ''}
        ${live.filter(can).length > 1 ? `<button class="btn red" id="cnall" title="Скасувати всі послуги цього візиту">Скасувати весь візит</button>` : ''}
        ${ph ? `<a class="btn" href="tel:${esc(ph)}" title="Зателефонувати в салон">${IC.call.replace('<svg', '<svg width="18" height="18"')} Зателефонувати в салон</a>` : ''}
      </div></div>`;
    const ics = $('#ics'); if (ics) ics.onclick = () => downloadIcs(live.map((x) => ({ s: Date.parse(x.starts_at), e: Date.parse(x.ends_at), service: x.service, master: x.master })), C.settings);
    const cancel = async (id) => {
      if (!(await confirmBox(id ? 'Скасувати цю послугу?' : 'Скасувати весь візит?', { ok: 'Так, скасувати', cancel: 'Ні', danger: true, sub: 'Майстер отримає сповіщення, а час стане вільним для інших.' }))) return;
      const { error } = await sb.rpc('client_cancel', { p_token: token, p_appt: id || null });
      if (error) return toast(errMsg(error), 'bad', 5000);
      toast('Запис скасовано'); visit(token);
    };
    $$('[data-cn]').forEach((b) => (b.onclick = () => cancel(b.dataset.cn)));
    const ca = $('#cnall'); if (ca) ca.onclick = () => cancel(null);
    $$('[data-mv]').forEach((b) => (b.onclick = () => moveSheet(token, v, v.items.find((x) => x.id === b.dataset.mv))));
  }
  function moveSheet(token, v, it) {
    const dur = (Date.parse(it.ends_at) - Date.parse(it.starts_at)) / 6e4;
    const sibs = v.items.filter((x) => x.status === 'booked');
    const skip = sibs.filter((x) => x.staff_id === it.staff_id).map((x) => [Date.parse(x.starts_at), Date.parse(x.ends_at)]);
    const extra = sibs.filter((x) => x.id !== it.id).map((x) => [Date.parse(x.starts_at), Date.parse(x.ends_at)]);
    const saveCart = st.cart; st.cart = [];
    let day = dayOf(it.starts_at);
    const s = sheet({ title: 'Перенести: ' + esc(it.service), body: '<div id="mvb"></div>', onClose: () => (st.cart = saveCart) });
    const draw = () => {
      const t = today(), days = [];
      for (let i = 0; i <= C.settings.max_days; i++) { const d = addDays(t, i); days.push([d, slots(it.staff_id, dur, d, { skip, extra }).length]); }
      if (!days.find((d) => d[0] === day && d[1])) day = (days.find((d) => d[1]) || [])[0];
      const sl = day ? slots(it.staff_id, dur, day, { skip, extra }) : [];
      $('#mvb', s.el).innerHTML = `<div class="sm mut mb">Зараз: ${esc(relDay(dayOf(it.starts_at)))}, ${fmtT(it.starts_at)} · ${esc(it.master)}</div>
        <div class="dstrip">${days.map(([d, n]) => `<button class="dpill ${d === day ? 'on' : ''} ${n ? '' : 'off'}" ${n ? `data-d="${d}"` : 'disabled'} title="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}"><div class="w">${WD[isoDow(d)]}</div><div class="d">${+d.slice(8)}</div><div class="m">${esc(fmtDay(d, { month: 'short' }).replace('.', ''))}</div></button>`).join('')}</div>
        ${sl.length ? `<div class="slots mt">${sl.map((m) => `<button class="slot" data-t="${m}" title="Перенести на ${toHM(m)}">${toHM(m)}</button>`).join('')}</div>` : '<div class="empty">Немає вільного часу</div>'}`;
      $$('[data-d]', s.el).forEach((b) => (b.onclick = () => { day = b.dataset.d; draw(); }));
      $$('[data-t]', s.el).forEach((b) => (b.onclick = async () => {
        const start = new Date(dayBase(day) + +b.dataset.t * 6e4);
        if (!(await confirmBox(`Перенести на ${relDay(day)}, ${toHM(+b.dataset.t)}?`, { ok: 'Перенести' }))) return;
        const { error } = await sb.rpc('client_move', { p_token: token, p_appt: it.id, p_start: start.toISOString() });
        if (error) { toast(errMsg(error), 'bad', 5000); await loadBusy(); draw(); return; }
        s.close(); toast('Запис перенесено'); visit(token);
      }));
      const on = $('.dpill.on', s.el); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    };
    draw();
  }
  return { book, visit, load, get C() { return C; } };
})();
