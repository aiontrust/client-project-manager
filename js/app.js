(() => {
  const STATUSES = [
    { key: 'pending', label: 'Pending' },
    { key: 'in progress', label: 'In progress' },
    { key: 'completed', label: 'Completed' },
  ];
  const statusClass = s => (s || 'pending').replace(' ', '-');
  const statusLabel = s => (STATUSES.find(x => x.key === s) || STATUSES[0]).label;

  const state = {
    contacts: new Map(),
    projects: new Map(),
    entries: new Map(),
    selectedId: null,
    search: '',
    view: 'clients',
    clientFilter: '',
    loaded: { contacts: false, projects: false, entries: false },
    cal: { mode: 'month', cursor: null, sort: { key: 'startDate', dir: 1 } },
  };
  let db = null;
  let readOnly = false;

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const dayDiff = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
  const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const monthStart = iso => iso.slice(0, 8) + '01';
  const addMonths = (iso, n) => { const d = fromISO(monthStart(iso)); d.setMonth(d.getMonth() + n); return toISO(d); };
  const monthLabel = (iso, opts = { month: 'long', year: 'numeric' }) => fromISO(iso).toLocaleDateString(undefined, opts);
  function fmtDate(iso) {
    if (!iso) return '—';
    return fromISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const fmtLong = iso => fromISO(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const daysUntil = iso => iso ? dayDiff(todayISO(), iso) : null;
  function dueFlag(p) {
    if (p.status === 'completed' || !p.endDate) return '';
    const n = daysUntil(p.endDate);
    if (n < 0) return `<span class="flag">Overdue ${-n}d</span>`;
    if (n <= 7) return `<span class="flag soon">Due in ${n}d</span>`;
    return '';
  }
  const isOverdue = p => p.status !== 'completed' && p.endDate && daysUntil(p.endDate) < 0;
  const spanOf = p => {
    const s = p.startDate || p.endDate, e = p.endDate || p.startDate;
    return s ? [s, e < s ? s : e] : null;
  };

  // ---------- links ----------
  function linkKind(url) {
    try {
      const h = new URL(url).hostname;
      if (/(^|\.)(drive|docs|photos)\.google\.com$/.test(h)) return 'drive';
    } catch {}
    return 'web';
  }
  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  function normalizeUrl(raw) {
    let u = raw.trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); return /\./.test(x.hostname) ? x.href : null; } catch { return null; }
  }
  function renderLinks(links) {
    if (!links || !links.length) return '';
    return `<ul class="links">${links.map(l => {
      const k = linkKind(l.url);
      return `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
        <span class="kind ${k}">${k === 'drive' ? 'Drive' : 'Web'}</span>
        <span class="ltxt">${esc(l.label || hostOf(l.url))}</span>
        <span class="host">${esc(hostOf(l.url))} ↗</span></a></li>`;
    }).join('')}</ul>`;
  }
  // A project's links as small buttons that open in a new tab: the first few, then "+N more".
  // On project cards, two or more links fold into a dropdown to keep the card compact.
  // The open one is remembered so a live update from a teammate doesn't close it.
  let openLinkMenu = null;
  function linkMenu(links, key) {
    if (!links || !links.length) return '';
    if (links.length === 1) return linkChips(links);
    return `<details class="link-menu" data-menu="${esc(key)}"${openLinkMenu === key ? ' open' : ''}>
      <summary>Links <span class="mini">${links.length}</span></summary>
      <ul>${links.map(l => {
        const k = linkKind(l.url);
        return `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
          <span class="kind ${k}">${k === 'drive' ? 'Drive' : 'Web'}</span>
          <span class="ltxt">${esc(l.label || hostOf(l.url))}</span>
          <span class="host">${esc(hostOf(l.url))} ↗</span></a></li>`;
      }).join('')}</ul>
    </details>`;
  }
  function linkChips(links, max = 3) {
    if (!links || !links.length) return '';
    const chips = links.slice(0, max).map(l => {
      const k = linkKind(l.url);
      return `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}"><span class="kind ${k}">${k === 'drive' ? 'Drive' : 'Web'}</span><span class="ltxt">${esc(l.label || hostOf(l.url))}</span></a>`;
    }).join('');
    return `<span class="link-chips">${chips}${links.length > max ? `<span class="mini">+${links.length - max} more</span>` : ''}</span>`;
  }
  const linkRow = (l = { label: '', url: '' }) => `<div class="link-row">
      <input name="link-label" placeholder="Label, e.g. Site photos" value="${esc(l.label)}" aria-label="Link label" autocomplete="off">
      <input name="link-url" type="url" inputmode="url" placeholder="https://drive.google.com/…" value="${esc(l.url)}" aria-label="Link address" autocomplete="off">
      <button type="button" class="btn ghost sm" data-action="remove-link" aria-label="Remove link">Remove</button>
    </div>`;
  const linksEditor = links => `<div class="field full">
      <span class="flabel">Links</span>
      <div class="link-rows" id="link-rows">${(links || []).map(linkRow).join('')}</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn sm" data-action="add-link">+ Add link</button>
        <span class="hint">Paste a website or Google Drive address. Use Drive's Share → Copy link.</span>
      </div>
    </div>`;
  function readLinks(form) {
    const out = [];
    for (const row of form.querySelectorAll('.link-row')) {
      const label = row.querySelector('[name="link-label"]').value.trim();
      const raw = row.querySelector('[name="link-url"]').value.trim();
      if (!label && !raw) continue;
      const url = normalizeUrl(raw);
      if (!url) return { error: raw ? `“${raw}” isn't a web address. Paste the full link, starting with https://.` : `Add the web address for “${label}”, or remove that row.` };
      out.push({ label: label || (linkKind(url) === 'drive' ? 'Google Drive file' : hostOf(url)), url });
    }
    return { links: out };
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- persistence ----------
  const mapOf = col => state[col];
  async function save(col, id, data) {
    if (!db) { mapOf(col).set(id, { id, ...data }); render(); return true; }
    try { await db.collection(col).doc(id).set(data); return true; }
    catch (e) { return handleWriteError(e); }
  }
  async function remove(col, id) {
    if (!db) { mapOf(col).delete(id); render(); return true; }
    try { await db.collection(col).doc(id).delete(); return true; }
    catch (e) { return handleWriteError(e); }
  }
  function handleWriteError(e) {
    if (e && e.code === 'invalid_argument') {
      readOnly = true; render();
      toast('You can view this workspace but not change it.');
    } else if (e && e.code === 'quota_exceeded') {
      toast('Storage is full. Delete some old records, then try again.');
    } else {
      toast('That change didn’t save. Check your connection and try again.');
    }
    return false;
  }
  function listen(col) {
    const map = mapOf(col);
    const source = db;
    source.collection(col).onSnapshot(snap => {
      if (db !== source) return;
      map.clear();
      snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      state.loaded[col] = true;
      if (state.selectedId && !state.contacts.has(state.selectedId) && state.loaded.contacts) state.selectedId = null;
      render();
    }, () => {
      if (db !== source) return;
      $('offline').hidden = false;
      $('offline').textContent = 'Live updates stopped. Reload the page to reconnect.';
    });
  }

  // ---------- derived ----------
  const sortedContacts = () => [...state.contacts.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const projectsFor = cid => [...state.projects.values()].filter(p => p.clientId === cid).sort(byDue);
  function byDue(a, b) {
    const order = { 'in progress': 0, 'pending': 1, 'completed': 2 };
    return ((order[a.status] ?? 1) - (order[b.status] ?? 1)) || (a.endDate || '9999').localeCompare(b.endDate || '9999');
  }
  const clientName = cid => state.contacts.get(cid)?.name || 'No client';

  // ---------- render ----------
  function render() {
    const contacts = sortedContacts();
    const projects = [...state.projects.values()];
    $('count-clients').textContent = contacts.length;
    $('count-projects').textContent = projects.length;

    const active = projects.filter(p => p.status === 'in progress').length;
    const pending = projects.filter(p => p.status === 'pending').length;
    const overdue = projects.filter(isOverdue).length;
    $('summary').innerHTML =
      `<span class="chip"><b>${active}</b> in progress</span>` +
      `<span class="chip"><b>${pending}</b> pending</span>` +
      (overdue ? `<span class="chip warn"><b>${overdue}</b> overdue</span>` : `<span class="chip"><b>0</b> overdue</span>`) +
      (readOnly ? `<span class="chip">View only</span>` : '');

    document.querySelectorAll('#add-contact, #add-project-board, #add-entry').forEach(b => b.disabled = readOnly);

    const gated = !$('gate').hidden;
    for (const v of ['clients', 'projects', 'calendar']) {
      $('view-' + v).hidden = gated || state.view !== v;
      $('tab-' + v).setAttribute('aria-selected', state.view === v);
    }

    renderList(contacts);
    renderDetail();
    renderBoard(contacts);
    renderCalendar();
  }

  function renderList(contacts) {
    const q = state.search.trim().toLowerCase();
    const rows = contacts.filter(c => !q || [c.name, c.email, c.company].some(v => (v || '').toLowerCase().includes(q)));
    const el = $('contact-list');
    if (db && !state.loaded.contacts) { el.innerHTML = `<li class="empty">Loading clients…</li>`; return; }
    if (!contacts.length) {
      el.innerHTML = `<li class="empty none-yet"><strong>No clients yet</strong>Add your first client to start tracking their projects.</li>`;
      return;
    }
    if (!rows.length) { el.innerHTML = `<li class="empty">No clients match “${esc(state.search)}”.</li>`; return; }
    el.innerHTML = rows.map(c => {
      const open = projectsFor(c.id).filter(p => p.status !== 'completed').length;
      return `<li><button data-select="${esc(c.id)}" aria-current="${c.id === state.selectedId}">
        <span class="avatar">${esc(initials(c.name))}</span>
        <span class="who"><strong>${esc(c.name)}</strong><span>${esc(c.company || c.email)}</span></span>
        <span class="mini" title="Open projects">${open ? open + ' open' : ''}</span>
      </button></li>`;
    }).join('');
  }

  function renderDetail() {
    const el = $('detail');
    const c = state.contacts.get(state.selectedId);
    // On phones the list sits right above, so "Pick a client" adds nothing there.
    el.classList.toggle('picking', !c && state.contacts.size > 0);
    if (!c) {
      const has = state.contacts.size > 0;
      el.innerHTML = `<div class="empty" style="padding:56px 20px">
        <strong>${has ? 'Pick a client' : 'Your client book is empty'}</strong>
        <span>${has ? 'Select a client on the left to see their details and projects.' : 'Clients you add appear here with their contact details and every project you run for them.'}</span>
        ${has || readOnly ? '' : `<div class="actions" style="justify-content:center">
          <button class="btn primary" data-action="new-contact">+ Add a client</button>
          <button class="btn" data-action="load-examples">Load example data</button>
        </div>`}
      </div>`;
      return;
    }
    const projects = projectsFor(c.id);
    const fact = (label, value, copyable) => `<div><dt>${label}</dt><dd><span>${value ? esc(value) : '<span class="mini">Not set</span>'}</span>${value && copyable ? `<button class="copy" data-copy="${esc(value)}">Copy</button>` : ''}</dd></div>`;
    el.innerHTML = `<div class="detail">
      <div class="detail-head">
        <div>
          <h2>${esc(c.name)} ${c.example ? '<span class="example">Example</span>' : ''}</h2>
          <div class="company">${esc(c.company || '')}</div>
        </div>
        ${readOnly ? '' : `<div class="actions">
          <button class="btn sm" data-action="edit-contact">Edit</button>
          <button class="btn sm danger" data-action="ask-delete-contact">Delete</button>
        </div>`}
      </div>
      <div id="contact-confirm"></div>
      <dl class="facts">
        ${fact('Email', c.email, true)}
        ${fact('Phone', c.phone, true)}
        ${fact('Company', c.company, false)}
      </dl>
      ${c.notes ? `<div style="display:grid;gap:6px"><span class="label">Notes</span><p class="notes">${esc(c.notes)}</p></div>` : ''}
      <div style="display:grid;gap:10px">
        <div class="section-head">
          <h3>Projects <span class="mini">${projects.length}</span></h3>
          ${readOnly ? '' : '<button class="btn sm primary" data-action="new-project-for">+ New project</button>'}
        </div>
        ${projects.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Project</th><th>Dates</th><th>Status</th><th></th></tr></thead>
          <tbody>${projects.map(p => `<tr>
            <td><button class="linkish" data-edit-project="${esc(p.id)}">${esc(p.name)}</button> ${dueFlag(p)}${p.links && p.links.length ? `<div style="margin-top:6px">${linkChips(p.links)}</div>` : ''}</td>
            <td class="dates">${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</td>
            <td>${statusControl(p)}</td>
            <td style="text-align:right">${readOnly ? '' : `<button class="btn ghost sm" data-edit-project="${esc(p.id)}">Edit</button>`}</td>
          </tr>`).join('')}</tbody></table></div>`
          : `<div class="empty" style="background:var(--bg);border-radius:8px">No projects for ${esc(c.name)} yet.</div>`}
      </div>
    </div>`;
  }

  function statusControl(p) {
    if (readOnly) return `<span class="pill ${statusClass(p.status)}">${statusLabel(p.status)}</span>`;
    return `<select class="status ${statusClass(p.status)}" data-status="${esc(p.id)}" aria-label="Status of ${esc(p.name)}">
      ${STATUSES.map(s => `<option value="${s.key}" ${s.key === p.status ? 'selected' : ''}>${s.label}</option>`).join('')}
    </select>`;
  }

  function renderBoard(contacts) {
    const sel = $('filter-client');
    const cur = state.clientFilter;
    sel.innerHTML = `<option value="">All clients</option>` + contacts.map(c => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const projects = [...state.projects.values()].filter(p => !cur || p.clientId === cur).sort(byDue);
    $('board').innerHTML = STATUSES.map(s => {
      const items = projects.filter(p => p.status === s.key);
      return `<div class="lane">
        <div class="lane-head"><span class="pill ${statusClass(s.key)}">${s.label}</span><span class="mini">${items.length}</span></div>
        ${items.length ? items.map(p => `<article class="card ${isOverdue(p) ? 'overdue' : ''}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <h4>${esc(p.name)}</h4>
            ${readOnly ? '' : `<button class="btn ghost sm" data-edit-project="${esc(p.id)}">Edit</button>`}
          </div>
          <button class="client" data-goto="${esc(p.clientId)}">${esc(clientName(p.clientId))}</button>
          <div class="mini" style="font-variant-numeric:tabular-nums">${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</div>
          ${linkMenu(p.links, p.id)}
          <div class="meta">${statusControl(p)} <span>${dueFlag(p)} ${p.example ? '<span class="example">Example</span>' : ''}</span></div>
        </article>`).join('') : `<div class="empty">Nothing ${s.label.toLowerCase()}.</div>`}
      </div>`;
    }).join('');
  }

  // ---------- calendar ----------
  function renderCalendar() {
    const cal = state.cal;
    if (!cal.cursor) cal.cursor = monthStart(todayISO());
    document.querySelectorAll('[data-calmode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.calmode === cal.mode));
    $('cal-nav').hidden = cal.mode === 'list';
    $('cal-legend').hidden = cal.mode === 'list';
    if (cal.mode === 'month') { $('cal-title').textContent = monthLabel(cal.cursor); $('cal-body').innerHTML = monthHTML(); }
    else $('cal-body').innerHTML = listHTML();
  }

  function itemsByDay() {
    const by = new Map();
    const push = (d, it) => { if (!by.has(d)) by.set(d, []); by.get(d).push(it); };
    for (const p of state.projects.values()) {
      if (p.startDate) push(p.startDate, { kind: 'start', p });
      if (p.endDate && p.endDate !== p.startDate) push(p.endDate, { kind: 'due', p });
      else if (p.endDate) by.get(p.endDate).find(x => x.p === p).kind = 'due';
    }
    for (const e of state.entries.values()) if (e.date) push(e.date, { kind: 'entry', e });
    return by;
  }

  function monthHTML() {
    const first = fromISO(state.cal.cursor);
    const gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const gridEnd = new Date(last); gridEnd.setDate(last.getDate() + (6 - last.getDay()));
    const by = itemsByDay();
    const today = todayISO();
    const dows = [...Array(7)].map((_, i) => { const d = new Date(2026, 0, 4 + i); return d.toLocaleDateString(undefined, { weekday: 'short' }); });
    let cells = '';
    for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      const items = (by.get(iso) || []).sort((a, b) => ({ due: 0, start: 1, entry: 2 }[a.kind] - { due: 0, start: 1, entry: 2 }[b.kind]));
      const shown = items.slice(0, 3);
      const chips = shown.map(it => {
        if (it.kind === 'entry') return `<span class="evt entry">${esc(it.e.title)}${it.e.links?.length ? ' ↗' : ''}</span>`;
        const p = it.p;
        if (it.kind === 'start') return `<span class="evt start"><b>Starts</b> ${esc(p.name)}</span>`;
        const cls = p.status === 'completed' ? 'done' : isOverdue(p) ? 'late' : '';
        return `<span class="evt due ${cls}"><b>Due</b> ${esc(p.name)}</span>`;
      }).join('');
      const out = d.getMonth() !== first.getMonth();
      const aria = `${fmtLong(iso)}${items.length ? `, ${items.length} item${items.length > 1 ? 's' : ''}` : ''}`;
      cells += `<button class="day ${out ? 'out' : ''} ${iso === today ? 'today' : ''}" data-day="${iso}" aria-label="${esc(aria)}">
        <span class="dnum">${d.getDate()}</span>${chips}${items.length > 3 ? `<span class="more">+${items.length - 3} more</span>` : ''}
      </button>`;
    }
    return `<div class="month"><div class="dow">${dows.map(x => `<div>${esc(x)}</div>`).join('')}</div><div class="weeks">${cells}</div></div>`;
  }

  function listHTML() {
    const { key, dir } = state.cal.sort;
    const rows = [...state.projects.values()].map(p => ({
      p, client: clientName(p.clientId), left: p.status === 'completed' ? null : daysUntil(p.endDate),
    }));
    if (!rows.length) return `<div class="listview"><div class="empty" style="padding:40px 20px"><strong>No projects yet</strong>Projects you add appear here as a sortable list, grouped by month.</div></div>`;
    const val = r => key === 'client' ? r.client.toLowerCase() : key === 'name' ? (r.p.name || '').toLowerCase() : key === 'status' ? statusLabel(r.p.status) : key === 'left' ? (r.left ?? 99999) : (r.p[key] || '9999-12-31');
    rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.p.endDate || '').localeCompare(b.p.endDate || ''); });
    const grouped = key === 'startDate' || key === 'endDate';
    const th = (k, label) => `<th><button class="sort" data-sort="${k}" ${key === k ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${label}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    let body = '', lastGroup = null;
    for (const r of rows) {
      if (grouped) {
        const d = r.p[key];
        const g = d ? d.slice(0, 7) : 'none';
        if (g !== lastGroup) {
          lastGroup = g;
          body += `<tr class="group"><td colspan="7">${d ? monthLabel(d.slice(0, 7) + '-01') : (key === 'endDate' ? 'No due date' : 'No start date')}</td></tr>`;
        }
      }
      const left = r.p.status === 'completed' ? '<span class="mini">Done</span>'
        : r.left == null ? '<span class="mini">—</span>'
        : r.left < 0 ? `<span class="late-txt">${-r.left}d overdue</span>`
        : r.left === 0 ? '<span class="late-txt">Today</span>' : `${r.left}d`;
      body += `<tr>
        <td class="dates">${fmtDate(r.p.startDate)}</td>
        <td><button class="linkish" data-edit-project="${esc(r.p.id)}">${esc(r.p.name)}</button> ${r.p.example ? '<span class="example">Example</span>' : ''}</td>
        <td class="dates">${fmtDate(r.p.endDate)}</td>
        <td class="num">${left}</td>
        <td>${linkChips(r.p.links, 2)}</td>
        <td><button class="linkish" style="font-weight:400" data-goto="${esc(r.p.clientId)}">${esc(r.client)}</button></td>
        <td>${statusControl(r.p)}</td>
      </tr>`;
    }
    return `<div class="listview table-wrap"><table>
      <thead><tr>${th('startDate', 'Start')}${th('name', 'Project')}${th('endDate', 'Due')}${th('left', 'Days left')}<th>Links</th>${th('client', 'Client')}${th('status', 'Status')}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // ---------- sheets ----------
  function openSheet(html, focusId, wide) {
    $('sheet').innerHTML = html;
    $('sheet').classList.toggle('wide', !!wide);
    $('scrim').hidden = false;
    setTimeout(() => (focusId ? $(focusId) : $('sheet').querySelector('button, input'))?.focus(), 0);
  }
  function closeSheet() { $('scrim').hidden = true; $('sheet').innerHTML = ''; $('sheet').classList.remove('wide'); }

  // ---------- timeline report (exportable) ----------
  const RC = {
    ink: '#17211f', muted: '#5b6b67', line: '#d3dcd9', grid: '#e9eeec', band: '#f3f5f4', stripe: '#fafbfb', accent: '#0f6e6a',
    'pending': ['#fbefd6', '#a36a00'], 'in progress': ['#dde7fa', '#2457b8'], 'completed': ['#dcf0e2', '#23753f'],
    danger: '#b3261e', entry: '#7a3fa0',
  };
  const RF = `Helvetica Neue, Helvetica, Arial, sans-serif`;
  const trunc = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n - 1) + '…' : s;
  const shortDate = iso => fromISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function reportSVG() {
    const r = state.report;
    const W = 1600, pad = 40, labelW = 330, chartX = pad + labelW, chartW = W - chartX - pad;
    const winStart = r.start + '-01', winEnd = addDays(addMonths(winStart, r.months), -1);
    const days = dayDiff(winStart, winEnd) + 1, dw = chartW / days;
    const X = iso => chartX + dayDiff(winStart, iso) * dw;
    const today = todayISO();

    const projects = [...state.projects.values()].filter(p => {
      const s = spanOf(p);
      return s && s[0] <= winEnd && s[1] >= winStart && (r.completed || p.status !== 'completed');
    }).sort((a, b) => spanOf(a)[0].localeCompare(spanOf(b)[0]));

    let groups;
    if (r.group === 'client') {
      const m = new Map();
      for (const p of projects) { const k = clientName(p.clientId); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
      groups = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => ({ name, items }));
    } else if (r.group === 'status') {
      groups = STATUSES.map(s => ({ name: s.label, items: projects.filter(p => p.status === s.key) })).filter(g => g.items.length);
    } else groups = [{ name: null, items: projects }];

    const T = (x, y, txt, o = {}) => `<text x="${x}" y="${y}" font-family="${RF}" font-size="${o.size || 13}" font-weight="${o.weight || 400}" fill="${o.fill || RC.ink}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(txt)}</text>`;
    let out = '';

    // header
    const counts = { 'in progress': 0, pending: 0, completed: 0 };
    projects.forEach(p => counts[p.status] = (counts[p.status] || 0) + 1);
    const overdue = projects.filter(isOverdue).length;
    out += T(pad, pad + 30, 'Project timeline', { size: 30, weight: 700 });
    out += T(pad, pad + 58, `${monthLabel(winStart)} – ${monthLabel(winEnd)}  ·  Generated ${fmtDate(today)}`, { size: 15, fill: RC.muted });
    const stats = [[projects.length, 'projects'], [counts['in progress'], 'in progress'], [counts.pending, 'pending'], [counts.completed, 'completed'], [overdue, 'overdue']];
    let sx = pad;
    for (const [n, l] of stats) {
      const red = l === 'overdue' && n > 0;
      out += T(sx, pad + 100, String(n), { size: 24, weight: 700, fill: red ? RC.danger : RC.ink });
      out += T(sx, pad + 120, l, { size: 12, fill: red ? RC.danger : RC.muted });
      sx += 130;
    }

    // axis
    const axisY = pad + 150, rowsY = axisY + 44;
    out += `<rect x="${chartX}" y="${axisY}" width="${chartW}" height="40" fill="${RC.band}"/>`;
    const monthLines = [];
    for (let m = winStart; m <= winEnd; m = addMonths(m, 1)) {
      const mx = X(m);
      monthLines.push(mx);
      out += T(mx + 8, axisY + 17, monthLabel(m, { month: 'long', year: 'numeric' }), { size: 13, weight: 700 });
    }
    if (dw * 7 >= 22) {
      for (let i = 0; i < days; i++) {
        const iso = addDays(winStart, i);
        if (fromISO(iso).getDay() === 1) out += T(X(iso) + dw / 2, axisY + 34, String(fromISO(iso).getDate()), { size: 10, fill: RC.muted, anchor: 'middle' });
      }
    }

    // rows
    let y = rowsY, body = '', stripe = 0;
    const RH = 42, GH = 32;
    if (!projects.length) {
      body += T(chartX + chartW / 2, y + 50, r.completed ? 'No projects scheduled in this period.' : 'No open projects scheduled in this period.', { size: 16, fill: RC.muted, anchor: 'middle' });
      y += 90;
    }
    for (const g of groups) {
      if (g.name !== null) {
        body += `<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${GH}" fill="${RC.band}"/>`;
        body += T(pad + 12, y + 21, `${g.name}`, { size: 14, weight: 700 }) + T(W - pad - 12, y + 21, `${g.items.length} project${g.items.length > 1 ? 's' : ''}`, { size: 12, fill: RC.muted, anchor: 'end' });
        y += GH;
      }
      for (const p of g.items) {
        if (stripe++ % 2) body += `<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${RH}" fill="${RC.stripe}"/>`;
        const sub = r.group === 'client' ? statusLabel(p.status) : r.group === 'status' ? clientName(p.clientId) : `${clientName(p.clientId)} · ${statusLabel(p.status)}`;
        body += T(pad + 12, y + 18, trunc(p.name, 40), { size: 14, weight: 600 });
        body += T(pad + 12, y + 34, trunc(sub, 48), { size: 11.5, fill: RC.muted });
        const [s, e] = spanOf(p);
        const a = s < winStart ? winStart : s, b = e > winEnd ? winEnd : e;
        const bx = X(a), bw = Math.max(dw, (dayDiff(a, b) + 1) * dw);
        const [fill, stroke] = RC[p.status] || RC.pending;
        const late = isOverdue(p);
        body += `<rect x="${bx.toFixed(1)}" y="${y + 10}" width="${bw.toFixed(1)}" height="22" rx="4" fill="${fill}" stroke="${late ? RC.danger : stroke}" stroke-width="${late ? 2 : 1}"/>`;
        const label = `${p.startDate ? shortDate(p.startDate) : '?'} – ${p.endDate ? shortDate(p.endDate) : '?'}${late ? '  ·  overdue' : ''}`;
        if (bw > label.length * 6.4 + 16) body += T(bx + 8, y + 25, label, { size: 11.5, weight: 600, fill: late ? RC.danger : stroke });
        else body += T(bx + bw + 6, y + 25, label, { size: 11.5, fill: late ? RC.danger : RC.muted });
        if (r.entries) {
          for (const en of state.entries.values()) {
            if (en.projectId !== p.id || !en.date || en.date < winStart || en.date > winEnd) continue;
            const cx = X(en.date) + dw / 2, cy = y + 21;
            body += `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="${RC.entry}" stroke="#ffffff" stroke-width="2" transform="rotate(45 ${cx} ${cy})"><title>${esc(en.title)}</title></rect>`;
          }
        }
        y += RH;
      }
    }

    // gridlines + today, drawn under bars
    let grid = monthLines.map(mx => `<line x1="${mx.toFixed(1)}" y1="${axisY}" x2="${mx.toFixed(1)}" y2="${y}" stroke="${RC.line}" stroke-width="1"/>`).join('');
    if (today >= winStart && today <= winEnd) {
      const tx = (X(today) + dw / 2).toFixed(1);
      grid += `<line x1="${tx}" y1="${axisY - 6}" x2="${tx}" y2="${y}" stroke="${RC.danger}" stroke-width="1.5" stroke-dasharray="4 3"/>` + T(tx, axisY - 10, 'Today', { size: 11, weight: 700, fill: RC.danger, anchor: 'middle' });
    }
    out += grid + body;
    out += `<line x1="${chartX}" y1="${axisY}" x2="${chartX}" y2="${y}" stroke="${RC.line}"/>`;

    // legend
    y += 30;
    let lx = pad;
    const key = [['pending', 'Pending'], ['in progress', 'In progress'], ['completed', 'Completed']];
    for (const [k, l] of key) {
      out += `<rect x="${lx}" y="${y - 11}" width="22" height="14" rx="3" fill="${RC[k][0]}" stroke="${RC[k][1]}"/>` + T(lx + 30, y, l, { size: 12, fill: RC.muted });
      lx += 130;
    }
    out += `<rect x="${lx}" y="${y - 11}" width="22" height="14" rx="3" fill="#ffffff" stroke="${RC.danger}" stroke-width="2"/>` + T(lx + 30, y, 'Overdue', { size: 12, fill: RC.muted });
    lx += 120;
    if (r.entries) { out += `<rect x="${lx + 5}" y="${y - 10}" width="11" height="11" fill="${RC.entry}" transform="rotate(45 ${lx + 10.5} ${y - 4.5})"/>` + T(lx + 30, y, 'Calendar entry', { size: 12, fill: RC.muted }); }
    const H = Math.ceil(y + pad);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Project timeline, ${esc(monthLabel(winStart))} to ${esc(monthLabel(winEnd))}"><rect width="${W}" height="${H}" fill="#ffffff"/>${out}</svg>`;
    return { svg, W, H, name: `project-timeline-${r.start}${r.months > 1 ? '-' + addMonths(winStart, r.months - 1).slice(0, 7) : ''}` };
  }

  function reportSheet() {
    state.report ||= { start: todayISO().slice(0, 7), months: 3, group: 'client', completed: true, entries: true };
    const r = state.report;
    openSheet(`<h2 id="sheet-title">Timeline report</h2>
      <p class="hint" style="margin:0">An overview of every project across the months you choose, for company reviews. Download it as a PDF or image to share.</p>
      <form id="report-form" class="report-controls">
        <div class="field"><label for="r-start">Starting month</label><input id="r-start" name="start" type="month" value="${esc(r.start)}"></div>
        <div class="field"><label for="r-months">Length</label><select id="r-months" name="months">
          ${[1, 3, 6, 12].map(n => `<option value="${n}" ${n === r.months ? 'selected' : ''}>${n} month${n > 1 ? 's' : ''}</option>`).join('')}
        </select></div>
        <div class="field"><label for="r-group">Group by</label><select id="r-group" name="group">
          ${[['client', 'Client'], ['status', 'Status'], ['none', 'No grouping']].map(([v, l]) => `<option value="${v}" ${v === r.group ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <label class="check"><input id="r-completed" name="completed" type="checkbox" ${r.completed ? 'checked' : ''}> Include completed</label>
        <label class="check"><input id="r-entries" name="entries" type="checkbox" ${r.entries ? 'checked' : ''}> Show calendar entries</label>
      </form>
      <div class="report-preview" id="report-preview"></div>
      <div class="sheet-actions" style="align-items:center">
        <span class="hint" id="r-msg" style="margin-right:auto"></span>
        <button type="button" class="btn" data-action="close">Close</button>
        <button type="button" class="btn" data-action="export-png">Download PNG</button>
        <button type="button" class="btn primary" data-action="export-pdf">Download PDF</button>
      </div>`, 'r-start', true);
    $('report-form').addEventListener('submit', e => e.preventDefault());
    $('report-form').addEventListener('change', () => {
      const v = $('r-start').value;
      if (/^\d{4}-\d{2}$/.test(v)) r.start = v;
      r.months = Number($('r-months').value);
      r.group = $('r-group').value;
      r.completed = $('r-completed').checked;
      r.entries = $('r-entries').checked;
      $('report-preview').innerHTML = reportSVG().svg;
    });
    $('report-preview').innerHTML = reportSVG().svg;
  }

  function svgToPng(svg, W, H, scale = 2) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = W * scale; c.height = H * scale;
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, W, H);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve({ blob: b, canvas: c }) : reject(new Error('png')), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg')); };
      img.src = url;
    });
  }
  let jsPdfLoading = null;
  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    jsPdfLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = () => window.jspdf ? resolve(window.jspdf) : reject(new Error('jspdf'));
      s.onerror = () => { jsPdfLoading = null; reject(new Error('jspdf')); };
      document.head.appendChild(s);
    });
    return jsPdfLoading;
  }
  async function exportReport(kind) {
    const msg = $('r-msg');
    const say = t => { if (msg) msg.textContent = t; };
    say(kind === 'pdf' ? 'Preparing PDF…' : 'Preparing image…');
    try {
      const { svg, W, H, name } = reportSVG();
      const { blob, canvas } = await svgToPng(svg, W, H);
      let data = blob, filename = name + '.png';
      if (kind === 'pdf') {
        const { jsPDF } = await loadJsPdf();
        const w = W * 0.75, h = H * 0.75;
        const doc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'pt', format: [w, h] });
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
        data = doc.output('blob'); filename = name + '.pdf';
      }
      const status = await saveFile(filename, data);
      say(status === 'delivered' ? 'Sent.' : `Saved ${filename}`);
    } catch (e) {
      const code = e && e.code;
      say(code === 'declined' ? 'Download cancelled.'
        : code === 'rate_limited' ? 'A download is already waiting for your answer.'
        : code === 'unavailable' || code === 'not_granted' ? 'Downloads aren’t available in this view.'
        : e && e.message === 'jspdf' ? 'The PDF tool didn’t load. Check your connection, or download the PNG instead.'
        : 'The report couldn’t be created. Try again, or download the other format.');
    }
  }

  function dayPanel(iso) {
    const projects = [...state.projects.values()].filter(p => { const s = spanOf(p); return s && s[0] <= iso && iso <= s[1]; }).sort(byDue);
    const entries = [...state.entries.values()].filter(e => e.date === iso).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const role = p => p.startDate === iso && p.endDate === iso ? 'Starts and due' : p.startDate === iso ? 'Starts' : p.endDate === iso ? 'Due' : 'Running';
    openSheet(`<h2 id="sheet-title">${esc(fmtLong(iso))}</h2>
      <div style="display:grid;gap:10px">
        <div class="section-head"><h3>Entries</h3>${readOnly ? '' : `<button class="btn sm primary" data-action="new-entry" data-date="${iso}">+ New entry</button>`}</div>
        ${entries.length ? `<ul class="day-list">${entries.map(e => `<li class="day-item">
          <div class="top"><strong>${esc(e.title)}</strong>
            <span style="display:flex;gap:6px;align-items:center">${e.example ? '<span class="example">Example</span>' : ''}${readOnly ? '' : `<button class="btn ghost sm" data-edit-entry="${esc(e.id)}">Edit</button>`}</span></div>
          ${e.projectId && state.projects.has(e.projectId) ? `<span class="tag">For ${esc(state.projects.get(e.projectId).name)} · ${esc(clientName(state.projects.get(e.projectId).clientId))}</span>` : ''}
          ${e.notes ? `<p class="notes" style="padding:0;background:none">${esc(e.notes)}</p>` : ''}
          ${renderLinks(e.links)}
        </li>`).join('')}</ul>` : `<p class="hint" style="margin:0">No entries on this day. Add one to keep notes and links to websites or Drive files.</p>`}
      </div>
      <div style="display:grid;gap:10px">
        <h3>Projects on this day</h3>
        ${projects.length ? `<ul class="day-list">${projects.map(p => `<li class="day-item">
          <div class="top"><button class="linkish" data-edit-project="${esc(p.id)}">${esc(p.name)}</button><span class="pill ${statusClass(p.status)}">${statusLabel(p.status)}</span></div>
          <span class="tag">${role(p)} · ${esc(clientName(p.clientId))} · ${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}</span>
          ${renderLinks(p.links)}
        </li>`).join('')}</ul>` : `<p class="hint" style="margin:0">No projects running on this day.</p>`}
      </div>
      <div class="sheet-actions"><button type="button" class="btn" data-action="close">Close</button></div>`);
  }

  function contactForm(c) {
    const v = c || { name: '', email: '', phone: '', company: '', notes: '' };
    openSheet(`<h2 id="sheet-title">${c ? 'Edit client' : 'New client'}</h2>
      <form id="contact-form" novalidate style="display:grid;gap:16px">
        <div class="fields">
          <div class="field full"><label for="f-name">Name</label><input id="f-name" name="name" value="${esc(v.name)}" required autocomplete="off"></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" value="${esc(v.email)}" autocomplete="off"></div>
          <div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" type="tel" value="${esc(v.phone)}" autocomplete="off"></div>
          <div class="field full"><label for="f-company">Company</label><input id="f-company" name="company" value="${esc(v.company)}" autocomplete="off"></div>
          <div class="field full"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" placeholder="How you met, preferences, billing details…">${esc(v.notes || '')}</textarea></div>
          <div class="field full"><span class="err" id="f-err" hidden></span></div>
        </div>
        <div class="sheet-actions">
          <button type="button" class="btn" data-action="close">Cancel</button>
          <button type="submit" class="btn primary">${c ? 'Save changes' : 'Add client'}</button>
        </div>
      </form>`, 'f-name');
    $('contact-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const data = Object.fromEntries(['name', 'email', 'phone', 'company', 'notes'].map(k => [k, String(f.get(k) || '').trim()]));
      const err = $('f-err');
      if (!data.name) { err.textContent = 'Enter the client’s name.'; err.hidden = false; return; }
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { err.textContent = 'That email address doesn’t look complete, for example name@company.com.'; err.hidden = false; return; }
      const id = c ? c.id : newId();
      const body = { ...data, createdAt: c?.createdAt || new Date().toISOString() };
      if (c?.example) body.example = true;
      if (await save('contacts', id, body)) {
        closeSheet(); state.selectedId = id; state.view = 'clients'; render();
        toast(c ? 'Client updated' : 'Client added');
      }
    });
  }

  function projectForm(p, presetClient) {
    const contacts = sortedContacts();
    if (!contacts.length) { toast('Add a client first, then create projects for them.'); return; }
    const v = p || { name: '', clientId: presetClient || state.clientFilter || '', startDate: todayISO(), endDate: '', status: 'pending', links: [] };
    openSheet(`<h2 id="sheet-title">${p ? 'Edit project' : 'New project'}</h2>
      <form id="project-form" novalidate style="display:grid;gap:16px">
        <div class="fields">
          <div class="field full"><label for="p-name">Project name</label><input id="p-name" name="name" value="${esc(v.name)}" required autocomplete="off"></div>
          <div class="field full"><label for="p-client">Client</label><select id="p-client" name="clientId">
            <option value="">Choose a client</option>
            ${contacts.map(c => `<option value="${esc(c.id)}" ${c.id === v.clientId ? 'selected' : ''}>${esc(c.name)}${c.company ? ' — ' + esc(c.company) : ''}</option>`).join('')}
          </select></div>
          <div class="field"><label for="p-start">Start date</label><input id="p-start" name="startDate" type="date" value="${esc(v.startDate)}"></div>
          <div class="field"><label for="p-end">Due date</label><input id="p-end" name="endDate" type="date" value="${esc(v.endDate)}"></div>
          <div class="field full"><label for="p-status">Status</label><select id="p-status" name="status">
            ${STATUSES.map(s => `<option value="${s.key}" ${s.key === v.status ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select></div>
          ${linksEditor(v.links)}
          <div class="field full"><span class="err" id="p-err" hidden></span></div>
        </div>
        ${p ? '<div id="project-confirm"></div>' : ''}
        <div class="sheet-actions">
          ${p ? '<button type="button" class="btn danger" data-action="ask-delete-project" style="margin-right:auto">Delete</button>' : ''}
          <button type="button" class="btn" data-action="close">Cancel</button>
          <button type="submit" class="btn primary">${p ? 'Save changes' : 'Add project'}</button>
        </div>
      </form>`, 'p-name');
    const form = $('project-form');
    form.dataset.projectId = p ? p.id : '';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const data = Object.fromEntries(['name', 'clientId', 'startDate', 'endDate', 'status'].map(k => [k, String(f.get(k) || '').trim()]));
      const err = $('p-err');
      const fail = m => { err.textContent = m; err.hidden = false; };
      if (!data.name) return fail('Enter a project name.');
      if (!data.clientId) return fail('Choose which client this project is for.');
      if (data.startDate && data.endDate && data.endDate < data.startDate) return fail('The due date is before the start date. Pick a later due date.');
      const l = readLinks(form);
      if (l.error) return fail(l.error);
      const id = p ? p.id : newId();
      const body = { ...data, links: l.links, createdAt: p?.createdAt || new Date().toISOString() };
      if (p?.example) body.example = true;
      if (await save('projects', id, body)) { closeSheet(); render(); toast(p ? 'Project updated' : 'Project added'); }
    });
  }

  function entryForm(entry, presetDate) {
    const projects = [...state.projects.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const v = entry || { title: '', date: presetDate || todayISO(), projectId: '', notes: '', links: [] };
    openSheet(`<h2 id="sheet-title">${entry ? 'Edit entry' : 'New calendar entry'}</h2>
      <form id="entry-form" novalidate style="display:grid;gap:16px">
        <div class="fields">
          <div class="field full"><label for="e-title">Title</label><input id="e-title" name="title" value="${esc(v.title)}" placeholder="e.g. Site visit, photos from shoot" required autocomplete="off"></div>
          <div class="field"><label for="e-date">Date</label><input id="e-date" name="date" type="date" value="${esc(v.date)}"></div>
          <div class="field"><label for="e-project">Project (optional)</label><select id="e-project" name="projectId">
            <option value="">None</option>
            ${projects.map(p => `<option value="${esc(p.id)}" ${p.id === v.projectId ? 'selected' : ''}>${esc(p.name)} — ${esc(clientName(p.clientId))}</option>`).join('')}
          </select></div>
          <div class="field full"><label for="e-notes">Notes</label><textarea id="e-notes" name="notes">${esc(v.notes || '')}</textarea></div>
          ${linksEditor(v.links && v.links.length ? v.links : (entry ? [] : [{ label: '', url: '' }]))}
          <div class="field full"><span class="err" id="e-err" hidden></span></div>
        </div>
        ${entry ? '<div id="entry-confirm"></div>' : ''}
        <div class="sheet-actions">
          ${entry ? '<button type="button" class="btn danger" data-action="ask-delete-entry" style="margin-right:auto">Delete</button>' : ''}
          <button type="button" class="btn" data-action="close">Cancel</button>
          <button type="submit" class="btn primary">${entry ? 'Save changes' : 'Add entry'}</button>
        </div>
      </form>`, 'e-title');
    const form = $('entry-form');
    form.dataset.entryId = entry ? entry.id : '';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const data = Object.fromEntries(['title', 'date', 'projectId', 'notes'].map(k => [k, String(f.get(k) || '').trim()]));
      const err = $('e-err');
      const fail = m => { err.textContent = m; err.hidden = false; };
      if (!data.title) return fail('Give the entry a title.');
      if (!data.date) return fail('Pick a date for this entry.');
      const l = readLinks(form);
      if (l.error) return fail(l.error);
      const id = entry ? entry.id : newId();
      const body = { ...data, links: l.links, createdAt: entry?.createdAt || new Date().toISOString() };
      if (entry?.example) body.example = true;
      if (await save('entries', id, body)) {
        closeSheet();
        state.cal.cursor = state.cal.mode === 'month' ? monthStart(data.date) : state.cal.cursor;
        render(); toast(entry ? 'Entry updated' : 'Entry added');
      }
    });
  }

  // ---------- events ----------
  function setView(v) { state.view = v; store.set('cpm.view', v); render(); }
  $('tab-clients').addEventListener('click', () => setView('clients'));
  $('tab-projects').addEventListener('click', () => setView('projects'));
  $('tab-calendar').addEventListener('click', () => setView('calendar'));
  $('search').addEventListener('input', e => { state.search = e.target.value; renderList(sortedContacts()); });
  $('filter-client').addEventListener('change', e => { state.clientFilter = e.target.value; renderBoard(sortedContacts()); });
  $('add-contact').addEventListener('click', () => contactForm(null));
  $('add-project-board').addEventListener('click', () => projectForm(null));
  $('add-entry').addEventListener('click', () => entryForm(null, state.cal.mode === 'month' && state.cal.cursor !== monthStart(todayISO()) ? state.cal.cursor : todayISO()));
  $('open-report').addEventListener('click', reportSheet);
  $('scrim').addEventListener('click', e => { if (e.target === $('scrim')) closeSheet(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const menu = document.querySelector('.link-menu[open]');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); return; }
    if (!$('scrim').hidden) closeSheet();
  });
  // One link dropdown open at a time; clicking elsewhere closes it.
  document.addEventListener('toggle', e => {
    const menu = e.target;
    if (!menu.classList || !menu.classList.contains('link-menu')) return;
    if (menu.open) {
      openLinkMenu = menu.dataset.menu;
      document.querySelectorAll('.link-menu[open]').forEach(m => { if (m !== menu) m.open = false; });
    } else if (openLinkMenu === menu.dataset.menu) {
      openLinkMenu = null;
    }
  }, true);
  document.addEventListener('click', e => {
    const menu = document.querySelector('.link-menu[open]');
    if (menu && !menu.contains(e.target)) menu.open = false;
  });

  document.addEventListener('change', async e => {
    const id = e.target.dataset?.status;
    if (!id) return;
    const p = state.projects.get(id);
    if (!p) return;
    const next = e.target.value;
    if (await save('projects', id, { ...stripId(p), status: next })) toast(`Moved to ${statusLabel(next)}`);
    else render();
  });

  document.addEventListener('click', async e => {
    const team = e.target.closest('[data-remove-member],[data-cancel-invite]');
    if (team) { teamAction(team); return; }
    const t = e.target.closest('[data-select],[data-action],[data-edit-project],[data-edit-entry],[data-goto],[data-copy],[data-calmode],[data-calnav],[data-day],[data-sort]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.select) { state.selectedId = ds.select; render(); return; }
    if (ds.goto) { if (state.contacts.has(ds.goto)) { closeSheet(); state.selectedId = ds.goto; setView('clients'); } return; }
    if (ds.editProject) { const p = state.projects.get(ds.editProject); if (p && !readOnly) projectForm(p); return; }
    if (ds.editEntry) { const en = state.entries.get(ds.editEntry); if (en) { readOnly ? dayPanel(en.date) : entryForm(en); } return; }
    if (ds.calmode) { state.cal.mode = ds.calmode; store.set('cpm.calmode', ds.calmode); renderCalendar(); return; }
    if (ds.calnav) {
      const n = Number(ds.calnav);
      state.cal.cursor = n === 0 ? monthStart(todayISO()) : addMonths(state.cal.cursor, n);
      renderCalendar();
      return;
    }
    if (ds.day) { dayPanel(ds.day); return; }
    if (ds.sort) {
      const s = state.cal.sort;
      state.cal.sort = s.key === ds.sort ? { key: s.key, dir: -s.dir } : { key: ds.sort, dir: 1 };
      renderCalendar(); return;
    }
    if (ds.copy) {
      const val = ds.copy;
      try { await navigator.clipboard.writeText(val); toast('Copied'); }
      catch { const r = document.createRange(); r.selectNodeContents(t.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected. Press Ctrl+C or ⌘C to copy.'); }
      return;
    }
    const c = state.contacts.get(state.selectedId);
    switch (ds.action) {
      case 'close': closeSheet(); break;
      case 'new-contact': contactForm(null); break;
      case 'edit-contact': if (c) contactForm(c); break;
      case 'new-project-for': if (c) projectForm(null, c.id); break;
      case 'new-entry': entryForm(null, ds.date); break;
      case 'load-examples': loadExamples(); break;
      case 'sign-in':
        t.disabled = true;
        state.cloud.api.signIn().catch(ex => { t.disabled = false; toast(`Sign-in didn’t start: ${ex.message}`); });
        break;
      case 'sign-out': signOut(); break;
      case 'reload': location.reload(); break;
      case 'new-workspace': closeSheet(); $('account').hidden = true; gate('create'); break;
      case 'leave-workspace': leaveWorkspace(t); break;
      case 'back-to-workspace': openWorkspace(state.cloud.workspace); break;
      case 'import-local': importLocal(); break;
      case 'import-skip': store.set('cpm.imported.' + state.cloud.workspace.id, '1'); $('import-note').hidden = true; break;
      case 'export-png': exportReport('png'); break;
      case 'export-pdf': exportReport('pdf'); break;
      case 'add-link': { const rows = $('link-rows'); rows.insertAdjacentHTML('beforeend', linkRow()); rows.lastElementChild.querySelector('input').focus(); break; }
      case 'remove-link': t.closest('.link-row')?.remove(); break;
      case 'ask-delete-contact': {
        if (!c) break;
        const n = projectsFor(c.id).length;
        $('contact-confirm').innerHTML = `<div class="confirm"><span>Delete ${esc(c.name)}${n ? ` and their ${n} project${n > 1 ? 's' : ''}` : ''}? This can’t be undone.</span>
          <button class="btn sm" data-action="cancel-delete-contact">Keep</button>
          <button class="btn sm danger solid" data-action="delete-contact">Delete</button></div>`;
        break;
      }
      case 'cancel-delete-contact': $('contact-confirm').innerHTML = ''; break;
      case 'delete-contact': {
        if (!c) break;
        for (const p of projectsFor(c.id)) { if (!(await remove('projects', p.id))) return; }
        if (await remove('contacts', c.id)) { state.selectedId = null; render(); toast(`Deleted ${c.name}`); }
        break;
      }
      case 'ask-delete-project':
        $('project-confirm').innerHTML = `<div class="confirm"><span>Delete this project? Calendar entries for it are kept. This can’t be undone.</span>
          <button type="button" class="btn sm" data-action="cancel-delete-project">Keep</button>
          <button type="button" class="btn sm danger solid" data-action="delete-project">Delete</button></div>`;
        break;
      case 'cancel-delete-project': $('project-confirm').innerHTML = ''; break;
      case 'delete-project': {
        const id = $('project-form')?.dataset.projectId;
        if (id && await remove('projects', id)) { closeSheet(); render(); toast('Project deleted'); }
        break;
      }
      case 'ask-delete-entry':
        $('entry-confirm').innerHTML = `<div class="confirm"><span>Delete this entry and its links? This can’t be undone.</span>
          <button type="button" class="btn sm" data-action="cancel-delete-entry">Keep</button>
          <button type="button" class="btn sm danger solid" data-action="delete-entry">Delete</button></div>`;
        break;
      case 'cancel-delete-entry': $('entry-confirm').innerHTML = ''; break;
      case 'delete-entry': {
        const id = $('entry-form')?.dataset.entryId;
        if (id && await remove('entries', id)) { closeSheet(); render(); toast('Entry deleted'); }
        break;
      }
    }
  });

  function stripId(o) { const { id, ...rest } = o; return rest; }

  // ---------- files ----------
  // On claude.ai the page must hand files to the `downloads` capability; on its own it uses a normal browser download.
  async function saveFile(filename, data) {
    let dl = null;
    try { dl = window.claude ? await window.claude.use('downloads') : null; } catch { dl = null; }
    if (dl) return (await dl.save({ filename, data })).status;
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'saved';
  }

  // ---------- backup ----------
  const COLLECTIONS = ['contacts', 'projects', 'entries'];
  async function downloadBackup() {
    const backup = { app: 'client-project-manager', version: 1, exportedAt: new Date().toISOString() };
    for (const col of COLLECTIONS) backup[col] = [...state[col].values()];
    const filename = `client-project-manager-backup-${todayISO()}.json`;
    try {
      await saveFile(filename, new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      toast(`Saved ${filename}`);
    } catch (e) {
      toast(e && e.code === 'declined' ? 'Backup cancelled.' : 'The backup couldn’t be saved. Try again.');
    }
  }
  async function restoreBackup(file) {
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { backup = null; }
    if (!backup || backup.app !== 'client-project-manager' || !COLLECTIONS.every(c => Array.isArray(backup[c]))) {
      toast('That file isn’t a Client & Project Manager backup.');
      return;
    }
    let n = 0;
    for (const col of COLLECTIONS) {
      for (const doc of backup[col]) {
        if (!doc || typeof doc.id !== 'string' || !doc.id) continue;
        if (!(await save(col, doc.id, stripId(doc)))) return;
        n++;
      }
    }
    toast(`Restored ${n} record${n === 1 ? '' : 's'} from the backup`);
  }

  // ---------- example data ----------
  async function loadExamples() {
    const t = todayISO(), d = n => addDays(t, n), now = new Date().toISOString();
    const ex = { example: true, createdAt: now };
    const records = {
      contacts: {
        'ex-c1': { name: 'Maya Okafor', email: 'maya@example.com', phone: '555-0142', company: 'Harbor Street Bakery', notes: 'Example client. Prefers email.' },
        'ex-c2': { name: 'Daniel Reyes', email: 'dan@example.com', phone: '555-0177', company: 'Reyes Landscaping', notes: '' },
        'ex-c3': { name: 'Priya Natarajan', email: 'priya@example.com', phone: '555-0190', company: 'Northgate Dental', notes: '' },
      },
      projects: {
        'ex-p1': { name: 'Website refresh', clientId: 'ex-c1', startDate: d(-26), endDate: d(19), status: 'in progress', links: [{ label: 'Current website', url: 'https://example.com/' }] },
        'ex-p2': { name: 'Holiday menu flyers', clientId: 'ex-c1', startDate: d(9), endDate: d(35), status: 'pending', links: [] },
        'ex-p3': { name: 'Logo redesign', clientId: 'ex-c2', startDate: d(-40), endDate: d(-5), status: 'in progress', links: [] },
        'ex-p4': { name: 'Online booking setup', clientId: 'ex-c3', startDate: d(-6), endDate: d(5), status: 'in progress', links: [] },
        'ex-p5': { name: 'Business cards', clientId: 'ex-c2', startDate: d(-52), endDate: d(-36), status: 'completed', links: [] },
      },
      entries: {
        'ex-e1': { title: 'Homepage review with Maya', date: d(3), projectId: 'ex-p1', notes: 'Walk through the new homepage layout.', links: [{ label: 'Homepage draft', url: 'https://example.com/draft' }] },
        'ex-e2': { title: 'Site visit: Northgate Dental', date: d(2), projectId: 'ex-p4', notes: '', links: [] },
      },
    };
    for (const col of COLLECTIONS) {
      for (const [id, body] of Object.entries(records[col])) {
        if (!(await save(col, id, { ...body, ...ex }))) return;
      }
    }
    state.selectedId = 'ex-c1';
    render();
    toast('Example data added. Delete it whenever you like.');
  }

  $('backup-download').addEventListener('click', downloadBackup);
  $('backup-restore').addEventListener('click', () => $('backup-file').click());
  $('backup-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) restoreBackup(f);
  });

  // ---------- accounts and sync ----------
  // Used when js/config.js points at a Supabase project.
  function gate(mode, message) {
    const el = $('gate');
    const showApp = !mode;
    el.hidden = showApp;
    for (const id of ['summary', 'view-clients', 'view-projects', 'view-calendar', 'foot', 'main-tabs']) $(id).hidden = !showApp;
    if (showApp) { el.innerHTML = ''; render(); return; }
    const user = state.cloud && state.cloud.user;
    const who = user ? `<p class="hint">Signed in as <strong>${esc(user.email)}</strong>. <button class="copy" data-action="sign-out">Sign out</button></p>` : '';
    if (mode === 'loading') {
      el.innerHTML = `<div class="gate-card"><p class="hint">${esc(message || 'Connecting…')}</p></div>`;
    } else if (mode === 'signin') {
      el.innerHTML = `<div class="gate-card">
        <h2>Sign in to your workspace</h2>
        ${message ? `<p class="gate-error" role="alert">Sign-in didn\u2019t finish: ${esc(message)}. Try again, and if it keeps happening, see Troubleshooting in docs/supabase-setup.md.</p>` : ''}
        <p>Your team's clients, projects and calendar, kept in sync on every device.</p>
        <button class="btn primary" data-action="sign-in">Sign in with Google</button>
        <p class="hint">Joining a teammate's workspace? Sign in with the Google account for the email address they invited.</p>
      </div>`;
    } else if (mode === 'create') {
      el.innerHTML = `<div class="gate-card">
        <h2>Create your workspace</h2>
        <p>A workspace holds your company's clients, projects and calendar. You can invite your team once it's set up.</p>
        <form id="ws-form" class="field" novalidate>
          <label for="ws-name">Workspace name</label>
          <input id="ws-name" name="name" placeholder="e.g. your company name" autocomplete="organization" maxlength="100" required>
          <span class="err" id="ws-err" hidden></span>
          <button class="btn primary" type="submit" style="justify-self:start;margin-top:8px">Create workspace</button>
        </form>
        <p class="hint">Expecting an invite? Ask your teammate to invite <strong>${esc(user ? user.email : 'your email address')}</strong>, then reload this page.</p>
        ${state.cloud && state.cloud.workspace ? `<button class="btn" data-action="back-to-workspace" style="justify-self:start">Back to ${esc(state.cloud.workspace.name)}</button>` : ''}
        ${who}
      </div>`;
      $('ws-form').addEventListener('submit', async e => {
        e.preventDefault();
        const name = $('ws-name').value.trim();
        const err = $('ws-err');
        if (!name) { err.textContent = 'Enter a name for the workspace.'; err.hidden = false; return; }
        e.target.querySelector('button').disabled = true;
        try {
          const id = await state.cloud.api.createWorkspace(name);
          const ws = { id, name, role: 'owner' };
          state.cloud.workspaces.push(ws);
          openWorkspace(ws);
          toast(`Created ${name}`);
        } catch (ex) {
          err.textContent = `The workspace couldn’t be created: ${ex.message}`; err.hidden = false;
          e.target.querySelector('button').disabled = false;
        }
      });
      setTimeout(() => $('ws-name')?.focus(), 0);
    } else {
      el.innerHTML = `<div class="gate-card">
        <h2>Can’t reach your workspace</h2>
        <p>${esc(message || 'Something went wrong.')}</p>
        <button class="btn primary" data-action="reload">Reload</button>
        ${who}
      </div>`;
    }
  }

  // Supabase reports a failed sign-in by sending the browser back with
  // error and error_description in the address.
  function readSignInError() {
    for (const part of [location.hash.slice(1), location.search.slice(1)]) {
      const params = new URLSearchParams(part);
      const message = params.get('error_description') || params.get('error');
      if (message) return message;
    }
    return '';
  }

  async function startCloud(api, signInError) {
    state.cloud = { api, user: null, workspace: null, workspaces: [] };
    gate('loading');
    api.onSignedOut(() => location.reload());
    try {
      state.cloud.user = await api.user();
      if (signInError) history.replaceState(null, '', location.pathname);
      if (!state.cloud.user) return gate('signin', signInError);
      state.cloud.workspaces = await api.workspaces();
    } catch (e) {
      return gate('error', e.message);
    }
    if (!state.cloud.workspaces.length) return gate('create');
    const saved = store.get('cpm.workspace');
    openWorkspace(state.cloud.workspaces.find(w => w.id === saved) || state.cloud.workspaces[0]);
  }

  function openWorkspace(ws) {
    if (db && db.close) db.close();
    state.cloud.workspace = ws;
    store.set('cpm.workspace', ws.id);
    for (const col of COLLECTIONS) { state[col].clear(); state.loaded[col] = false; }
    state.selectedId = null;
    readOnly = false;
    db = state.cloud.api.store(ws.id);
    $('account').hidden = false;
    $('account-name').textContent = ws.name;
    $('storage-note').textContent = `Saved to ${ws.name} and shared with everyone in the workspace.`;
    gate(null);
    COLLECTIONS.forEach(listen);
    offerLocalImport(ws);
  }

  // Data saved in this browser before signing in can be copied into the workspace once.
  function offerLocalImport(ws) {
    const local = window.CPMLocalStore && window.CPMLocalStore.peek();
    const flag = 'cpm.imported.' + ws.id;
    const note = $('import-note');
    const n = local ? COLLECTIONS.reduce((sum, c) => sum + Object.keys(local[c] || {}).length, 0) : 0;
    if (!n || store.get(flag)) { note.hidden = true; return; }
    note.hidden = false;
    note.innerHTML = `<span>This browser has ${n} record${n === 1 ? '' : 's'} saved from before you signed in. Copy ${n === 1 ? 'it' : 'them'} into ${esc(ws.name)}?</span>
      <span class="actions"><button class="btn sm" data-action="import-skip">Not now</button><button class="btn sm primary" data-action="import-local">Copy into workspace</button></span>`;
  }
  async function importLocal() {
    const ws = state.cloud.workspace;
    const local = window.CPMLocalStore.peek() || {};
    $('import-note').hidden = true;
    let n = 0;
    for (const col of COLLECTIONS) {
      for (const [id, data] of Object.entries(local[col] || {})) {
        if (!(await save(col, id, data))) { $('import-note').hidden = false; return; }
        n++;
      }
    }
    store.set('cpm.imported.' + ws.id, '1');
    toast(`Copied ${n} record${n === 1 ? '' : 's'} into ${ws.name}`);
  }

  async function teamSheet() {
    const { api, user, workspace: ws, workspaces } = state.cloud;
    const owner = ws.role === 'owner';
    openSheet(`<h2 id="sheet-title">${esc(ws.name)}</h2>
      <p class="hint" style="margin:0">Signed in as <strong>${esc(user.email)}</strong>${owner ? ' · Owner' : ''}</p>
      ${workspaces.length > 1 ? `<div class="field"><label for="ws-switch">Switch workspace</label><select id="ws-switch">
        ${workspaces.map(w => `<option value="${esc(w.id)}" ${w.id === ws.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>` : ''}
      <div style="display:grid;gap:10px">
        <h3>Team</h3>
        <ul class="day-list" id="team-members"><li class="hint">Loading the team…</li></ul>
      </div>
      ${owner ? `<form id="invite-form" class="field" novalidate>
        <label for="invite-email">Invite a teammate</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="invite-email" type="email" placeholder="name@company.com" autocomplete="off" style="flex:1 1 220px">
          <button class="btn primary" type="submit">Send invite</button>
        </div>
        <span class="hint">They join when they sign in with Google using this address. No email is sent, so let them know.</span>
        <span class="err" id="invite-err" hidden></span>
      </form>
      <div style="display:grid;gap:10px" id="invites-wrap" hidden><h3>Waiting to join</h3><ul class="day-list" id="team-invites"></ul></div>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn ghost" data-action="new-workspace" style="margin-right:auto">New workspace</button>
        ${owner ? '' : '<button type="button" class="btn danger" data-action="leave-workspace">Leave workspace</button>'}
        <button type="button" class="btn" data-action="sign-out">Sign out</button>
        <button type="button" class="btn primary" data-action="close">Done</button>
      </div>`, null);
    $('ws-switch')?.addEventListener('change', e => {
      const next = workspaces.find(w => w.id === e.target.value);
      if (next) { closeSheet(); openWorkspace(next); toast(`Switched to ${next.name}`); }
    });
    $('invite-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('invite-email').value.trim().toLowerCase();
      const err = $('invite-err');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter their full email address, for example name@company.com.'; err.hidden = false; return; }
      try { await api.invite(ws.id, email); }
      catch (ex) { err.textContent = `The invite couldn’t be saved: ${ex.message}`; err.hidden = false; return; }
      err.hidden = true; $('invite-email').value = '';
      toast(`Invited ${email}`);
      loadTeam();
    });
    loadTeam();
  }

  async function loadTeam() {
    const { api, user, workspace: ws } = state.cloud;
    const owner = ws.role === 'owner';
    const list = $('team-members');
    if (!list) return;
    try {
      const [members, invites] = await Promise.all([api.members(ws.id), owner ? api.invites(ws.id) : Promise.resolve([])]);
      members.sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.email.localeCompare(b.email));
      list.innerHTML = members.map(m => `<li class="day-item"><div class="top">
        <span><strong>${esc(m.name || m.email)}</strong>${m.user_id === user.id ? ' <span class="mini">(you)</span>' : ''}${m.name ? `<br><span class="tag">${esc(m.email)}</span>` : ''}</span>
        <span class="actions" style="align-items:center"><span class="pill ${m.role === 'owner' ? 'in-progress' : 'pending'}">${m.role === 'owner' ? 'Owner' : 'Member'}</span>
        ${owner && m.role !== 'owner' ? `<button class="btn ghost sm" data-remove-member="${esc(m.user_id)}">Remove</button>` : ''}</span>
      </div></li>`).join('');
      if (owner) {
        $('invites-wrap').hidden = !invites.length;
        $('team-invites').innerHTML = invites.map(i => `<li class="day-item"><div class="top">
          <span>${esc(i.email)}</span><button class="btn ghost sm" data-cancel-invite="${esc(i.email)}">Cancel invite</button></div></li>`).join('');
      }
    } catch (e) {
      list.innerHTML = `<li class="err">The team couldn’t be loaded: ${esc(e.message)}</li>`;
    }
  }

  async function teamAction(t) {
    const { api, workspace: ws } = state.cloud;
    const ds = t.dataset;
    try {
      if (ds.removeMember) {
        if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Confirm remove'; t.classList.add('danger'); return; }
        await api.removeMember(ws.id, ds.removeMember);
        toast('Removed from the workspace');
      } else if (ds.cancelInvite) {
        await api.cancelInvite(ws.id, ds.cancelInvite);
        toast('Invite cancelled');
      }
    } catch (e) {
      toast(`That didn’t work: ${e.message}`);
    }
    loadTeam();
  }

  async function leaveWorkspace(t) {
    const { api, user, workspace: ws } = state.cloud;
    if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = `Confirm leaving ${ws.name}`; return; }
    try { await api.removeMember(ws.id, user.id); }
    catch (e) { toast(`That didn’t work: ${e.message}`); return; }
    store.set('cpm.workspace', '');
    location.reload();
  }

  async function signOut() {
    try { await state.cloud.api.signOut(); } catch {}
    store.set('cpm.workspace', '');
    location.reload();
  }

  $('account').addEventListener('click', teamSheet);

  // ---------- boot ----------
  const savedView = store.get('cpm.view');
  if (['clients', 'projects', 'calendar'].includes(savedView)) state.view = savedView;
  const savedMode = store.get('cpm.calmode');
  if (['month', 'list'].includes(savedMode)) state.cal.mode = savedMode;
  render();
  (async () => {
    try { db = window.claude ? await window.claude.use('db') : null; } catch { db = null; }
    if (db) {
      $('storage-note').textContent = 'Your data is saved with this page on claude.ai, so it follows you across devices.';
    } else {
      let cloud = null;
      const signInError = readSignInError();
      try { cloud = window.CPMCloud ? await window.CPMCloud.connect(window.CPM_CONFIG) : null; }
      catch (e) { gate('error', e.message); return; }
      if (cloud) { startCloud(cloud, signInError); return; }
      db = window.CPMLocalStore ? window.CPMLocalStore.open() : null;
    }
    if (!db) { $('offline').hidden = false; $('storage-note').textContent = 'Use Download backup before closing the page to keep your changes.'; state.loaded = { contacts: true, projects: true, entries: true }; render(); return; }
    listen('contacts');
    listen('projects');
    listen('entries');
  })();
})();
