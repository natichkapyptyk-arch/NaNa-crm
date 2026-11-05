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
    S.realMe = S.me; S.viewAs = null;
    // власниця/адмін: «Переглянути як Поліна» — панель так, як її бачить працівник (?as=<імʼя|логін|id>); зміни в цьому режимі вимкнено
    let as = null; try { as = new URLSearchParams(location.search).get('as') || sessionStorage.getItem('nana_as'); } catch (e) { /* */ }
    if (as && S.me && ['owner', 'admin'].includes(S.me.role)) {
      const k = as.trim().toLowerCase();
      const t = S.staff.find((x) => x.is_active && x.id !== S.me.id && (x.id === as || (x.login || '').toLowerCase() === k || (x.first_name || '').toLowerCase() === k));
      if (t) { S.viewAs = t; S.me = t; try { sessionStorage.setItem('nana_as', t.id); } catch (e) { /* */ } guardWrites(); }
    }
    S.loaded = true;
  }
  // режим перегляду: читати можна, а будь-які зміни (запис, оплата, налаштування…) не відправляються в базу
  function guardWrites() {
    if (sb.__guard) return; sb.__guard = true;
    const rpc = sb.rpc.bind(sb), from = sb.from.bind(sb), READ = ['clients_stats', 'pub_busy', 'pub_catalog', 'client_visit'];
    const blocked = () => {
      toast(`Режим перегляду «як ${S.viewAs?.first_name || ''}» — зміни не зберігаються`, 'bad', 3500);
      const res = { data: null, error: { message: 'Режим перегляду — зміни вимкнено' } };
      const p = new Proxy(function () {}, { get: (_, k) => (k === 'then' ? (ok, er) => Promise.resolve(res).then(ok, er) : () => p), apply: () => p });
      return p;
    };
    sb.rpc = (n, a, o) => (S.viewAs && !READ.includes(n) ? blocked() : rpc(n, a, o));
    sb.from = (t) => { const q = from(t); if (S.viewAs) for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = blocked; return q; };
  }
  const exitViewAs = () => { try { sessionStorage.removeItem('nana_as'); } catch (e) { /* */ } location.href = location.pathname + '#/staff/team'; };
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
        <button class="btn ico" id="st-bell" title="Сповіщення про записи">${IC.bell}<span class="badge hide" id="st-bc">0</span><span class="badge onl hide" id="st-bo" title="Нові онлайн-записи">0</span></button>
        <div class="me" id="st-me" title="Мій профіль і вихід">${avatar(S.me, 's')}<span class="sm b nm">${esc(S.me.first_name)}</span></div></div>
        <div class="st-shell"><nav class="st-nav" id="st-nav"></nav><main class="st-main">${S.viewAs ? `<div class="viewas">👁 Ви бачите панель як <b>${esc(S.viewAs.first_name)}</b> (${S.viewAs.role === 'master' ? 'майстер' : S.viewAs.role === 'admin' ? 'адмін' : 'власниця'}) — зміни вимкнено<button class="btn sm" id="va-x" title="Повернутись до своєї панелі">Вийти з перегляду</button></div>` : ''}<div class="pg" id="st-main"></div></main></div><nav class="st-tabs" id="st-tabs"></nav>`;
      const vx = $('#va-x'); if (vx) vx.onclick = exitViewAs;
      $('#st-bell').onclick = (e) => { e.stopPropagation(); notifPanel(); };
      $('#st-me').onclick = meMenu;
      pollNotif(); clearInterval(S.poll); S.poll = setInterval(pollNotif, 30000);
    }
    const nav = NAV();
    $('#st-nav').innerHTML = nav.map(([k, n, ic]) => `<a href="#/staff/${k}" class="${k === page ? 'on' : ''}" title="${TIPS[k]}">${ic}<span>${n}</span></a>`).join('') +
      `<div class="sep"></div><a href="#" target="_blank" title="Відкрити сторінку онлайн-запису, яку бачать клієнти">${IC.globe.replace('width="14" height="14"', 'width="20" height="20"')}<span>Сторінка запису</span></a>
       ${isStandalone() ? '' : `<a href="javascript:void 0" id="nav-app" title="Встановити панель як застосунок на телефон або компʼютер">📲<span>На телефон</span></a>`}
       <a href="javascript:void 0" id="nav-out" title="Вийти з програми на цьому пристрої">${IC.out}<span>Вийти</span></a>`;
    $('#nav-out').onclick = logout;
    const na = $('#nav-app'); if (na) na.onclick = () => installApp(true);
    const main4 = ['cal', 'clients', 'sched', isBoss() ? 'dash' : 'earn'];
    $('#st-tabs').innerHTML = nav.filter((x) => main4.includes(x[0])).map(([k, n, ic]) => `<a href="#/staff/${k}" class="${k === page ? 'on' : ''}" title="${TIPS[k]}">${ic}<span>${n.replace('Мій заробіток', 'Заробіток')}</span></a>`).join('') +
      `<a href="javascript:void 0" id="tab-more" class="${main4.includes(page) ? '' : 'on'}" title="Інші розділи">${IC.more}<span>Ще</span></a>`;
    $('#tab-more').onclick = () => {
      const s = sheet({ title: 'Розділи', body: nav.filter((x) => !main4.includes(x[0])).map(([k, n, ic]) => `<a class="list-row" href="#/staff/${k}" title="${TIPS[k]}"><span style="width:22px">${ic}</span><div class="grow nm">${n}</div>${IC.fwd}</a>`).join('') +
        `<a class="list-row" href="#" target="_blank" title="Сторінка, яку бачать клієнти"><span style="width:22px">${IC.globe}</span><div class="grow nm">Сторінка онлайн-запису</div></a>
         ${isStandalone() ? '' : `<div class="list-row" id="m-app" title="Іконка NaNa на екрані телефона — відкривається одразу календар"><span style="width:22px;text-align:center">📲</span><div class="grow nm">Встановити на телефон</div>${IC.fwd}</div>`}
         <div class="list-row" id="m-out" title="Вийти з програми"><span style="width:22px">${IC.out}</span><div class="grow nm">Вийти</div></div>` });
      $$('a.list-row', s.el).forEach((a) => a.addEventListener('click', () => s.close()));
      const ma = $('#m-app', s.el); if (ma) ma.onclick = () => { s.close(); installApp(true); };
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
    if (p !== 'cal' && S.calFull) { S.calFull = false; document.body.classList.remove('cal-full'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
    shell(p);
    const main = $('#st-main'); main.innerHTML = '<div class="spin"></div>';
    try { await pages[p](main, arg); } catch (e) { console.error(e); main.innerHTML = `<div class="card empty"><div class="big">😕</div>${esc(errMsg(e))}<div class="mt"><button class="btn" onclick="location.reload()" title="Перезавантажити сторінку">Оновити</button></div></div>`; }
  }

  /* ================= сповіщення ================= */
  const ONLINE = 'Новий онлайн-запис';
  async function pollNotif() {
    if (!S.me) return;
    const q = () => sb.from('notifications').select('id', { count: 'exact', head: true }).eq('staff_id', S.me.id).is('read_at', null);
    const [{ count }, { count: on }] = await Promise.all([q(), q().eq('title', ONLINE)]);
    const b = $('#st-bc'), o = $('#st-bo'); if (!b) return;
    const rest = (count || 0) - (on || 0);   // червоний — інші непрочитані, жовтий 🌐 — онлайн-записи
    b.textContent = rest > 99 ? '99+' : rest; b.classList.toggle('hide', !rest);
    o.textContent = '🌐 ' + (on > 99 ? '99+' : on); o.classList.toggle('hide', !on);
    $('#st-bell').title = `Сповіщення про записи${count ? ` — непрочитаних ${count}` : ''}${on ? `, з них онлайн-записів ${on}` : ''}`;
  }
  async function notifPanel() {
    let p = $('.npanel'); if (p) { p.remove(); return; }
    p = document.createElement('div'); p.className = 'npanel'; p.innerHTML = '<div class="spin"></div>'; document.body.appendChild(p);
    const off = (e) => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('click', off); } };
    setTimeout(() => document.addEventListener('click', off), 0);
    const { data } = await sb.from('notifications').select('*').eq('staff_id', S.me.id).order('created_at', { ascending: false }).limit(60);
    const all = data || [], isOn = (n) => n.title === ONLINE, isSelf = (n) => /^Ви /.test(n.title || '');
    const ic = (n) => (isSelf(n) ? '✍️' : isOn(n) ? '🌐' : { new: '🆕', cancel: '❌', move: '🔁' }[n.kind] || '🔔');
    let only = S.nOnly && all.some(isOn) ? 1 : 0;
    const draw = () => {
      const unOn = all.filter((n) => isOn(n) && !n.read_at).length, list = only ? all.filter(isOn) : all;
      p.innerHTML = `<div class="row sp" style="padding:12px 14px;border-bottom:1.5px solid var(--line)"><b>Сповіщення</b>
        <div class="row" style="gap:6px"><button class="btn sm" id="n-all" title="Позначити всі сповіщення прочитаними">Прочитати все</button>
        <a class="btn sm ico" href="#/staff/team/${S.me.id}" title="Налаштувати, які сповіщення отримувати">${IC.gear.replace('<svg', '<svg width="16" height="16"')}</a></div></div>
        <div class="chips n-f"><button class="chip ${only ? '' : 'on'}" data-nf="0" title="Усі сповіщення, зокрема ваші власні дії (сірим)">Усі</button><button class="chip ${only ? 'on' : ''}" data-nf="1" title="Лише записи, які клієнти зробили самі онлайн">🌐 Онлайн-записи${unOn ? ` <span class="n">${unOn}</span>` : ''}</button></div>` +
        (list.map((n) => `<div class="it ${n.read_at ? '' : 'un'} ${isSelf(n) ? 'self' : ''} ${isOn(n) ? 'onl' : ''}" data-id="${n.id}" data-day="${n.day || ''}" title="${isSelf(n) ? 'Ваша дія. ' : ''}Відкрити цей день у календарі"><div class="ic">${ic(n)}</div><div class="grow"><div class="b sm">${esc(n.title)}</div><div class="sm">${esc(n.body || '')}</div>
          <div class="xs mut">${esc(relDay(dayOf(n.created_at)))}, ${fmtT(n.created_at)}</div></div></div>`).join('') || `<div class="empty">${only ? 'Онлайн-записів поки немає' : 'Поки сповіщень немає'}</div>`);
      $('#n-all', p).onclick = async (e) => { e.stopPropagation(); await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('staff_id', S.me.id).is('read_at', null); p.remove(); pollNotif(); };
      $$('[data-nf]', p).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); only = +b.dataset.nf; S.nOnly = only; draw(); }));
      $$('.it', p).forEach((it) => (it.onclick = async () => {
        p.remove(); await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', it.dataset.id); pollNotif();
        if (it.dataset.day) go('#/staff/cal/' + it.dataset.day);
      }));
    };
    draw();
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
    if (!S.calSel) S.calSel = 'all';   // кожен (і майстриня) одразу бачить записи всіх майстрів; свій стовпчик — фільтром угорі
    const shown = S.calSel === 'all' ? ms : ms.filter((m) => m.id === S.calSel);
    const dd = await dayData(S.day, shown.map((m) => m.id));
    const appts = dd.appts.filter((a) => shown.some((m) => m.id === a.staff_id) && (S.showCancel || a.status !== 'cancel'));
    const act = dd.appts.filter((a) => shown.some((m) => m.id === a.staff_id) && a.status !== 'cancel');
    const paid = act.reduce((s, a) => s + +(a.payments?.amount || 0), 0), plan = act.filter((a) => a.status !== 'noshow').reduce((s, a) => s + +a.price, 0);
    main.innerHTML = `<div class="cal-bar">
        <button class="btn ico" id="c-prev" title="Попередній день">${IC.back}</button>
        <label class="cal-day" title="Обрати дату в календарі" style="cursor:pointer;position:relative">${esc(innerWidth < 600
          ? (S.day === today() ? 'Сьогодні, ' + fmtDay(S.day, { day: 'numeric', month: 'short' }) : fmtDay(S.day, { weekday: 'short', day: 'numeric', month: 'short' }))
          : (relDay(S.day) === fmtDay(S.day, { weekday: 'short', day: 'numeric', month: 'short' }) ? fmtDay(S.day, { weekday: 'long', day: 'numeric', month: 'long' }) : relDay(S.day) + ', ' + fmtDay(S.day, { day: 'numeric', month: 'long' })))}
          <input type="date" id="c-date" value="${S.day}" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
        <button class="btn ico" id="c-next" title="Наступний день">${IC.fwd}</button>
        ${S.day !== today() ? '<button class="btn sm" id="c-today" title="Повернутись до сьогодні">Сьогодні</button>' : ''}
        <div class="grow"></div>
        <button class="btn sm" id="c-mode" title="${S.calMode === 'grid' ? 'Показати списком' : 'Показати сіткою по годинах'}">${S.calMode === 'grid' ? IC.list.replace('<svg', '<svg width="16" height="16"') + '<span class="cb-t"> Список</span>' : IC.cal.replace('<svg', '<svg width="16" height="16"') + '<span class="cb-t"> Сітка</span>'}</button>
        <button class="btn sm" id="c-block" title="Закрити час або день для запису (відпустка, лікар…)">${IC.lock}<span class="cb-t"> Закрити час</span></button>
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
    $('#c-mode').onclick = () => { S.calMode = S.calMode === 'grid' ? 'list' : 'grid'; ls.set('calMode', S.calMode); if (S.calMode !== 'grid') calFull(body, false, true); pCal(main, S.day); };
    $('#c-new').onclick = () => newAppt({ mid: S.calSel !== 'all' ? S.calSel : isBoss() ? null : S.me.id, day: S.day });
    $('#c-block').onclick = () => blockSheet({ mid: S.calSel !== 'all' ? S.calSel : isBoss() ? null : S.me.id, day: S.day });
    $$('[data-sel]', main).forEach((b) => (b.onclick = () => { S.calSel = b.dataset.sel; pCal(main, S.day); }));
    // телефон: провести пальцем вліво / вправо по списку — наступний / попередній день
    if (S.calMode !== 'grid') { let x0 = null, y0 = 0;
      body.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX > 24 && t.clientX < innerWidth - 24 ? t.clientX : null; y0 = t.clientY; }, { passive: true });
      body.addEventListener('touchend', (e) => { if (x0 == null) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) nav(addDays(S.day, dx < 0 ? 1 : -1)); }, { passive: true }); }
    $('#c-cn').onchange = (e) => { S.showCancel = e.target.checked; pCal(main, S.day); };
  }
  // картку майстра з календаря відкривають власниця/адмін (будь-яку) і майстер (лише свою)
  const canCard = (m) => isBoss() || m.id === S.me.id;
  // візит: послуги одного клієнта в одного майстра підряд (без розриву) показуються одним блоком
  function visitGroups(list) {
    const out = [];
    list.forEach((a) => { const last = out[out.length - 1];
      if (last && a.status !== 'cancel' && last.status !== 'cancel' && last.items[0].visit_id === a.visit_id && Math.abs(Date.parse(a.starts_at) - Date.parse(last.items[last.items.length - 1].ends_at)) <= 6e4) {
        last.items.push(a); if (a.status === 'booked') last.status = 'booked';
      } else out.push({ status: a.status, items: [a] }); });
    return out;
  }
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
    const G = {};   // візит (група послуг) за id першого запису — для перетягування
    const cols = shown.map((m) => {
      const hh = hoursFor(m.id, S.day, dd.over);
      const off = !hh ? `<div class="off" style="top:0;height:${H}px"></div>` : (hh[0] > s0 ? `<div class="off" style="top:0;height:${y(hh[0])}px"></div>` : '') + (hh[1] < s1 ? `<div class="off" style="top:${y(hh[1])}px;height:${H - y(hh[1])}px"></div>` : '');
      const bl = dd.blocks.filter((b) => b.staff_id === m.id).map((b) => { const a = dayOf(b.starts_at) < S.day ? 0 : kParts(b.starts_at).min, e = dayOf(b.ends_at) > S.day ? 1440 : kParts(b.ends_at).min;
        return `<div class="blk" data-blk="${b.id}" style="top:${y(Math.max(a, s0))}px;height:${Math.max(18, (Math.min(e, s1) - Math.max(a, s0)) * PX)}px" title="Закритий час: ${esc(b.reason)}. Натисніть, щоб відкрити">${IC.lock} ${esc(b.reason)}</div>`; }).join('');
      const ap = visitGroups(appts.filter((a) => a.staff_id === m.id)).map((g) => { const a = g.items[0], z = g.items[g.items.length - 1]; G[a.id] = g;
        const st = kParts(a.starts_at).min, en = dayOf(z.ends_at) === S.day ? kParts(z.ends_at).min : 1440, box = `style="top:${y(st)}px;height:${Math.max(24, (en - st) * PX - 2)}px"`;
        if (g.items.length === 1) return `<div class="ap ${a.status}" data-ap="${a.id}" ${box} title="${esc(STATUS[a.status])}: ${esc(a.clients?.name)} — ${esc(svcById(a.service_id)?.name)}">${apHtml(a)}</div>`;
        return `<div class="ap grp ${g.status}" data-ap="${a.id}" ${box} title="Візит: ${g.items.length} ${plural(g.items.length, 'послуга', 'послуги', 'послуг')} — ${esc(a.clients?.name)}"><span class="t">${fmtT(a.starts_at)}–${fmtT(z.ends_at)}${a.visits?.source === 'online' ? ' 🌐' : ''} · ${g.items.length} ${plural(g.items.length, 'послуга', 'послуги', 'послуг')}</span><b>${esc(a.clients?.name || '')}</b>`
          + g.items.map((x) => `<div class="ap-ln ${x.status}" data-ap="${x.id}" title="Відкрити: ${esc(svcById(x.service_id)?.name)}">${fmtT(x.starts_at)} ${esc(svcById(x.service_id)?.name || '')}</div>`).join('') + `</div>`; }).join('');
      return `<div class="cal-col" data-col="${m.id}" style="height:${H}px" title="Натисніть на вільне місце, щоб записати клієнта">${lines}${off}${bl}${ap}</div>`;
    }).join('');
    const n = shown.length, phone = innerWidth < 600;   // на телефоні вужча колонка часу й майстрів — видно 2,5 майстра
    // вгору-вниз гортається вся сітка (.cal-wrap), вбік — лише стовпчики майстрів (.cal-xs) разом із шапкою;
    // так палець, що йде трохи навскіс, не тягне сітку по діагоналі
    const tw = phone ? 46 : 56, cols_t = `repeat(${n},minmax(${n > 1 ? (phone ? 128 : 150) : 200}px,1fr))`;
    body.innerHTML = `<div class="cal-wrap" style="--tw:${tw}px">
      <div class="cal-hd"><button type="button" class="cal-head tm cal-fs" id="c-fs" title="${S.calFull ? 'Вийти з повноекранного режиму (Esc)' : 'Відкрити сітку на весь екран'}">${S.calFull ? FS_OFF : FS_ON}</button>
        <div class="cal-hx"><div class="cal-hg" style="grid-template-columns:${cols_t}">${shown.map((m) => canCard(m) ? `<a class="cal-head lnk" href="#/staff/team/${m.id}" title="Відкрити картку: ${esc(fullName(m))}">${avatar(m, 's')}<span class="ell">${esc(m.first_name)}</span></a>` : `<div class="cal-head">${avatar(m, 's')}<span class="ell">${esc(m.first_name)}</span></div>`).join('')}</div></div></div>
      <div class="cal-bd"><div class="cal-times" style="height:${H}px">${times}</div>
        <div class="cal-xs"><div class="cal-grid" style="grid-template-columns:${cols_t}">${cols}</div></div></div></div>`;
    if (S.day === today()) { const nm = kParts(new Date(nowMs())).min; if (nm >= s0 && nm <= s1) $$('.cal-col', body).forEach((c) => c.insertAdjacentHTML('beforeend', `<div class="cal-now" style="top:${y(nm)}px"></div>`)); }
    const wrap = $('.cal-wrap', body), xs = $('.cal-xs', body), hx = $('.cal-hx', body);
    // шапка з іменами їде вбік разом зі стовпчиками (і навпаки — можна гортати за шапку)
    const sync = (from, to) => () => { if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft; };
    xs.addEventListener('scroll', sync(xs, hx), { passive: true }); hx.addEventListener('scroll', sync(hx, xs), { passive: true });
    calFull(body, S.calFull);
    // сітка займає весь екран до нижнього меню — гортається всередині, а не вся сторінка
    const fit = () => { if (!wrap.isConnected) return removeEventListener('resize', fit); if (wrap.classList.contains('full')) { wrap.style.maxHeight = ''; return; }
      const tabs = $('#st-tabs'), tb = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.offsetHeight : 0;
      wrap.style.maxHeight = Math.max(320, innerHeight - (wrap.getBoundingClientRect().top + scrollY) - tb - 14) + 'px'; };
    fit(); addEventListener('resize', fit); S.calFit = fit;
    $('#c-fs', body).onclick = () => calFull(body, !S.calFull, true);
    const first = appts[0] ? kParts(appts[0].starts_at).min : S.day === today() ? kParts(new Date(nowMs())).min : s0 + 60;
    wrap.scrollTop = Math.max(0, y(first) - 60);
    $$('.cal-col', body).forEach((c) => (c.onclick = (e) => {
      if (e.target.closest('.ap,.blk')) return;
      const r = c.getBoundingClientRect(); let m = s0 + (e.clientY - r.top) / PX; m = Math.floor(m / S.settings.step_min) * S.settings.step_min;
      newAppt({ mid: c.dataset.col, day: S.day, min: m });
    }));
    bindDay(body, dd);
    gridDrag(body, { s0, s1, PX, G });
  }

  /* ---- перетягування запису в сітці: мишкою одразу, пальцем — затиснути ~0,4 с і тягнути ---- */
  function gridDrag(body, { s0, s1, PX, G }) {
    if (S.dragOff) S.dragOff();
    const wrap = $('.cal-wrap', body); if (!wrap) return;
    const step = +S.settings.step_min || 15;
    let d = null, skipClick = false;
    const can = (g) => g.items.every((a) => a.status === 'booked') && (isBoss() || g.items[0].staff_id === S.me.id || g.items.every(madeByMe));
    const colAt = (x) => $$('.cal-col', body).find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    const durOf = (g) => (Date.parse(g.items[g.items.length - 1].ends_at) - Date.parse(g.items[0].starts_at)) / 6e4;
    const begin = (el, g, x, y, touch) => {
      const r = el.getBoundingClientRect();
      d = { el, g, x0: x, y0: y, dy: y - r.top, on: false, touch, t: 0, col: null, min: null };
      if (touch) d.t = setTimeout(() => { if (d && !d.on) { start(); move(d.x0, d.y0); } }, 380);
    };
    const start = () => {
      d.on = true; d.el.classList.add('drg-src');
      d.gh = d.el.cloneNode(true); d.gh.classList.add('drg-gh'); d.gh.removeAttribute('data-ap'); d.gh.removeAttribute('title');
      $$('[data-ap]', d.gh).forEach((x) => x.removeAttribute('data-ap'));
      d.gh.insertAdjacentHTML('afterbegin', '<div class="drg-t"></div>');
      document.body.classList.add('cal-dragging'); hideTip(); try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* */ }
    };
    const move = (x, y) => {
      if (!d) return;
      if (!d.on) { if (Math.hypot(x - d.x0, y - d.y0) < 8) return; if (d.touch) { clearTimeout(d.t); d = null; return; } start(); }
      const wr = wrap.getBoundingClientRect();   // біля краю — сітка сама прокручується
      if (y < wr.top + 70) wrap.scrollTop -= 14; else if (y > wr.bottom - 40) wrap.scrollTop += 14;
      const xs = $('.cal-xs', body); if (xs) { if (x < wr.left + 60) xs.scrollLeft -= 14; else if (x > wr.right - 30) xs.scrollLeft += 14; }
      const col = colAt(x) || d.col; if (!col) return;
      const dur = durOf(d.g), cr = col.getBoundingClientRect();
      let m = Math.round((s0 + (y - d.dy - cr.top) / PX) / step) * step;
      m = Math.max(s0, Math.min(m, Math.max(s0, s1 - dur)));
      if (d.gh.parentNode !== col) col.appendChild(d.gh);
      d.col = col; d.min = m; d.gh.style.top = (m - s0) * PX + 'px';
      $('.drg-t', d.gh).textContent = `${toHM(m)}–${toHM(m + dur)} · ${byId(col.dataset.col)?.first_name || ''}`;
    };
    const end = async () => {
      if (!d) return; clearTimeout(d.t); const x = d; d = null; document.body.classList.remove('cal-dragging');
      if (!x.on) return;
      skipClick = true; setTimeout(() => (skipClick = false), 450);
      const g = x.g, a0 = g.items[0], from = kParts(a0.starts_at).min, mid = x.col?.dataset.col;
      const back = () => { x.gh?.remove(); x.el.classList.remove('drg-src'); };
      if (!mid || x.min == null || (mid === a0.staff_id && x.min === from)) return back();
      if (!isBoss() && mid !== S.me.id && !g.items.every(madeByMe)) { back(); return toast('Переносити можна лише у свій стовпчик', 'bad'); }
      if (mid !== a0.staff_id) { const bad = g.items.find((a) => !msOf(mid).some((m) => m.service_id === a.service_id));
        if (bad) { back(); return toast(`${byId(mid)?.first_name || 'Цей майстер'} не виконує «${svcById(bad.service_id)?.name || 'цю послугу'}»`, 'bad', 4500); } }
      const delta = x.min - from, other = mid !== a0.staff_id;
      const ok = await confirmBox(`Перенести ${g.items.length > 1 ? 'візит' : 'запис'} на ${toHM(x.min)}${other ? ` до майстра ${byId(mid)?.first_name || ''}` : ''}?`,
        { ok: 'Перенести', sub: esc(`${a0.clients?.name || ''} · ${g.items.map((a) => svcById(a.service_id)?.name || '').join(', ')} · було ${fmtT(a0.starts_at)}${other ? ', ' + (byId(a0.staff_id)?.first_name || '') : ''}`) });
      if (!ok) return back();
      for (const a of delta > 0 ? [...g.items].reverse() : g.items) {   // по черзі, щоб послуги візиту не «наїхали» одна на одну
        const st = new Date(Date.parse(a.starts_at) + delta * 6e4), dur = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 6e4);
        const r = await withForce((force) => sb.rpc('staff_move', { p_appt: a.id, p_staff: mid, p_start: st.toISOString(), p_dur: dur, p_force: force }));
        if (r.cancelled) { back(); return refresh(); }
        if (r.error) { toast(errMsg(r.error), 'bad', 5000); return refresh(); }
      }
      toast(g.items.length > 1 ? 'Візит перенесено' : 'Запис перенесено'); refresh();
    };
    $$('.cal-col .ap', body).forEach((el) => { const g = G[el.dataset.ap]; if (!g || !can(g)) return;
      el.classList.add('drg'); el.title += ' · Перетягніть, щоб перенести';
      el.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); begin(el, g, e.clientX, e.clientY, false); } });
      el.addEventListener('touchstart', (e) => { if (e.touches.length === 1) begin(el, g, e.touches[0].clientX, e.touches[0].clientY, true); }, { passive: true });
      el.addEventListener('contextmenu', (e) => { if (d) e.preventDefault(); });
    });
    const mm = (e) => d && move(e.clientX, e.clientY);
    const tm = (e) => { if (!d) return; if (d.on) e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); };
    const up = () => end();
    const ck = (e) => { if (skipClick && body.contains(e.target)) { e.stopPropagation(); e.preventDefault(); skipClick = false; } };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', tm, { passive: false }); document.addEventListener('touchend', up); document.addEventListener('touchcancel', up);
    document.addEventListener('click', ck, true);
    S.dragOff = () => { [['mousemove', mm], ['mouseup', up], ['touchmove', tm], ['touchend', up], ['touchcancel', up]].forEach(([k, f]) => document.removeEventListener(k, f)); document.removeEventListener('click', ck, true); S.dragOff = null; };
  }
  // сітка на весь екран: верхня смужка з датою й кнопками, сітка — на весь екран (і браузер на весь екран, де можна)
  const FS_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const FS_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  function calFull(body, on, user = false) {
    on = !!on; S.calFull = on; document.body.classList.toggle('cal-full', on);
    calFullPos();
    const wrap = $('.cal-wrap', body), btn = $('#c-fs', body); if (!wrap) return;
    wrap.classList.toggle('full', on); if (on) wrap.style.maxHeight = '';   // на весь екран — до самого низу, без обмеження висоти
    if (btn) { btn.innerHTML = on ? FS_OFF : FS_ON; btn.title = on ? 'Вийти з повноекранного режиму (Esc)' : 'Відкрити сітку на весь екран'; }
    $('.cal-fbar', body)?.remove();
    if (on) {
      const lbl = relDay(S.day) === fmtDay(S.day, { weekday: 'short', day: 'numeric', month: 'short' }) ? fmtDay(S.day, { weekday: 'long', day: 'numeric', month: 'long' }) : relDay(S.day) + ', ' + fmtDay(S.day, { day: 'numeric', month: 'long' });
      wrap.insertAdjacentHTML('beforebegin', `<div class="cal-fbar"><button class="btn ico sm" data-fd="-1" title="Попередній день">${IC.back}</button><b class="ell">${esc(lbl)}</b><button class="btn ico sm" data-fd="1" title="Наступний день">${IC.fwd}</button>
        ${S.day !== today() ? '<button class="btn sm" data-fd="0" title="Повернутись до сьогодні">Сьогодні</button>' : ''}<div class="grow"></div>
        <button class="btn sm pri" id="cf-new" title="Створити новий запис">${IC.plus}<span class="cf-t"> Запис</span></button><button class="btn ico sm" id="cf-x" title="Вийти з повноекранного режиму (Esc)">${IC.x}</button></div>`);
      $$('[data-fd]', body).forEach((b) => (b.onclick = () => go('#/staff/cal/' + (+b.dataset.fd ? addDays(S.day, +b.dataset.fd) : today()))));
      $('#cf-new', body).onclick = () => $('#c-new')?.click();
      $('#cf-x', body).onclick = () => calFull(body, false, true);
    } else if (user && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!on && S.calFit) setTimeout(S.calFit, 50);
  }
  // де починається сітка на весь екран: на компʼютері — праворуч від меню й під верхньою смужкою (меню не закриває), на телефоні — весь екран
  function calFullPos() {
    const nav = $('#st-nav'), top = $('.st-top'), wide = nav && getComputedStyle(nav).display !== 'none';
    document.body.style.setProperty('--cf-l', wide ? Math.round(nav.getBoundingClientRect().right) + 'px' : '0px');
    document.body.style.setProperty('--cf-t', wide && top ? Math.round(top.getBoundingClientRect().bottom) + 'px' : '0px');
  }
  addEventListener('resize', () => S.calFull && calFullPos());
  // Esc / вихід з повноекранного режиму браузера — закрити й нашу «повноекранну» сітку
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.calFull && !sheets.length && $('#c-body')) calFull($('#c-body'), false, true); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.calFull && $('#c-body')) calFull($('#c-body'), false); });

  function drawList(body, shown, dd, appts) {
    body.innerHTML = `<div class="cal-list">${shown.map((m) => {
      const list = appts.filter((a) => a.staff_id === m.id); const hh = hoursFor(m.id, S.day, dd.over);
      const bl = dd.blocks.filter((b) => b.staff_id === m.id);
      return `<h4>${canCard(m) ? `<a class="m-lnk" href="#/staff/team/${m.id}" title="Відкрити картку: ${esc(fullName(m))}">${avatar(m, 's')} ${esc(fullName(m))}</a>` : `${avatar(m, 's')} ${esc(fullName(m))}`} <span class="mut sm" style="font-weight:600">${hh ? toHM(hh[0]) + '–' + toHM(hh[1]) : 'вихідний'} · ${list.length} ${plural(list.length, 'запис', 'записи', 'записів')}</span></h4>` +
        bl.map((b) => `<div class="ap-row noshow" data-blk="${b.id}" title="Закритий час. Натисніть, щоб відкрити"><div class="tm">${fmtT(b.starts_at)}<small>${fmtT(b.ends_at)}</small></div><div class="grow">${IC.lock} <b>${esc(b.reason)}</b></div></div>`).join('') +
        (visitGroups(list).map((g) => { const a = g.items[0], z = g.items[g.items.length - 1], many = g.items.length > 1;
          return `<div class="ap-row ${g.status}" data-ap="${a.id}" title="Відкрити запис"><div class="tm">${fmtT(a.starts_at)}<small>${fmtT(z.ends_at)}</small></div>
          <div class="grow"><div class="b ell">${esc(a.clients?.name || '')}${a.visits?.source === 'online' ? ' <span class="pill i" title="Клієнт записався онлайн">онлайн</span>' : ''}</div>`
          + (many ? g.items.map((x) => `<div class="sm mut ell ap-ln" data-ap="${x.id}" title="Відкрити: ${esc(svcById(x.service_id)?.name)}">${fmtT(x.starts_at)} · ${esc(svcById(x.service_id)?.name || '')}</div>`).join('') : `<div class="sm mut ell">${esc(svcById(a.service_id)?.name || '')}</div>`) + `</div>
          <div style="text-align:right"><span class="pill ${g.status}">${STATUS[g.status]}</span><div class="sm b" style="margin-top:4px">${money(g.items.reduce((t, x) => t + +(x.payments?.amount ?? x.price), 0))}</div></div></div>`; }).join('') ||
          (hh ? `<div class="ap-row" style="border-left-color:var(--line2);cursor:pointer" data-new="${m.id}" title="Створити запис до ${esc(m.first_name)}"><div class="grow mut">Записів немає — ${IC.plus} записати</div></div>` : ''));
    }).join('')}</div>`;
    $$('[data-new]', body).forEach((r) => (r.onclick = () => newAppt({ mid: r.dataset.new, day: S.day })));
    bindDay(body, dd);
  }
  function bindDay(body, dd) {
    S.dayAppts = dd.appts;
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
  // запис, який майстриня сама створила до іншої майстрині, — може перенести або скасувати (виправити помилку)
  const madeByMe = (a) => !isBoss() && a.status === 'booked' && !!a.created_by && a.created_by === S.me.user_id && a.staff_id !== S.me.id;
  const staffByUser = (uid) => uid && S.staff.find((x) => x.user_id === uid);
  async function openAppt(a) {
    const m = byId(a.staff_id), sv = svcById(a.service_id), c = a.clients || {};
    const mine = isBoss() || a.staff_id === S.me.id, made = madeByMe(a);
    const who = a.visits?.source === 'online' ? 'клієнт(ка) онлайн' : staffByUser(a.created_by) ? (a.created_by === S.me.user_id ? 'ви' : staffByUser(a.created_by).first_name) : '';
    const pay = a.payments;
    const actions = made ? `
        <button class="btn" data-act="move" title="Ви створили цей запис — можна змінити день, час або майстра">Перенести</button>
        <button class="btn red" data-act="cancel" title="Ви створили цей запис — можна скасувати, якщо помилились">Скасувати</button>`
      : !mine ? '' : a.status === 'booked' ? `
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
        ${who ? `<dt>Записав(ла)</dt><dd>${esc(who)}${a.created_at ? ` · ${esc(relDay(dayOf(a.created_at)))}, ${fmtT(a.created_at)}` : ''}</dd>` : ''}
        ${pay ? `<dt>Оплачено</dt><dd>${money(pay.amount)} · ${esc(pay.method)}</dd>` : ''}
        ${a.cancel_reason ? `<dt>Причина</dt><dd>${esc(a.cancel_reason)}</dd>` : ''}${a.cancelled_by ? `<dt>Скасував(ла)</dt><dd>${a.cancelled_by === 'client' ? 'клієнт онлайн' : 'салон'}</dd>` : ''}
        ${a.visits?.comment ? `<dt>Коментар</dt><dd>${esc(a.visits.comment)}</dd>` : ''}</dl><div id="a-visit"></div><div id="a-log"></div>
      ${mine && ['booked', 'done'].includes(a.status) ? `<div class="row wrap mt" style="gap:8px">
        ${a.status === 'booked' || isBoss() ? `<button class="btn sm" id="a-svc" title="Якщо фактично зробили іншу послугу — змінити її, ціну й тривалість">✎ Змінити послугу</button>` : ''}
        <button class="btn sm" id="a-add" title="Додати до цього візиту ще одну послугу (одразу після цієї)">${IC.plus} Додати послугу</button></div>` : ''}
      <div class="sect"><h3>${esc(c.name || '')} <a class="btn sm ghost" href="javascript:void 0" id="a-cl" title="Відкрити картку клієнта з історією візитів">картка ${IC.fwd.replace('width="20" height="20"', 'width="14" height="14"')}</a></h3>
        <div class="sm">${esc(fmtPhone(c.phone))} · зручно: <b>${esc(CONTACTS[c.contact]?.[0] || 'дзвінок')}</b>${c.instagram ? ' · ' + igLink(c.instagram, true) : ''}</div>${c.note ? `<div class="hint">📝 ${esc(c.note)}</div>` : ''}${contactLinks(c)}${a.status === 'booked' && Date.parse(a.starts_at) > nowMs() ? `<button class="btn sm mt" id="a-rem" title="Готовий текст нагадування для Viber, Telegram або SMS">${IC.bell} Нагадати про візит</button>` : ''}</div>
      <label class="lb mt" for="a-note">Нотатка до запису</label><textarea class="inp" id="a-note" rows="2" placeholder="Видно лише персоналу" ${mine ? '' : 'disabled'}>${esc(a.note || '')}</textarea>`,
      foot: actions });
    const note = $('#a-note', s.el);
    note.onchange = async () => { const { error } = await sb.from('appointments').update({ note: note.value.trim() || null }).eq('id', a.id); if (error) toast(errMsg(error), 'bad'); else { a.note = note.value.trim(); toast('Нотатку збережено'); } };
    $('#a-cl', s.el).onclick = () => { s.close(); clientSheet(c.id); };
    const sb1 = $('#a-svc', s.el); if (sb1) sb1.onclick = () => changeSvcSheet(a, () => { s.close(); refresh(); });
    // усі послуги цього візиту (як в EasyWeek): список + нова послуга стає одразу після останньої
    const vq = sb.from('appointments').select('id,starts_at,ends_at,service_id,staff_id,price,status').eq('visit_id', a.visit_id).neq('status', 'cancel').order('starts_at');
    vq.then(({ data: vis }) => { if (!vis || vis.length < 2 || !s.ov.isConnected) return;
      $('#a-visit', s.el).innerHTML = `<div class="sect" style="margin-top:12px"><h3 style="margin-bottom:6px">Послуги у візиті <span class="pill g">${vis.length}</span></h3>${vis.map((x) => `<div class="vis-ln ${x.id === a.id ? 'on' : ''}" ${x.id === a.id ? '' : `data-vis="${x.id}" title="Відкрити цю послугу"`}>
        <div class="grow"><div class="b ell">${esc(svcById(x.service_id)?.name || '')}</div><div class="xs mut">${fmtT(x.starts_at)}–${fmtT(x.ends_at)} · ${esc(byId(x.staff_id)?.first_name || '')}</div></div><b class="nw">${money(x.price)}</b></div>`).join('')}
        <div class="row sp sm b" style="padding:6px 2px 0"><span>Разом</span><span>${money(vis.reduce((t, x) => t + +x.price, 0))}</span></div></div>`;
      $$('[data-vis]', s.el).forEach((r) => (r.onclick = () => { const o = (S.dayAppts || []).find((x) => x.id === r.dataset.vis); if (o) { s.close(); openAppt(o); } })); });
    // історія змін: хто й коли створив, переніс, скасував, змінив послугу чи ціну
    sb.from('appt_log').select('at,who,what').eq('appointment_id', a.id).order('at').then(({ data: log, error }) => {
      if (error || !log || !log.length || !s.ov.isConnected) return;
      $('#a-log', s.el).innerHTML = `<details class="a-log"${log.length <= 3 ? ' open' : ''}><summary>Історія змін <span class="pill g">${log.length}</span></summary>${log.map((x) =>
        `<div class="lg-ln"><span class="xs mut nw">${esc(relDay(dayOf(x.at)))}, ${fmtT(x.at)}</span><span class="sm"><b>${esc(x.who || 'система')}</b> — ${esc(x.what)}</span></div>`).join('')}</details>`; });
    const ab = $('#a-add', s.el); if (ab) ab.onclick = async () => {
      const { data: vis } = await vq; const end = (vis || []).reduce((t, x) => Math.max(t, Date.parse(x.ends_at)), Date.parse(a.ends_at));
      s.close(); newAppt({ client: { id: c.id, name: c.name, phone: c.phone }, mid: a.staff_id, day: dayOf(new Date(end).toISOString()), min: kParts(new Date(end).toISOString()).min, visit: a.visit_id }); };
    const rb = $('#a-rem', s.el); if (rb) rb.onclick = () => remindSheet(a.id, c);
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
  // «Завершити й оплатити»: якщо у візиті кілька незавершених послуг — закриваємо всі разом (кожна — своя оплата)
  async function paySheet(a, done) {
    if (a.status === 'booked' && a.visit_id) {
      const { data: vis } = await sb.from('appointments').select('id,staff_id,service_id,starts_at,price,status').eq('visit_id', a.visit_id).eq('status', 'booked').order('starts_at');
      const mineOk = (x) => isBoss() || x.staff_id === S.me.id;
      const items = (vis || []).filter(mineOk);
      if (items.length > 1) return payVisitSheet(a, items, (vis || []).filter((x) => !mineOk(x)), done);
    }
    return paySingle(a, done);
  }
  function payVisitSheet(a, items, others, done) {
    const methods = S.settings.pay_methods || ['Готівка'];
    let method = methods[0];
    const s = sheet({ title: 'Оплата візиту', body: `<div class="sm mut mb">${esc(a.clients?.name || '')} · ${items.length} ${plural(items.length, 'послуга', 'послуги', 'послуг')}</div>
      <div id="pv-l">${items.map((x) => `<label class="pv-row"><input type="checkbox" data-pv="${x.id}" checked title="Завершити й оплатити цю послугу">
        <div class="grow"><div class="b ell">${esc(svcById(x.service_id)?.name || '')}</div><div class="xs mut">${fmtT(x.starts_at)} · ${esc(byId(x.staff_id)?.first_name || '')} · ціна ${money(x.price)}</div></div>
        <input class="inp" type="number" inputmode="decimal" min="0" step="1" data-pa="${x.id}" value="${+x.price}" title="Сума за цю послугу, ₴"></label>`).join('')}</div>
      <div class="pv-tot"><span>Разом</span><b id="pv-sum"></b></div>
      <div class="hint">Суму кожної послуги можна змінити, якщо була знижка чи доплата.${others.length ? ` Послуги інших майстрів (${others.map((x) => esc(svcById(x.service_id)?.name || '')).join(', ')}) завершують вони.` : ''}</div>
      <label class="lb">Спосіб оплати</label><div class="chips" id="p-m">${methods.map((x) => `<button class="chip ${x === method ? 'on y' : ''}" data-m="${esc(x)}" title="Оплата: ${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div id="p-qr" class="mt"></div>
      <div class="hint mt">Майстрам: <b id="pv-co"></b></div>`,
      foot: `<button class="btn" data-x2 title="Закрити без змін">Скасувати</button><button class="btn pri" id="p-ok" title="Завершити й оплатити обрані послуги (Ctrl/⌘+Enter)">✓ Зберегти</button>` });
    const sel = () => items.filter((x) => $(`[data-pv="${x.id}"]`, s.el).checked).map((x) => ({ x, v: $(`[data-pa="${x.id}"]`, s.el).value }));
    const upd = async () => {
      const l = sel(); const tot = l.reduce((t, r) => t + (+r.v || 0), 0);
      $('#pv-sum', s.el).textContent = money(tot) + (l.length < items.length ? ` · ${l.length} з ${items.length}` : '');
      const per = {}; l.forEach((r) => (per[r.x.staff_id] = (per[r.x.staff_id] || 0) + Math.round((+r.v || 0) * payPct(r.x.staff_id)) / 100));
      $('#pv-co', s.el).textContent = Object.entries(per).map(([id, m]) => `${byId(id)?.first_name || ''} ${money(m)}`).join(' · ') || '—';
      $('#p-ok', s.el).textContent = l.length ? `✓ Зберегти · ${money(tot)}` : '✓ Зберегти';
      const box = $('#p-qr', s.el);
      if (/qr|apple|google|картк/i.test(method) && S.settings.pay_link) box.innerHTML = `<div class="qr-box">${await qrSvg(S.settings.pay_link)}</div><div class="hint" style="text-align:center">Клієнт сканує камерою телефону</div>`; else box.innerHTML = '';
    };
    $$('[data-pv],[data-pa]', s.el).forEach((x) => (x.oninput = x.onchange = upd)); upd();
    $$('[data-m]', s.el).forEach((b) => (b.onclick = () => { method = b.dataset.m; $$('[data-m]', s.el).forEach((x) => { x.classList.toggle('on', x === b); x.classList.toggle('y', x === b); }); upd(); }));
    $('[data-x2]', s.el).onclick = s.close;
    s.el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') $('#p-ok', s.el).click(); });
    $('#p-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const l = sel(); if (!l.length) return toast('Позначте хоча б одну послугу', 'bad');
      const bad = l.filter((r) => r.v === '' || !(+r.v >= 0)); if (bad.length) { bad.forEach((r) => $(`[data-pa="${r.x.id}"]`, s.el).classList.add('err')); return toast('Перевірте суми', 'bad'); }
      let ok = 0, sum = 0;
      for (const r of l) { const { error } = await sb.rpc('appt_status', { p_appt: r.x.id, p_status: 'done', p_amount: +r.v, p_method: method });
        if (error) { toast(`${svcById(r.x.service_id)?.name}: ${errMsg(error)}`, 'bad', 6000); break; } ok++; sum += +r.v; }
      if (!ok) return;
      s.close(); toast(`Оплату збережено · ${ok} ${plural(ok, 'послуга', 'послуги', 'послуг')} · ${money(sum)}`); done();
    });
  }
  function paySingle(a, done) {
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
  /* ---------- змінити послугу в записі (фактично зробили іншу) ---------- */
  async function svcEditOk() {   // працює, коли в базі є функція appt_service
    if (S.svcEditOk == null) { const { error } = await sb.rpc('appt_service', { p_appt: null, p_service: null });
      S.svcEditOk = !(error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''))); }
    return S.svcEditOk;
  }
  async function changeSvcSheet(a, done) {
    if (!(await svcEditOk())) return toast('Зміна послуги ще не увімкнена в базі — потрібне оновлення бази', 'bad', 5000);
    const own = msOf(a.staff_id);   // лише послуги, закріплені за цим майстром
    if (!own.length) return toast(`У ${byId(a.staff_id)?.first_name || 'майстра'} немає закріплених послуг — додайте їх у «Послуги»`, 'bad', 5000);
    const st = { sid: a.service_id };
    const s = sheet({ title: 'Змінити послугу', body: `<div class="sm mut mb">${esc(a.clients?.name || '')} · ${esc(relDay(dayOf(a.starts_at)))}, ${fmtT(a.starts_at)} · ${esc(byId(a.staff_id)?.first_name || '')}</div>
      <label class="lb" for="cs-s">Послуга <span class="mut" style="font-weight:600">· лише послуги ${esc(byId(a.staff_id)?.first_name || 'майстра')}</span></label><select class="inp" id="cs-s">${own.map((x) => `<option value="${x.service_id}">${esc(x.svc.name)} — ${durTxt(x.dur)} · ${money(x.price)}</option>`).join('')}</select>
      <div class="two"><div><label class="lb" for="cs-u">Тривалість, хв</label><input class="inp" id="cs-u" type="number" min="5" step="5"></div><div><label class="lb" for="cs-p">Ціна, ₴</label><input class="inp" id="cs-p" type="number" min="0" step="10"></div></div>
      <div class="hint">Початок лишається ${fmtT(a.starts_at)}, кінець зміниться за новою тривалістю.${a.status === 'done' ? ' Візит уже оплачено — суму оплати змініть окремо кнопкою «Змінити оплату».' : ''}</div>`,
      foot: `<button class="btn" data-x2 title="Закрити без змін">Скасувати</button><button class="btn pri" id="cs-ok" title="Зберегти іншу послугу">Зберегти</button>` });
    const sel = $('#cs-s', s.el), u = $('#cs-u', s.el), pr = $('#cs-p', s.el); niceSelect(sel);
    const fill = (keep) => { const o = S.ms.find((x) => x.staff_id === a.staff_id && x.service_id === sel.value && x.is_active), sv = svcById(sel.value);
      if (keep) { u.value = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 6e4); pr.value = +a.price; }
      else { u.value = o?.dur || sv?.dur || ''; pr.value = +(o?.price ?? sv?.price ?? 0); } };
    if ([...sel.options].some((o) => o.value === a.service_id)) { sel.value = a.service_id; fill(true); } else fill(false);
    sel.onchange = () => fill(false);
    $('[data-x2]', s.el).onclick = s.close;
    $('#cs-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const dur = +u.value, price = +pr.value;
      if (!sel.value) return toast('Оберіть послугу', 'bad'); if (!(dur >= 5) || !(price >= 0)) return toast('Перевірте тривалість і ціну', 'bad');
      const r = await withForce((force) => sb.rpc('appt_service', { p_appt: a.id, p_service: sel.value, p_dur: dur, p_price: price, p_force: force }));
      if (r.cancelled) return; if (r.error) return toast(errMsg(r.error), 'bad', 5000);
      s.close(); toast('Послугу змінено'); done();
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
      ${isBoss() || madeByMe(a) ? `<label class="lb" for="mv-m">Майстер <span class="mut" style="font-weight:600">· хто виконує цю послугу</span></label><select class="inp" id="mv-m">${masters().filter((m) => m.id === st.mid || msOf(m.id).some((x) => x.service_id === a.service_id)).map((m) => `<option value="${m.id}" ${m.id === st.mid ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}</select>` : ''}
      <div class="two"><div><label class="lb" for="mv-d">Дата</label><input class="inp" type="date" id="mv-d" value="${st.day}"></div>
      <div><label class="lb" for="mv-u">Тривалість, хв</label><input class="inp" type="number" id="mv-u" min="5" step="5" value="${st.dur}"></div></div>
      <label class="lb">Час</label><div id="mv-t"></div>`,
      foot: `<button class="btn" data-x2 title="Не переносити">Скасувати</button><button class="btn pri" id="mv-ok" title="Зберегти новий час">Перенести</button>` });
    const tp = () => timePicker($('#mv-t', s.el), { mid: st.mid, dur: st.dur, day: st.day, min: st.min, ignoreId: a.id, onPick: (m) => (st.min = m) });
    tp();
    const mm = $('#mv-m', s.el); if (mm) { niceSelect(mm); mm.onchange = () => { st.mid = mm.value; tp(); }; }
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
  function newAppt({ mid = null, day = today(), min = null, client = null, visit = null } = {}) {
    const ms = masters();
    if (!mid) mid = ms.length === 1 ? ms[0].id : null;
    const st = { mid, day, min, client, sid: null, dur: null, price: null, contact: 'call' };
    const s = sheet({ title: visit ? 'Додати послугу до візиту' : 'Новий запис', wide: false, body: `
      <label class="lb">Клієнт <span class="req">*</span></label><div id="na-c"></div>
      <label class="lb" for="na-m">Майстер <span class="req">*</span></label>
      <select class="inp" id="na-m" title="До якого майстра записати клієнта (можна до будь-кого)"><option value="">— оберіть майстра —</option>${ms.map((m) => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(fullName(m))}</option>`).join('')}</select>
      <label class="lb" for="na-s">Послуга <span class="req">*</span></label><select class="inp" id="na-s"></select>
      <div class="two"><div><label class="lb" for="na-u">Тривалість, хв</label><input class="inp" id="na-u" type="number" min="5" step="5"></div><div><label class="lb" for="na-p">Ціна, ₴</label><input class="inp" id="na-p" type="number" min="0" step="10"></div></div>
      <label class="lb ${visit ? 'hide' : ''}" for="na-d">Дата <span class="req">*</span></label><input class="inp ${visit ? 'hide' : ''}" id="na-d" type="date" value="${day}">
      <label class="lb">Час <span class="req">*</span></label><div id="na-t"><div class="hint">Спершу оберіть майстра й послугу</div></div>
      <label class="lb" for="na-n">Нотатка</label><input class="inp" id="na-n" placeholder="Видно лише персоналу">`,
      foot: `<button class="btn" data-x2 title="Закрити без збереження">Скасувати</button><button class="btn pri" id="na-ok" title="Створити запис (Ctrl/⌘+Enter)">Записати</button>` });
    const el = s.el;
    // клієнт
    const drawClient = () => {
      const c = $('#na-c', el);
      if (st.client) {
        c.innerHTML = `<div class="list-row" style="cursor:default;margin:0"><span class="ava s y">${esc((st.client.name || '?')[0])}</span><div class="grow"><div class="nm">${esc(st.client.name)}</div><div class="sub">${esc(fmtPhone(st.client.phone))}</div></div><button class="btn ghost ico sm" id="na-cx" title="Обрати іншого клієнта">${IC.x}</button></div>`;
        if (visit) $('#na-cx', c)?.remove(); else $('#na-cx', c).onclick = () => { st.client = null; drawClient(); };   // у візиті клієнт той самий
        return;
      }
      c.innerHTML = `<div class="search">${IC.search}<input class="inp" id="na-q" placeholder="Пошук: імʼя або телефон" autocomplete="off" autofocus></div><div id="na-sg"></div>
        <div id="na-newc" class="hide"><div class="two mt"><input class="inp" id="na-cn" placeholder="Імʼя клієнта"><input class="inp" id="na-cp" type="tel" placeholder="+380…"></div><div id="na-dup"></div>
        <div class="chips mt" id="na-cc">${Object.entries(CONTACTS).map(([k, [n]]) => `<button type="button" class="chip ${k === st.contact ? 'on' : ''}" data-cc="${k}" title="Клієнту зручно: ${n}">${n}</button>`).join('')}</div></div>`;
      const q = $('#na-q', c), sg = $('#na-sg', c);
      let tmr;
      q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
        const v = q.value.trim().replace(/[,()*%\\"]/g, ' ').trim();
        if (v.length < 2) { sg.innerHTML = ''; $('#na-newc', c).classList.add('hide'); return; }
        const digits = v.replace(/\D/g, '');
        let rq = sb.from('clients').select('id,name,phone,contact,instagram').limit(8);
        const vi = igNick(v) || v.replace(/^@/, '');
        rq = digits.length >= 3 && !/[a-z]/i.test(v) ? rq.ilike('phone', '%' + digits + '%') : rq.or(`name.ilike.*${v}*,instagram.ilike.*${vi}*`);
        const { data } = await rq;
        sg.innerHTML = `<div class="sugg">${(data || []).map((x) => `<div data-cid="${x.id}" title="Обрати цього клієнта"><b>${esc(x.name)}</b> <span class="mut sm">${esc(fmtPhone(x.phone))}${x.instagram ? ' · @' + esc(x.instagram) : ''}</span></div>`).join('')}
          <div data-newc title="Створити нового клієнта">${IC.plus} <b>Новий клієнт</b>${digits.length >= 9 ? ' ' + esc(v) : ''}</div></div>`;
        $$('[data-cid]', sg).forEach((d) => (d.onclick = () => { st.client = data.find((x) => x.id === d.dataset.cid); drawClient(); }));
        $('[data-newc]', sg).onclick = () => { sg.innerHTML = ''; $('#na-newc', c).classList.remove('hide'); if (digits.length >= 9) $('#na-cp', c).value = v; else $('#na-cn', c).value = v; ($('#na-cn', c).value ? $('#na-cp', c) : $('#na-cn', c)).focus(); };
      }, 220); };
      $$('[data-cc]', c).forEach((b) => (b.onclick = () => { st.contact = b.dataset.cc; $$('[data-cc]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
      phoneDupWatch($('#na-cp', c), $('#na-dup', c), { label: 'Обрати цього клієнта', onPick: (x) => { st.client = x; drawClient(); } });
    };
    drawClient();
    // майстер і послуга
    const msel = $('#na-m', el), ssel = $('#na-s', el); niceSelect(msel); niceSelect(ssel);
    const fillSvc = () => {
      // лише послуги, закріплені за майстром (інших майстер не виконує)
      const own = st.mid ? msOf(st.mid) : [];
      ssel.innerHTML = !st.mid ? `<option value="">— спершу оберіть майстра —</option>`
        : !own.length ? `<option value="">— у майстра немає послуг (додайте в «Послуги») —</option>`
        : `<option value="">— оберіть послугу —</option>` + own.map((x) => `<option value="${x.service_id}">${esc(x.svc.name)} — ${durTxt(x.dur)} · ${money(x.price)}</option>`).join('');
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
    const drawTime = () => {
      if (visit) { $('#na-t', el).innerHTML = `<div class="hint" style="margin:0">Одразу після попередньої послуги, без перерви: <b>${toHM(st.min)}${st.dur ? '–' + toHM(st.min + st.dur) : ''}</b></div>`; return; }
      if (!st.mid || !st.dur) { $('#na-t', el).innerHTML = '<div class="hint">Спершу оберіть майстра й послугу</div>'; return; }
      timePicker($('#na-t', el), { mid: st.mid, dur: st.dur, day: st.day, min: st.min, onPick: (m) => (st.min = m) }); };
    msel.onchange = () => { st.mid = msel.value || null; fillSvc(); };
    ssel.onchange = pickSvc;
    $('#na-u', el).onchange = (e) => { st.dur = Math.max(5, +e.target.value || 0) || null; drawTime(); };
    $('#na-p', el).onchange = (e) => (st.price = e.target.value === '' ? null : +e.target.value);
    $('#na-d', el).onchange = (e) => { if (e.target.value) { st.day = e.target.value; drawTime(); } };
    if (!isBoss() && !st.mid && S.me.is_bookable) { st.mid = S.me.id; msel.value = S.me.id; }   // за замовчуванням — до себе, але можна обрати будь-кого
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
        p_start: kDate(st.day, st.min).toISOString(), p_dur: st.dur, p_price: st.price, p_note: $('#na-n', el).value, p_force: force, p_visit: visit }));
      if (r.cancelled) return; if (r.error) return toast(errMsg(r.error), 'bad', 5000);
      s.close(); toast(visit ? 'Послугу додано до візиту' : 'Запис створено'); S.clientsCache = null;
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
      fresh: ['Нові за 30 днів', (c) => daysBetween(dayOf(c.created_at), t) <= 30], ig: ['Є Instagram', (c) => !!c.instagram], noshow: ['Не приходили', (c) => c.noshows > 0], never: ['Без візитів', (c) => !c.visits && !c.next_visit] };
    S.cf = arg && F[arg] ? arg : S.cf || 'all'; S.cq = S.cq || ''; S.csort = S.csort || 'last';
    main.innerHTML = `<div class="pg-h"><h1>Клієнти</h1>${isBoss() ? `<button class="btn" id="cl-imp" title="Додати клієнтів з таблиці Excel (наприклад, експорт з EasyWeek)">⬆ Імпорт</button><button class="btn" id="cl-copy" title="Скопіювати телефони клієнтів зі списку нижче — для розсилки"><span class="lg-t">Скопіювати номери</span><span class="ph-t">📋 Номери</span></button><button class="btn" id="cl-copyig" title="Скопіювати нікнейми Instagram клієнтів зі списку нижче — для розсилки в директ"><span class="lg-t">Скопіювати нікнейми</span><span class="ph-t">📋 Нікнейми</span></button>` : ''}<button class="btn pri" id="cl-new" title="Записати клієнта">${IC.plus} Запис</button></div>
      <div class="search mb">${IC.search}<input class="inp" id="cl-q" placeholder="Пошук за імʼям, телефоном або Instagram" value="${esc(S.cq)}"></div>
      <div class="chips scroll mb">${Object.entries(F).map(([k, [n, f]]) => `<button class="chip ${S.cf === k ? 'on' : ''}" data-f="${k}" title="Фільтр: ${esc(n)}">${esc(n)} <span class="n">${rows.filter(f).length}</span></button>`).join('')}</div>
      <div class="row sp mb"><div class="sm mut" id="cl-cnt"></div><select class="inp" id="cl-sort" style="max-width:230px;min-height:36px;padding:6px 10px" title="Сортування списку">
        <option value="last">Давно не були — вгорі</option><option value="recent">Нещодавні візити</option><option value="spent">Більше витратили</option><option value="visits">Більше візитів</option><option value="name">За імʼям</option></select></div>
      <div id="cl-list"></div>`;
    $('#cl-sort').value = S.csort;
    const draw = () => {
      const q = S.cq.toLowerCase(), qd = q.replace(/\D/g, '');
      const qi = igNick(q) || q.replace(/^@/, '');
      let list = rows.filter(F[S.cf][1]).filter((c) => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.phone.replace(/\D/g, '').includes(qd)) || (qi.length >= 2 && (c.instagram || '').toLowerCase().includes(qi.toLowerCase())));
      const lv = (c) => (c.last_visit ? Date.parse(c.last_visit) : 0);
      list.sort({ last: (a, b) => lv(a) - lv(b) || a.name.localeCompare(b.name), recent: (a, b) => lv(b) - lv(a), spent: (a, b) => b.spent - a.spent, visits: (a, b) => b.visits - a.visits, name: (a, b) => a.name.localeCompare(b.name, 'uk') }[S.csort]);
      if (S.csort === 'last') list.sort((a, b) => (a.last_visit ? 0 : 1) - (b.last_visit ? 0 : 1) || lv(a) - lv(b));
      $('#cl-cnt').textContent = `${list.length} ${plural(list.length, 'клієнт', 'клієнти', 'клієнтів')}`;
      S.cshown = list;
      $('#cl-list').innerHTML = list.slice(0, 300).map((c) => { const ld = lastDays(c);
        return `<div class="list-row" data-c="${c.id}" title="Відкрити картку клієнта"><span class="ava s ${isStale(c) ? '' : 'y'}">${esc(c.name[0] || '?')}</span><div class="grow">
          <div class="nm ell">${esc(c.name)} ${igLink(c.instagram)}${isStale(c) ? `<span class="pill w" title="Не було понад ${stale} днів і немає запису — варто нагадати про себе">не було ${ld} ${plural(ld, 'день', 'дні', 'днів')}</span>` : ''}${c.next_visit ? `<span class="pill booked" title="Найближчий запис">${esc(relDay(dayOf(c.next_visit)))}</span>` : ''}${c.demo ? ' <span class="pill g">демо</span>' : ''}</div>
          <div class="sub ell">${esc(fmtPhone(c.phone))} · ${c.last_visit ? 'був(ла) ' + esc(relDay(dayOf(c.last_visit))) : 'ще не був(ла)'} · ${c.visits} ${plural(c.visits, 'візит', 'візити', 'візитів')}${isBoss() ? ' · ' + money(c.spent) : ''}</div></div>
          ${isStale(c) ? `<button class="btn sm inv-b" data-inv="${c.id}" title="Готовий текст запрошення — відкрити Viber / Telegram клієнта">${IC.bell}<span>Нагадати</span></button>` : ''}
          <span class="mut" style="width:20px" title="Зручний спосіб звʼязку: ${esc(CONTACTS[c.contact]?.[0] || '')}">${CONTACTS[c.contact]?.[1] || ''}</span></div>`; }).join('') +
        (list.length > 300 ? `<div class="hint" style="text-align:center">Показано 300 з ${list.length}. Уточніть пошук.</div>` : '') || '<div class="card empty"><div class="big">🔎</div>Нікого не знайдено</div>';
      $$('[data-c]', main).forEach((r) => (r.onclick = () => clientSheet(r.dataset.c)));
      $$('[data-inv]', main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); inviteSheet(rows.find((x) => x.id === b.dataset.inv)); }));
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
    const im = $('#cl-imp'); if (im) im.onclick = () => importSheet(rows);
    const ci = $('#cl-copyig'); if (ci) ci.onclick = async () => {
      const L = (S.cshown || []).filter((c) => c.instagram);
      if (!L.length) return toast('У списку нижче немає клієнтів з Instagram', 'bad');
      try { await navigator.clipboard.writeText(L.map((c) => `${c.name}\t@${c.instagram}\thttps://instagram.com/${c.instagram}`).join('\n')); toast(`Скопійовано ${L.length} ${plural(L.length, 'нікнейм', 'нікнейми', 'нікнеймів')}`); } catch (e) { toast('Не вдалося скопіювати', 'bad'); }
    };
  }

  /* імпорт клієнтів з Excel / CSV (EasyWeek: Клієнти → Експорт) — лише імʼя, телефон, день народження, дата створення */
  let _xlsx;
  const loadXlsx = () => (window.XLSX ? Promise.resolve() : (_xlsx ||= new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => { _xlsx = null; bad(new Error('Не вдалося завантажити читач Excel. Перевірте інтернет.')); }; document.head.appendChild(s); })));
  function parseClients(table) {   // table: масив рядків (масивів); 1-й рядок — заголовки
    const H = (table[0] || []).map((h) => String(h ?? '').trim().toLowerCase().replace(/[ʼ’`]/g, "'"));
    const col = (...names) => H.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    const iN = col("ім'я", 'імя', 'имя', 'name', 'first name'), iL = col('прізвище', 'фамилия', 'last name', 'surname'), iP = col('телефон', 'phone', 'мобільний'),
      iB = col('день народження', 'дата народження', 'birthday', 'день рождения'), iC = col('дата створення', 'created');
    if (iN < 0 || iP < 0) return { err: 'У таблиці не знайдено колонок «Імʼя» і «Телефон».' };
    const dmy = (v) => { if (v instanceof Date) return { day: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`, min: v.getHours() * 60 + v.getMinutes() };
      const m = String(v ?? '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\D+(\d{1,2}):(\d{2}))?/) || String(v ?? '').match(/(\d{4})-(\d{2})-(\d{2})(?:\D+(\d{1,2}):(\d{2}))?/);
      if (!m) return null; const [y, mo, d] = m[3].length === 4 ? [m[3], m[2], m[1]] : [m[1], m[2], m[3]];
      if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null; return { day: `${y}-${pad(+mo)}-${pad(+d)}`, min: m[4] ? +m[4] * 60 + +m[5] : 12 * 60 }; };
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const out = new Map(); let bad = 0;
    table.slice(1).forEach((r) => {
      if (!r || r.every((x) => x == null || x === '')) return;
      const a = clean(r[iN]), b = iL >= 0 ? clean(r[iL]) : '', phone = normPhone(r[iP]);
      const name = !b || b.toLowerCase() === a.toLowerCase() ? a : a ? `${a} ${b}` : b;
      if (!phone || !name) { bad++; return; }
      const bd = iB >= 0 ? dmy(r[iB]) : null, cr = iC >= 0 ? dmy(r[iC]) : null;
      if (!out.has(phone)) out.set(phone, { name, phone, birthday: bd ? bd.day : null, created_at: cr ? kDate(cr.day, cr.min).toISOString() : undefined });
    });
    return { list: [...out.values()], bad };
  }
  function importSheet(existing) {
    const have = new Set(existing.map((c) => c.phone));
    const s = sheet({ title: 'Імпорт клієнтів', body: `<p class="mut sm" style="margin:0 0 12px">Оберіть таблицю Excel (.xlsx) або CSV. Потрібні колонки «Імʼя» і «Телефон». Також беруться «Прізвище», «День народження» і «Дата створення», якщо вони є. Підходить експорт клієнтів з EasyWeek.</p>
      <input type="file" class="inp" id="im-f" accept=".xlsx,.xls,.csv"><div id="im-r" class="mt"></div>` });
    let ready = [];
    $('#im-f', s.el).onchange = async (e) => {
      const f = e.target.files[0], box = $('#im-r', s.el); if (!f) return;
      box.innerHTML = '<div class="spin"></div>';
      try {
        await loadXlsx();
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        const r = parseClients(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }));
        if (r.err) { box.innerHTML = `<div class="hint" style="color:var(--bad)">${esc(r.err)}</div>`; return; }
        ready = r.list.filter((c) => !have.has(c.phone)); const dup = r.list.length - ready.length;
        box.innerHTML = `<div class="card" style="padding:12px 14px"><b>Нових клієнтів: ${ready.length}</b>
          <div class="sm mut">${dup ? `Уже є в системі (той самий телефон), їх не чіпаю: ${dup}<br>` : ''}${r.bad ? `Без телефону або імені, пропущено: ${r.bad}<br>` : ''}Записи й візити з файлу не переносяться, лише картки клієнтів.</div></div>
          ${ready.length ? `<div class="sm mut mt">Приклад:</div>${ready.slice(0, 5).map((c) => `<div class="list-row"><div class="grow"><div class="nm ell">${esc(c.name)}</div><div class="sub">${esc(fmtPhone(c.phone))}${c.birthday ? ' · 🎂 ' + esc(fmtDay(c.birthday, { day: 'numeric', month: 'long', year: 'numeric' })) : ''}</div></div></div>`).join('')}
          <button class="btn pri wide mt" id="im-go">Додати ${ready.length} ${plural(ready.length, 'клієнта', 'клієнтів', 'клієнтів')}</button>` : ''}`;
        const go = $('#im-go', s.el); if (go) go.onclick = () => busy(go, async () => {
          let done = 0;
          for (let i = 0; i < ready.length; i += 400) {
            const { error } = await sb.from('clients').upsert(ready.slice(i, i + 400), { onConflict: 'phone', ignoreDuplicates: true });
            if (error) { toast(`Додано ${done}. Помилка: ${errMsg(error)}`, 'bad', 6000); return; }
            done += Math.min(400, ready.length - i); go.textContent = `Додаю… ${done} з ${ready.length}`;
          }
          S.clientsCache = null; s.close(); toast(`Додано ${done} ${plural(done, 'клієнта', 'клієнтів', 'клієнтів')}`); refresh();
        });
      } catch (x) { box.innerHTML = `<div class="hint" style="color:var(--bad)">${esc(errMsg(x))}</div>`; }
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
      ${!next && last && daysBetween(dayOf(last.starts_at), today()) >= S.settings.stale_days ? `<div class="hint row wrap" style="gap:8px">⏳ Не було ${daysBetween(dayOf(last.starts_at), today())} днів і немає запису<button class="btn sm" id="c-inv" title="Готовий текст запрошення для Viber, Telegram або SMS">${IC.bell} Нагадати</button></div>` : ''}
      ${next ? `<div class="hint row wrap" style="gap:8px">📅 Наступний запис: <b>${esc(relDay(dayOf(next.starts_at)))}, ${fmtT(next.starts_at)}</b><button class="btn sm" id="c-rem" title="Готовий текст нагадування для Viber, Telegram або SMS">${IC.bell} Нагадати</button></div>` : ''}
      <div class="sect"><h3>Дані клієнта</h3>
        <div class="two"><div><label class="lb" for="c-n">Імʼя</label><input class="inp" id="c-n" value="${esc(c.name)}"></div><div><label class="lb" for="c-p">Телефон</label><input class="inp" id="c-p" type="tel" value="${esc(c.phone)}"></div></div><div id="c-dup"></div>
        <label class="lb">Зручний звʼязок</label><div class="chips" id="c-c">${Object.entries(CONTACTS).map(([k, [n]]) => `<button class="chip ${c.contact === k ? 'on' : ''}" data-cc="${k}" title="Клієнту зручно: ${n}">${n}</button>`).join('')}</div>
        <div class="two"><div id="c-igw" class="${c.contact === 'instagram' || c.instagram ? '' : 'hide'}"><label class="lb" for="c-ig">Посилання на Instagram</label><div class="row" style="gap:8px;flex-wrap:nowrap">
          <input class="inp" id="c-ig" value="${esc(igUrl(c.instagram).slice(8))}" placeholder="Вставте посилання або @нікнейм" autocomplete="off">
          <a class="btn nw" id="c-igo" target="_blank" rel="noopener" href="${esc(igUrl(c.instagram) || '#')}" title="Відкрити профіль клієнта в Instagram" style="${igUrl(c.instagram) ? '' : 'opacity:.4;pointer-events:none'}">${IC.ig}<span>Відкрити</span></a></div>
          <div class="hint" id="c-igh"></div></div><div><label class="lb" for="c-b">День народження</label><input class="inp" id="c-b" type="date" value="${c.birthday || ''}"></div></div>
        <label class="lb" for="c-no">Нотатки</label><textarea class="inp" id="c-no" rows="2" placeholder="Вподобання">${esc(c.note || '')}</textarea>
        <button class="btn mt" id="c-save" title="Зберегти дані клієнта">Зберегти</button></div>
      <div class="sect"><h3>Історія (${hist.length})</h3>${hist.map((x) => `<div class="list-row" style="cursor:default"><div class="grow"><div class="nm sm">${esc(svcById(x.service_id)?.name || '')} <span class="pill ${x.status}">${STATUS[x.status]}</span></div>
        <div class="sub">${esc(fmtDay(dayOf(x.starts_at), { day: 'numeric', month: 'short', year: 'numeric' }))}, ${fmtT(x.starts_at)} · ${esc(byId(x.staff_id)?.first_name || '')}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        <div class="b sm nw">${x.payments ? money(x.payments.amount) : x.status === 'booked' ? money(x.price) : ''}</div></div>`).join('') || '<div class="mut">Ще не було записів</div>'}</div>`;
    s.el.querySelector('.sh-f')?.remove();
    s.el.insertAdjacentHTML('beforeend', `<div class="sh-f"><button class="btn pri" id="c-book" title="Створити новий запис для цього клієнта">${IC.plus} Записати</button></div>`);
    phoneDupWatch($('#c-p', s.el), $('#c-dup', s.el), { exceptId: c.id, label: 'Відкрити картку', onPick: (x) => clientSheet(x.id) });
    let contact = c.contact;
    $$('[data-cc]', s.el).forEach((b) => (b.onclick = () => { contact = b.dataset.cc; $$('[data-cc]', s.el).forEach((x) => x.classList.toggle('on', x === b));
      const show = contact === 'instagram' || !!$('#c-ig', s.el).value.trim(); $('#c-igw', s.el).classList.toggle('hide', !show);
      if (contact === 'instagram' && !$('#c-ig', s.el).value.trim()) $('#c-ig', s.el).focus(); }));
    const igIn = $('#c-ig', s.el), igGo = $('#c-igo', s.el), igH = $('#c-igh', s.el);
    const igSync = () => { const v = igIn.value.trim(), u = igUrl(v); igGo.href = u || '#'; igGo.style.opacity = u ? '' : '.4'; igGo.style.pointerEvents = u ? '' : 'none';
      igH.textContent = v && !u ? 'Не схоже на посилання Instagram' : u && u.slice(8) !== v.replace(/^https?:\/\/(www\.)?/i, '') ? '→ ' + u.slice(8) : ''; };
    igIn.oninput = igSync; igIn.onblur = () => { const u = igUrl(igIn.value); if (u) igIn.value = u.slice(8); igSync(); };
    $('#c-save', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const phone = normPhone($('#c-p', s.el).value), name = $('#c-n', s.el).value.trim();
      if (!phone || name.length < 2) return toast('Перевірте імʼя і телефон', 'bad');
      if ($('#c-ig', s.el).value.trim() && !igNick($('#c-ig', s.el).value)) return toast('Перевірте посилання на Instagram', 'bad');
      const { error } = await sb.from('clients').update({ name, phone, contact, instagram: igNick($('#c-ig', s.el).value) || null, birthday: $('#c-b', s.el).value || null, note: $('#c-no', s.el).value.trim() || null }).eq('id', id);
      if (error) return toast(/duplicate|unique/i.test(error.message) ? 'Клієнт з таким телефоном уже є' : errMsg(error), 'bad');
      toast('Збережено'); S.clientsCache = null; $('.sh-h h2', s.el).textContent = name;
    });
    $('#c-book', s.el).onclick = () => { s.close(); newAppt({ client: c, mid: isBoss() ? null : S.me.id }); };
    const rb = $('#c-rem', s.el); if (rb) rb.onclick = () => remindSheet(next.id, c);
    const ib = $('#c-inv', s.el); if (ib) ib.onclick = () => inviteSheet({ ...c, last_visit: last.starts_at });
    if (isBoss() && (await mergeOk()) && s.ov.isConnected) {
      $('#c-save', s.el).insertAdjacentHTML('afterend', `<button class="btn mt" id="c-merge" title="Якщо це та сама людина, що й в іншій картці — зібрати все в одну" style="margin-left:8px">⇄ Обʼєднати з іншим клієнтом</button>`);
      $('#c-merge', s.el).onclick = () => mergeSheet(c, s);
    }
  }

  /* ================= нагадування клієнту ================= */
  async function remindSheet(apptId, c) {
    const s = sheet({ title: 'Нагадати про візит', body: '<div class="spin"></div>' });
    const body = $('.sh-b', s.el);
    const { data: a0, error } = await sb.from('appointments').select('visit_id').eq('id', apptId).single();
    if (error) { body.innerHTML = `<div class="empty">${esc(errMsg(error))}</div>`; return; }
    const [{ data: list }, { data: v }] = await Promise.all([
      sb.from('appointments').select('starts_at,service_id,staff_id').eq('visit_id', a0.visit_id).eq('status', 'booked').order('starts_at'),
      sb.from('visits').select('token').eq('id', a0.visit_id).single()]);
    if (!list?.length) { body.innerHTML = '<div class="empty">Немає майбутніх записів для нагадування</div>'; return; }
    const set = S.settings, t0 = list[0].starts_at, nm = String(c.name || '').trim().split(/\s+/)[0];
    const site = String(set.site_url || location.origin + location.pathname).replace(/#.*$/, '');
    const txt = [`Вітаємо${nm ? ', ' + nm : ''}! 💛`, `Нагадуємо про ваш запис у ${set.salon_name || 'NaNa studio'}:`,
      `📅 ${fmtDay(dayOf(t0), { weekday: 'long', day: 'numeric', month: 'long' })} о ${fmtT(t0)}`,
      ...list.map((x) => `• ${list.length > 1 ? fmtT(x.starts_at) + ' ' : ''}${svcById(x.service_id)?.name || ''} — майстер ${byId(x.staff_id)?.first_name || ''}`),
      set.address ? `📍 ${set.address}` : '', v?.token ? `Переглянути, перенести чи скасувати: ${site}#/v/${v.token}` : '',
      'Якщо плани змінились — напишіть нам, будь ласка.'].filter(Boolean).join('\n');
    msgBox(s, c, txt, 9, 'Текст можна змінити. Натисніть месенджер — текст скопіюється й відкриється чат клієнта, залишиться лише вставити. Клієнти, які підключили Telegram-бота салону, отримують нагадування й автоматично.');
  }
  // текст + кнопки Viber / Telegram / SMS / Instagram: копіює текст і відкриває чат клієнта
  function msgBox(s, c, txt, rows, hint, onSent = () => {}) {
    const body = $('.sh-b', s.el);
    const p = String(c.phone || '').replace(/[^\d+]/g, ''), pref = c.contact === 'call' ? 'sms' : c.contact;
    const B = [['viber', `${IC.vb} Viber`], ['telegram', `${IC.tg} Telegram`], ['sms', '💬 SMS'], ...(c.instagram ? [['instagram', `${IC.ig} Instagram`]] : []), ['copy', '📋 Лише скопіювати']];
    body.innerHTML = `<div class="sm mb"><b>${esc(c.name || '')}</b> · ${esc(fmtPhone(c.phone))}</div>
      <textarea class="inp" id="rm-t" rows="${rows}">${esc(txt)}</textarea>
      <div class="hint">${hint}</div>
      <div class="contact-btns">${B.map(([k, n]) => `<button class="btn sm ${k === pref ? 'pri' : ''}" data-rm="${k}" title="${k === 'copy' ? 'Скопіювати текст' : 'Скопіювати текст і відкрити ' + k}${k === pref ? ' — клієнту так зручніше' : ''}">${n}</button>`).join('')}</div>`;
    $$('[data-rm]', s.el).forEach((b) => (b.onclick = async () => {
      const k = b.dataset.rm, text = $('#rm-t', s.el).value;
      let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* без доступу до буфера */ }
      onSent(k);
      if (k === 'sms') { location.href = `sms:${p}?&body=${encodeURIComponent(text)}`; return; }
      if (k === 'copy') return toast(ok ? 'Текст скопійовано' : 'Не вдалося скопіювати — виділіть текст вручну', ok ? '' : 'bad');
      const url = { viber: `viber://chat?number=${encodeURIComponent(p)}`, telegram: `https://t.me/${p}`, instagram: igUrl(c.instagram) }[k];
      toast(ok ? 'Текст скопійовано — вставте його в чат' : 'Скопіюйте текст вручну', ok ? '' : 'bad', 4000);
      if (k === 'viber') location.href = url; else window.open(url, '_blank', 'noopener');
    }));
  }

  /* ================= запросити знову (застарілі клієнти) ================= */
  async function inviteSheet(c) {
    const s = sheet({ title: 'Запросити знову', body: '<div class="spin"></div>' });
    const { data: hist } = await sb.from('appointments').select('starts_at,service_id,staff_id').eq('client_id', c.id).eq('status', 'done').order('starts_at', { ascending: false }).limit(50);
    if (!s.ov.isConnected) return;
    const done = hist || [], top = (key) => Object.entries(done.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
    const fav = svcById(top('service_id')), mst = byId(top('staff_id')), last = done[0]?.starts_at || c.last_visit;
    const set = S.settings, nm = String(c.name || '').trim().split(/\s+/)[0];
    const site = String(set.site_url || location.origin + location.pathname).replace(/#.*$/, '');
    const days = last ? daysBetween(dayOf(last), today()) : 0;
    const txt = [`Вітаємо${nm ? ', ' + nm : ''}! 💛`,
      `Давно не бачились у ${set.salon_name || 'NaNa studio'}${days >= 60 ? ` — минуло вже ${days >= 90 ? Math.floor(days / 30) + ' ' + plural(Math.floor(days / 30), 'місяць', 'місяці', 'місяців') : days + ' днів'}` : ''}. Ми скучили!`,
      fav ? `Можемо записати вас на «${fav.name}»${mst?.first_name ? ` (майстер — ${mst.first_name})` : ''} у зручний для вас час.` : 'Будемо раді бачити вас знову — підберемо зручний час.',
      `Записатися онлайн: ${site}`,
      'Або просто напишіть у відповідь, коли вам зручно 😊'].join('\n');
    msgBox(s, c, txt, 7, `Останній візит: <b>${last ? esc(fmtDay(dayOf(last), { day: 'numeric', month: 'long', year: 'numeric' })) : '—'}</b>${fav ? ` · улюблена послуга: <b>${esc(fav.name)}</b>` : ''}. Текст можна змінити. Натисніть месенджер — текст скопіюється й відкриється чат клієнта, залишиться лише вставити.`);
  }

  /* ================= обʼєднання дублів ================= */
  async function mergeOk() {   // кнопка зʼявляється, лише коли в базі є функція client_merge
    if (S.mergeOk == null) { const { error } = await sb.rpc('client_merge', { p_from: null, p_to: null });
      S.mergeOk = !(error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''))); }
    return S.mergeOk;
  }
  function mergeSheet(c, cardSheet) {
    const s = sheet({ title: 'Обʼєднати клієнтів', body: `<div class="hint mb">Знайдіть іншу картку тієї ж людини, що й <b>${esc(c.name)}</b> (${esc(fmtPhone(c.phone))}).</div>
      <div class="search">${IC.search}<input class="inp" id="mg-q" placeholder="Пошук: імʼя або телефон" autocomplete="off" autofocus></div><div id="mg-sg"></div>` });
    const q = $('#mg-q', s.el), sg = $('#mg-sg', s.el); let tmr;
    q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
      const v = q.value.trim().replace(/[,()*%\\]/g, ' ').trim(), digits = v.replace(/\D/g, '');
      if (v.length < 2) { sg.innerHTML = ''; return; }
      let rq = sb.from('clients').select('id,name,phone,contact,instagram').neq('id', c.id).limit(8);
      rq = digits.length >= 3 ? rq.ilike('phone', '%' + digits + '%') : rq.ilike('name', '%' + v + '%');
      const { data } = await rq;
      sg.innerHTML = `<div class="sugg">${(data || []).map((x) => `<div data-mg="${x.id}" title="Обрати цю картку"><b>${esc(x.name)}</b> <span class="mut sm">${esc(fmtPhone(x.phone))}</span></div>`).join('') || '<div class="mut" style="cursor:default">Нікого не знайдено</div>'}</div>`;
      $$('[data-mg]', sg).forEach((d) => (d.onclick = () => pick(data.find((x) => x.id === d.dataset.mg))));
    }, 220); };
    const cnt = async (id) => (await sb.from('appointments').select('id', { count: 'exact', head: true }).eq('client_id', id).eq('status', 'done')).count || 0;
    async function pick(x) {
      const [n1, n2] = await Promise.all([cnt(c.id), cnt(x.id)]);
      let keep = n2 > n1 ? x.id : c.id;
      const row = (y, n) => `<label class="list-row" style="margin:0 0 8px"><input type="radio" name="mg-k" value="${y.id}" ${y.id === keep ? 'checked' : ''} style="accent-color:var(--gr)"><div class="grow"><div class="nm">${esc(y.name)}</div><div class="sub">${esc(fmtPhone(y.phone))} · ${n} ${plural(n, 'візит', 'візити', 'візитів')}</div></div></label>`;
      const draw = () => { const drop = keep === c.id ? x : c, kp = keep === c.id ? c : x;
        $('.sh-b', s.el).innerHTML = `<div class="b mb">Яку картку залишити?</div>${row(c, n1)}${row(x, n2)}
          <div class="dup" style="display:block">Усі візити, записи й оплати з картки «${esc(drop.name)}» перейдуть у «${esc(kp.name)}». Її номер і нотатки допишуться в нотатки, а сама картка зникне. <b>Це не можна скасувати.</b></div>`;
        $$('[name="mg-k"]', s.el).forEach((r) => (r.onchange = () => { keep = r.value; draw(); })); };
      draw();
      s.el.insertAdjacentHTML('beforeend', `<div class="sh-f"><button class="btn" id="mg-back" title="Обрати іншу картку">Назад</button><button class="btn red" id="mg-ok" title="Обʼєднати дві картки в одну">Обʼєднати</button></div>`);
      $('#mg-back', s.el).onclick = () => { s.close(); mergeSheet(c, cardSheet); };
      $('#mg-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
        const from = keep === c.id ? x.id : c.id;
        const { error } = await sb.rpc('client_merge', { p_from: from, p_to: keep });
        if (error) return toast(errMsg(error), 'bad', 5000);
        S.clientsCache = null; s.close(); cardSheet?.close(); toast('Клієнтів обʼєднано'); clientSheet(keep);
        if (location.hash.startsWith('#/staff/clients')) open('clients');
      });
    }
  }

  return { open, quick, pwLink, S, isBoss, isOwner, masters, byId, svcById, msOf, payPct, reload, newAppt, clientSheet, loginPage, dayData, hoursFor };
})();
