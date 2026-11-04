'use strict';
/* NaNa studio — дашборд, заробіток, послуги, персонал, налаштування */
const Admin = (() => {
  const S = () => Staff.S;
  const isBoss = () => Staff.isBoss();

  async function qAll(make) {   // більше 1000 рядків — частинами
    let out = [], i = 0;
    for (;;) { const { data, error } = await make().range(i, i + 999); if (error) throw error; out = out.concat(data); if (data.length < 1000) break; i += 1000; }
    return out;
  }
  const one = (x) => (Array.isArray(x) ? x[0] || null : x);

  /* ---------- вибір періоду ---------- */
  function monthRange(m) { const [y, mo] = m.split('-').map(Number); const a = new Date(Date.UTC(y, mo - 1, 1)).toISOString().slice(0, 10); const b = addDays(new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10), -1); return [a, b]; }
  const curMonth = () => today().slice(0, 7);
  const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
  function periodState(key) {
    const st = ls.get('per.' + key, null);
    if (st && st.from && st.to) return st;
    const [from, to] = monthRange(curMonth()); return { mode: 'month', month: curMonth(), from, to };
  }
  function periodBar(key, st, onChange) {
    const [y, m] = (st.month || curMonth()).split('-');
    const label = st.mode === 'month' ? `${MONTHS[+m - 1]} ${y}` : `${fmtDay(st.from, { day: 'numeric', month: 'short' })} — ${fmtDay(st.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const html = `<div class="per">
      <button class="btn ico sm" data-pm="-1" title="Попередній місяць">${IC.back}</button>
      <b style="min-width:130px;text-align:center;text-transform:capitalize" title="Обраний період">${esc(label)}</b>
      <button class="btn ico sm" data-pm="1" title="Наступний місяць">${IC.fwd}</button>
      <button class="chip ${st.mode === 'month' && st.month === curMonth() ? 'on' : ''}" data-pq="cur" title="Поточний місяць">Цей місяць</button>
      <button class="chip ${st.mode === 'month' && st.month === shiftMonth(curMonth(), -1) ? 'on' : ''}" data-pq="prev" title="Минулий місяць">Минулий</button>
      <button class="chip ${st.mode === 'd7' ? 'on' : ''}" data-pq="d7" title="Останні 7 днів">7 днів</button>
      <button class="chip ${st.mode === 'd30' ? 'on' : ''}" data-pq="d30" title="Останні 30 днів">30 днів</button>
      <span class="row" style="gap:6px" title="Свій період: з якої по яку дату"><input class="inp" type="date" data-pf value="${st.from}" style="min-height:36px;padding:5px 8px;width:auto"> — <input class="inp" type="date" data-pt value="${st.to}" style="min-height:36px;padding:5px 8px;width:auto"></span></div>`;
    const bind = (root) => {
      const set = (n) => { ls.set('per.' + key, n); onChange(n); };
      $$('[data-pm]', root).forEach((b) => (b.onclick = () => { const mm = shiftMonth(st.mode === 'month' ? st.month : st.from.slice(0, 7), +b.dataset.pm); const [f, t] = monthRange(mm); set({ mode: 'month', month: mm, from: f, to: t }); }));
      $$('[data-pq]', root).forEach((b) => (b.onclick = () => { const q = b.dataset.pq;
        if (q === 'cur' || q === 'prev') { const mm = q === 'cur' ? curMonth() : shiftMonth(curMonth(), -1); const [f, t] = monthRange(mm); set({ mode: 'month', month: mm, from: f, to: t }); }
        else { const n = q === 'd7' ? 6 : 29; set({ mode: q, month: today().slice(0, 7), from: addDays(today(), -n), to: today() }); } }));
      const pf = $('[data-pf]', root), pt = $('[data-pt]', root);
      const cust = () => { if (pf.value && pt.value && pf.value <= pt.value) set({ mode: 'custom', month: pf.value.slice(0, 7), from: pf.value, to: pt.value }); else if (pf.value > pt.value) toast('Дата «з» має бути раніше за «по»', 'bad'); };
      pf.onchange = cust; pt.onchange = cust;
    };
    return { html, bind };
  }
  const tsRange = (from, to) => [kDate(from, 0).toISOString(), kDate(addDays(to, 1), 0).toISOString()];

  /* ---------- доступні години (для завантаженості) ---------- */
  function availMinutes(mids, from, to, over, blocks) {
    let tot = 0; const per = {};
    for (const mid of mids) {
      let m = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const h = Staff.hoursFor(mid, d, over); if (h) m += h[1] - h[0];
      }
      blocks.filter((b) => b.staff_id === mid).forEach((b) => (m -= (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 6e4));
      per[mid] = Math.max(0, m); tot += per[mid];
    }
    return { tot, per };
  }

  /* ================= ДАШБОРД ================= */
  async function dash(main) {
    const st = periodState('dash');
    const pb = periodBar('dash', st, () => dash(main));
    main.innerHTML = `<div class="pg-h"><h1>Дашборд</h1></div>${pb.html}<div id="d-body"><div class="spin"></div></div>`;
    pb.bind(main);
    const [f, t] = tsRange(st.from, st.to);
    // попередній період: стільки ж днів (для місяця — ті самі дні попереднього місяця)
    const upto = st.to > today() ? today() : st.to, len = Math.max(1, daysBetween(st.from, upto) + 1);
    let pFrom, pTo;
    if (st.mode === 'month') { pFrom = monthRange(shiftMonth(st.month, -1))[0]; pTo = addDays(pFrom, len - 1); const pe = monthRange(shiftMonth(st.month, -1))[1]; if (pTo > pe) pTo = pe; }
    else { pFrom = addDays(st.from, -len); pTo = addDays(st.from, -1); }
    const [pf, pt] = tsRange(pFrom, pTo);
    const [ap, pays, prevPays, prevAp, exp, over, blocks, cls] = await Promise.all([
      qAll(() => sb.from('appointments').select('id,visit_id,client_id,staff_id,service_id,starts_at,ends_at,price,status,demo,visits(source),clients(name)').gte('starts_at', f).lt('starts_at', t).order('starts_at')),
      qAll(() => sb.from('payments').select('id,appointment_id,staff_id,amount,method,commission,paid_at,appointments(starts_at,service_id,visit_id,clients(name))').gte('paid_at', f).lt('paid_at', t).order('paid_at', { ascending: false })),
      qAll(() => sb.from('payments').select('amount,appointments(visit_id)').gte('paid_at', pf).lt('paid_at', pt)),
      qAll(() => sb.from('appointments').select('status').gte('starts_at', pf).lt('starts_at', pt)),
      qAll(() => sb.from('expenses').select('*').gte('day', st.from).lte('day', st.to).order('day', { ascending: false })),
      qAll(() => sb.from('day_overrides').select('*').gte('day', st.from).lte('day', st.to)),
      qAll(() => sb.from('blocks').select('*').gte('starts_at', f).lt('starts_at', t)),
      qAll(() => sb.rpc('clients_stats'))]);
    const body = $('#d-body'); if (!body) return;
    const rev = pays.reduce((a, p) => a + +p.amount, 0), prevRev = prevPays.reduce((a, p) => a + +p.amount, 0);
    const comm = pays.reduce((a, p) => a + +p.commission, 0), expSum = exp.reduce((a, x) => a + +x.amount, 0);
    const visits = new Set(pays.map((p) => one(p.appointments)?.visit_id)).size, prevVisits = new Set(prevPays.map((p) => one(p.appointments)?.visit_id)).size;
    const avg = visits ? rev / visits : 0, prevAvg = prevVisits ? prevRev / prevVisits : 0;
    const done = ap.filter((a) => a.status === 'done').length, prevDone = prevAp.filter((a) => a.status === 'done').length;
    const cancel = ap.filter((a) => a.status === 'cancel').length, noshow = ap.filter((a) => a.status === 'noshow').length;
    const live = ap.filter((a) => a.status !== 'cancel');
    const online = ap.filter((a) => one(a.visits)?.source === 'online').length;
    const stale = cls.filter((c) => c.last_visit && !c.next_visit && daysBetween(dayOf(c.last_visit), today()) >= S().settings.stale_days).length;
    const newCl = cls.filter((c) => { const d = dayOf(c.created_at); return d >= st.from && d <= st.to; }).length;
    const ms = Staff.masters();
    const av = availMinutes(ms.map((m) => m.id), st.from, upto, over, blocks.filter((b) => dayOf(b.starts_at) <= upto));
    const busyMin = (mid) => live.filter((a) => (!mid || a.staff_id === mid) && dayOf(a.starts_at) <= upto).reduce((s, a) => s + (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 6e4, 0);
    const load = av.tot ? Math.round((busyMin() / av.tot) * 100) : 0;
    const delta = (a, b) => { if (!b) return ''; const p = Math.round(((a - b) / b) * 100); return `<div class="d ${p >= 0 ? 'up' : 'dn'}" title="Порівняно з ${esc(fmtDay(pFrom, { day: 'numeric', month: 'short' }))} – ${esc(fmtDay(pTo, { day: 'numeric', month: 'short' }))}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% до ${st.mode === 'month' ? 'тих самих днів минулого місяця' : 'попер. періоду'}</div>`; };
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

    // по днях і способах оплати
    const methods = [...new Set([...(S().settings.pay_methods || []), ...pays.map((p) => p.method)])];
    const colors = ['#4E4E4C', '#D3DA0C', '#B4B4A6', '#2F6FB0', '#C0392B', '#2F8A57'];
    const byMethod = methods.map((m, i) => ({ m, c: colors[i % colors.length], sum: pays.filter((p) => p.method === m).reduce((a, p) => a + +p.amount, 0), n: pays.filter((p) => p.method === m).length })).filter((x) => x.n);
    const byMonth = len > 62; const buckets = [];
    if (byMonth) { for (let m = st.from.slice(0, 7); m <= st.to.slice(0, 7); m = shiftMonth(m, 1)) buckets.push(m); }
    else for (let d = st.from; d <= st.to; d = addDays(d, 1)) buckets.push(d);
    const keyOf = (iso) => (byMonth ? dayOf(iso).slice(0, 7) : dayOf(iso));
    const bsum = buckets.map((k) => byMethod.map((x) => pays.filter((p) => p.method === x.m && keyOf(p.paid_at) === k).reduce((a, p) => a + +p.amount, 0)));
    const bmax = Math.max(1, ...bsum.map((v) => v.reduce((a, b) => a + b, 0)));
    const bars = buckets.map((k, i) => { const tot = bsum[i].reduce((a, b) => a + b, 0);
      return `<div class="b" style="height:${(tot / bmax) * 100}%" title="${esc(byMonth ? MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4) : fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' }))}: ${money(tot)}${byMethod.map((x, j) => bsum[i][j] ? `\n${x.m}: ${money(bsum[i][j])}` : '').join('')}">
        ${byMethod.map((x, j) => (bsum[i][j] ? `<i style="height:${(bsum[i][j] / (tot || 1)) * 100}%;background:${x.c}"></i>` : '')).join('')}</div>`; }).join('');
    const step = Math.ceil(buckets.length / 10);
    const xl = buckets.map((k, i) => `<span>${i % step === 0 ? (byMonth ? MONTHS[+k.slice(5) - 1].slice(0, 3) : +k.slice(8)) : ''}</span>`).join('');

    // майстри
    const mrows = ms.map((m) => { const mp = pays.filter((p) => p.staff_id === m.id); const r = mp.reduce((a, p) => a + +p.amount, 0);
      const cm = mp.reduce((a, p) => a + +p.commission, 0); const n = ap.filter((a) => a.staff_id === m.id && a.status === 'done').length;
      const ld = av.per[m.id] ? Math.round((busyMin(m.id) / av.per[m.id]) * 100) : 0;
      return { m, r, cm, n, ld, avg: n ? r / n : 0 }; }).sort((a, b) => b.r - a.r);
    // послуги
    const sv = {}; pays.forEach((p) => { const id = one(p.appointments)?.service_id; if (!id) return; sv[id] = sv[id] || { n: 0, r: 0 }; sv[id].n++; sv[id].r += +p.amount; });
    const svTop = Object.entries(sv).sort((a, b) => b[1].r - a[1].r).slice(0, 8); const svMax = Math.max(1, ...svTop.map((x) => x[1].r));
    // дні тижня
    const wd = [0, 0, 0, 0, 0, 0, 0, 0]; live.forEach((a) => wd[isoDow(dayOf(a.starts_at))]++); const wdMax = Math.max(1, ...wd);
    // години
    const hrs = {}; live.forEach((a) => { const h = Math.floor(kParts(a.starts_at).min / 60); hrs[h] = (hrs[h] || 0) + 1; });
    const peak = Object.entries(hrs).sort((a, b) => b[1] - a[1])[0];

    body.innerHTML = `<div class="kpis">
        <div class="kpi main click" data-k="rev" role="button" tabindex="0" title="Показати всі оплати за період"><div class="l">Виручка</div><div class="v">${money(rev)}</div>${delta(rev, prevRev).replace('class="d', 'style="color:#E9EBA0" class="d')}</div>
        <div class="kpi click" data-k="done" role="button" tabindex="0" title="Список завершених візитів за період"><div class="l">Завершених візитів</div><div class="v">${done}</div>${delta(done, prevDone)}</div>
        <div class="kpi click" data-k="avg" role="button" tabindex="0" title="Середній чек кожного майстра — у таблиці «Майстри»"><div class="l">Середній чек</div><div class="v">${money(avg)}</div>${delta(avg, prevAvg)}</div>
        <div class="kpi click" data-k="load" role="button" tabindex="0" title="Завантаженість кожного майстра — у таблиці «Майстри»"><div class="l">Завантаженість майстрів</div><div class="v">${load}%</div><div class="d mut" title="Зайнятий час / робочий час за графіком">${durTxt(busyMin())} з ${durTxt(av.tot)}</div></div>
        <div class="kpi click" data-k="comm" role="button" tabindex="0" title="Скільки кожному майстру — у таблиці «Майстри»"><div class="l">До виплати майстрам</div><div class="v">${money(comm)}</div><div class="d mut">за відсотками з карток</div></div>
        <div class="kpi click" data-k="profit" role="button" tabindex="0" title="Як рахується прибуток і всі витрати за період"><div class="l">Прибуток салону</div><div class="v">${money(rev - comm - expSum)}</div><div class="d mut" title="Виручка − виплати майстрам − витрати">після виплат і витрат</div></div>
        <div class="kpi click" data-k="newcl" role="button" tabindex="0" title="Список нових клієнтів за період"><div class="l">Нових клієнтів</div><div class="v">${newCl}</div><div class="d mut">онлайн-записів: ${pct(online, ap.length)}%</div></div>
        <div class="kpi click" data-k="cancel" role="button" tabindex="0" title="Список скасованих записів і неявок за період"><div class="l">Скасовано / не прийшли</div><div class="v">${cancel} / ${noshow}</div><div class="d mut">${pct(cancel + noshow, ap.length)}% від усіх записів</div></div>
        <a class="kpi click" href="#/staff/clients/stale" title="Клієнти, які не були понад ${S().settings.stale_days} днів і не мають запису — відкрити список" style="text-decoration:none"><div class="l">Застарілі клієнти</div><div class="v" style="color:var(--warn)">${stale}</div><div class="d mut">не були ${S().settings.stale_days}+ днів →</div></a>
      </div>
      <div class="dgrid">
        <div class="card full"><div class="row sp"><h3 style="margin:0">Виручка по ${byMonth ? 'місяцях' : 'днях'}</h3><span class="sm mut">наведіть на стовпчик</span></div>
          <div class="bars">${bars}</div><div class="bars-x">${xl}</div>
          <div class="legend">${byMethod.map((x) => `<span><i style="background:${x.c}"></i>${esc(x.m)}</span>`).join('')}</div></div>
        <div class="card"><h3>Гроші за способами оплати</h3>${byMethod.map((x) => `<div class="hbar"><div class="t"><span>${esc(x.m)} <span class="mut">· ${x.n} ${plural(x.n, 'оплата', 'оплати', 'оплат')}</span></span><span>${money(x.sum)} · ${pct(x.sum, rev)}%</span></div>
          <div class="tr"><i style="width:${pct(x.sum, rev)}%;background:${x.c}"></i></div></div>`).join('') || '<div class="empty">Оплат за період немає</div>'}
          ${exp.length || true ? `<div class="sect"><h3>Витрати: ${money(expSum)} <button class="btn sm" id="d-exp" title="Додати витрату (оренда, матеріали…)" style="margin-left:auto">${IC.plus} Витрата</button></h3>
            ${exp.slice(0, 6).map((x) => `<div class="row sp sm" style="padding:4px 0"><span>${esc(fmtDay(x.day, { day: 'numeric', month: 'short' }))} · ${esc(x.category)}${x.note ? ' · <span class="mut">' + esc(x.note) + '</span>' : ''}</span><b>${money(x.amount)}</b></div>`).join('') || '<div class="mut sm">Витрат не внесено</div>'}</div>` : ''}</div>
        <div class="card"><h3>Популярні послуги</h3>${svTop.map(([id, x]) => `<div class="hbar"><div class="t"><span class="ell">${esc(Staff.svcById(id)?.name || '—')}</span><span class="nw">${x.n} × · ${money(x.r)}</span></div><div class="tr"><i class="y" style="width:${(x.r / svMax) * 100}%"></i></div></div>`).join('') || '<div class="empty">Немає даних</div>'}</div>
        <div class="card full" id="d-masters"><h3>Майстри</h3><div class="tbl-wrap d-only"><table class="tbl"><thead><tr><th>Майстер</th><th class="r">Візити</th><th class="r">Виручка</th><th class="r">Сер. чек</th><th class="r">Завантаж.</th><th class="r">%</th><th class="r">До виплати</th></tr></thead>
          <tbody>${mrows.map((x) => `<tr class="click" data-st="${x.m.id}" title="Відкрити картку майстра"><td><div class="row" style="gap:8px">${avatar(x.m, 's')}<b>${esc(fullName(x.m))}</b></div></td><td class="r">${x.n}</td><td class="r b">${money(x.r)}</td><td class="r">${money(x.avg)}</td><td class="r">${x.ld}%</td><td class="r">${Staff.payPct(x.m.id)}%</td><td class="r b">${money(x.cm)}</td></tr>`).join('')}
          <tr><td class="b">Разом</td><td class="r b">${done}</td><td class="r b">${money(rev)}</td><td class="r">${money(avg)}</td><td class="r">${load}%</td><td></td><td class="r b">${money(comm)}</td></tr></tbody></table></div>
          <div class="m-list">${mrows.map((x) => `<div class="m-row click" data-st="${x.m.id}" title="Відкрити картку майстра">${avatar(x.m, 's')}<div class="grow"><div class="b ell">${esc(fullName(x.m))}</div>
            <div class="xs mut">${x.n} ${plural(x.n, 'візит', 'візити', 'візитів')} · сер. ${money(x.avg)} · завант. ${x.ld}%</div></div>
            <div class="r"><div class="b">${money(x.r)}</div><div class="xs mut">майстру ${money(x.cm)} (${Staff.payPct(x.m.id)}%)</div></div></div>`).join('')}
            <div class="m-row"><div class="grow b">Разом · ${done} ${plural(done, 'візит', 'візити', 'візитів')}</div><div class="r"><div class="b">${money(rev)}</div><div class="xs mut">майстрам ${money(comm)}</div></div></div></div></div>
        <div class="card"><h3>Записи за днями тижня</h3>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<div class="hbar"><div class="t"><span>${WDL[d]}</span><span>${wd[d]}</span></div><div class="tr"><i style="width:${(wd[d] / wdMax) * 100}%"></i></div></div>`).join('')}
          ${peak ? `<div class="hint">Найпопулярніша година: <b>${pad(peak[0])}:00</b></div>` : ''}</div>
        <div class="card"><h3>Корисне</h3><div class="col sm">
          <div>🗓 Записів на майбутнє в періоді: <b>${ap.filter((a) => a.status === 'booked' && Date.parse(a.starts_at) > nowMs()).length}</b> на ${money(ap.filter((a) => a.status === 'booked' && Date.parse(a.starts_at) > nowMs()).reduce((s, a) => s + +a.price, 0))}</div>
          <div>🌐 Онлайн записалися: <b>${online}</b> з ${ap.length} (${pct(online, ap.length)}%)</div>
          <div>🔁 Повторні клієнти: <b>${pct(cls.filter((c) => c.visits >= 2).length, cls.filter((c) => c.visits >= 1).length)}%</b> мають 2+ візити</div>
          <div>🎂 Дні народження цього місяця: <b>${cls.filter((c) => c.birthday && c.birthday.slice(5, 7) === today().slice(5, 7)).length}</b></div>
          <div>⏳ Втрачено через неявки: <b>${money(ap.filter((a) => a.status === 'noshow').reduce((s, a) => s + +a.price, 0))}</b></div></div></div>
        <div class="card full" id="d-txcard"><div class="row sp wrap mb"><h3 style="margin:0">Транзакції (${pays.length})</h3><div class="row wrap" style="gap:6px">
          <div class="chips" id="d-mf"><button class="chip on" data-mf="" title="Усі способи оплати">Усі</button>${byMethod.map((x) => `<button class="chip" data-mf="${esc(x.m)}" title="Лише ${esc(x.m)}">${esc(x.m)}</button>`).join('')}</div>
          <button class="btn sm" id="d-csv" title="Завантажити транзакції таблицею для Excel">⬇ CSV</button></div></div><div class="tbl-wrap d-only" style="max-height:480px;overflow:auto"><table class="tbl" id="d-tx"></table></div><div class="m-list" id="d-txm"></div></div>
      </div>`;
    let mf = '';
    const drawTx = () => {
      const list = pays.filter((p) => !mf || p.method === mf);
      $('#d-tx').innerHTML = `<thead><tr><th>Дата</th><th>Клієнт</th><th>Послуга</th><th>Майстер</th><th>Оплата</th><th class="r">Сума</th><th class="r">Майстру</th></tr></thead><tbody>${list.map((p) => { const a = one(p.appointments);
        return `<tr><td class="nw">${esc(fmtDay(dayOf(p.paid_at), { day: 'numeric', month: 'short' }))}, ${fmtT(p.paid_at)}</td><td>${esc(one(a?.clients)?.name || '')}</td><td>${esc(Staff.svcById(a?.service_id)?.name || '')}</td>
          <td>${esc(Staff.byId(p.staff_id)?.first_name || '')}</td><td><span class="pill g">${esc(p.method)}</span></td><td class="r b">${money(p.amount)}</td><td class="r">${money(p.commission)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="mut">Немає транзакцій</td></tr>'}
        <tr><td colspan="5" class="b">Разом</td><td class="r b">${money(list.reduce((a, p) => a + +p.amount, 0))}</td><td class="r b">${money(list.reduce((a, p) => a + +p.commission, 0))}</td></tr></tbody>`;
      $('#d-txm').innerHTML = list.slice(0, 200).map((p) => { const a = one(p.appointments);
        return `<div class="m-row"><div class="grow"><div class="b sm ell">${esc(one(a?.clients)?.name || '')} · ${esc(Staff.byId(p.staff_id)?.first_name || '')}</div>
          <div class="xs mut ell">${esc(fmtDay(dayOf(p.paid_at), { day: 'numeric', month: 'short' }))}, ${fmtT(p.paid_at)} · ${esc(Staff.svcById(a?.service_id)?.name || '')}</div></div>
          <div class="r"><div class="b">${money(p.amount)}</div><span class="pill g" style="font-size:11px">${esc(p.method)}</span></div></div>`; }).join('') +
        (list.length > 200 ? `<div class="hint">Показано 200 з ${list.length} — усі в CSV</div>` : '') +
        `<div class="m-row"><div class="grow b">Разом</div><div class="r b">${money(list.reduce((a, p) => a + +p.amount, 0))}</div></div>`;
    };
    drawTx();
    $$('[data-mf]', body).forEach((b) => (b.onclick = () => { mf = b.dataset.mf; $$('[data-mf]', body).forEach((x) => x.classList.toggle('on', x === b)); drawTx(); }));
    $('#d-csv').onclick = () => {
      const rows = [['Дата', 'Час', 'Клієнт', 'Послуга', 'Майстер', 'Спосіб оплати', 'Сума', 'Майстру']].concat(pays.filter((p) => !mf || p.method === mf).map((p) => { const a = one(p.appointments);
        return [dayOf(p.paid_at), fmtT(p.paid_at), one(a?.clients)?.name || '', Staff.svcById(a?.service_id)?.name || '', fullName(Staff.byId(p.staff_id) || {}), p.method, p.amount, p.commission]; }));
      const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `nana-transakcii-${st.from}_${st.to}.csv`; a.click();
    };
    $$('[data-st]', body).forEach((r) => (r.onclick = () => go('#/staff/team/' + r.dataset.st)));
    $('#d-exp').onclick = () => expenseSheet(() => dash(main));

    // плитки: відкривають список за період або ведуть до потрібного блоку нижче
    const jump = (id) => { const el = $('#' + id, body); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
    const perTxt = esc(fmtDay(st.from, { day: 'numeric', month: 'short' }) + ' — ' + fmtDay(st.to, { day: 'numeric', month: 'short', year: 'numeric' }));
    const dt = (iso) => esc(fmtDay(dayOf(iso), { day: 'numeric', month: 'short' }));
    const apList = (list) => list.map((a) => `<div class="m-row click" data-cl="${a.client_id}" title="Відкрити картку клієнта"><div class="grow"><div class="b sm ell">${esc(one(a.clients)?.name || '—')} · ${esc(Staff.byId(a.staff_id)?.first_name || '')}</div>
        <div class="xs mut ell">${dt(a.starts_at)}, ${fmtT(a.starts_at)} · ${esc(Staff.svcById(a.service_id)?.name || '')}</div></div>
        <div class="r"><span class="pill ${a.status}">${STATUS[a.status]}</span><div class="sm b" style="margin-top:3px">${money(a.price)}</div></div></div>`).join('') || '<div class="empty">Немає записів за цей період</div>';
    // список записів з категоріями: рядок-фільтр угорі, а в «Усі» — розділи по категоріях з кількістю й сумою
    const catSheet = (title, list) => {
      const catOf = (a) => Staff.svcById(a.service_id)?.category || 'Інше';
      const ord = (c) => Math.min(...S().services.filter((x) => x.category === c).map((x) => +x.sort || 0), 9999);
      const cats = [...new Set(list.map(catOf))].sort((a, b) => ord(a) - ord(b) || a.localeCompare(b, 'uk'));
      const sum = (l) => l.reduce((t, a) => t + +a.price, 0);
      let cur = '';
      const s = listSheet(title, `<div class="chips scroll mb" id="cs-cats"></div><div id="cs-list"></div>`);
      const draw = () => {
        $('#cs-cats', s.el).innerHTML = `<button class="chip ${!cur ? 'on' : ''}" data-cc="" title="Усі категорії">Усі <span class="n">${list.length}</span></button>`
          + cats.map((c) => `<button class="chip ${cur === c ? 'on' : ''}" data-cc="${esc(c)}" title="Лише ${esc(c)}">${esc(c)} <span class="n">${list.filter((a) => catOf(a) === c).length}</span></button>`).join('');
        const one = (c) => { const l = list.filter((a) => catOf(a) === c);
          return `<div class="s-cat" style="display:flex;justify-content:space-between"><span>${esc(c)} · ${l.length}</span><span>${money(sum(l))}</span></div>${apList(l)}`; };
        $('#cs-list', s.el).innerHTML = list.length ? (cur ? one(cur) : cats.map(one).join('')) : apList([]);
        $$('[data-cc]', s.el).forEach((b) => (b.onclick = () => { cur = b.dataset.cc; draw(); }));
        $$('[data-cl]', s.el).forEach((r) => (r.onclick = () => Staff.clientSheet(r.dataset.cl)));
      };
      draw();
    };
    const listSheet = (title, html, foot = '') => { const s = sheet({ title, wide: true, body: `<div class="sm mut mb">${perTxt}</div>${html}`, foot });
      $$('[data-cl]', s.el).forEach((r) => (r.onclick = () => Staff.clientSheet(r.dataset.cl))); return s; };
    const K = {
      rev: () => jump('d-txcard'), avg: () => jump('d-masters'), load: () => jump('d-masters'), comm: () => jump('d-masters'),
      done: () => catSheet(`Завершені візити: ${done}`, ap.filter((a) => a.status === 'done')),
      cancel: () => catSheet(`Скасовано / не прийшли: ${cancel} / ${noshow}`, ap.filter((a) => a.status === 'cancel' || a.status === 'noshow')),
      newcl: () => { const nc = cls.filter((c) => { const d = dayOf(c.created_at); return d >= st.from && d <= st.to; }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        listSheet(`Нові клієнти: ${nc.length}`, nc.map((c) => `<div class="m-row click" data-cl="${c.id}" title="Відкрити картку клієнта"><span class="ava s y">${esc(c.name[0] || '?')}</span><div class="grow"><div class="b sm ell">${esc(c.name)}</div>
          <div class="xs mut ell">${esc(fmtPhone(c.phone))} · додано ${dt(c.created_at)}</div></div><div class="r sm">${c.visits} ${plural(c.visits, 'візит', 'візити', 'візитів')}</div></div>`).join('') || '<div class="empty">Нових клієнтів за цей період немає</div>'); },
      profit: () => { const s = listSheet('Прибуток салону', `<dl class="kv"><dt>Виручка</dt><dd>${money(rev)}</dd><dt>Виплати майстрам</dt><dd>− ${money(comm)}</dd><dt>Витрати</dt><dd>− ${money(expSum)}</dd><dt>Прибуток</dt><dd class="b">${money(rev - comm - expSum)}</dd></dl>
          <h3 class="mt">Витрати (${exp.length})</h3>${exp.map((x) => `<div class="m-row"><div class="grow"><div class="b sm ell">${esc(x.category)}</div><div class="xs mut ell">${dt(x.day)}${x.note ? ' · ' + esc(x.note) : ''}</div></div><div class="r b">${money(x.amount)}</div></div>`).join('') || '<div class="mut sm">Витрат не внесено</div>'}`,
          `<button class="btn pri" id="pf-exp" title="Додати витрату (оренда, матеріали…)">${IC.plus} Витрата</button>`);
        $('#pf-exp', s.el).onclick = () => { s.close(); expenseSheet(() => dash(main)); }; },
    };
    $$('[data-k]', body).forEach((el) => { el.onclick = () => K[el.dataset.k](); el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); K[el.dataset.k](); } }; });
  }
  function expenseSheet(done) {
    const s = sheet({ title: 'Нова витрата', body: `<div class="two"><div><label class="lb" for="e-d">Дата</label><input class="inp" type="date" id="e-d" value="${today()}"></div>
      <div><label class="lb" for="e-a">Сума, ₴</label><input class="inp" type="number" id="e-a" min="0" step="1" autofocus></div></div>
      <label class="lb" for="e-c">Категорія</label><input class="inp" id="e-c" list="e-cl" placeholder="Оренда, матеріали…"><datalist id="e-cl">${['Оренда', 'Матеріали', 'Комунальні', 'Реклама', 'Обладнання', 'Інше'].map((x) => `<option value="${x}">`).join('')}</datalist>
      <label class="lb" for="e-n">Коментар</label><input class="inp" id="e-n">`,
      foot: `<button class="btn" data-x2 title="Закрити без збереження">Скасувати</button><button class="btn pri" id="e-ok" title="Зберегти витрату">Зберегти</button>` });
    $('[data-x2]', s.el).onclick = s.close;
    $('#e-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const amount = +$('#e-a', s.el).value, category = $('#e-c', s.el).value.trim();
      if (!(amount > 0) || !category) return toast('Вкажіть суму і категорію', 'bad');
      const { error } = await sb.from('expenses').insert({ id: crypto.randomUUID(), day: $('#e-d', s.el).value || today(), amount, category, note: $('#e-n', s.el).value.trim() || null });
      if (error) return toast(errMsg(error), 'bad'); s.close(); toast('Витрату додано'); done();
    });
  }

  /* ================= МІЙ ЗАРОБІТОК ================= */
  async function earn(main) {
    const me = S().me, st = periodState('earn');
    const pb = periodBar('earn', st, () => earn(main));
    main.innerHTML = `<div class="pg-h"><h1>Мій заробіток</h1></div>${pb.html}<div id="e-body"><div class="spin"></div></div>`; pb.bind(main);
    const [f, t] = tsRange(st.from, st.to);
    const [pays, ap] = await Promise.all([
      qAll(() => sb.from('payments').select('amount,method,commission,commission_pct,paid_at,appointments(service_id,clients(name))').eq('staff_id', me.id).gte('paid_at', f).lt('paid_at', t).order('paid_at', { ascending: false })),
      qAll(() => sb.from('appointments').select('status,price,starts_at').eq('staff_id', me.id).gte('starts_at', f).lt('starts_at', t))]);
    const rev = pays.reduce((a, p) => a + +p.amount, 0), my = pays.reduce((a, p) => a + +p.commission, 0);
    const fut = ap.filter((a) => a.status === 'booked' && Date.parse(a.starts_at) > nowMs());
    const pctNow = Staff.payPct(me.id);
    $('#e-body').innerHTML = `<div class="kpis">
      <div class="kpi main"><div class="l">Мій заробіток</div><div class="v">${money(my)}</div></div>
      <div class="kpi"><div class="l">Мій відсоток</div><div class="v">${num(pctNow)}%</div><div class="d mut">від чеку · встановлює власниця</div></div>
      <div class="kpi"><div class="l">Виручка з моїх послуг</div><div class="v">${money(rev)}</div></div>
      <div class="kpi"><div class="l">Візитів</div><div class="v">${pays.length}</div></div>
      <div class="kpi"><div class="l">Ще заплановано</div><div class="v">${fut.length}</div><div class="d mut">≈ ${money(fut.reduce((s, a) => s + +a.price, 0) * pctNow / 100)} для мене</div></div></div>
      <div class="card mt"><h3>Мої оплачені візити</h3>
      <div class="m-list">${pays.map((p) => { const a = one(p.appointments); return `<div class="m-row"><div class="grow"><div class="b sm ell">${esc(Staff.svcById(a?.service_id)?.name || '')}</div><div class="xs mut">${esc(fmtDay(dayOf(p.paid_at), { day: 'numeric', month: 'short' }))} · ${esc(one(a?.clients)?.name || '')} · чек ${money(p.amount)}</div></div><div class="r b">${money(p.commission)}</div></div>`; }).join('') || '<div class="mut">Ще немає оплат за цей період</div>'}</div>
      <div class="tbl-wrap d-only"><table class="tbl"><thead><tr><th>Дата</th><th>Клієнт</th><th>Послуга</th><th class="r">Чек</th><th class="r">%</th><th class="r">Мені</th></tr></thead><tbody>
      ${pays.map((p) => { const a = one(p.appointments); return `<tr><td class="nw">${esc(fmtDay(dayOf(p.paid_at), { day: 'numeric', month: 'short' }))}</td><td>${esc(one(a?.clients)?.name || '')}</td><td>${esc(Staff.svcById(a?.service_id)?.name || '')}</td><td class="r">${money(p.amount)}</td><td class="r">${num(p.commission_pct)}%</td><td class="r b">${money(p.commission)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="mut">Ще немає оплат за цей період</td></tr>'}
      </tbody></table></div></div>`;
  }

  /* ================= ПОСЛУГИ ================= */
  async function services(main, arg) {
    const all = S().services, cats = [...new Set(all.map((s) => s.category))];
    S().svcCat = S().svcCat ?? ''; S().svcOff = S().svcOff ?? false;
    const list = all.filter((s) => (!S().svcCat || s.category === S().svcCat) && (S().svcOff || s.is_active));
    main.innerHTML = `<div class="pg-h"><h1>Послуги</h1><button class="btn pri" id="sv-new" title="Додати нову послугу">${IC.plus} Послуга</button></div>
      <div class="chips scroll mb"><button class="chip ${!S().svcCat ? 'on' : ''}" data-c="" title="Усі категорії">Усі <span class="n">${all.filter((s) => s.is_active).length}</span></button>${cats.map((c) => `<button class="chip ${S().svcCat === c ? 'on' : ''}" data-c="${esc(c)}" title="Категорія ${esc(c)}">${esc(c)} <span class="n">${all.filter((s) => s.category === c && s.is_active).length}</span></button>`).join('')}
        <label class="chip" title="Показати також вимкнені послуги"><input type="checkbox" id="sv-off" ${S().svcOff ? 'checked' : ''} style="accent-color:var(--gr)"> вимкнені</label></div>
      ${cats.filter((c) => !S().svcCat || c === S().svcCat).map((c) => { const l = list.filter((s) => s.category === c); if (!l.length) return '';
        return `<div class="s-cat">${esc(c)}<button class="btn ghost sm s-rc" data-rc="${esc(c)}" title="Перейменувати категорію «${esc(c)}»">✎ Перейменувати</button></div>` + l.map((s) => { const ms = S().ms.filter((x) => x.service_id === s.id && x.is_active); const prices = ms.map((x) => +x.price);
          const pf = hasMsFrom() ? ms.some((x) => x.price_from) : s.price_from;
          const pr = (pf ? 'від ' : '') + (prices.length ? (Math.min(...prices) === Math.max(...prices) ? money(prices[0]) : money(Math.min(...prices)) + '–' + money(Math.max(...prices))) : money(s.price));
          return `<div class="list-row ${s.is_active ? '' : 'off'}" data-s="${s.id}" title="Редагувати послугу: ціни, тривалість, хто виконує, фото">${(s.photos || [])[0] ? `<span class="s-ph" style="width:46px;height:46px;cursor:pointer"><img src="${esc(s.photos[0])}" alt="" loading="lazy"></span>` : '<span class="s-ph" style="width:46px;height:46px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mut)" title="Немає фото — додайте в редагуванні">📷</span>'}<div class="grow"><div class="nm">${esc(s.name)} ${s.is_active ? '' : '<span class="pill g">вимкнено</span>'}</div>
            <div class="sub">${durTxt(s.dur)} · ${ms.length ? ms.map((x) => esc(Staff.byId(x.staff_id)?.first_name || '')).join(', ') : '<span style="color:var(--bad)">немає майстра — клієнти не бачать</span>'}</div></div><div class="b nw">${pr}</div></div>`; }).join(''); }).join('')}`;
    $$('[data-c]', main).forEach((b) => (b.onclick = () => { S().svcCat = b.dataset.c; services(main); }));
    $('#sv-off').onchange = (e) => { S().svcOff = e.target.checked; services(main); };
    $('#sv-new').onclick = () => serviceSheet(null, () => services(main));
    $$('[data-s]', main).forEach((r) => (r.onclick = () => serviceSheet(r.dataset.s, () => services(main))));
    $$('[data-rc]', main).forEach((b) => (b.onclick = () => renameCat(b.dataset.rc, () => services(main))));
  }
  // перейменувати категорію — у всіх її послуг (і вимкнених); якщо така назва вже є — послуги приєднаються до неї
  function renameCat(old, done) {
    const cats = [...new Set(S().services.map((x) => x.category))].filter((c) => c !== old);
    const n = S().services.filter((x) => x.category === old).length;
    const s = sheet({ title: 'Перейменувати категорію', body: `<label class="lb" for="rc-n">Нова назва для «${esc(old)}» <span class="mut" style="font-weight:600">· ${n} ${plural(n, 'послуга', 'послуги', 'послуг')}</span></label>
      <input class="inp" id="rc-n" value="${esc(old)}" list="rc-l" maxlength="40" autofocus><datalist id="rc-l">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="hint" id="rc-h">Назву побачать і клієнти в онлайн-записі.</div>`,
      foot: `<button class="btn" data-x2 title="Закрити без змін">Скасувати</button><button class="btn pri" id="rc-ok" title="Зберегти нову назву">Зберегти</button>` });
    const inp = $('#rc-n', s.el), hint = $('#rc-h', s.el);
    inp.oninput = () => { const v = inp.value.trim(); hint.textContent = cats.includes(v) ? `Категорія «${v}» уже є — послуги «${old}» перейдуть до неї.` : 'Назву побачать і клієнти в онлайн-записі.'; };
    $('[data-x2]', s.el).onclick = s.close;
    s.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#rc-ok', s.el).click(); });
    $('#rc-ok', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const v = inp.value.trim();
      if (!v) { inp.classList.add('err'); return toast('Вкажіть назву', 'bad'); }
      if (v === old) return s.close();
      const { error } = await sb.from('services').update({ category: v }).eq('category', old);
      if (error) return toast(errMsg(error), 'bad');
      if (S().svcCat === old) S().svcCat = v;
      await Staff.reload(); s.close(); toast(cats.includes(v) ? `Послуги перенесено в «${v}»` : 'Категорію перейменовано'); done();
    });
  }
  const hasFrom = () => S().services.some((x) => 'price_from' in x);   // поле «Ціна від» зʼявляється після оновлення бази
  const hasMsFrom = () => S().ms.some((x) => 'price_from' in x);      // «від» окремо для кожної майстрині (після оновлення бази 2)
  function serviceSheet(id, done) {
    const sv = id ? Staff.svcById(id) : { category: S().svcCat || '', name: '', descr: '', dur: 60, price: 0, is_active: true, sort: 100 };
    const people = S().staff.filter((x) => x.is_active && (x.is_bookable || S().ms.some((m) => m.staff_id === x.id && m.service_id === id)));
    const cats = [...new Set(S().services.map((s) => s.category))];
    const s = sheet({ title: id ? 'Послуга' : 'Нова послуга', wide: true, body: `
      <div class="two"><div><label class="lb" for="sv-c">Категорія</label><input class="inp" id="sv-c" list="sv-cl" value="${esc(sv.category)}" placeholder="Брови, Вії, Манікюр…"><datalist id="sv-cl">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div><label class="lb" for="sv-n">Назва <span class="req">*</span></label><input class="inp" id="sv-n" value="${esc(sv.name)}" maxlength="80"></div></div>
      <label class="lb" for="sv-d">Опис для клієнтів</label><input class="inp" id="sv-d" value="${esc(sv.descr || '')}" maxlength="160" placeholder="Що входить у послугу">
      <div class="three"><div><label class="lb" for="sv-u">Тривалість, хв</label><input class="inp" type="number" id="sv-u" min="5" step="5" value="${sv.dur}"></div>
      <div><label class="lb" for="sv-p">Ціна, ₴</label><input class="inp" type="number" id="sv-p" min="0" step="10" value="${+sv.price}"></div>
      <div><label class="lb" for="sv-o">Порядок</label><input class="inp" type="number" id="sv-o" value="${sv.sort}" title="Менше число — вище в списку"></div></div>
      <label class="sw mt" title="Вимкнена послуга не показується клієнтам"><input type="checkbox" id="sv-a" ${sv.is_active ? 'checked' : ''}><i></i><span class="b">Послуга доступна для запису</span></label>
      ${hasFrom() && !hasMsFrom() ? `<label class="sw mt" title="Клієнти бачать ціну як «від 1 400 ₴» — коли кінцева сума залежить від роботи"><input type="checkbox" id="sv-f" ${sv.price_from ? 'checked' : ''}><i></i><span class="b">Ціна «від»</span></label>` : ''}
      <div class="sect"><h3>📷 Фото робіт <span class="mut sm" style="font-weight:600">до 6 — перше показується в списку</span></h3><div class="sv-phs" id="sv-phs"></div></div>
      <div class="sect"><h3>Хто виконує — і за скільки <button class="btn sm" id="sv-all" title="Поставити всім обраним майстрам тривалість і ціну зверху" style="margin-left:auto">Як зверху всім</button></h3>
        <div class="hint" style="margin:-4px 0 8px">Кожен майстер може мати свою ціну й тривалість${hasMsFrom() ? '; «від» — клієнти бачать ціну як «від …»' : ''}.</div>
        ${people.map((p) => { const x = S().ms.find((m) => m.staff_id === p.id && m.service_id === id && m.is_active);
          return `<div class="ms-row"><input type="checkbox" data-p="${p.id}" ${x ? 'checked' : ''} title="${esc(p.first_name)} виконує цю послугу"><span class="row" style="gap:8px">${avatar(p, 's')}<b class="ell">${esc(fullName(p))}</b></span>
            <input class="inp" type="number" min="5" step="5" data-pu="${p.id}" value="${x ? x.dur : sv.dur}" title="Тривалість у цього майстра, хв"><input class="inp" type="number" min="0" step="10" data-pp="${p.id}" value="${x ? +x.price : +sv.price}" title="Ціна у цього майстра, ₴">${hasMsFrom() ? `<label class="ms-from" title="Клієнти бачать у ${esc(p.first_name)} ціну як «від …»"><input type="checkbox" data-pf="${p.id}" ${x?.price_from ? 'checked' : ''}>від</label>` : ''}</div>`; }).join('') || '<div class="mut">Немає майстрів</div>'}</div>`,
      foot: `<button class="btn" data-x2 title="Закрити без збереження">Скасувати</button><button class="btn pri" id="sv-ok" title="Зберегти послугу">Зберегти</button>` });
    const el = s.el;
    const sid = id || crypto.randomUUID();
    let photos = [...(sv.photos || [])];
    const drawPh = () => {
      $('#sv-phs', el).innerHTML = photos.map((u, k) => `<div class="ph"><img src="${esc(u)}" alt="">${k ? `<button class="btn" data-first="${k}" title="Зробити головним (першим)" style="left:4px;right:auto">★</button>` : '<b>головне</b>'}<button class="btn" data-rmph="${k}" title="Прибрати фото">${IC.x.replace('width="20" height="20"', 'width="14" height="14"')}</button></div>`).join('') +
        (photos.length < 6 ? `<label class="add" title="Додати фото з телефона або компʼютера">${IC.plus}Додати<input type="file" accept="image/*" multiple hidden id="sv-phin"></label>` : '');
      $$('[data-rmph]', el).forEach((b) => (b.onclick = () => { photos.splice(+b.dataset.rmph, 1); drawPh(); }));
      $$('[data-first]', el).forEach((b) => (b.onclick = () => { const [u] = photos.splice(+b.dataset.first, 1); photos.unshift(u); drawPh(); }));
      const inp = $('#sv-phin', el); if (inp) inp.onchange = async () => {
        const files = [...inp.files].slice(0, 6 - photos.length); if (!files.length) return;
        const lab = inp.closest('label'); lab.innerHTML = '<span class="xs">Завантаження…</span>';
        for (const f of files) {
          try {
            const blob = await resizeImg(f, 1200); const path = `services/${sid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
            const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' }); if (error) throw error;
            photos.push(sb.storage.from('photos').getPublicUrl(path).data.publicUrl);
          } catch (e) { toast(errMsg(e), 'bad'); }
        }
        drawPh();
      };
    };
    drawPh();
    // тривалість і ціна згори переходять до майстрів, у яких стояло те саме значення (свої, відмінні — не чіпаємо)
    [['#sv-u', 'pu'], ['#sv-p', 'pp']].forEach(([sel, k]) => { const top = $(sel, el); let prev = top.value;
      top.addEventListener('input', () => { $$(`[data-${k}]`, el).forEach((f) => { if (f.value === prev || f.value === '') { f.value = top.value; f.classList.add('synced'); setTimeout(() => f.classList.remove('synced'), 700); } }); prev = top.value; }); });
    $('#sv-all', el).onclick = () => { $$('[data-p]', el).forEach((c) => { if (c.checked) { $(`[data-pu="${c.dataset.p}"]`, el).value = $('#sv-u', el).value; $(`[data-pp="${c.dataset.p}"]`, el).value = $('#sv-p', el).value; } }); };
    $('[data-x2]', el).onclick = s.close;
    $('#sv-ok', el).onclick = (e) => busy(e.currentTarget, async () => {
      const name = $('#sv-n', el).value.trim(), dur = +$('#sv-u', el).value, price = +$('#sv-p', el).value;
      if (!name) { $('#sv-n', el).classList.add('err'); return toast('Вкажіть назву', 'bad'); }
      if (!(dur >= 5) || !(price >= 0)) return toast('Перевірте тривалість і ціну', 'bad');
      // якщо поле категорії не чіпали, а за цей час категорію перейменували — не повертаємо стару назву
      let category = $('#sv-c', el).value.trim() || 'Інше';
      if (id && category === sv.category) { const { data: cur } = await sb.from('services').select('category').eq('id', id).single(); if (cur?.category) category = cur.category; }
      const row = { category, name, descr: $('#sv-d', el).value.trim() || null, dur, price, sort: +$('#sv-o', el).value || 100, is_active: $('#sv-a', el).checked, photos };
      if ($('#sv-f', el)) row.price_from = $('#sv-f', el).checked;
      const r1 = id ? await sb.from('services').update(row).eq('id', id) : await sb.from('services').insert({ id: sid, ...row });
      if (r1.error) return toast(errMsg(r1.error), 'bad');
      const up = [], del = [];
      $$('[data-p]', el).forEach((c) => { const pid = c.dataset.p;
        if (c.checked) { const u = +$(`[data-pu="${pid}"]`, el).value, p = +$(`[data-pp="${pid}"]`, el).value; up.push({ staff_id: pid, service_id: sid, dur: u >= 5 ? u : dur, price: p >= 0 ? p : price, is_active: true, ...(hasMsFrom() ? { price_from: !!$(`[data-pf="${pid}"]`, el)?.checked } : {}) }); }
        else if (S().ms.some((m) => m.staff_id === pid && m.service_id === sid)) del.push(pid); });
      if (up.length) { const { error } = await sb.from('master_services').upsert(up); if (error) return toast(errMsg(error), 'bad'); }
      if (del.length) { const { error } = await sb.from('master_services').delete().eq('service_id', sid).in('staff_id', del); if (error) return toast(errMsg(error), 'bad'); }
      await Staff.reload(); s.close(); toast('Послугу збережено'); done();
    });
  }

  /* ================= ПЕРСОНАЛ ================= */
  async function team(main, arg) {
    if (arg) return staffCard(main, arg);
    if (!isBoss()) return staffCard(main, S().me.id);
    S().teamOff = S().teamOff ?? false;
    const list = S().staff.filter((x) => S().teamOff || x.is_active);
    main.innerHTML = `<div class="pg-h"><h1>Персонал</h1><label class="chip" title="Показати також тих, хто вже не працює"><input type="checkbox" id="t-off" ${S().teamOff ? 'checked' : ''} style="accent-color:var(--gr)"> колишні</label>
      <a class="btn pri" href="#/staff/team/new" title="Додати нового співробітника">${IC.plus} Співробітник</a></div>
      <div class="team-grid">${list.map((p) => `<a class="t-card ${p.is_active ? '' : 'off'}" href="#/staff/team/${p.id}" style="text-decoration:none" title="Відкрити картку: ${esc(fullName(p))}">${avatar(p, 'l')}<div class="grow">
        <div class="b">${esc(fullName(p))}</div><div class="sm mut">${ROLE[p.role]}${p.experience ? ' · ' + esc(p.experience) : ''}</div>
        <div class="row wrap" style="gap:5px;margin-top:6px">${p.is_bookable ? `<span class="pill g">${S().ms.filter((m) => m.staff_id === p.id && m.is_active).length} послуг</span>` : ''}${p.is_bookable ? `<span class="pill i">${Staff.payPct(p.id)}%</span>` : ''}
        ${p.tg_chat_id ? '<span class="pill done" title="Сповіщення в Telegram підключено">Telegram ✓</span>' : ''}${!p.is_active ? '<span class="pill cancel">не працює</span>' : ''}${p.demo ? '<span class="pill g">приклад</span>' : ''}</div></div></a>`).join('')}</div>`;
    $('#t-off').onchange = (e) => { S().teamOff = e.target.checked; team(main); };
  }
  async function resizeImg(file, max) {   // зменшити фото, зберігаючи пропорції
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  }
  async function resizePhoto(file) {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
    const c = document.createElement('canvas'), side = Math.min(img.width, img.height);
    c.width = c.height = Math.min(600, side);
    const ctx = c.getContext('2d'); ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
  }
  async function staffCard(main, id) {
    const boss = isBoss(), isNew = id === 'new';
    if (isNew && !boss) return go('#/staff/team');
    const p = isNew ? { id: crypto.randomUUID(), role: 'master', first_name: '', last_name: '', middle_name: '', is_active: true, is_bookable: true, notify: { new: true, cancel: true, move: true, tg: true }, sort: 100 } : Staff.byId(id);
    if (!p) { main.innerHTML = '<div class="card empty">Співробітника не знайдено</div>'; return; }
    const self = p.id === S().me.id, can = boss || self;
    const pct = Staff.payPct(p.id), nt = p.notify || {};
    const myS = S().ms.filter((m) => m.staff_id === p.id && m.is_active);
    const svcs = S().services.filter((s) => s.is_active || myS.some((m) => m.service_id === s.id));
    const age = ageOf(p.birth_date);
    let monthStat = '';
    if (!isNew && (boss || self)) {
      const [f, t] = tsRange(...monthRange(curMonth()));
      const { data } = await sb.from('payments').select('amount,commission').eq('staff_id', p.id).gte('paid_at', f).lt('paid_at', t);
      if (data) monthStat = `<div class="kpis mt" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))"><div class="kpi"><div class="l">Візитів цього місяця</div><div class="v">${data.length}</div></div>
        <div class="kpi"><div class="l">Виручка</div><div class="v">${money(data.reduce((a, x) => a + +x.amount, 0))}</div></div><div class="kpi"><div class="l">Заробіток</div><div class="v">${money(data.reduce((a, x) => a + +x.commission, 0))}</div></div></div>`;
    }
    const roleOpts = ['master', 'admin', 'owner'].filter((r) => r !== 'owner' || Staff.isOwner() || p.role === 'owner');
    const bot = S().settings.tg_bot;
    // «назад» — туди, звідки відкрили картку (календар, дашборд, персонал); інакше власниці/адміну — список персоналу
    const back = prevHash.startsWith('#/staff') && !prevHash.startsWith('#/staff/team/') ? prevHash : boss ? '#/staff/team' : '';
    const backTip = /^#\/staff\/?(cal|$)/.test(back) ? 'Назад до календаря' : back.startsWith('#/staff/team') ? 'Назад до списку персоналу' : 'Назад';
    main.innerHTML = `<div class="pg-h">${back ? `<a class="btn ico" href="${back}" title="${backTip}">${IC.back}</a>` : ''}<h1>${isNew ? 'Новий співробітник' : esc(fullName(p))}</h1></div>
      <div class="card"><div class="row wrap" style="gap:16px">
        <div style="text-align:center"><div id="ph-box">${avatar(p, 'xl')}</div>${can ? `<label class="btn sm mt" title="Завантажити фото (буде обрізано квадратом)">📷 Фото<input type="file" accept="image/*" id="ph-in" hidden></label>` : ''}</div>
        <div class="grow" style="min-width:220px"><div class="three"><div><label class="lb" for="f-ln">Прізвище</label><input class="inp" id="f-ln" value="${esc(p.last_name)}" ${can ? '' : 'disabled'}></div>
          <div><label class="lb" for="f-fn">Імʼя <span class="req">*</span></label><input class="inp" id="f-fn" value="${esc(p.first_name)}" ${can ? '' : 'disabled'}></div>
          <div><label class="lb" for="f-mn">По батькові</label><input class="inp" id="f-mn" value="${esc(p.middle_name)}" ${can ? '' : 'disabled'}></div></div>
          <div class="three"><div><label class="lb" for="f-bd">Дата народження</label><input class="inp" type="date" id="f-bd" value="${p.birth_date || ''}" ${can ? '' : 'disabled'}></div>
          <div><label class="lb">Вік</label><div class="inp" style="background:#F7F7F3" id="f-age" title="Рахується автоматично з дати народження">${age != null ? age + ' ' + plural(age, 'рік', 'роки', 'років') : '—'}</div></div>
          <div><label class="lb" for="f-ex">Досвід / посада</label><input class="inp" id="f-ex" value="${esc(p.experience || '')}" placeholder="напр. Топ майстер, 5 років" ${can ? '' : 'disabled'}></div></div></div></div>
        <label class="lb" for="f-bio">Опис (бачать клієнти)</label><textarea class="inp" id="f-bio" rows="2" maxlength="300" ${can ? '' : 'disabled'}>${esc(p.bio || '')}</textarea>
        ${monthStat}</div>
      <div class="dgrid">
        <div class="card"><h3>Контакти</h3>
          <label class="lb" for="f-ph">Телефон</label><input class="inp" id="f-ph" type="tel" value="${esc(p.phone || '')}" placeholder="+380…" ${can ? '' : 'disabled'}>
          <label class="lb" for="f-tg">Нікнейм Telegram</label><input class="inp" id="f-tg" value="${esc(p.telegram || '')}" placeholder="@nickname" ${can ? '' : 'disabled'}>
          <label class="lb" for="f-em">Пошта</label><input class="inp" id="f-em" type="email" value="${esc(p.email || '')}" ${can ? '' : 'disabled'}></div>
        <div class="card"><h3>Робота</h3>
          <div class="two"><div><label class="lb" for="f-sd">Початок роботи в салоні</label><input class="inp" type="date" id="f-sd" value="${p.start_date || ''}" ${boss ? '' : 'disabled'}></div>
          <div><label class="lb">Стаж у салоні</label><div class="inp" style="background:#F7F7F3">${p.start_date ? esc(sinceTxt(p.start_date)) : '—'}</div></div></div>
          <div class="two"><div><label class="lb" for="f-pct">Відсоток від чеку, %</label><input class="inp" type="number" min="0" max="100" step="0.5" id="f-pct" value="${num(pct).replace(',', '.')}" ${boss ? '' : 'disabled'} title="${boss ? 'Скільки відсотків від суми оплати отримує майстер' : 'Встановлює власниця'}"></div>
          <div><label class="lb" for="f-role">Роль</label><select class="inp" id="f-role" ${boss && !self ? '' : 'disabled'} title="Власниця і адмін бачать гроші та керують усім">${roleOpts.map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select></div></div>
          <div class="col mt"><label class="sw" title="Чи показувати майстра клієнтам для онлайн-запису"><input type="checkbox" id="f-bk" ${p.is_bookable ? 'checked' : ''} ${boss ? '' : 'disabled'}><i></i><span class="b">Приймає записи клієнтів</span></label>
          <label class="sw" title="Вимкніть, якщо людина більше не працює — історія збережеться"><input type="checkbox" id="f-ac" ${p.is_active ? 'checked' : ''} ${boss && !self ? '' : 'disabled'}><i></i><span class="b">Працює в салоні</span></label></div>
          ${!isNew ? `<a class="btn wide mt" href="#/staff/sched/${p.id}" title="Години роботи, вихідні, закритий час">${IC.clock} Графік роботи</a>` : ''}</div>
        <div class="card full"><h3>Послуги, які виконує ${boss ? '' : '<span class="mut sm" style="font-weight:600">(змінює власниця)</span>'}</h3>
          ${[...new Set(svcs.map((s) => s.category))].map((c) => `<div class="s-cat" style="margin-top:10px">${esc(c)}</div>` + svcs.filter((s) => s.category === c).map((s) => { const x = myS.find((m) => m.service_id === s.id);
            return `<div class="ms-row"><input type="checkbox" data-sv="${s.id}" ${x ? 'checked' : ''} ${boss ? '' : 'disabled'} title="Виконує «${esc(s.name)}»"><span class="ell sm b">${esc(s.name)}</span>
              <input class="inp" type="number" min="5" step="5" data-su="${s.id}" value="${x ? x.dur : s.dur}" ${boss ? '' : 'disabled'} title="Тривалість, хв"><input class="inp" type="number" min="0" step="10" data-sp="${s.id}" value="${x ? +x.price : +s.price}" ${boss ? '' : 'disabled'} title="Ціна, ₴"></div>`; }).join('')).join('')}
          <div class="hint">Колонки: тривалість (хв) і ціна (₴) саме в цього майстра.</div></div>
        <div class="card"><h3>Сповіщення</h3>
          <div class="col">${[['new', 'Нові записи'], ['cancel', 'Скасування'], ['move', 'Перенесення']].map(([k, n]) => `<label class="sw" title="Отримувати сповіщення: ${n.toLowerCase()}"><input type="checkbox" data-nt="${k}" ${nt[k] !== false ? 'checked' : ''} ${can ? '' : 'disabled'}><i></i><span>${n}</span></label>`).join('')}
          <label class="sw" title="Дублювати сповіщення в Telegram"><input type="checkbox" data-nt="tg" ${nt.tg !== false ? 'checked' : ''} ${can ? '' : 'disabled'}><i></i><span>Надсилати в Telegram</span></label></div>
          <div class="hint">${p.role === 'master' ? 'Майстер отримує сповіщення лише про свої записи.' : 'Власниця й адмін отримують сповіщення про всі записи.'}</div>
          ${!isNew && bot ? `<div class="sect"><h3>${IC.tg.replace('<svg', '<svg width="18" height="18"')} Telegram ${p.tg_chat_id ? '<span class="pill done">підключено</span>' : '<span class="pill g">не підключено</span>'}</h3>
            ${self || boss ? `<div class="row wrap"><a class="btn sm ${p.tg_chat_id ? '' : 'pri'}" href="https://t.me/${esc(bot)}?start=s_${p.tg_link}" target="_blank" rel="noopener" title="${self ? 'Відкрити бота і натиснути Start' : 'Посилання для цього співробітника — надішліть йому'}">${p.tg_chat_id ? 'Перепідключити' : 'Підключити'}</a>
              ${boss && !self ? `<button class="btn sm" id="tg-copy" title="Скопіювати посилання, щоб надіслати співробітнику">Скопіювати посилання</button>` : ''}
              ${self && p.tg_chat_id ? '<button class="btn sm" id="tg-test" title="Надіслати перевірне повідомлення собі в Telegram">Надіслати тест</button>' : ''}
              ${boss && p.tg_chat_id ? '<button class="btn sm red" id="tg-off" title="Відʼєднати Telegram від цієї картки">Відʼєднати</button>' : ''}</div>` : ''}</div>` : ''}</div>
        <div class="card"><h3>${IC.lock} Вхід у програму</h3>
          ${can ? `<label class="lb" for="f-lg">Логін або пошта</label><input class="inp" id="f-lg" value="${esc(p.login || '')}" autocapitalize="off" spellcheck="false" placeholder="напр. polina" ${self || boss ? '' : 'disabled'}>
          <label class="lb" for="f-pw">${p.user_id ? 'Новий пароль' : 'Пароль'}</label><input class="inp" id="f-pw" type="text" autocomplete="new-password" placeholder="${p.user_id ? 'залиште порожнім, щоб не міняти' : 'щонайменше 4 символи'}">
          <button class="btn mt" id="f-login" title="Зберегти логін і пароль">${p.user_id ? 'Змінити вхід' : 'Створити вхід'}</button>
          <div class="hint">Без пошти: логін на кшталт <b>polina</b>. Персонал може входити й за спільним посиланням швидкого входу (Налаштування).</div>` : ''}</div>
      </div>
      ${can ? `<div class="row mt2" style="justify-content:flex-end;gap:10px"><button class="btn pri lg" id="f-save" title="Зберегти картку">${isNew ? 'Створити співробітника' : 'Зберегти зміни'}</button></div>` : ''}`;
    if (self && ls.get('pwHint', 0)) {   // прийшли за посиланням «встановити пароль»
      ls.set('pwHint', 0); const f = $('#f-pw', main);
      if (f) setTimeout(() => { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.focus(); f.classList.add('err'); toast('Впишіть новий пароль і натисніть «Змінити вхід»', 'ok', 6000); }, 300);
    }
    let photo = p.photo_url || null;
    $('#f-bd', main).onchange = (e) => { const a = ageOf(e.target.value); $('#f-age', main).textContent = a != null ? a + ' ' + plural(a, 'рік', 'роки', 'років') : '—'; };
    const phIn = $('#ph-in', main); if (phIn) phIn.onchange = async () => {
      const f = phIn.files[0]; if (!f) return;
      try {
        const blob = await resizePhoto(f); const path = `staff/${p.id}-${Date.now()}.jpg`;
        const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true }); if (error) throw error;
        photo = sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
        $('#ph-box', main).innerHTML = avatar({ ...p, photo_url: photo }, 'xl');
        if (!isNew) { const { error: e2 } = await sb.from('staff').update({ photo_url: photo }).eq('id', p.id); if (e2) throw e2; await Staff.reload(); toast('Фото збережено'); }
      } catch (e) { toast(errMsg(e), 'bad'); }
    };
    const tgc = $('#tg-copy', main); if (tgc) tgc.onclick = async () => { try { await navigator.clipboard.writeText(`https://t.me/${bot}?start=s_${p.tg_link}`); toast('Посилання скопійовано — надішліть його співробітнику'); } catch (e) { toast('Не вдалося скопіювати', 'bad'); } };
    const tgt = $('#tg-test', main); if (tgt) tgt.onclick = () => busy(tgt, async () => {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(SB_URL + '/functions/v1/tg-bot', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: SB_KEY }, body: JSON.stringify({ action: 'test' }) });
      const j = await r.json().catch(() => ({})); r.ok ? toast('Надіслано — перевірте Telegram') : toast(j.error || 'Не вдалося', 'bad');
    });
    const tgo = $('#tg-off', main); if (tgo) tgo.onclick = async () => { if (!(await confirmBox('Відʼєднати Telegram?', { ok: 'Відʼєднати', danger: true }))) return;
      const { error } = await sb.from('staff').update({ tg_chat_id: null }).eq('id', p.id); if (error) return toast(errMsg(error), 'bad'); await Staff.reload(); toast('Відʼєднано'); staffCard(main, p.id); };
    const lg = $('#f-login', main); if (lg) lg.onclick = () => busy(lg, async () => {
      if (isNew) return toast('Спершу створіть співробітника', 'bad');
      const login = $('#f-lg', main).value.trim(), pw = $('#f-pw', main).value;
      const { error } = await sb.rpc('staff_set_login', { p_staff: p.id, p_login: login, p_password: pw || null });
      if (error) return toast(errMsg(error), 'bad', 5000);
      await Staff.reload(); $('#f-pw', main).value = ''; toast('Вхід збережено' + (pw ? ' — новий пароль діє' : ''));
    });
    const sv = $('#f-save', main); if (sv) sv.onclick = () => busy(sv, async () => {
      const fn = $('#f-fn', main).value.trim(); if (!fn) { $('#f-fn', main).classList.add('err'); return toast('Вкажіть імʼя', 'bad'); }
      const phone = $('#f-ph', main).value.trim(); if (phone && !normPhone(phone)) return toast('Перевірте телефон', 'bad');
      const notify = {}; $$('[data-nt]', main).forEach((c) => (notify[c.dataset.nt] = c.checked));
      const row = { first_name: fn, last_name: $('#f-ln', main).value.trim(), middle_name: $('#f-mn', main).value.trim(), birth_date: $('#f-bd', main).value || null,
        experience: $('#f-ex', main).value.trim() || null, bio: $('#f-bio', main).value.trim() || null, phone: phone ? normPhone(phone) : null,
        telegram: $('#f-tg', main).value.trim().replace(/^@/, '') || null, email: $('#f-em', main).value.trim() || null, photo_url: photo, notify };
      if (boss) Object.assign(row, { start_date: $('#f-sd', main).value || null, is_bookable: $('#f-bk', main).checked });
      if (boss && !self) Object.assign(row, { role: $('#f-role', main).value, is_active: $('#f-ac', main).checked });
      let r = isNew ? await sb.from('staff').insert({ id: p.id, ...row }) : await sb.from('staff').update(row).eq('id', p.id);
      if (r.error) return toast(errMsg(r.error), 'bad');
      if (boss) {
        const pv = Math.min(100, Math.max(0, +$('#f-pct', main).value || 0));
        r = await sb.from('staff_pay').upsert({ staff_id: p.id, commission_pct: pv }); if (r.error) return toast(errMsg(r.error), 'bad');
        const up = [], del = [];
        $$('[data-sv]', main).forEach((c) => { const sid = c.dataset.sv;
          if (c.checked) up.push({ staff_id: p.id, service_id: sid, dur: Math.max(5, +$(`[data-su="${sid}"]`, main).value || 60), price: Math.max(0, +$(`[data-sp="${sid}"]`, main).value || 0), is_active: true });
          else if (S().ms.some((m) => m.staff_id === p.id && m.service_id === sid)) del.push(sid); });
        if (up.length) { r = await sb.from('master_services').upsert(up); if (r.error) return toast(errMsg(r.error), 'bad'); }
        if (del.length) { r = await sb.from('master_services').delete().eq('staff_id', p.id).in('service_id', del); if (r.error) return toast(errMsg(r.error), 'bad'); }
        if (isNew && row.is_bookable) await sb.from('work_hours').upsert([1, 2, 3, 4, 5, 6].map((d) => ({ staff_id: p.id, weekday: d, start_time: S().settings.open_time, end_time: S().settings.close_time })));
      }
      await Staff.reload(); toast(isNew ? 'Співробітника створено. Тепер задайте вхід у програму.' : 'Збережено');
      if (isNew) go('#/staff/team/' + p.id); else staffCard(main, p.id);
    });
  }

  /* ================= НАЛАШТУВАННЯ ================= */
  async function settings(main) {
    const s = S().settings;
    const { data: tl } = await sb.rpc('team_link');
    const teamUrl = siteBase() + '#/team/' + tl.token, bookUrl = siteBase();
    const { count: demoN } = await sb.from('appointments').select('id', { count: 'exact', head: true }).eq('demo', true);
    let methods = [...(s.pay_methods || [])];
    main.innerHTML = `<div class="pg-h"><h1>Налаштування</h1></div><div class="dgrid" style="margin-top:0">
      <div class="card"><h3>Салон</h3>
        <label class="lb" for="s-n">Назва</label><input class="inp" id="s-n" value="${esc(s.salon_name)}">
        <label class="lb" for="s-a">Адреса</label><input class="inp" id="s-a" value="${esc(s.address || '')}">
        <div class="two"><div><label class="lb" for="s-p">Телефон</label><input class="inp" id="s-p" type="tel" value="${esc(s.phone || '')}"></div><div><label class="lb" for="s-i">Instagram</label><input class="inp" id="s-i" value="${esc(s.instagram || '')}"></div></div>
        <label class="lb" for="s-u">Адреса сайту (для посилань у Telegram)</label><input class="inp" id="s-u" value="${esc(s.site_url || '')}" placeholder="https://…"></div>
      <div class="card"><h3>Правила онлайн-запису</h3>
        <div class="two"><div><label class="lb" for="s-o">Салон працює з</label><input class="inp" type="time" step="600" id="s-o" value="${s.open_time.slice(0, 5)}"></div><div><label class="lb" for="s-c">до</label><input class="inp" type="time" step="600" id="s-c" value="${s.close_time.slice(0, 5)}"></div></div>
        <div class="two"><div><label class="lb" for="s-l">Останній запис о</label><input class="inp" type="time" step="600" id="s-l" value="${s.last_start.slice(0, 5)}" title="Пізніше цього часу клієнти онлайн не запишуться"></div>
        <div><label class="lb" for="s-st">Крок часу, хв</label><select class="inp" id="s-st">${[5, 10, 15, 20, 30, 60].map((v) => `<option ${v === s.step_min ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <div class="two"><div><label class="lb" for="s-b">Перерва між клієнтами, хв</label><input class="inp" type="number" min="0" max="120" step="5" id="s-b" value="${s.buffer_min}"></div>
        <div><label class="lb" for="s-ld">Не раніше ніж за, год</label><input class="inp" type="number" min="0" max="72" step="0.5" id="s-ld" value="${s.lead_min / 60}" title="Мінімум часу між записом і початком послуги"></div></div>
        <div class="two"><div><label class="lb" for="s-md">Запис наперед, днів</label><input class="inp" type="number" min="1" max="365" id="s-md" value="${s.max_days}"></div>
        <div><label class="lb" for="s-ch">Скасування онлайн до, год</label><input class="inp" type="number" min="0" max="72" id="s-ch" value="${s.cancel_hours}"></div></div>
        <div class="two"><div><label class="lb" for="s-sd">«Застарілий» клієнт після, днів</label><input class="inp" type="number" min="7" max="720" id="s-sd" value="${s.stale_days}"></div>
        <div><label class="lb" for="s-rh">Нагадування клієнтам за, год</label><input class="inp" id="s-rh" value="${(s.remind_hours || []).join(', ')}" placeholder="24, 2" title="Через кому, напр. 24, 2"></div></div></div>
      <div class="card"><h3>Оплата</h3><label class="lb">Способи оплати</label><div class="chips" id="s-pm"></div>
        <div class="row mt"><input class="inp" id="s-pmn" placeholder="Новий спосіб, напр. Термінал"><button class="btn" id="s-pma" title="Додати спосіб оплати">${IC.plus}</button></div>
        <label class="lb" for="s-pl">Посилання для оплати за QR</label><input class="inp" id="s-pl" value="${esc(s.pay_link || '')}" placeholder="напр. посилання на банку Monobank">
        <div class="hint">Коли майстер обирає оплату «QR», на екрані зʼявиться QR-код з цим посиланням.</div></div>
      <div class="card"><h3>Посилання</h3>
        <label class="lb">Онлайн-запис для клієнтів</label><div class="row"><input class="inp" readonly value="${esc(bookUrl)}"><button class="btn" data-cp="${esc(bookUrl)}" title="Скопіювати посилання">Копіювати</button></div>
        <div class="row mt"><button class="btn" id="s-qr" title="Показати QR-код для друку на рецепції">QR-код для рецепції</button>${s.instagram ? '<span class="hint" style="margin:0">Додайте посилання в шапку Instagram</span>' : ''}</div>
        <label class="lb">Швидкий вхід для персоналу ${tl.enabled ? '<span class="pill done">увімкнено</span>' : '<span class="pill cancel">вимкнено</span>'}</label>
        <div class="row"><input class="inp" readonly value="${esc(teamUrl)}"><button class="btn" data-cp="${esc(teamUrl)}" title="Скопіювати посилання для персоналу">Копіювати</button></div>
        <div class="hint">⚠️ Хто має це посилання, може увійти як будь-хто з персоналу без пароля. Надсилайте лише працівникам.</div>
        <div class="row wrap mt"><button class="btn sm" id="s-tl" title="${tl.enabled ? 'Вимкнути вхід без пароля' : 'Увімкнути вхід за посиланням'}">${tl.enabled ? 'Вимкнути' : 'Увімкнути'}</button><button class="btn sm red" id="s-tr" title="Створити нове посилання — старе перестане працювати">Нове посилання</button></div>
        ${s.tg_bot ? `<label class="lb">Telegram-бот</label><a class="btn sm" href="https://t.me/${esc(s.tg_bot)}" target="_blank" rel="noopener" title="Відкрити бота салону">${IC.tg.replace('<svg', '<svg width="16" height="16"')} @${esc(s.tg_bot)}</a>` : ''}</div>
      ${demoN ? `<div class="card full"><h3>Демо-дані</h3><p class="mut sm" style="margin:0 0 10px">У програмі ${demoN} демо-записів і приклади клієнтів — щоб подивитись, як усе працює. Коли почнете працювати по-справжньому, приберіть їх.</p>
        <button class="btn red" id="s-demo" title="Видалити всі демо-записи, демо-клієнтів і приклад-майстра">Прибрати демо-дані</button></div>` : ''}
    </div><div class="row mt2" style="justify-content:flex-end"><button class="btn pri lg" id="s-save" title="Зберегти налаштування">Зберегти налаштування</button></div>`;
    const drawPm = () => { $('#s-pm', main).innerHTML = methods.map((m, i) => `<span class="chip on">${esc(m)} <button class="btn ghost ico sm" data-rm="${i}" title="Прибрати «${esc(m)}»" style="width:22px;min-height:22px;color:#fff;border:0">${IC.x.replace('width="20" height="20"', 'width="14" height="14"')}</button></span>`).join('');
      $$('[data-rm]', main).forEach((b) => (b.onclick = () => { if (methods.length < 2) return toast('Має лишитись хоча б один спосіб', 'bad'); methods.splice(+b.dataset.rm, 1); drawPm(); })); };
    drawPm();
    $('#s-pma', main).onclick = () => { const v = $('#s-pmn', main).value.trim(); if (v && !methods.includes(v)) { methods.push(v); $('#s-pmn', main).value = ''; drawPm(); } };
    $$('[data-cp]', main).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.cp); toast('Скопійовано'); } catch (e) { toast('Не вдалося скопіювати', 'bad'); } }));
    $('#s-qr', main).onclick = async () => { const svg = await qrSvg(bookUrl, 8);
      sheet({ title: 'QR-код для запису', body: `<div style="text-align:center"><img src="img/logo.png" style="height:70px;background:var(--gr);padding:10px;border-radius:12px" alt=""><div class="qr-box mt">${svg}</div><p class="b">Записатися онлайн</p><p class="hint">Зробіть знімок екрана або роздрукуйте (Ctrl/⌘+P)</p></div>` }); };
    $('#s-tl', main).onclick = async () => { const { error } = await sb.rpc('team_link', { p_regen: false, p_enabled: !tl.enabled }); if (error) return toast(errMsg(error), 'bad'); toast(tl.enabled ? 'Швидкий вхід вимкнено' : 'Швидкий вхід увімкнено'); settings(main); };
    $('#s-tr', main).onclick = async () => { if (!(await confirmBox('Створити нове посилання?', { ok: 'Створити', sub: 'Старе посилання перестане працювати.' }))) return;
      const { error } = await sb.rpc('team_link', { p_regen: true }); if (error) return toast(errMsg(error), 'bad'); toast('Нове посилання створено'); settings(main); };
    const dm = $('#s-demo', main); if (dm) dm.onclick = async () => {
      if (!(await confirmBox('Прибрати всі демо-дані?', { ok: 'Так, прибрати', danger: true, sub: 'Будуть видалені демо-записи, їхні оплати й демо-клієнти. Справжні дані не зачіпаються.' }))) return;
      await busy(dm, async () => { const { data, error } = await sb.rpc('demo_clear'); if (error) return toast(errMsg(error), 'bad'); await Staff.reload(); toast(`Прибрано: ${data.appointments} записів, ${data.clients} клієнтів`); settings(main); });
    };
    $('#s-save', main).onclick = (e) => busy(e.currentTarget, async () => {
      const rh = $('#s-rh', main).value.split(/[,\s]+/).map(Number).filter((x) => x > 0 && x <= 168);
      const row = { salon_name: $('#s-n', main).value.trim() || 'NaNa studio', address: $('#s-a', main).value.trim() || null, phone: $('#s-p', main).value.trim() ? normPhone($('#s-p', main).value) : null,
        instagram: $('#s-i', main).value.trim().replace(/^@/, '') || null, site_url: $('#s-u', main).value.trim() || null,
        open_time: $('#s-o', main).value, close_time: $('#s-c', main).value, last_start: $('#s-l', main).value, step_min: +$('#s-st', main).value,
        buffer_min: Math.max(0, +$('#s-b', main).value || 0), lead_min: Math.round(Math.max(0, +$('#s-ld', main).value || 0) * 60), max_days: Math.max(1, +$('#s-md', main).value || 60),
        cancel_hours: Math.max(0, +$('#s-ch', main).value || 0), stale_days: Math.max(7, +$('#s-sd', main).value || 60), remind_hours: rh.length ? rh : [24, 2],
        pay_methods: methods, pay_link: $('#s-pl', main).value.trim() || null, updated_at: new Date().toISOString() };
      if (toMin(row.close_time) <= toMin(row.open_time)) return toast('Час закриття має бути пізніше за відкриття', 'bad');
      const { error } = await sb.from('settings').update(row).eq('id', 1); if (error) return toast(errMsg(error), 'bad');
      await Staff.reload(); toast('Налаштування збережено');
    });
  }

  return { dash, earn, services, team, settings };
})();
