'use strict';
/* NaNa studio — панель персоналу: вхід, календар, записи, графік, клієнти, сповіщення */
const Staff = (() => {
  const S = { me: null, staff: [], services: [], ms: [], hours: [], settings: null, pay: [], loaded: false,
    day: null, calMode: ls.get('calMode', innerWidth < 760 ? 'list' : 'grid'), calSel: null, showCancel: false, clientsCache: null };
  const app = () => $('#app');
  const isBoss = () => !!S.me && ['owner', 'admin'].includes(S.me.role);
  const isOwner = () => !!S.me && S.me.role === 'owner';
  const masters = () => S.staff.filter((s) => s.is_active && s.is_bookable);
  const byId = (id) => S.staff.find((s) => s.id === id);
  const svcById = (id) => S.services.find((s) => s.id === id);
  const msOf = (mid) => S.ms.filter((x) => x.staff_id === mid && x.is_active).map((x) => ({ ...x, svc: svcById(x.service_id) })).filter((x) => x.svc && x.svc.is_active)
    .sort((a, b) => a.svc.sort - b.svc.sort || a.svc.name.localeCompare(b.svc.name));
  const payPct = (id) => +(S.pay.find((p) => p.staff_id === id)?.commission_pct ?? 0);

  async function loadAll() {
    const r = await Promise.all([
      sb.from('staff').select('*').order('sort').order('first_name'),
      sb.from('services').select('*').order('sort').order('name'),
      sb.from('master_services').select('*'),
      sb.from('work_hours').select('*'),
      sb.from('settings').select('*').eq('id', 1).single(),
      sb.from('staff_pay').select('*')]);
    for (const x of r) if (x.error) throw x.error;
    [S.staff, S.services, S.ms, S.hours, S.settings, S.pay] = r.map((x) => x.data);
    const { data: { user } } = await sb.auth.getUser();
    S.me = S.staff.find((s) => s.user_id === user?.id && s.is_active) || null;
    S.loaded = true;
  }
  const reload = async () => { await loadAll(); };

  /* ================= вхід ================= */
  function loginPage(msg) {
    document.title = 'Вхід для персоналу — NaNa studio';
    app().innerHTML = `<div class="login-box"><div class="login-logo"><img src="img/logo.png" alt="NaNa studio"></div>
      <form class="card" id="lf"><h2 style="margin:0 0 4px">Вхід для персоналу</h2><p class="mut sm" style="margin:0 0 14px">Логін або пошта і пароль</p>
      ${msg ? `<div class="errtxt mb">${esc(msg)}</div>` : ''}
      <label class="lb" for="l-u">Логін або пошта</label><input class="inp" id="l-u" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="наприклад, admin" autofocus>
      <label class="lb" for="l-p">Пароль</label><input class="inp" id="l-p" type="password" autocomplete="current-password">
      <div class="errtxt hide" id="l-e"></div>
      <button class="btn pri lg wide mt" id="l-go" title="Увійти в програму (Enter)">Увійти</button>
      <p class="hint" style="text-align:center">Немає пароля? Попросіть у власниці посилання для швидкого входу.</p></form>
      <p style="text-align:center"><a href="#" class="sm mut" title="Сторінка онлайн-запису для клієнтів">← Онлайн-запис для клієнтів</a></p></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const u = $('#l-u').value.trim().toLowerCase(), p = $('#l-p').value; const er = $('#l-e');
      if (!u || !p) { er.textContent = 'Вкажіть логін і пароль'; er.classList.remove('hide'); return; }
      await busy($('#l-go'), async () => {
        const { error } = await sb.auth.signInWithPassword({ email: u.includes('@') ? u : u + '@nana.local', password: p });
        if (error) { er.textContent = /invalid/i.test(error.message) ? 'Невірний логін або пароль' : errMsg(error); er.classList.remove('hide'); return; }
        S.loaded = false; go('#/staff/cal');
      });
    };
  }
  async function quick(token) {
    document.title = 'Швидкий вхід — NaNa studio';
    app().innerHTML = `<div class="login-box"><div class="login-logo"><img src="img/logo.png" alt="NaNa studio"></div><div class="card" id="qb"><div class="spin"></div></div></div>`;
    const call = async (body) => { const r = await fetch(SB_URL + '/functions/v1/team-login', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'Помилка'); return j; };
    try {
      const { staff } = await call({ token });
      $('#qb').innerHTML = `<h2 style="margin:0 0 4px">Хто ви?</h2><p class="mut sm" style="margin:0 0 12px">Оберіть себе, щоб увійти</p>${staff.map((s) =>
        `<div class="list-row" data-id="${s.id}" title="Увійти як ${esc(fullName(s))}">${avatar(s)}<div class="grow"><div class="nm">${esc(fullName(s))}</div><div class="sub">${ROLE[s.role]}</div></div>${IC.fwd}</div>`).join('')}`;
      $$('[data-id]', $('#qb')).forEach((r) => (r.onclick = () => busy(null, async () => {
        r.style.opacity = '.5';
        try {
          const { token_hash } = await call({ token, staff_id: r.dataset.id });
          let { error } = await sb.auth.verifyOtp({ token_hash, type: 'magiclink' });
          if (error) ({ error } = await sb.auth.verifyOtp({ token_hash, type: 'email' }));
          if (error) throw error;
          S.loaded = false; location.replace(siteBase() + '#/staff/cal');
        } catch (e) { r.style.opacity = ''; toast(errMsg(e), 'bad'); }
      })));
    } catch (e) { $('#qb').innerHTML = `<div class="empty"><div class="big">🔒</div>${esc(errMsg(e))}<div class="mt"><a class="btn" href="#/staff" title="Звичайний вхід з паролем">Увійти з паролем</a></div></div>`; }
  }

  async function pwLink(token) {   // одноразове посилання з Telegram → вхід → поле нового пароля
    document.title = 'Встановити пароль — NaNa studio';
    app().innerHTML = `<div class="login-box"><div class="login-logo"><img src="img/logo.png" alt="NaNa studio"></div><div class="card" id="qb"><div class="spin"></div></div></div>`;
    try {
      const r = await fetch(SB_URL + '/functions/v1/team-login', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, body: JSON.stringify({ pw_token: token }) });
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'Помилка');
      let { error } = await sb.auth.verifyOtp({ token_hash: j.token_hash, type: 'magiclink' });
      if (error) ({ error } = await sb.auth.verifyOtp({ token_hash: j.token_hash, type: 'email' }));
      if (error) throw error;
      ls.set('pwHint', 1); S.loaded = false; location.replace(siteBase() + '#/staff/team/' + j.staff_id);
    } catch (e) { $('#qb').innerHTML = `<div class="empty"><div class="big">🔒</div>${esc(errMsg(e))}<div class="mt"><a class="btn" href="#/staff" title="Звичайний вхід з паролем">Увійти з паролем</a></div></div>`; }
  }

  /* ================= каркас ================= */
  const NAV = () => [
    ['cal', 'Календар', IC.cal, true],
    ['clients', 'Клієнти', IC.users, true],
    ['sched', 'Графік', IC.clock, true],
    ['dash', 'Дашборд', IC.chart, isBoss()],
    ['earn', 'Мій заробіток', IC.wallet, S.me.is_bookable || !isBoss()],
    ['services', 'Послуги', IC.list, isBoss()],
    ['team', isBoss() ? 'Персонал' : 'Моя картка', IC.user, true],
    ['settings', 'Налаштування', IC.gear, isBoss()],
  ].filter((x) => x[3]);
  const TIPS = { cal: 'Записи на день по майстрах', clients: 'База клієнтів, історія, застарілі', sched: 'Години роботи, вихідні, закритий час', dash: 'Гроші, статистика, транзакції',
    earn: 'Мій відсоток і заробіток за період', services: 'Послуги, ціни, тривалість', team: 'Картки співробітників', settings: 'Налаштування салону і запису' };
  function shell(page) {
    if (!$('#st-main')) {
      app().innerHTML = `<div class="st-top"><a class="brand" href="#/staff/cal" title="Календар — головна сторінка"><img src="img/banana.png" alt=""><b>NaNa</b></a>
        <div class="ttl" id="st-ttl"></div>
        <button class="btn ico" id="st-bell" title="Сповіщення про записи">${IC.bell}<span class="badge hide" id="st-bc">0</span></button>
        <div class="me" id="st-me" title="Мій профіль і вихід">${avatar(S.me, 's')}<span class="sm b nm">${esc(S.me.first_name)}</span></div></div>
        <div class="st-shell"><nav class="st-nav" id="st-nav"></nav><main class="st-main"><div class="pg" id="st-main"></div></main></div><nav class="st-tabs" id="st-tabs"></nav>`;
      $('#st-bell').onclick = (e) => { e.stopPropagation(); notifPanel(); };
      $('#st-me').onclick = meMenu;
      pollNotif(); clearInterval(S.poll); S.poll = setInterval(pollNotif, 30000);
    }
    const nav = NAV();
    $('#st-nav').innerHTML = nav.map(([k, n, ic]) => `<a href="#/staff/${k}" class="${k === page ? 'on' : ''}" title="${TIPS[k]}">${ic}<span>${n}</span></a>`).join('') +
      `<div class="sep"></div><a href="#" target="_blank" title="Відкрити сторінку онлайн-запису, яку бачать клієнти">${IC.globe.replace('width="14" height="14"', 'width="20" height="20"')}<span>Сторінка запису</span></a>
       <a href="javascript:void 0" id="nav-out" title="Вийти з програми на цьому пристрої">${IC.out}<span>Вийти</span></a>`;
    $('#nav-out').onclick = logout;
    const main4 = ['cal', 'clients', 'sched', isBoss() ? 'dash' : 'earn'];
    $('#st-tabs').innerHTML = nav.filter((x) => main4.includes(x[0])).map(([k, n, ic]) => `<a href="#/staff/${k}" class="${k === page ? 'on' : ''}" title="${TIPS[k]}">${ic}<span>${n.replace('Мій заробіток', 'Заробіток')}</span></a>`).join('') +
      `<a href="javascript:void 0" id="tab-more" class="${main4.includes(page) ? '' : 'on'}" title="Інші розділи">${IC.more}<span>Ще</span></a>`;
    $('#tab-more').onclick = () => {
      const s = sheet({ title: 'Розділи', body: nav.filter((x) => !main4.includes(x[0])).map(([k, n, ic]) => `<a class="list-row" href="#/staff/${k}" title="${TIPS[k]}"><span style="width:22px">${ic}</span><div class="grow nm">${n}</div>${IC.fwd}</a>`).join('') +
        `<a class="list-row" href="#" target="_blank" title="Сторінка, яку бачать клієнти"><span style="width:22px">${IC.globe}</span><div class="grow nm">Сторінка онлайн-запису</div></a>
         <div class="list-row" id="m-out" title="Вийти з програми"><span style="width:22px">${IC.out}</span><div class="grow nm">Вийти</div></div>` });
      $$('a.list-row', s.el).forEach((a) => a.addEventListener('click', () => s.close()));
      $('#m-out', s.el).onclick = () => { s.close(); logout(); };
    };
    const t = nav.find((x) => x[0] === page); $('#st-ttl').textContent = t ? t[1] : '';
    document.title = (t ? t[1] + ' — ' : '') + 'NaNa studio';
  }
  function meMenu() {
    const s = sheet({ title: esc(fullName(S.me)), body: `<div class="row mb">${avatar(S.me, 'l')}<div><div class="b">${esc(fullName(S.me))}</div><div class="mut sm">${ROLE[S.me.role]}${S.me.login ? ' · вхід: ' + esc(S.me.login) : ''}</div></div></div>
      <a class="list-row" href="#/staff/team/${S.me.id}" title="Моя картка: фото, контакти, сповіщення, пароль">${IC.user}<div class="grow nm">Моя картка і пароль</div>${IC.fwd}</a>
      <div class="list-row" id="mm-out" title="Вийти з програми на цьому пристрої">${IC.out}<div class="grow nm">Вийти</div></div>` });
    $('a', s.el).addEventListener('click', () => s.close());
    $('#mm-out', s.el).onclick = () => { s.close(); logout(); };
  }
  async function logout() {
    if (!(await confirmBox('Вийти з програми?', { ok: 'Вийти' }))) return;
    clearInterval(S.poll); await sb.auth.signOut({ scope: 'local' }); S.loaded = false; S.me = null; location.hash = '#/staff';
  }

  async function open(sub) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return loginPage();
    if (!S.loaded) {
      if (!$('#st-main')) app().innerHTML = '<div class="spin"></div>';
      try { await loadAll(); } catch (e) { return loginPage(errMsg(e)); }
    }
    if (!S.me) { await sb.auth.signOut({ scope: 'local' }); return loginPage('Цей акаунт не має доступу до програми салону.'); }
    const [page, arg] = (sub || 'cal').split('/');
    const pages = { cal: pCal, clients: pClients, sched: pSched, dash: Admin.dash, earn: Admin.earn, services: Admin.services, team: Admin.team, settings: Admin.settings };
    const allowed = NAV().map((x) => x[0]);
    const p = allowed.includes(page) ? page : 'cal';
    shell(p);
    const main = $('#st-main'); main.innerHTML = '<div class="spin"></div>';
    try { await pages[p](main, arg); } catch (e) { console.error(e); main.innerHTML = `<div class="card empty"><div class="big">😕</div>${esc(errMsg(e))}<div class="mt"><button class="btn" onclick="location.reload()" title="Перезавантажити сторінку">Оновити</button></div></div>`; }
  }

  /* ================= сповіщення ================= */
  async function pollNotif() {
    if (!S.me) return;
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('staff_id', S.me.id).is('read_at', null);
    const b = $('#st-bc'); if (!b) return; b.textContent = count > 99 ? '99+' : count; b.classList.toggle('hide', !count);
  }
  async function notifPanel() {
    let p = $('.npanel'); if (p) { p.remove(); return; }
    p = document.createElement('div'); p.className = 'npanel'; p.innerHTML = '<div class="spin"></div>'; document.body.appendChild(p);
    const off = (e) => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('click', off); } };
    setTimeout(() => document.addEventListener('click', off), 0);
    const { data } = await sb.from('notifications').select('*').eq('staff_id', S.me.id).order('created_at', { ascending: false }).limit(40);
    const ic = { new: '🆕', cancel: '❌', move: '🔁' };
    p.innerHTML = `<div class="row sp" style="padding:12px 14px;border-bottom:1.5px solid var(--line)"><b>Сповіщення</b>
      <div class="row" style="gap:6px"><button class="btn sm" id="n-all" title="Позначити всі сповіщення прочитаними">Прочитати все</button>
      <a class="btn sm ico" href="#/staff/team/${S.me.id}" title="Налаштувати, які сповіщення отримувати">${IC.gear.replace('<svg', '<svg width="16" height="16"')}</a></div></div>` +
      ((data || []).map((n) => `<div class="it ${n.read_at ? '' : 'un'}" data-id="${n.id}" data-day="${n.day || ''}" title="Відкрити цей день у календарі"><div class="ic">${ic[n.kind] || '🔔'}</div><div class="grow"><div class="b sm">${esc(n.title)}</div><div class="sm">${esc(n.body || '')}</div>
        <div class="xs mut">${esc(relDay(dayOf(n.created_at)))}, ${fmtT(n.created_at)}</div></div></div>`).join('') || '<div class="empty">Поки сповіщень немає</div>');
    $('#n-all', p).onclick = async (e) => { e.stopPropagation(); await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('staff_id', S.me.id).is('read_at', null); p.remove(); pollNotif(); };
    $$('.it', p).forEach((it) => (it.onclick = async () => {
      p.remove(); await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', it.dataset.id); pollNotif();
      if (it.dataset.day) go('#/staff/cal/' + it.dataset.day);
    }));
  }

  /* ================= розклад дня ================= */
  async function dayData(day, mids) {
    const from = kDate(day, 0).toISOString(), to = kDate(addDays(day, 1), 0).toISOString();
    const [a, b, o] = await Promise.all([
      sb.from('appointments').select('*, clients(id,name,phone,contact,instagram,note), visits(source,comment,token), payments(amount,method,commission)').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
      sb.from('blocks').select('*').lt('starts_at', to).gt('ends_at', from),
      sb.from('day_overrides').select('*').eq('day', day)]);
    for (const x of [a, b, o]) if (x.error) throw x.error;
    a.data.forEach((x) => { if (Array.isArray(x.payments)) x.payments = x.payments[0] || null; });
    return { appts: a.data, blocks: b.data, over: o.data };
  }
  function hoursFor(mid, day, over) {
    const o = over.find((x) => x.staff_id === mid && x.day === day);
    if (o) return o.is_off ? null : [toMin(o.start_time), toMin(o.end_time)];
    const h = S.hours.find((x) => x.staff_id === mid && x.weekday === isoDow(day));
    return h ? [toMin(h.start_time), toMin(h.end_time)] : null;
  }
  function freeSlots(mid, dur, day, dd, ignoreId) {
    const hh = hoursFor(mid, day, dd.over); if (!hh) return [];
    const st = S.settings, buf = st.buffer_min * 6e4, base = kDate(day, 720).getTime() - 720 * 6e4, out = [];
    const ap = dd.appts.filter((a) => a.staff_id === mid && ['booked', 'done'].includes(a.status) && a.id !== ignoreId).map((a) => [Date.parse(a.starts_at), Date.parse(a.ends_at)]);
    const bl = dd.blocks.filter((b) => b.staff_id === mid).map((b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)]);
    for (let m = hh[0]; m + dur <= hh[1]; m += st.step_min) {
      const a = base + m * 6e4, b = a + dur * 6e4;
      if (day === today() && a < nowMs()) continue;
      if (ap.some(([x, y]) => x < b + buf && y > a - buf) || bl.some(([x, y]) => x < b && y > a)) continue;
      out.push(m);
    }
    return out;
  }

  /* ================= календар ================= */
  async function pCal(main, arg) {
    S.day = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : S.day || today();
    const ms = masters();
    if (!S.calSel) S.calSel = isBoss() || !S.me.is_bookable ? 'all' : S.me.id;
    const shown = S.calSel === 'all' ? ms : ms.filter((m) => m.id === S.calSel);
    const dd = await dayData(S.day, shown.map((m) => m.id));
    const appts = dd.appts.filter((a) => shown.some((m) => m.id === a.staff_id) && (S.showCancel || a.status !== 'cancel'));
    const act = dd.appts.filter((a) => shown.some((m) => m.id === a.staff_id) && a.status !== 'cancel');
    const paid = act.reduce((s, a) => s + +(a.payments?.amount || 0), 0), plan = act.filter((a) => a.status !== 'noshow').reduce((s, a) => s + +a.price, 0);
    main.innerHTML = `<div class="cal-bar">
        <button class="btn ico" id="c-prev" title="Попередній день">${IC.back}</button>
        <label class="cal-day" title="Обрати дату в календарі" style="cursor:pointer;position:relative">${esc(relDay(S.day) === fmtDay(S.day, { weekday: 'short', day: 'numeric', month: 'short' }) ? fmtDay(S.day, { weekday: 'long', day: 'numeric', month: 'long' }) : relDay(S.day) + ', ' + fmtDay(S.day, { day: 'numeric', month: 'long' }))}
          <input type="date" id="c-date" value="${S.day}" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
        <button class="btn ico" id="c-next" title="Наступний день">${IC.fwd}</button>
        ${S.day !== today() ? '<button class="btn sm" id="c-today" title="Повернутись до сьогодні">Сьогодні</button>' : ''}
        <div class="grow"></div>
        <button class="btn sm" id="c-mode" title="${S.calMode === 'grid' ? 'Показати списком' : 'Показати сіткою по годинах'}">${S.calMode === 'grid' ? IC.list.replace('<svg', '<svg width="16" height="16"') + ' Список' : IC.cal.replace('<svg', '<svg width="16" height="16"') + ' Сітка'}</button>
        <button class="btn sm" id="c-block" title="Закрити час або день для запису (відпустка, лікар…)">${IC.lock} Закрити час</button>
        <button class="btn pri" id="c-new" title="Створити новий запис клієнта">${IC.plus} Запис</button></div>
      <div class="chips scroll mb">${ms.length > 1 ? `<button class="chip ${S.calSel === 'all' ? 'on' : ''}" data-sel="all" title="Показати всіх майстрів">Усі майстри</button>` : ''}${ms.map((m) => `<button class="chip ${S.calSel === m.id ? 'on' : ''}" data-sel="${m.id}" title="Лише записи майстра ${esc(m.first_name)}">${esc(m.first_name)}</button>`).join('')}
        <label class="chip" title="Показувати також скасовані записи" style="gap:8px"><input type="checkbox" id="c-cn" ${S.showCancel ? 'checked' : ''} style="accent-color:var(--gr)"> скасовані</label></div>
      <div class="sm mut mb">${act.length} ${plural(act.length, 'запис', 'записи', 'записів')}${act.length ? ` · завершено ${act.filter((a) => a.status === 'done').length}` : ''}${isBoss() && act.length ? ` · оплачено ${money(paid)} з ${money(plan)}` : ''}</div>
      <div id="c-body"></div>`;
    const body = $('#c-body');
    if (!shown.length) body.innerHTML = '<div class="card empty"><div class="big">👩‍🎨</div>Немає майстрів, які приймають записи. Додайте їх у розділі «Персонал».</div>';
    else if (S.calMode === 'grid') drawGrid(body, shown, dd, appts); else drawList(body, shown, dd, appts);
    const nav = (d) => go('#/staff/cal/' + d);
    $('#c-prev').onclick = () => nav(addDays(S.day, -1)); $('#c-next').onclick = () => nav(addDays(S.day, 1));
    const t = $('#c-today'); if (t) t.onclick = () => nav(today());
    $('#c-date').onchange = (e) => e.target.value && nav(e.target.value);
    $('#c-mode').onclick = () => { S.calMode = S.calMode === 'grid' ? 'list' : 'grid'; ls.set('calMode', S.calMode); pCal(main, S.day); };
    $('#c-new').onclick = () => newAppt({ mid: S.calSel !== 'all' ? S.calSel : isBoss() ? null : S.me.id, day: S.day });
    $('#c-block').onclick = () => blockSheet({ mid: S.calSel !== 'all' ? S.calSel : isBoss() ? null : S.me.id, day: S.day });
    $$('[data-sel]', main).forEach((b) => (b.onclick = () => { S.calSel = b.dataset.sel; pCal(main, S.day); }));
    $('#c-cn').onchange = (e) => { S.showCancel = e.target.checked; pCal(main, S.day); };
  }
  // картку майстра з календаря відкривають власниця/адмін (будь-яку) і майстер (лише свою)
  const canCard = (m) => isBoss() || m.id === S.me.id;
  const apHtml = (a) => `<span class="t">${fmtT(a.starts_at)}–${fmtT(a.ends_at)}${a.visits?.source === 'online' ? ' 🌐' : ''}</span><b>${esc(a.clients?.name || '')}</b>${esc(svcById(a.service_id)?.name || '')}`;
  function drawGrid(body, shown, dd, appts) {
    const PX = 1.25;
    let s0 = toMin(S.settings.open_time), s1 = toMin(S.settings.close_time);
    shown.forEach((m) => { const h = hoursFor(m.id, S.day, dd.over); if (h) { s0 = Math.min(s0, h[0]); s1 = Math.max(s1, h[1]); } });
    appts.forEach((a) => { s0 = Math.min(s0, kParts(a.starts_at).min); s1 = Math.max(s1, dayOf(a.ends_at) === S.day ? kParts(a.ends_at).min : 1440); });
    s0 = Math.floor(s0 / 60) * 60; s1 = Math.ceil(s1 / 60) * 60;
    const H = (s1 - s0) * PX, y = (m) => (m - s0) * PX;
    let times = ''; for (let m = s0; m <= s1; m += 60) times += `<div style="top:${y(m)}px">${toHM(m)}</div>`;
    let lines = ''; for (let m = s0; m < s1; m += 30) lines += `<div class="hl ${m % 60 ? '' : 'h'}" style="top:${y(m)}px"></div>`;
    const cols = shown.map((m) => {
      const hh = hoursFor(m.id, S.day, dd.over);
      const off = !hh ? `<div class="off" style="top:0;height:${H}px"></div>` : (hh[0] > s0 ? `<div class="off" style="top:0;height:${y(hh[0])}px"></div>` : '') + (hh[1] < s1 ? `<div class="off" style="top:${y(hh[1])}px;height:${H - y(hh[1])}px"></div>` : '');
      const bl = dd.blocks.filter((b) => b.staff_id === m.id).map((b) => { const a = dayOf(b.starts_at) < S.day ? 0 : kParts(b.starts_at).min, e = dayOf(b.ends_at) > S.day ? 1440 : kParts(b.ends_at).min;
        return `<div class="blk" data-blk="${b.id}" style="top:${y(Math.max(a, s0))}px;height:${Math.max(18, (Math.min(e, s1) - Math.max(a, s0)) * PX)}px" title="Закритий час: ${esc(b.reason)}. Натисніть, щоб відкрити">${IC.lock} ${esc(b.reason)}</div>`; }).join('');
      const ap = appts.filter((a) => a.staff_id === m.id).map((a) => { const st = kParts(a.starts_at).min, en = dayOf(a.ends_at) === S.day ? kParts(a.ends_at).min : 1440;
        return `<div class="ap ${a.status}" data-ap="${a.id}" style="top:${y(st)}px;height:${Math.max(24, (en - st) * PX - 2)}px" title="${esc(STATUS[a.status])}: ${esc(a.clients?.name)} — ${esc(svcById(a.service_id)?.name)}">${apHtml(a)}</div>`; }).join('');
      return `<div class="cal-col" data-col="${m.id}" style="height:${H}px" title="Натисніть на вільне місце, щоб записати клієнта">${lines}${off}${bl}${ap}</div>`;
    }).join('');
    const n = shown.length;
    body.innerHTML = `<div class="cal-wrap"><div class="cal-grid" style="grid-template-columns:56px repeat(${n},minmax(${n > 1 ? 150 : 220}px,1fr))">
      <div class="cal-head tm"></div>${shown.map((m) => canCard(m) ? `<a class="cal-head lnk" href="#/staff/team/${m.id}" title="Відкрити картку: ${esc(fullName(m))}">${avatar(m, 's')}<span class="ell">${esc(m.first_name)}</span></a>` : `<div class="cal-head">${avatar(m, 's')}<span class="ell">${esc(m.first_name)}</span></div>`).join('')}
      <div class="cal-times" style="height:${H}px;position:sticky">${times}</div>${cols}</div></div>`;
    if (S.day === today()) { const nm = kParts(new Date(nowMs())).min; if (nm >= s0 && nm <= s1) $$('.cal-col', body).forEach((c) => c.insertAdjacentHTML('beforeend', `<div class="cal-now" style="top:${y(nm)}px"></div>`)); }
    const wrap = $('.cal-wrap', body);
    const first = appts[0] ? kParts(appts[0].starts_at).min : S.day === today() ? kParts(new Date(nowMs())).min : s0 + 60;
    wrap.scrollTop = Math.max(0, y(first) - 60);
    $$('.cal-col', body).forEach((c) => (c.onclick = (e) => {
      if (e.target.closest('.ap,.blk')) return;
      const r = c.getBoundingClientRect(); let m = s0 + (e.clientY - r.top) / PX; m = Math.floor(m / S.settings.step_min) * S.settings.step_min;
      if (!isBoss() && c.dataset.col !== S.me.id) return toast('Записувати можна лише до себе', 'bad');
      newAppt({ mid: c.dataset.col, day: S.day, min: m });
    }));
    bindDay(body, dd);
  }
  function drawList(body, shown, dd, appts) {
    body.innerHTML = `<div class="cal-list">${shown.map((m) => {
      const list = appts.filter((a) => a.staff_id === m.id); const hh = hoursFor(m.id, S.day, dd.over);
      const bl = dd.blocks.filter((b) => b.staff_id === m.id);
      return `<h4>${canCard(m) ? `<a class="m-lnk" href="#/staff/team/${m.id}" title="Відкрити картку: ${esc(fullName(m))}">${avatar(m, 's')} ${esc(fullName(m))}</a>` : `${avatar(m, 's')} ${esc(fullName(m))}`} <span class="mut sm" style="font-weight:600">${hh ? toHM(hh[0]) + '–' + toHM(hh[1]) : 'вихідний'} · ${list.length} ${plural(list.length, 'запис', 'записи', 'записів')}</span></h4>` +
        bl.map((b) => `<div class="ap-row noshow" data-blk="${b.id}" title="Закритий час. Натисніть, щоб відкрити"><div class="tm">${fmtT(b.starts_at)}<small>${fmtT(b.ends_at)}</small></div><div class="grow">${IC.lock} <b>${esc(b.reason)}</b></div></div>`).join('') +
        (list.map((a) => `<div class="ap-row ${a.status}" data-ap="${a.id}" title="Відкрити запис"><div class="tm">${fmtT(a.starts_at)}<small>${fmtT(a.ends_at)}</small></div>
          <div class="grow"><div class="b ell">${esc(a.clients?.name || '')}${a.visits?.source === 'online' ? ' <span class="pill i" title="Клієнт записався онлайн">онлайн</span>' : ''}</div><div class="sm mut ell">${esc(svcById(a.service_id)?.name || '')}</div></div>
          <div style="text-align:right"><span class="pill ${a.status}">${STATUS[a.status]}</span><div class="sm b" style="margin-top:4px">${money(a.payments?.amount ?? a.price)}</div></div></div>`).join('') ||
          (hh ? `<div class="ap-row" style="border-left-color:var(--line2);cursor:pointer" data-new="${m.id}" title="Створити запис до ${esc(m.first_name)}"><div class="grow mut">Записів немає — ${IC.plus} записати</div></div>` : ''));
    }).join('')}</div>`;
    $$('[data-new]', body).forEach((r) => (r.onclick = () => newAppt({ mid: r.dataset.new, day: S.day })));
    bindDay(body, dd);
  }
  function bindDay(body, dd) {
    $$('[data-ap]', body).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); openAppt(dd.appts.find((a) => a.id === el.dataset.ap)); }));
    $$('[data-blk]', body).forEach((el) => (el.onclick = async (e) => {
      e.stopPropagation(); const b = dd.blocks.find((x) => x.id === el.dataset.blk); const m = byId(b.staff_id);
      const s = sheet({ title: 'Закритий час', body: `<dl class="kv"><dt>Майстер</dt><dd>${esc(fullName(m))}</dd><dt>Коли</dt><dd>${esc(relDay(dayOf(b.starts_at)))}, ${fmtT(b.starts_at)}–${fmtT(b.ends_at)}</dd><dt>Причина</dt><dd>${esc(b.reason)}</dd></dl>`,
        foot: (isBoss() || b.staff_id === S.me.id) ? `<button class="btn red" id="b-del" title="Зробити цей час знову доступним для запису">Відкрити цей час</button>` : '' });
      const d = $('#b-del', s.el); if (d) d.onclick = () => busy(d, async () => {
        const { error } = await sb.from('blocks').delete().eq('id', b.id); if (error) return toast(errMsg(error), 'bad');
        s.close(); toast('Час відкрито для запису'); refresh();
      });
    }));
  }
  const refresh = () => { const h = location.hash; if (h.startsWith('#/staff/cal') || h === '#/staff' || h === '#staff') open(h.replace(/^#\/?staff\/?/, '')); else if (h.startsWith('#/staff/clients')) open('clients'); };

  /* ================= картка запису ================= */
  async function openAppt(a) {
    const m = byId(a.staff_id), sv = svcById(a.service_id), c = a.clients || {};
    const mine = isBoss() || a.staff_id === S.me.id;
    const pay = a.payments;
    const actions = !mine ? '' : a.status === 'booked' ? `
        <button class="btn pri" data-act="done" title="Відмітити, що клієнт прийшов, і записати оплату">✓ Завершити й оплатити</button>
        <button class="btn" data-act="move" title="Змінити день, час або майстра">Перенести</button>
        <button class="btn" data-act="noshow" title="Клієнт не прийшов на запис">Не прийшов(ла)</button>
        <button class="btn red" data-act="cancel" title="Скасувати запис — час звільниться">Скасувати</button>`
      : a.status === 'done' ? (isBoss() ? `<button class="btn" data-act="done" title="Виправити суму або спосіб оплати">Змінити оплату</button><button class="btn red" data-act="booked" title="Повернути запис у стан «Записано» (оплата зникне)">Скасувати завершення</button>` : '')
      : `<button class="btn" data-act="booked" title="Повернути запис — знову «Записано»">Відновити запис</button>`;
    const s = sheet({ title: esc(sv?.name || 'Запис'), body: `
      <div class="row wrap mb"><span class="pill ${a.status}">${STATUS[a.status]}</span>${a.visits?.source === 'online' ? '<span class="pill i">записався(лась) онлайн</span>' : ''}${a.demo ? '<span class="pill g" title="Демо-запис — можна видалити в Налаштуваннях">демо</span>' : ''}</div>
      <dl class="kv"><dt>Коли</dt><dd>${esc(fmtDay(dayOf(a.starts_at), { weekday: 'long', day: 'numeric', month: 'long' }))}, ${fmtT(a.starts_at)}–${fmtT(a.ends_at)}</dd>
        <dt>Майстер</dt><dd>${esc(fullName(m || {}))}</dd><dt>Ціна</dt><dd>${money(a.price)}</dd>
        ${pay ? `<dt>Оплачено</dt><dd>${money(pay.amount)} · ${esc(pay.method)}</dd>` : ''}
        ${a.cancel_reason ? `<dt>Причина</dt><dd>${esc(a.cancel_reason)}</dd>` : ''}${a.cancelled_by ? `<dt>Скасував(ла)</dt><dd>${a.cancelled_by === 'client' ? 'клієнт онлайн' : 'салон'}</dd>` : ''}
        ${a.visits?.comment ? `<dt>Коментар</dt><dd>${esc(a.visits.comment)}</dd>` : ''}</dl>
      <div class="sect"><h3>${esc(c.name || '')} <a class="btn sm ghost" href="javascript:void 0" id="a-cl" title="Відкрити картку клієнта з історією візитів">картка ${IC.fwd.replace('width="20" height="20"', 'width="14" height="14"')}</a></h3>
        <div class="sm">${esc(fmtPhone(c.phone))} · зручно: <b>${esc(CONTACTS[c.contact]?.[0] || 'дзвінок')}</b>${c.instagram ? ' · @' + esc(c.instagram) : ''}</div>${c.note ? `<div class="hint">📝 ${esc(c.note)}</div>` : ''}${contactLinks(c)}</div>
      <label class="lb mt" for="a-note">Нотатка до запису</label><textarea class="inp" id="a-note" rows="2" placeholder="Видно лише персоналу" ${mine ? '' : 'disabled'}>${esc(a.note || '')}</textarea>`,
      foot: actions });
    const note = $('#a-note', s.el);
    note.onchange = async () => { const { error } = await sb.from('appointments').update({ note: note.value.trim() || null }).eq('id', a.id); if (error) toast(errMsg(error), 'bad'); else { a.note = note.value.trim(); toast('Нотатку збережено'); } };
    $('#a-cl', s.el).onclick = () => { s.close(); clientSheet(c.id); };
    $$('[data-act]', s.el).forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act;
      if (act === 'done') return paySheet(a, () => { s.close(); refresh(); });
      if (act === 'move') { s.close(); return moveSheet(a); }
      if (act === 'cancel') return cancelSheet(a, () => { s.close(); refresh(); });
      if (act === 'noshow' && !(await confirmBox('Клієнт не прийшов?', { ok: 'Так, не прийшов(ла)' }))) return;
      if (act === 'booked' && !(await confirmBox(a.status === 'done' ? 'Скасувати завершення й оплату?' : 'Відновити запис?', { ok: 'Так' }))) return;
      await busy(b, async () => {
        const { error } = await sb.rpc('appt_status', { p_appt: a.id, p_status: act });
        if (error) return toast(errMsg(error), 'bad', 5000);
        toast(act === 'noshow' ? 'Відмічено: не прийшов(ла)' : 'Запис відновлено'); s.close(); refresh();
      });
    }));
  }
  function paySheet(a, done) {
    const methods = S.settings.pay_methods || ['Готівка'];
    let method = a.payments?.method || methods[0];
    const s = sheet({ title: 'Оплата', body: `<div class="sm mut mb">${esc(svcById(a.service_id)?.name)} · ${esc(a.clients?.name || '')}</div>
      <label class="lb" for="p-am">Сума, ₴</label><input class="inp" id="p-am" type="number" inputmode="decimal" min="0" step="1" value="${+(a.payments?.amount ?? a.price)}" style="font-size:22px;font-weight:800">
      <div class="hint">Ціна послуги: ${money(a.price)}. Змініть, якщо була знижка чи доплата.</div>
      <label class="lb">Спосіб оплати</label><div class="chips" id="p-m">${methods.map((x) => `<button class="chip ${x === method ? 'on y' : ''}" data-m="${esc(x)}" title="Оплата: ${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div id="p-qr" class="mt"></div>
      <div class="hint mt">Майстру: ${payPct(a.staff_id)}% = <b id="p-co"></b></div>`,
      foot: `<button class="btn" data-x2 title="Закрити без змін">Скасувати</button><button class="btn pri" id="p-ok" title="Зберегти оплату й завершити запис (Ctrl/⌘+Enter)">✓ Зберегти</button>` });
    const am = $('#p-am', s.el);
    const upd = async () => {
      $('#p-co', s.el).textContent = money(Math.round((+am.value || 0) * payPct(a.staff_id)) / 100);
      const box = $('#p-qr', s.el);
      if (/qr|apple|google|картк/i.test(method) && S.settings.pay_link) { box.innerHTML = `<div class="qr-box">${await qrSvg(S.settings.pay_link)}</div><div class="hint" style="text-align:center">Клієнт сканує камерою телефону</div>`; }
      else box.innerHTML = '';
    };
    am.oninput = upd; upd();
    $$('[data-m]', s.el).forEach((b) => (b.onclick = () => { method = b.dataset.m; $$('[data-m]', s.el).forEach((x) => { x.classList.toggle('on', x === b); x.classList.toggle('y', x === b); }); upd(); }));
    $('[data-x2]', s.el).onclick = s.close;
    s.el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#p-ok', s.el).click(); });
    $('#p-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const v = +am.value; if (!(v >= 0) || am.value === '') { am.classList.add('err'); return; }
      const { error } = await sb.rpc('appt_status', { p_appt: a.id, p_status: 'done', p_amount: v, p_method: method });
      if (error) return toast(errMsg(error), 'bad', 5000);
      s.close(); toast('Оплату збережено · ' + money(v)); done();
    });
  }
  function cancelSheet(a, done) {
    const s = sheet({ title: 'Скасувати запис?', body: `<div class="sm mut mb">${esc(svcById(a.service_id)?.name)} · ${esc(a.clients?.name || '')} · ${esc(relDay(dayOf(a.starts_at)))}, ${fmtT(a.starts_at)}</div>
      <label class="lb" for="cn-r">Причина <span class="mut" style="font-weight:600">(необовʼязково)</span></label><input class="inp" id="cn-r" placeholder="Наприклад: клієнт захворів" autofocus>
      <div class="chips mt">${['Клієнт попросив', 'Захворів(ла)', 'Майстер не може', 'Не підтвердив(ла)'].map((r) => `<button class="chip" data-r="${r}" title="Вставити причину">${r}</button>`).join('')}</div>`,
      foot: `<button class="btn" data-x2 title="Не скасовувати">Ні</button><button class="btn red" id="cn-ok" title="Скасувати запис">Скасувати запис</button>` });
    $$('[data-r]', s.el).forEach((b) => (b.onclick = () => ($('#cn-r', s.el).value = b.dataset.r)));
    $('[data-x2]', s.el).onclick = s.close;
    $('#cn-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const { error } = await sb.rpc('appt_status', { p_appt: a.id, p_status: 'cancel', p_reason: $('#cn-r', s.el).value });
      if (error) return toast(errMsg(error), 'bad', 5000);
      s.close(); toast('Запис скасовано'); done();
    });
  }

  /* ---------- вибір часу (спільне для нового запису й перенесення) ---------- */
  function timePicker(box, { mid, dur, day, min, ignoreId, onPick }) {
    box.innerHTML = '<div class="spin" style="margin:14px auto;width:24px;height:24px"></div>';
    return dayData(day).then((dd) => {
      const fs = mid ? freeSlots(mid, dur, day, dd, ignoreId) : [];
      const hh = mid ? hoursFor(mid, day, dd.over) : null;
      box.innerHTML = `${mid ? `<div class="hint" style="margin:0 0 8px">${hh ? `Майстер працює ${toHM(hh[0])}–${toHM(hh[1])}` : '⚠️ У майстра в цей день вихідний'} · вільних віконець: ${fs.length}</div>` : ''}
        ${fs.length ? `<div class="slots">${fs.map((m) => `<button type="button" class="slot ${m === min ? 'on' : ''}" data-t="${m}" title="Обрати ${toHM(m)}–${toHM(m + dur)}">${toHM(m)}</button>`).join('')}</div>` : ''}
        <div class="row mt"><label class="sm b nw" for="tp-t">Або свій час:</label><input class="inp" type="time" id="tp-t" step="300" value="${min != null ? toHM(min) : ''}" style="max-width:140px"></div>`;
      $$('[data-t]', box).forEach((b) => (b.onclick = () => { $$('[data-t]', box).forEach((x) => x.classList.toggle('on', x === b)); $('#tp-t', box).value = toHM(+b.dataset.t); onPick(+b.dataset.t); }));
      $('#tp-t', box).onchange = (e) => { $$('[data-t]', box).forEach((x) => x.classList.toggle('on', x.dataset.t == toMin(e.target.value))); onPick(e.target.value ? toMin(e.target.value) : null); };
      if (min != null) onPick(min);
    });
  }
  async function withForce(fn) {   // якщо час поза графіком/зайнятий — запитати «все одно?»
    let { error } = await fn(false);
    if (error && /^CHECK:/.test(error.message)) {
      if (!(await confirmBox(error.message.slice(6), { ok: 'Все одно записати', sub: 'Час поза графіком майстра або занадто близько до іншого запису.' }))) return { cancelled: true };
      ({ error } = await fn(true));
    }
    return { error };
  }
  function moveSheet(a) {
    const st = { mid: a.staff_id, day: dayOf(a.starts_at), min: kParts(a.starts_at).min, dur: Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 6e4) };
    const s = sheet({ title: 'Перенести запис', body: `<div class="sm mut mb">${esc(svcById(a.service_id)?.name)} · ${esc(a.clients?.name || '')} · зараз ${esc(relDay(st.day))}, ${fmtT(a.starts_at)}</div>
      ${isBoss() ? `<label class="lb" for="mv-m">Майстер</label><select class="inp" id="mv-m">${masters().map((m) => `<option value="${m.id}" ${m.id === st.mid ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}</select>` : ''}
      <div class="two"><div><label class="lb" for="mv-d">Дата</label><input class="inp" type="date" id="mv-d" value="${st.day}"></div>
      <div><label class="lb" for="mv-u">Тривалість, хв</label><input class="inp" type="number" id="mv-u" min="5" step="5" value="${st.dur}"></div></div>
      <label class="lb">Час</label><div id="mv-t"></div>`,
      foot: `<button class="btn" data-x2 title="Не переносити">Скасувати</button><button class="btn pri" id="mv-ok" title="Зберегти новий час">Перенести</button>` });
    const tp = () => timePicker($('#mv-t', s.el), { mid: st.mid, dur: st.dur, day: st.day, min: st.min, ignoreId: a.id, onPick: (m) => (st.min = m) });
    tp();
    const mm = $('#mv-m', s.el); if (mm) mm.onchange = () => { st.mid = mm.value; tp(); };
    $('#mv-d', s.el).onchange = (e) => { if (e.target.value) { st.day = e.target.value; st.min = null; tp(); } };
    $('#mv-u', s.el).onchange = (e) => { st.dur = Math.max(5, +e.target.value || st.dur); tp(); };
    $('[data-x2]', s.el).onclick = s.close;
    $('#mv-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      if (st.min == null) return toast('Оберіть час', 'bad');
      const r = await withForce((force) => sb.rpc('staff_move', { p_appt: a.id, p_staff: st.mid, p_start: kDate(st.day, st.min).toISOString(), p_dur: st.dur, p_force: force }));
      if (r.cancelled) return; if (r.error) return toast(errMsg(r.error), 'bad', 5000);
      s.close(); toast('Запис перенесено'); go('#/staff/cal/' + st.day);
    });
  }

  /* ================= новий запис ================= */
  function newAppt({ mid = null, day = today(), min = null, client = null } = {}) {
    const ms = masters();
    if (!mid) mid = ms.length === 1 ? ms[0].id : null;
    const st = { mid, day, min, client, sid: null, dur: null, price: null, contact: 'call' };
    const s = sheet({ title: 'Новий запис', wide: false, body: `
      <label class="lb">Клієнт <span class="req">*</span></label><div id="na-c"></div>
      <label class="lb" for="na-m">Майстер <span class="req">*</span></label>
      <select class="inp" id="na-m" ${isBoss() ? '' : 'disabled'}><option value="">— оберіть майстра —</option>${ms.map((m) => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}</select>
      <label class="lb" for="na-s">Послуга <span class="req">*</span></label><select class="inp" id="na-s"></select>
      <div class="two"><div><label class="lb" for="na-u">Тривалість, хв</label><input class="inp" id="na-u" type="number" min="5" step="5"></div><div><label class="lb" for="na-p">Ціна, ₴</label><input class="inp" id="na-p" type="number" min="0" step="10"></div></div>
      <label class="lb" for="na-d">Дата <span class="req">*</span></label><input class="inp" id="na-d" type="date" value="${day}">
      <label class="lb">Час <span class="req">*</span></label><div id="na-t"><div class="hint">Спершу оберіть майстра й послугу</div></div>
      <label class="lb" for="na-n">Нотатка</label><input class="inp" id="na-n" placeholder="Видно лише персоналу">`,
      foot: `<button class="btn" data-x2 title="Закрити без збереження">Скасувати</button><button class="btn pri" id="na-ok" title="Створити запис (Ctrl/⌘+Enter)">Записати</button>` });
    const el = s.el;
    // клієнт
    const drawClient = () => {
      const c = $('#na-c', el);
      if (st.client) {
        c.innerHTML = `<div class="list-row" style="cursor:default;margin:0"><span class="ava s y">${esc((st.client.name || '?')[0])}</span><div class="grow"><div class="nm">${esc(st.client.name)}</div><div class="sub">${esc(fmtPhone(st.client.phone))}</div></div><button class="btn ghost ico sm" id="na-cx" title="Обрати іншого клієнта">${IC.x}</button></div>`;
        $('#na-cx', c).onclick = () => { st.client = null; drawClient(); };
        return;
      }
      c.innerHTML = `<div class="search">${IC.search}<input class="inp" id="na-q" placeholder="Пошук: імʼя або телефон" autocomplete="off" autofocus></div><div id="na-sg"></div>
        <div id="na-newc" class="hide"><div class="two mt"><input class="inp" id="na-cn" placeholder="Імʼя клієнта"><input class="inp" id="na-cp" type="tel" placeholder="+380…"></div><div id="na-dup"></div>
        <div class="chips mt" id="na-cc">${Object.entries(CONTACTS).map(([k, [n]]) => `<button type="button" class="chip ${k === st.contact ? 'on' : ''}" data-cc="${k}" title="Клієнту зручно: ${n}">${n}</button>`).join('')}</div></div>`;
      const q = $('#na-q', c), sg = $('#na-sg', c);
      let tmr;
      q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
        const v = q.value.trim().replace(/[,()*%\\]/g, ' ').trim();
        if (v.length < 2) { sg.innerHTML = ''; $('#na-newc', c).classList.add('hide'); return; }
        const digits = v.replace(/\D/g, '');
        let rq = sb.from('clients').select('id,name,phone,contact,instagram').limit(8);
        rq = digits.length >= 3 ? rq.ilike('phone', '%' + digits + '%') : rq.ilike('name', '%' + v + '%');
        const { data } = await rq;
        sg.innerHTML = `<div class="sugg">${(data || []).map((x) => `<div data-cid="${x.id}" title="Обрати цього клієнта"><b>${esc(x.name)}</b> <span class="mut sm">${esc(fmtPhone(x.phone))}</span></div>`).join('')}
          <div data-newc title="Створити нового клієнта">${IC.plus} <b>Новий клієнт</b>${digits.length >= 9 ? ' ' + esc(v) : ''}</div></div>`;
        $$('[data-cid]', sg).forEach((d) => (d.onclick = () => { st.client = data.find((x) => x.id === d.dataset.cid); drawClient(); }));
        $('[data-newc]', sg).onclick = () => { sg.innerHTML = ''; $('#na-newc', c).classList.remove('hide'); if (digits.length >= 9) $('#na-cp', c).value = v; else $('#na-cn', c).value = v; ($('#na-cn', c).value ? $('#na-cp', c) : $('#na-cn', c)).focus(); };
      }, 220); };
      $$('[data-cc]', c).forEach((b) => (b.onclick = () => { st.contact = b.dataset.cc; $$('[data-cc]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
      phoneDupWatch($('#na-cp', c), $('#na-dup', c), { label: 'Обрати цього клієнта', onPick: (x) => { st.client = x; drawClient(); } });
    };
    drawClient();
    // майстер і послуга
    const msel = $('#na-m', el), ssel = $('#na-s', el);
    const fillSvc = () => {
      const own = st.mid ? msOf(st.mid) : [];
      const other = S.services.filter((x) => x.is_active && !own.some((o) => o.service_id === x.id));
      ssel.innerHTML = `<option value="">— оберіть послугу —</option>` + (own.length ? `<optgroup label="Послуги майстра">${own.map((x) => `<option value="${x.service_id}">${esc(x.svc.name)} — ${durTxt(x.dur)} · ${money(x.price)}</option>`).join('')}</optgroup>` : '') +
        `<optgroup label="${own.length ? 'Інші послуги' : 'Усі послуги'}">${other.map((x) => `<option value="${x.id}">${esc(x.name)} — ${durTxt(x.dur)} · ${money(x.price)}</option>`).join('')}</optgroup>`;
      if (st.sid && [...ssel.options].some((o) => o.value === st.sid)) ssel.value = st.sid; else st.sid = null;
      pickSvc();
    };
    const pickSvc = () => {
      st.sid = ssel.value || null;
      const own = st.mid && st.sid ? S.ms.find((x) => x.staff_id === st.mid && x.service_id === st.sid) : null, sv = svcById(st.sid);
      st.dur = own?.dur || sv?.dur || null; st.price = own?.price ?? sv?.price ?? null;
      $('#na-u', el).value = st.dur || ''; $('#na-p', el).value = st.price != null ? +st.price : '';
      drawTime();
    };
    const drawTime = () => { if (!st.mid || !st.dur) { $('#na-t', el).innerHTML = '<div class="hint">Спершу оберіть майстра й послугу</div>'; return; }
      timePicker($('#na-t', el), { mid: st.mid, dur: st.dur, day: st.day, min: st.min, onPick: (m) => (st.min = m) }); };
    msel.onchange = () => { st.mid = msel.value || null; fillSvc(); };
    ssel.onchange = pickSvc;
    $('#na-u', el).onchange = (e) => { st.dur = Math.max(5, +e.target.value || 0) || null; drawTime(); };
    $('#na-p', el).onchange = (e) => (st.price = e.target.value === '' ? null : +e.target.value);
    $('#na-d', el).onchange = (e) => { if (e.target.value) { st.day = e.target.value; drawTime(); } };
    if (!isBoss()) { st.mid = S.me.id; msel.value = S.me.id; }
    fillSvc();
    $('[data-x2]', el).onclick = s.close;
    el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#na-ok', el).click(); });
    $('#na-ok', el).onclick = (e) => busy(e.currentTarget, async () => {
      const bad = [];
      let cl = st.client, name = null, phone = null;
      if (!cl) { name = ($('#na-cn', el)?.value || '').trim(); phone = normPhone($('#na-cp', el)?.value); if (name.length < 2 || !phone) bad.push('клієнта (імʼя і телефон)'); }
      if (!st.mid) bad.push('майстра'); if (!st.sid) bad.push('послугу'); if (st.min == null) bad.push('час');
      if (bad.length) return toast('Оберіть ' + bad.join(', '), 'bad');
      const r = await withForce((force) => sb.rpc('staff_book', { p_client: cl?.id || null, p_name: name, p_phone: phone, p_contact: st.contact, p_staff: st.mid, p_service: st.sid,
        p_start: kDate(st.day, st.min).toISOString(), p_dur: st.dur, p_price: st.price, p_note: $('#na-n', el).value, p_force: force, p_visit: null }));
      if (r.cancelled) return; if (r.error) return toast(errMsg(r.error), 'bad', 5000);
      s.close(); toast('Запис створено'); S.clientsCache = null;
      if (location.hash.startsWith('#/staff/cal')) go('#/staff/cal/' + st.day); else go('#/staff/cal/' + st.day);
    });
  }

  /* ================= закрити час ================= */
  function blockSheet({ mid = null, day = today() } = {}) {
    if (!isBoss()) mid = S.me.id;
    const s = sheet({ title: 'Закрити час для запису', body: `
      <label class="lb" for="bl-m">Майстер</label><select class="inp" id="bl-m" ${isBoss() ? '' : 'disabled'}>${(isBoss() ? masters() : [S.me]).map((m) => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}</select>
      <label class="lb" for="bl-d">Дата</label><input class="inp" type="date" id="bl-d" value="${day}">
      <label class="sw mt" title="Закрити весь день — клієнти не зможуть записатись"><input type="checkbox" id="bl-all"><i></i><span class="b">Вихідний на весь день</span></label>
      <div id="bl-part"><div class="two"><div><label class="lb" for="bl-a">З</label><input class="inp" type="time" id="bl-a" step="600" value="13:00"></div><div><label class="lb" for="bl-b">До</label><input class="inp" type="time" id="bl-b" step="600" value="14:00"></div></div></div>
      <label class="lb" for="bl-r">Причина <span class="req">*</span></label><input class="inp" id="bl-r" placeholder="Обід, лікар, навчання…" maxlength="80">
      <div class="chips mt">${['Обід', 'Особисті справи', 'Лікар', 'Навчання', 'Відпустка'].map((r) => `<button class="chip" data-r="${r}" title="Вставити причину">${r}</button>`).join('')}</div>`,
      foot: `<button class="btn" data-x2 title="Закрити без збереження">Скасувати</button><button class="btn dark" id="bl-ok" title="Закрити цей час для запису">${IC.lock} Закрити час</button>` });
    const el = s.el;
    $('#bl-all', el).onchange = (e) => $('#bl-part', el).classList.toggle('hide', e.target.checked);
    $$('[data-r]', el).forEach((b) => (b.onclick = () => ($('#bl-r', el).value = b.dataset.r)));
    $('[data-x2]', el).onclick = s.close;
    $('#bl-ok', el).onclick = (e) => busy(e.currentTarget, async () => {
      const m = $('#bl-m', el).value, d = $('#bl-d', el).value, r = $('#bl-r', el).value.trim(), all = $('#bl-all', el).checked;
      if (!d) return toast('Оберіть дату', 'bad');
      let error;
      if (all) ({ error } = await sb.from('day_overrides').upsert({ staff_id: m, day: d, is_off: true, start_time: null, end_time: null }));
      else {
        if (!r) { $('#bl-r', el).classList.add('err'); return toast('Вкажіть причину', 'bad'); }
        const a = toMin($('#bl-a', el).value), b = toMin($('#bl-b', el).value);
        if (!(b > a)) return toast('Час «до» має бути пізніше за «з»', 'bad');
        ({ error } = await sb.from('blocks').insert({ staff_id: m, starts_at: kDate(d, a).toISOString(), ends_at: kDate(d, b).toISOString(), reason: r }));
      }
      if (error) return toast(errMsg(error), 'bad');
      s.close(); toast(all ? 'День закрито' : 'Час закрито'); refresh();
    });
  }

  /* ================= графік ================= */
  async function pSched(main, arg) {
    const list = isBoss() ? masters() : [S.me];
    const mid = list.find((m) => m.id === arg)?.id || (list.find((m) => m.id === S.me.id) && S.me.is_bookable ? S.me.id : list[0]?.id);
    if (!mid) { main.innerHTML = '<div class="card empty">Немає майстрів. Додайте їх у «Персонал».</div>'; return; }
    const m = byId(mid);
    S.schedMonth = S.schedMonth || today().slice(0, 7) + '-01';
    const mon = S.schedMonth, mEnd = addDays(mon.slice(0, 8) + '01', 40).slice(0, 8) + '01', last = addDays(mEnd, -1);
    const [{ data: ov }, { data: bl }] = await Promise.all([
      sb.from('day_overrides').select('*').eq('staff_id', mid).gte('day', mon).lte('day', last),
      sb.from('blocks').select('*').eq('staff_id', mid).gte('starts_at', kDate(mon, 0).toISOString()).lt('starts_at', kDate(mEnd, 0).toISOString()).order('starts_at')]);
    const wh = S.hours.filter((h) => h.staff_id === mid);
    const canEdit = isBoss() || mid === S.me.id;
    const rows = [1, 2, 3, 4, 5, 6, 7].map((d) => { const h = wh.find((x) => x.weekday === d);
      return `<div class="wh-row"><label class="sw" title="${WDL[d]}: робочий чи вихідний"><input type="checkbox" data-wd="${d}" ${h ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><i></i><b>${WD[d]}</b></label>
        <input class="inp" type="time" step="600" data-a="${d}" value="${h ? h.start_time.slice(0, 5) : toHM(toMin(S.settings.open_time))}" ${h && canEdit ? '' : 'disabled'} title="Початок роботи">
        <input class="inp" type="time" step="600" data-b="${d}" value="${h ? h.end_time.slice(0, 5) : toHM(toMin(S.settings.close_time))}" ${h && canEdit ? '' : 'disabled'} title="Кінець роботи"></div>`; }).join('');
    // місяць
    const first = isoDow(mon); let cells = WD.slice(1).map((w) => `<div class="h">${w}</div>`).join('');
    for (let i = 1; i < first; i++) cells += '<div class="c out"></div>';
    for (let d = mon; d < mEnd; d = addDays(d, 1)) {
      const o = ov.find((x) => x.day === d), w = wh.find((x) => x.weekday === isoDow(d)), nb = bl.filter((b) => dayOf(b.starts_at) === d).length;
      const cls = o ? (o.is_off ? 'off' : 'cus') : w ? '' : 'off';
      const txt = o ? (o.is_off ? 'вихідний' : o.start_time.slice(0, 5) + '–' + o.end_time.slice(0, 5)) : w ? w.start_time.slice(0, 5) + '–' + w.end_time.slice(0, 5) : 'вихідний';
      cells += `<div class="c ${cls} ${d === today() ? 'today' : ''}" data-day="${d}" title="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}: ${txt}${o ? ' (окремо)' : ''}${nb ? ', закрито проміжків: ' + nb : ''}. Натисніть, щоб змінити"><b>${+d.slice(8)}</b><div class="xs">${txt}</div>${nb ? `<div class="xs">${IC.lock.replace('width="17" height="17"', 'width="11" height="11"')} ${nb}</div>` : ''}</div>`;
    }
    const [yy, mm] = mon.split('-');
    main.innerHTML = `<div class="pg-h"><h1>Графік</h1>${canEdit ? `<button class="btn" id="s-blk" title="Закрити частину дня або весь день">${IC.lock} Закрити час</button>` : ''}</div>
      ${list.length > 1 ? `<div class="chips scroll mb">${list.map((x) => `<a class="chip ${x.id === mid ? 'on' : ''}" href="#/staff/sched/${x.id}" title="Графік: ${esc(fullName(x))}">${esc(x.first_name)}</a>`).join('')}</div>` : ''}
      <div class="dgrid" style="margin-top:0"><div class="card"><h3>Звичайний тиждень ${avatar(m, 's')}</h3><div class="hint mb" style="margin-top:-6px">У ці години клієнти автоматично можуть записатись онлайн.</div>${rows}
        ${canEdit ? '<button class="btn pri wide mt" id="s-save" title="Зберегти години роботи">Зберегти тиждень</button>' : ''}</div>
      <div class="card"><div class="row sp mb"><button class="btn ico sm" id="s-pm" title="Попередній місяць">${IC.back}</button><h3 style="margin:0;text-transform:capitalize">${MONTHS[+mm - 1]} ${yy}</h3><button class="btn ico sm" id="s-nm" title="Наступний місяць">${IC.fwd}</button></div>
        <div class="mcal">${cells}</div><div class="legend"><span><i style="background:#fff;border:1.5px solid var(--line2)"></i>за графіком</span><span><i style="background:var(--yels);border:1.5px solid #DCE07A"></i>особливі години</span><span><i style="background:#E5E5DF"></i>вихідний</span></div></div></div>
      ${bl.length ? `<div class="card mt"><h3>Закритий час у цьому місяці</h3>${bl.map((b) => `<div class="list-row" style="cursor:default"><div class="grow"><div class="nm">${esc(relDay(dayOf(b.starts_at)))}, ${fmtT(b.starts_at)}–${fmtT(b.ends_at)}</div><div class="sub">${esc(b.reason)}</div></div>${canEdit ? `<button class="btn sm red" data-unb="${b.id}" title="Відкрити цей час для запису">Відкрити</button>` : ''}</div>`).join('')}</div>` : ''}`;
    $$('[data-wd]', main).forEach((c) => (c.onchange = () => { const d = c.dataset.wd; $(`[data-a="${d}"]`, main).disabled = !c.checked; $(`[data-b="${d}"]`, main).disabled = !c.checked; }));
    const sv = $('#s-save', main); if (sv) sv.onclick = () => busy(sv, async () => {
      const on = [], off = [];
      for (let d = 1; d <= 7; d++) { if ($(`[data-wd="${d}"]`, main).checked) { const a = $(`[data-a="${d}"]`, main).value, b = $(`[data-b="${d}"]`, main).value;
        if (!(toMin(b) > toMin(a))) return toast(`${WDL[d]}: кінець має бути пізніше за початок`, 'bad'); on.push({ staff_id: mid, weekday: d, start_time: a, end_time: b }); } else off.push(d); }
      if (off.length) { const { error } = await sb.from('work_hours').delete().eq('staff_id', mid).in('weekday', off); if (error) return toast(errMsg(error), 'bad'); }
      if (on.length) { const { error } = await sb.from('work_hours').upsert(on); if (error) return toast(errMsg(error), 'bad'); }
      await reload(); toast('Графік збережено — онлайн-запис оновився'); pSched(main, mid);
    });
    const mv = (n) => { const [y, m2] = S.schedMonth.split('-').map(Number); const d = new Date(Date.UTC(y, m2 - 1 + n, 1)); S.schedMonth = d.toISOString().slice(0, 10); pSched(main, mid); };
    $('#s-pm', main).onclick = () => mv(-1); $('#s-nm', main).onclick = () => mv(1);
    const sb2 = $('#s-blk', main); if (sb2) sb2.onclick = () => blockSheet({ mid, day: today() });
    $$('[data-unb]', main).forEach((b) => (b.onclick = () => busy(b, async () => { const { error } = await sb.from('blocks').delete().eq('id', b.dataset.unb); if (error) return toast(errMsg(error), 'bad'); toast('Час відкрито'); pSched(main, mid); })));
    if (canEdit) $$('.mcal .c[data-day]', main).forEach((c) => (c.onclick = () => daySheet(mid, c.dataset.day, ov.find((x) => x.day === c.dataset.day), wh.find((x) => x.weekday === isoDow(c.dataset.day)), () => pSched(main, mid))));
  }
  function daySheet(mid, day, o, w, done) {
    const mode = o ? (o.is_off ? 'off' : 'custom') : 'normal';
    const s = sheet({ title: esc(fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' })), body: `
      <div class="col">
        <label class="list-row" style="margin:0" title="Як у звичайному тижні"><input type="radio" name="dm" value="normal" ${mode === 'normal' ? 'checked' : ''} style="accent-color:var(--gr);width:18px;height:18px"><div class="grow"><div class="nm">За графіком</div><div class="sub">${w ? w.start_time.slice(0, 5) + '–' + w.end_time.slice(0, 5) : 'вихідний за тижневим графіком'}</div></div></label>
        <label class="list-row" style="margin:0" title="Закрити день для запису"><input type="radio" name="dm" value="off" ${mode === 'off' ? 'checked' : ''} style="accent-color:var(--gr);width:18px;height:18px"><div class="grow"><div class="nm">Вихідний</div><div class="sub">Клієнти не зможуть записатись</div></div></label>
        <label class="list-row" style="margin:0" title="Працювати в інші години цього дня"><input type="radio" name="dm" value="custom" ${mode === 'custom' ? 'checked' : ''} style="accent-color:var(--gr);width:18px;height:18px"><div class="grow"><div class="nm">Особливі години</div><div class="sub">Відкрити запис у вибрані години</div></div></label></div>
      <div class="two mt" id="dm-h"><div><label class="lb" for="dm-a">З</label><input class="inp" type="time" step="600" id="dm-a" value="${o && !o.is_off ? o.start_time.slice(0, 5) : w ? w.start_time.slice(0, 5) : '10:00'}"></div>
      <div><label class="lb" for="dm-b">До</label><input class="inp" type="time" step="600" id="dm-b" value="${o && !o.is_off ? o.end_time.slice(0, 5) : w ? w.end_time.slice(0, 5) : '19:00'}"></div></div>`,
      foot: `<button class="btn" data-blk title="Закрити лише частину цього дня">${IC.lock} Закрити частину дня</button><button class="btn pri" id="dm-ok" title="Зберегти цей день">Зберегти</button>` });
    const el = s.el;
    const sync = () => $('#dm-h', el).classList.toggle('hide', $('input[name=dm]:checked', el).value !== 'custom'); sync();
    $$('input[name=dm]', el).forEach((r) => (r.onchange = sync));
    $('[data-blk]', el).onclick = () => { s.close(); blockSheet({ mid, day }); };
    $('#dm-ok', el).onclick = (e) => busy(e.currentTarget, async () => {
      const v = $('input[name=dm]:checked', el).value; let error;
      if (v === 'normal') ({ error } = await sb.from('day_overrides').delete().eq('staff_id', mid).eq('day', day));
      else if (v === 'off') ({ error } = await sb.from('day_overrides').upsert({ staff_id: mid, day, is_off: true, start_time: null, end_time: null }));
      else { const a = $('#dm-a', el).value, b = $('#dm-b', el).value; if (!(toMin(b) > toMin(a))) return toast('Кінець має бути пізніше за початок', 'bad');
        ({ error } = await sb.from('day_overrides').upsert({ staff_id: mid, day, is_off: false, start_time: a, end_time: b })); }
      if (error) return toast(errMsg(error), 'bad');
      s.close(); toast('День збережено'); done();
    });
  }

  /* ================= клієнти ================= */
  async function clientsAll(force) {
    if (S.clientsCache && !force && Date.now() - S.clientsCache.t < 60000) return S.clientsCache.rows;
    let rows = [], i = 0;
    for (;;) { const { data, error } = await sb.rpc('clients_stats').range(i, i + 999); if (error) throw error; rows = rows.concat(data); if (data.length < 1000) break; i += 1000; }
    S.clientsCache = { t: Date.now(), rows }; return rows;
  }
  async function pClients(main, arg) {
    const rows = await clientsAll(true);
    const stale = S.settings.stale_days, t = today();
    const lastDays = (c) => (c.last_visit ? daysBetween(dayOf(c.last_visit), t) : null);
    const isStale = (c) => c.last_visit && !c.next_visit && lastDays(c) >= stale;
    const F = { all: ['Усі', () => true], stale: [`Застарілі (${stale}+ днів)`, isStale], next: ['Мають запис', (c) => !!c.next_visit],
      fresh: ['Нові за 30 днів', (c) => daysBetween(dayOf(c.created_at), t) <= 30], noshow: ['Не приходили', (c) => c.noshows > 0], never: ['Без візитів', (c) => !c.visits && !c.next_visit] };
    S.cf = arg && F[arg] ? arg : S.cf || 'all'; S.cq = S.cq || ''; S.csort = S.csort || 'last';
    main.innerHTML = `<div class="pg-h"><h1>Клієнти</h1>${isBoss() ? `<button class="btn" id="cl-copy" title="Скопіювати телефони клієнтів зі списку нижче — для розсилки">Скопіювати номери</button>` : ''}<button class="btn pri" id="cl-new" title="Записати клієнта">${IC.plus} Запис</button></div>
      <div class="search mb">${IC.search}<input class="inp" id="cl-q" placeholder="Пошук за імʼям або телефоном" value="${esc(S.cq)}"></div>
      <div class="chips scroll mb">${Object.entries(F).map(([k, [n, f]]) => `<button class="chip ${S.cf === k ? 'on' : ''}" data-f="${k}" title="Фільтр: ${esc(n)}">${esc(n)} <span class="n">${rows.filter(f).length}</span></button>`).join('')}</div>
      <div class="row sp mb"><div class="sm mut" id="cl-cnt"></div><select class="inp" id="cl-sort" style="max-width:230px;min-height:36px;padding:6px 10px" title="Сортування списку">
        <option value="last">Давно не були — вгорі</option><option value="recent">Нещодавні візити</option><option value="spent">Більше витратили</option><option value="visits">Більше візитів</option><option value="name">За імʼям</option></select></div>
      <div id="cl-list"></div>`;
    $('#cl-sort').value = S.csort;
    const draw = () => {
      const q = S.cq.toLowerCase(), qd = q.replace(/\D/g, '');
      let list = rows.filter(F[S.cf][1]).filter((c) => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.phone.replace(/\D/g, '').includes(qd)));
      const lv = (c) => (c.last_visit ? Date.parse(c.last_visit) : 0);
      list.sort({ last: (a, b) => lv(a) - lv(b) || a.name.localeCompare(b.name), recent: (a, b) => lv(b) - lv(a), spent: (a, b) => b.spent - a.spent, visits: (a, b) => b.visits - a.visits, name: (a, b) => a.name.localeCompare(b.name, 'uk') }[S.csort]);
      if (S.csort === 'last') list.sort((a, b) => (a.last_visit ? 0 : 1) - (b.last_visit ? 0 : 1) || lv(a) - lv(b));
      $('#cl-cnt').textContent = `${list.length} ${plural(list.length, 'клієнт', 'клієнти', 'клієнтів')}`;
      S.cshown = list;
      $('#cl-list').innerHTML = list.slice(0, 300).map((c) => { const ld = lastDays(c);
        return `<div class="list-row" data-c="${c.id}" title="Відкрити картку клієнта"><span class="ava s ${isStale(c) ? '' : 'y'}">${esc(c.name[0] || '?')}</span><div class="grow">
          <div class="nm ell">${esc(c.name)} ${isStale(c) ? `<span class="pill w" title="Не було понад ${stale} днів і немає запису — варто нагадати про себе">не було ${ld} ${plural(ld, 'день', 'дні', 'днів')}</span>` : ''}${c.next_visit ? `<span class="pill booked" title="Найближчий запис">${esc(relDay(dayOf(c.next_visit)))}</span>` : ''}${c.demo ? ' <span class="pill g">демо</span>' : ''}</div>
          <div class="sub ell">${esc(fmtPhone(c.phone))} · ${c.last_visit ? 'був(ла) ' + esc(relDay(dayOf(c.last_visit))) : 'ще не був(ла)'} · ${c.visits} ${plural(c.visits, 'візит', 'візити', 'візитів')}${isBoss() ? ' · ' + money(c.spent) : ''}</div></div>
          <span class="mut" style="width:20px" title="Зручний спосіб звʼязку: ${esc(CONTACTS[c.contact]?.[0] || '')}">${CONTACTS[c.contact]?.[1] || ''}</span></div>`; }).join('') +
        (list.length > 300 ? `<div class="hint" style="text-align:center">Показано 300 з ${list.length}. Уточніть пошук.</div>` : '') || '<div class="card empty"><div class="big">🔎</div>Нікого не знайдено</div>';
      $$('[data-c]', main).forEach((r) => (r.onclick = () => clientSheet(r.dataset.c)));
    };
    draw();
    let tmr; $('#cl-q').oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { S.cq = e.target.value.trim(); draw(); }, 150); };
    $('#cl-sort').onchange = (e) => { S.csort = e.target.value; draw(); };
    $$('[data-f]', main).forEach((b) => (b.onclick = () => { S.cf = b.dataset.f; $$('[data-f]', main).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#cl-new').onclick = () => newAppt({ mid: isBoss() ? null : S.me.id });
    const cp = $('#cl-copy'); if (cp) cp.onclick = async () => {
      const txt = (S.cshown || []).map((c) => `${c.name}\t${c.phone}`).join('\n');
      try { await navigator.clipboard.writeText(txt); toast(`Скопійовано ${S.cshown.length} номерів`); } catch (e) { toast('Не вдалося скопіювати', 'bad'); }
    };
  }
  async function clientSheet(id) {
    const s = sheet({ title: 'Клієнт', wide: true, body: '<div class="spin"></div>' });
    const [{ data: c, error }, { data: hist }] = await Promise.all([
      sb.from('clients').select('*').eq('id', id).single(),
      sb.from('appointments').select('id,starts_at,ends_at,status,price,staff_id,service_id,note,payments(amount,method)').eq('client_id', id).order('starts_at', { ascending: false }).limit(100)]);
    if (error) { s.el.querySelector('.sh-b').innerHTML = `<div class="empty">${esc(errMsg(error))}</div>`; return; }
    (hist || []).forEach((x) => { if (Array.isArray(x.payments)) x.payments = x.payments[0] || null; });
    const done = hist.filter((x) => x.status === 'done'), spent = done.reduce((a, x) => a + +(x.payments?.amount || 0), 0);
    const next = hist.filter((x) => x.status === 'booked' && Date.parse(x.starts_at) > nowMs()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
    const last = done[0];
    const fav = Object.entries(done.reduce((m, x) => ((m[x.service_id] = (m[x.service_id] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0];
    $('.sh-h h2', s.el).textContent = c.name;
    $('.sh-b', s.el).innerHTML = `${contactLinks(c)}
      <div class="kpis mt" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        <div class="kpi"><div class="l">Візитів</div><div class="v">${done.length}</div></div>
        ${isBoss() ? `<div class="kpi"><div class="l">Витратив(ла)</div><div class="v">${money(spent)}</div></div><div class="kpi"><div class="l">Середній чек</div><div class="v">${money(done.length ? spent / done.length : 0)}</div></div>` : ''}
        <div class="kpi"><div class="l">Останній візит</div><div class="v" style="font-size:17px">${last ? esc(relDay(dayOf(last.starts_at))) : '—'}</div>${last ? `<div class="d mut">${daysBetween(dayOf(last.starts_at), today())} дн. тому</div>` : ''}</div>
        <div class="kpi"><div class="l">Скасувань / неявок</div><div class="v">${hist.filter((x) => x.status === 'cancel').length} / ${hist.filter((x) => x.status === 'noshow').length}</div></div></div>
      ${fav ? `<div class="hint mt">💛 Улюблена послуга: <b>${esc(svcById(fav[0])?.name || '')}</b> (${fav[1]} р.)</div>` : ''}
      ${next ? `<div class="hint">📅 Наступний запис: <b>${esc(relDay(dayOf(next.starts_at)))}, ${fmtT(next.starts_at)}</b></div>` : ''}
      <div class="sect"><h3>Дані клієнта</h3>
        <div class="two"><div><label class="lb" for="c-n">Імʼя</label><input class="inp" id="c-n" value="${esc(c.name)}"></div><div><label class="lb" for="c-p">Телефон</label><input class="inp" id="c-p" type="tel" value="${esc(c.phone)}"></div></div><div id="c-dup"></div>
        <label class="lb">Зручний звʼязок</label><div class="chips" id="c-c">${Object.entries(CONTACTS).map(([k, [n]]) => `<button class="chip ${c.contact === k ? 'on' : ''}" data-cc="${k}" title="Клієнту зручно: ${n}">${n}</button>`).join('')}</div>
        <div class="two"><div><label class="lb" for="c-ig">Instagram</label><input class="inp" id="c-ig" value="${esc(c.instagram || '')}" placeholder="nickname"></div><div><label class="lb" for="c-b">День народження</label><input class="inp" id="c-b" type="date" value="${c.birthday || ''}"></div></div>
        <label class="lb" for="c-no">Нотатки</label><textarea class="inp" id="c-no" rows="2" placeholder="Алергії, вподобання, колір…">${esc(c.note || '')}</textarea>
        <button class="btn mt" id="c-save" title="Зберегти дані клієнта">Зберегти</button></div>
      <div class="sect"><h3>Історія (${hist.length})</h3>${hist.map((x) => `<div class="list-row" style="cursor:default"><div class="grow"><div class="nm sm">${esc(svcById(x.service_id)?.name || '')} <span class="pill ${x.status}">${STATUS[x.status]}</span></div>
        <div class="sub">${esc(fmtDay(dayOf(x.starts_at), { day: 'numeric', month: 'short', year: 'numeric' }))}, ${fmtT(x.starts_at)} · ${esc(byId(x.staff_id)?.first_name || '')}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        <div class="b sm nw">${x.payments ? money(x.payments.amount) : x.status === 'booked' ? money(x.price) : ''}</div></div>`).join('') || '<div class="mut">Ще не було записів</div>'}</div>`;
    s.el.querySelector('.sh-f')?.remove();
    s.el.insertAdjacentHTML('beforeend', `<div class="sh-f"><button class="btn pri" id="c-book" title="Створити новий запис для цього клієнта">${IC.plus} Записати</button></div>`);
    phoneDupWatch($('#c-p', s.el), $('#c-dup', s.el), { exceptId: c.id, label: 'Відкрити картку', onPick: (x) => clientSheet(x.id) });
    let contact = c.contact;
    $$('[data-cc]', s.el).forEach((b) => (b.onclick = () => { contact = b.dataset.cc; $$('[data-cc]', s.el).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#c-save', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const phone = normPhone($('#c-p', s.el).value), name = $('#c-n', s.el).value.trim();
      if (!phone || name.length < 2) return toast('Перевірте імʼя і телефон', 'bad');
      const { error } = await sb.from('clients').update({ name, phone, contact, instagram: $('#c-ig', s.el).value.trim().replace(/^@/, '') || null, birthday: $('#c-b', s.el).value || null, note: $('#c-no', s.el).value.trim() || null }).eq('id', id);
      if (error) return toast(/duplicate|unique/i.test(error.message) ? 'Клієнт з таким телефоном уже є' : errMsg(error), 'bad');
      toast('Збережено'); S.clientsCache = null; $('.sh-h h2', s.el).textContent = name;
    });
    $('#c-book', s.el).onclick = () => { s.close(); newAppt({ client: c, mid: isBoss() ? null : S.me.id }); };
  }

  return { open, quick, pwLink, S, isBoss, isOwner, masters, byId, svcById, msOf, payPct, reload, newAppt, clientSheet, loginPage, dayData, hoursFor };
})();
