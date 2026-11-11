import * as db from './db.js';
import {
  formatRange, formatPoint, formatShort, sortKey, todayPoint, toIso, fromIso,
  MJESECI, formatTimestamp,
} from './dates.js';
import {
  exhibitCode, stampDoc, stampedFileName, isImage, isPdf, stickerCanvas,
} from './stamp.js';

/* =========================================================
   Konstante
   ========================================================= */

const DEFAULT_SETTINGS = {
  id: 'settings',
  caseName: '',
  stickerTitle: 'Prilog predlagatelja',
  prefix: 'P',
  stickerPosition: 'gore-lijevo',
};

const DEFAULT_LABELS = [
  ['Omalovažavanje / sukob', 270],
  ['Problemi pri primopredaji', 0],
  ['Zabrinutost – dijete', 20],
  ['Zabrinutost – roditelj', 210],
  ['Mentalno zdravlje', 150],
  ['Značajni događaji', 50],
  ['Uključenost roditelja', 30],
  ['Pravo prvenstva čuvanja', 320],
  ['Uzdržavanje', 190],
  ['Zdravlje i škola', 100],
];

export const VISIT_STATUS = {
  'odrzano': { label: 'Održano', cls: 'st-ok', held: true },
  'djelomicno': { label: 'Održano djelomično / skraćeno', cls: 'st-warn', held: true },
  'kasnjenje': { label: 'Održano uz kašnjenje', cls: 'st-warn', held: true },
  'nije-predano': { label: 'Dijete nije predano', cls: 'st-bad', held: false },
  'nije-dosao': { label: 'Roditelj nije došao', cls: 'st-bad', held: false },
  'otkazano': { label: 'Otkazano', cls: 'st-bad', held: false },
};

const POSITIONS = {
  'gore-lijevo': 'Gore lijevo',
  'gore-desno': 'Gore desno',
  'dolje-desno': 'Dolje desno',
  'dolje-lijevo': 'Dolje lijevo',
};

/* =========================================================
   Stanje
   ========================================================= */

const state = {
  tab: 'timeline',
  settings: { ...DEFAULT_SETTINGS },
  labels: [],
  events: [],
  docs: [],
  filter: { q: '', labels: new Set(), kind: 'sve', open: false },
  docsGrouped: true,
  expanded: new Set(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* =========================================================
   Podaci
   ========================================================= */

async function load() {
  const [kv, labels, events, docs] = await Promise.all([
    db.getAll('kv'), db.getAll('labels'), db.getAll('events'), db.getAll('docs'),
  ]);
  const s = kv.find((x) => x.id === 'settings');
  state.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  if (!s) {
    await db.put('kv', state.settings);
    for (const [i, [name, hue]] of DEFAULT_LABELS.entries()) {
      await db.put('labels', { id: db.uid(), name, hue, order: i });
    }
    state.labels = await db.getAll('labels');
  } else {
    state.labels = labels;
  }
  state.labels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'hr'));
  state.events = events;
  state.docs = docs;
  sortEvents();
}

function sortEvents() {
  state.events.sort((a, b) => sortKey(a.start).localeCompare(sortKey(b.start)) || a.createdAt - b.createdAt);
}

const labelById = (id) => state.labels.find((l) => l.id === id);
const docById = (id) => state.docs.find((d) => d.id === id);

function eventsForDoc(docId) {
  return state.events.filter((e) => (e.docs || []).some((r) => r.docId === docId));
}

function nextExhibitNo() {
  return state.docs.reduce((m, d) => Math.max(m, d.exhibitNo || 0), 0) + 1;
}

async function addFiles(files) {
  const created = [];
  for (const f of files) {
    const doc = {
      id: db.uid(),
      name: f.name || 'dokument',
      type: f.type || '',
      size: f.size,
      blob: f,
      exhibitNo: nextExhibitNo(),
      createdAt: Date.now(),
    };
    await db.put('docs', doc);
    state.docs.push(doc);
    created.push(doc);
  }
  return created;
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.put('kv', state.settings);
  renderHeader();
}

/* =========================================================
   Iscrtavanje – zajedničko
   ========================================================= */

function chip(label) {
  if (!label) return '';
  return `<span class="chip" style="--h:${label.hue}">${esc(label.name)}</span>`;
}

function statusChip(code) {
  const s = VISIT_STATUS[code];
  if (!s) return '';
  return `<span class="status ${s.cls}">${esc(s.label)}</span>`;
}

function fileIcon(doc) {
  if (isPdf(doc)) return '📕';
  if (isImage(doc)) return '🖼️';
  if ((doc.type || '').startsWith('audio/')) return '🎧';
  if ((doc.type || '').startsWith('video/')) return '🎬';
  return '📄';
}

function exhBadge(doc) {
  return `<span class="exh">${esc(exhibitCode(state.settings, doc.exhibitNo))}</span>`;
}

function renderHeader() {
  $('#caseName').textContent = state.settings.caseName || 'Viđanja djeteta i događaji';
}

function render() {
  renderHeader();
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const view = $('#view');
  if (state.tab === 'timeline') view.innerHTML = renderTimeline();
  else if (state.tab === 'docs') view.innerHTML = renderDocs();
  else view.innerHTML = renderVisits();
}

/* =========================================================
   Vremenska crta
   ========================================================= */

function filteredEvents() {
  const f = state.filter;
  const q = f.q.trim().toLocaleLowerCase('hr');
  return state.events.filter((e) => {
    if (f.kind === 'dogadaj' && e.kind === 'vidjanje') return false;
    if (f.kind === 'vidjanje' && e.kind !== 'vidjanje') return false;
    if (f.labels.size && !(e.labels || []).some((id) => f.labels.has(id))) return false;
    if (q) {
      const docNames = (e.docs || []).map((r) => docById(r.docId)?.name || '').join(' ');
      const hay = `${e.title} ${e.notes || ''} ${docNames}`.toLocaleLowerCase('hr');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderEventCard(e) {
  const isVisit = e.kind === 'vidjanje';
  const st = VISIT_STATUS[e.visitStatus];
  const labels = (e.labels || []).map(labelById).filter(Boolean);
  const notes = e.notes || '';
  const long = notes.length > 180 || notes.split('\n').length > 3;
  const expanded = state.expanded.has(e.id);
  const docs = (e.docs || []).map((r) => ({ r, d: docById(r.docId) })).filter((x) => x.d);
  return `
  <article class="card event ${isVisit ? 'visit' : ''} ${isVisit && st && !st.held ? 'bad' : ''}" data-id="${e.id}">
    <div class="event-date">${esc(formatRange(e.start, e.end))}</div>
    <button class="icon-btn event-menu" data-action="event-menu" data-id="${e.id}" aria-label="Mogućnosti">⋮</button>
    <div class="event-title">${esc(e.title)}</div>
    ${isVisit || labels.length ? `<div class="chips">${isVisit ? statusChip(e.visitStatus) : ''}${labels.map(chip).join('')}</div>` : ''}
    ${notes ? `<div class="event-notes ${long && !expanded ? 'clamp' : ''}">${esc(notes)}</div>
      ${long ? `<button class="link small" data-action="toggle-notes" data-id="${e.id}">${expanded ? 'Prikaži manje' : 'Prikaži više'}</button>` : ''}` : ''}
    ${docs.map(({ r, d }) => `
      <button class="doc-ref" data-action="open-doc" data-id="${d.id}">
        <span class="ficon">${fileIcon(d)}</span>${exhBadge(d)}
        <span class="name">${esc(d.name)}</span>
        ${r.page ? `<span class="muted small">str. ${esc(r.page)}</span>` : ''}
      </button>`).join('')}
  </article>`;
}

function renderTimeline() {
  if (!state.events.length) {
    return `<div class="empty">
      <div class="big">🗂️</div>
      <h2>Još nema zabilježenih događaja</h2>
      <p>Zabilježite viđanje djeteta ili događaj i priložite snimku zaslona poruke, fotografiju ili PDF.
      Svaki dokument automatski dobiva oznaku dokaza (npr. ${esc(exhibitCode(state.settings, 1))}).</p>
      <p><button class="btn primary" data-action="new-event-with-doc">📎 Događaj s dokumentom</button></p>
      <p><button class="btn" data-action="new-visit">👧 Zabilježi viđanje</button></p>
      <p class="small">Podaci se spremaju samo na ovom uređaju. Redovito izradite sigurnosnu kopiju (Postavke).</p>
    </div>`;
  }
  const f = state.filter;
  const list = filteredEvents();
  const activeFilters = f.labels.size + (f.kind !== 'sve' ? 1 : 0);
  let html = `
  <div class="toolbar">
    <input class="input grow" type="search" placeholder="Pretraži događaje…" value="${esc(f.q)}" data-input="search" aria-label="Pretraži">
    <button class="btn ${activeFilters ? 'badge-on' : ''}" data-action="toggle-filters">Filtar${activeFilters ? ` (${activeFilters})` : ''}</button>
    <button class="btn" data-action="print-timeline" title="Ispis ili PDF">🖨️</button>
  </div>`;
  if (f.open) {
    html += `<div class="card filters">
      <div class="seg" style="grid-template-columns:repeat(3,1fr)">
        ${[['sve', 'Sve'], ['dogadaj', 'Događaji'], ['vidjanje', 'Viđanja']].map(([k, t]) =>
          `<button class="${f.kind === k ? 'on' : ''}" data-action="filter-kind" data-kind="${k}">${t}</button>`).join('')}
      </div>
      <div class="row chips">
        ${state.labels.map((l) => `<span class="chip chip-toggle ${f.labels.has(l.id) ? 'on' : ''}" style="--h:${l.hue}" role="button" tabindex="0" data-action="filter-label" data-id="${l.id}">${esc(l.name)}</span>`).join('')}
      </div>
      ${activeFilters ? '<div class="row"><button class="link" data-action="clear-filters">Poništi filtar</button></div>' : ''}
    </div>`;
  }
  html += `<div class="count" style="margin:0 2px 6px">${list.length === state.events.length ? `${list.length} ${plural(list.length, 'događaj', 'događaja', 'događaja')}` : `Prikazano ${list.length} od ${state.events.length}`}</div>`;
  let year = null;
  for (const e of list) {
    const y = e.start?.y;
    if (y !== year) {
      year = y;
      html += `<div class="year-head">${esc(y)}.</div>`;
    }
    html += renderEventCard(e);
  }
  if (!list.length) html += '<div class="empty">Nijedan događaj ne odgovara filtru.</div>';
  return html;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* =========================================================
   Dokazi
   ========================================================= */

function docLabelIds(docId) {
  const ids = new Set();
  for (const e of eventsForDoc(docId)) (e.labels || []).forEach((id) => ids.add(id));
  return ids;
}

function renderDocRow(d) {
  const evs = eventsForDoc(d.id);
  const sub = evs.length
    ? evs.map((e) => `${formatShort(e.start)} ${e.title}`).join(' · ')
    : 'Nije povezan s događajem';
  return `<button class="doc-row" data-action="open-doc" data-id="${d.id}">
    <span class="ficon">${fileIcon(d)}</span>${exhBadge(d)}
    <span class="body"><span class="name" style="display:block">${esc(d.name)}</span><span class="sub" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub)}</span></span>
  </button>`;
}

function renderDocs() {
  const docs = [...state.docs].sort((a, b) => a.exhibitNo - b.exhibitNo);
  if (!docs.length) {
    return `<div class="empty">
      <div class="big">📄</div>
      <h2>Još nema dokaza</h2>
      <p>Dodajte snimku zaslona, fotografiju ili PDF. Svaki dokument automatski dobiva broj dokaza i žutu naljepnicu.</p>
      <p><button class="btn primary" data-action="new-doc">Dodaj dokaz</button></p>
    </div>`;
  }
  let html = `<div class="toolbar">
    <span class="count grow">${docs.length} ${plural(docs.length, 'dokaz', 'dokaza', 'dokaza')}</span>
    <button class="btn small" data-action="docs-group">${state.docsGrouped ? 'Prikaži redom' : 'Grupiraj po oznakama'}</button>
    <button class="btn small" data-action="docs-export-menu">⬇︎ Izvoz</button>
  </div>`;
  if (!state.docsGrouped) {
    return html + docs.map(renderDocRow).join('');
  }
  for (const l of state.labels) {
    const inLabel = docs.filter((d) => docLabelIds(d.id).has(l.id));
    if (!inLabel.length) continue;
    html += `<div class="group-head">${chip(l)}<span class="muted small">${inLabel.length}</span></div>`;
    html += inLabel.map(renderDocRow).join('');
  }
  const visitDocs = docs.filter((d) => eventsForDoc(d.id).some((e) => e.kind === 'vidjanje'));
  if (visitDocs.length) {
    html += `<div class="group-head"><span class="chip" style="--h:120">Viđanja</span><span class="muted small">${visitDocs.length}</span></div>`;
    html += visitDocs.map(renderDocRow).join('');
  }
  const rest = docs.filter((d) => {
    const evs = eventsForDoc(d.id);
    return !evs.some((e) => e.kind === 'vidjanje') && docLabelIds(d.id).size === 0;
  });
  if (rest.length) {
    html += `<div class="group-head"><span class="chip" style="--h:220">Bez oznake</span><span class="muted small">${rest.length}</span></div>`;
    html += rest.map(renderDocRow).join('');
  }
  return html;
}

/* =========================================================
   Viđanja
   ========================================================= */

function renderVisits() {
  const visits = state.events.filter((e) => e.kind === 'vidjanje');
  if (!visits.length) {
    return `<div class="empty">
      <div class="big">👧</div>
      <h2>Još nema zabilježenih viđanja</h2>
      <p>Nakon svakog (ne)održanog viđanja zabilježite što se dogodilo. Aplikacija će voditi statistiku po mjesecima.</p>
      <p><button class="btn primary" data-action="new-visit">Zabilježi viđanje</button></p>
    </div>`;
  }
  const held = visits.filter((v) => VISIT_STATUS[v.visitStatus]?.held).length;
  const notHeld = visits.length - held;
  const pct = Math.round((held / visits.length) * 100);
  const byStatus = Object.keys(VISIT_STATUS).map((k) => [k, visits.filter((v) => v.visitStatus === k).length]);

  const months = new Map();
  for (const v of visits) {
    const key = `${v.start.y}-${String(v.start.m || 0).padStart(2, '0')}`;
    if (!months.has(key)) months.set(key, { y: v.start.y, m: v.start.m, total: 0, held: 0, late: 0, notHeld: 0 });
    const r = months.get(key);
    r.total++;
    if (VISIT_STATUS[v.visitStatus]?.held) r.held++; else r.notHeld++;
    if (v.visitStatus === 'kasnjenje' || v.visitStatus === 'djelomicno') r.late++;
  }
  const rows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, r]) => r);
  const colors = { 'st-ok': 'var(--ok)', 'st-warn': 'var(--warn)', 'st-bad': 'var(--danger)' };

  return `
  <div class="stats">
    <div class="stat"><div class="num">${visits.length}</div><div class="lbl">Zabilježeno viđanja</div></div>
    <div class="stat"><div class="num" style="color:var(--ok)">${held}</div><div class="lbl">Održano</div></div>
    <div class="stat"><div class="num" style="color:var(--danger)">${notHeld}</div><div class="lbl">Nije održano</div></div>
    <div class="stat"><div class="num">${pct}%</div><div class="lbl">Udio održanih</div></div>
  </div>
  <div class="card">
    <div class="bar" aria-hidden="true">${byStatus.filter(([, n]) => n).map(([k, n]) =>
      `<span style="width:${(n / visits.length) * 100}%;background:${colors[VISIT_STATUS[k].cls]};opacity:${k === 'odrzano' || k === 'nije-predano' ? 1 : 0.6}"></span>`).join('')}</div>
    <div style="margin-top:10px;display:grid;gap:6px">
      ${byStatus.map(([k, n]) => `<div style="display:flex;justify-content:space-between;gap:8px">${statusChip(k)}<b>${n}</b></div>`).join('')}
    </div>
  </div>
  <h2 class="section">Po mjesecima</h2>
  <div class="table-wrap"><table class="grid">
    <thead><tr><th>Mjesec</th><th class="n">Ukupno</th><th class="n">Održano</th><th class="n">Kašnj./skrać.</th><th class="n">Nije održano</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.m ? MJESECI[r.m - 1] : '—'} ${r.y}.</td><td class="n">${r.total}</td><td class="n">${r.held}</td><td class="n">${r.late}</td><td class="n" style="${r.notHeld ? 'color:var(--danger);font-weight:600' : ''}">${r.notHeld}</td></tr>`).join('')}</tbody>
  </table></div>
  <div class="toolbar">
    <button class="btn primary" data-action="new-visit">+ Zabilježi viđanje</button>
    <button class="btn" data-action="print-visits">🖨️ Ispiši izvješće</button>
  </div>
  <h2 class="section">Posljednja viđanja</h2>
  ${[...visits].reverse().slice(0, 20).map(renderEventCard).join('')}`;
}

/* =========================================================
   Modali
   ========================================================= */

function openModal(html, { full = false, onClose } = {}) {
  const root = $('#modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${full ? 'full' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(wrap);
  const close = () => {
    wrap.remove();
    if (onClose) onClose();
  };
  wrap.addEventListener('click', (ev) => {
    if (ev.target === wrap) close();
    if (ev.target.closest('[data-close]')) close();
  });
  const first = wrap.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, select');
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 50);
  return { el: wrap.firstElementChild, close };
}

function sheet(title, items) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal(`
      <div class="modal-head"><h1 style="padding-left:8px">${esc(title)}</h1><button class="icon-btn" data-close aria-label="Zatvori">✕</button></div>
      <div class="sheet-list">${items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? `<span>${it.icon}</span>` : ''}${esc(it.label)}</button>`).join('')}</div>
      <div style="height:env(safe-area-inset-bottom)"></div>`, { onClose: () => resolve(picked) });
    m.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-i]');
      if (b) { picked = items[+b.dataset.i].value; m.close(); }
    });
  });
}

function confirmDialog(text, okLabel = 'U redu', danger = false) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal(`
      <div class="modal-body"><p style="margin:4px 0 0">${esc(text)}</p></div>
      <div class="modal-foot"><button class="btn" data-close>Odustani</button><button class="btn primary ${danger ? 'danger' : ''}" data-ok style="${danger ? 'background:var(--danger);border-color:var(--danger);color:#fff' : ''}">${esc(okLabel)}</button></div>`,
    { onClose: () => resolve(result) });
    $('[data-ok]', m.el).addEventListener('click', () => { result = true; m.close(); });
  });
}

function promptDialog(title, value = '') {
  return new Promise((resolve) => {
    let result = null;
    const m = openModal(`
      <div class="modal-head"><h1 style="padding-left:8px">${esc(title)}</h1></div>
      <div class="modal-body"><input class="input" data-v value="${esc(value)}"></div>
      <div class="modal-foot"><button class="btn" data-close>Odustani</button><button class="btn primary" data-ok>Spremi</button></div>`,
    { onClose: () => resolve(result) });
    const input = $('[data-v]', m.el);
    const ok = () => { result = input.value.trim(); m.close(); };
    $('[data-ok]', m.el).addEventListener('click', ok);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

/* =========================================================
   Obrazac događaja / viđanja
   ========================================================= */

function pickFiles({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = $('#filePicker');
    input.multiple = multiple;
    input.value = '';
    const onChange = () => {
      input.removeEventListener('change', onChange);
      resolve([...input.files]);
    };
    input.addEventListener('change', onChange);
    input.click();
  });
}

function openEventForm(existing, { kind = 'dogadaj', files = [] } = {}) {
  const now = todayPoint();
  const e = existing ? structuredClone({ ...existing, docs: existing.docs || [], labels: existing.labels || [] }) : {
    id: db.uid(),
    kind,
    title: '',
    visitStatus: kind === 'vidjanje' ? 'odrzano' : '',
    start: { y: now.y, m: now.m, d: now.d, time: '' },
    end: null,
    notes: '',
    labels: [],
    docs: [],
    createdAt: Date.now(),
  };
  // Novi, još nespremljeni dokumenti (File objekti) čuvamo zasebno.
  const pending = files.map((f) => ({ tmpId: db.uid(), file: f, page: '' }));
  let approx = !!(e.start && e.start.y && (!e.start.m || !e.start.d));
  let hasEnd = !!(e.end && e.end.y);

  const m = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close aria-label="Zatvori">✕</button>
      <h1>${existing ? 'Uredi' : 'Novi'} ${e.kind === 'vidjanje' ? 'zapis o viđanju' : 'događaj'}</h1>
    </div>
    <form class="modal-body" data-form novalidate></form>
    <div class="modal-foot">
      <button class="btn" type="button" data-close>Odustani</button>
      <button class="btn primary" type="button" data-save>Spremi</button>
    </div>`, { full: true });
  const form = $('[data-form]', m.el);

  const readForm = () => {
    const v = (n) => form.elements[n]?.value ?? '';
    e.title = v('title').trim();
    e.notes = v('notes');
    if (e.kind === 'vidjanje') e.visitStatus = v('visitStatus');
    if (approx) {
      e.start = { y: +v('y') || null, m: +v('m') || null, d: null, time: v('time') };
    } else {
      const p = fromIso(v('date'));
      e.start = p ? { ...p, time: v('time') } : { y: null, m: null, d: null, time: v('time') };
    }
    if (hasEnd) {
      const p = fromIso(v('endDate'));
      e.end = p ? { ...p, time: v('endTime') } : null;
    } else {
      e.end = null;
    }
    e.labels = $$('input[name=label]:checked', form).map((x) => x.value);
    $$('input[data-page]', form).forEach((inp) => {
      const id = inp.dataset.page;
      const r = e.docs.find((x) => x.docId === id) || pending.find((x) => x.tmpId === id);
      if (r) r.page = inp.value.trim();
    });
  };

  const draw = () => {
    form.innerHTML = `
      <div class="field">
        <div class="seg">
          <button type="button" data-kind="dogadaj" class="${e.kind !== 'vidjanje' ? 'on' : ''}">📅 Događaj</button>
          <button type="button" data-kind="vidjanje" class="${e.kind === 'vidjanje' ? 'on' : ''}">👧 Viđanje djeteta</button>
        </div>
      </div>
      ${e.kind === 'vidjanje' ? `
      <div class="field">
        <label for="f-status">Ishod viđanja</label>
        <select class="input" id="f-status" name="visitStatus">
          ${Object.entries(VISIT_STATUS).map(([k, s]) => `<option value="${k}" ${e.visitStatus === k ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="field">
        <label for="f-title">Naslov${e.kind === 'vidjanje' ? '' : ' *'}</label>
        <input class="input" id="f-title" name="title" value="${esc(e.title)}" placeholder="${e.kind === 'vidjanje' ? 'npr. Redovno viđanje vikendom' : 'npr. Odbio predati dijete na primopredaji'}" maxlength="200">
      </div>
      <div class="field">
        <span class="label">Datum i vrijeme *</span>
        ${approx ? `
          <div class="row2">
            <input class="input" name="y" type="number" inputmode="numeric" min="1900" max="2100" placeholder="Godina" value="${esc(e.start?.y || '')}" aria-label="Godina">
            <select class="input" name="m" aria-label="Mjesec"><option value="">Mjesec (nepoznat)</option>${MJESECI.map((n, i) => `<option value="${i + 1}" ${e.start?.m === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </div>` : `
          <div class="row2">
            <input class="input" name="date" type="date" value="${esc(toIso(e.start))}" aria-label="Datum">
            <input class="input" name="time" type="time" value="${esc(e.start?.time || '')}" aria-label="Vrijeme">
          </div>`}
        ${approx ? `<input type="hidden" name="time" value="">` : ''}
        <div class="hint"><button type="button" class="link small" data-toggle-approx>${approx ? 'Znam točan datum' : 'Ne znam točan datum'}</button></div>
        <label class="check" style="margin-top:10px"><input type="checkbox" data-toggle-end ${hasEnd ? 'checked' : ''}> Traje više dana / dodaj završetak</label>
        ${hasEnd ? `<div class="row2" style="margin-top:8px">
          <input class="input" name="endDate" type="date" value="${esc(toIso(e.end))}" aria-label="Završni datum">
          <input class="input" name="endTime" type="time" value="${esc(e.end?.time || '')}" aria-label="Završno vrijeme">
        </div>` : ''}
      </div>
      <div class="field">
        <label for="f-notes">Opis – što se dogodilo</label>
        <textarea class="input" id="f-notes" name="notes" placeholder="Opišite činjenice: tko, što, gdje, kada. Navedite svjedoke ako ih je bilo.">${esc(e.notes)}</textarea>
      </div>
      <div class="field">
        <span class="label">Oznake – na što se odnosi</span>
        <div class="label-list">
          ${state.labels.map((l) => `<label class="label-item"><input type="checkbox" name="label" value="${l.id}" ${e.labels.includes(l.id) ? 'checked' : ''}>${chip(l)}</label>`).join('')}
        </div>
        <button type="button" class="link small" data-new-label style="margin-top:6px">+ Nova oznaka</button>
      </div>
      <div class="field">
        <span class="label">Dokazi (snimke zaslona, fotografije, PDF)</span>
        ${e.docs.map((r) => {
          const d = docById(r.docId);
          if (!d) return '';
          return `<div class="attached"><span class="ficon">${fileIcon(d)}</span>${exhBadge(d)}<span class="name">${esc(d.name)}</span>
            <input class="input" data-page="${d.id}" value="${esc(r.page || '')}" placeholder="str." aria-label="Stranica">
            <button type="button" class="icon-btn" data-unlink="${d.id}" aria-label="Ukloni">✕</button></div>`;
        }).join('')}
        ${pending.map((p, i) => `<div class="attached"><span class="ficon">${fileIcon({ type: p.file.type, name: p.file.name })}</span><span class="exh">${esc(exhibitCode(state.settings, nextExhibitNo() + i))}</span><span class="name">${esc(p.file.name)}</span>
            <input class="input" data-page="${p.tmpId}" value="${esc(p.page)}" placeholder="str." aria-label="Stranica">
            <button type="button" class="icon-btn" data-unpend="${p.tmpId}" aria-label="Ukloni">✕</button></div>`).join('')}
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="btn small" data-add-file>📎 Dodaj datoteku</button>
          ${state.docs.length ? '<button type="button" class="btn small" data-pick-existing>🗂️ Odaberi postojeći dokaz</button>' : ''}
        </div>
      </div>`;
  };

  draw();

  form.addEventListener('click', async (ev) => {
    const t = ev.target;
    const kindBtn = t.closest('[data-kind]');
    if (kindBtn) {
      readForm();
      e.kind = kindBtn.dataset.kind;
      if (e.kind === 'vidjanje' && !e.visitStatus) e.visitStatus = 'odrzano';
      $('.modal-head h1', m.el).textContent = `${existing ? 'Uredi' : 'Novi'} ${e.kind === 'vidjanje' ? 'zapis o viđanju' : 'događaj'}`;
      draw();
      return;
    }
    if (t.closest('[data-toggle-approx]')) {
      readForm();
      approx = !approx;
      if (!approx && e.start?.y && !e.start.d) e.start = { ...e.start, m: e.start.m || 1, d: 1 };
      draw();
      return;
    }
    if (t.closest('[data-new-label]')) {
      readForm();
      const name = await promptDialog('Nova oznaka');
      if (name) {
        const l = { id: db.uid(), name, hue: Math.floor(Math.random() * 360), order: state.labels.length };
        await db.put('labels', l);
        state.labels.push(l);
        e.labels.push(l.id);
        draw();
      }
      return;
    }
    if (t.closest('[data-add-file]')) {
      readForm();
      const fs = await pickFiles();
      fs.forEach((f) => pending.push({ tmpId: db.uid(), file: f, page: '' }));
      draw();
      return;
    }
    if (t.closest('[data-pick-existing]')) {
      readForm();
      const avail = state.docs.filter((d) => !e.docs.some((r) => r.docId === d.id)).sort((a, b) => a.exhibitNo - b.exhibitNo);
      if (!avail.length) { toast('Svi dokazi su već priloženi.'); return; }
      const id = await sheet('Odaberi dokaz', avail.map((d) => ({ label: `${exhibitCode(state.settings, d.exhibitNo)}  ${d.name}`, icon: fileIcon(d), value: d.id })));
      if (id) { e.docs.push({ docId: id, page: '' }); draw(); }
      return;
    }
    const un = t.closest('[data-unlink]');
    if (un) { readForm(); e.docs = e.docs.filter((r) => r.docId !== un.dataset.unlink); draw(); return; }
    const up = t.closest('[data-unpend]');
    if (up) { readForm(); pending.splice(pending.findIndex((p) => p.tmpId === up.dataset.unpend), 1); draw(); return; }
    const tog = t.closest('[data-toggle-end]');
    if (tog) {
      readForm();
      hasEnd = tog.checked;
      if (hasEnd && !e.end) e.end = e.start?.d ? { ...e.start, time: '' } : null;
      draw();
    }
  });

  $('[data-save]', m.el).addEventListener('click', async () => {
    readForm();
    if (!e.start?.y) { toast('Unesite datum (barem godinu).'); return; }
    if (e.kind === 'vidjanje') {
      if (!e.title) e.title = `Viđanje – ${VISIT_STATUS[e.visitStatus].label.toLowerCase()}`;
    } else {
      e.visitStatus = '';
      if (!e.title) { toast('Unesite naslov događaja.'); $('[name=title]', form).focus(); return; }
    }
    const btn = $('[data-save]', m.el);
    btn.disabled = true;
    try {
      const created = await addFiles(pending.map((p) => p.file));
      created.forEach((d, i) => e.docs.push({ docId: d.id, page: pending[i].page }));
      e.updatedAt = Date.now();
      await db.put('events', e);
      const idx = state.events.findIndex((x) => x.id === e.id);
      if (idx >= 0) state.events[idx] = e; else state.events.push(e);
      sortEvents();
      m.close();
      render();
      toast(created.length ? `Spremljeno. Dodano dokaza: ${created.length}.` : 'Spremljeno.');
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Spremanje nije uspjelo: ' + err.message);
    }
  });
}

/* =========================================================
   Preglednik dokaza
   ========================================================= */

async function openDocViewer(docId) {
  const d = docById(docId);
  if (!d) return;
  const urls = [];
  const m = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close aria-label="Natrag">←</button>
      ${exhBadge(d)}<h1>${esc(d.name)}</h1>
    </div>
    <div class="modal-body" style="padding:0">
      <div class="viewer-body" data-preview><div style="color:#ccc;padding:40px">Učitavanje…</div></div>
      <div class="viewer-actions">
        <button class="btn primary" data-act="dl-stamped">⬇︎ Preuzmi s naljepnicom</button>
        <button class="btn" data-act="dl-orig">Original</button>
        ${navigator.share ? '<button class="btn" data-act="share">Podijeli</button>' : ''}
        <button class="btn" data-act="rename">Preimenuj</button>
        <button class="btn" data-act="number">Promijeni broj</button>
        <button class="btn danger" data-act="delete">Obriši</button>
      </div>
      <div class="viewer-info">
        <div class="small muted">Dodano ${esc(formatTimestamp(d.createdAt))} · ${(d.size / 1024).toFixed(0)} KB</div>
        <h2 class="section">Povezani događaji</h2>
        ${eventsForDoc(d.id).map((e) => `<div class="card" style="padding:10px 12px"><div class="event-date">${esc(formatRange(e.start, e.end))}</div><b>${esc(e.title)}</b></div>`).join('') || '<p class="muted small">Dokaz nije povezan ni s jednim događajem.</p>'}
      </div>
    </div>`, { full: true, onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)) });

  const preview = $('[data-preview]', m.el);
  try {
    if (isImage(d) || isPdf(d)) {
      const stamped = await stampDoc(d, state.settings);
      const u = URL.createObjectURL(stamped);
      urls.push(u);
      preview.innerHTML = isImage(d) ? `<img src="${u}" alt="${esc(d.name)}">` : `<iframe src="${u}" title="${esc(d.name)}"></iframe>`;
    } else {
      const c = stickerCanvas(300, { title: state.settings.stickerTitle, code: exhibitCode(state.settings, d.exhibitNo), caption: state.settings.caseName });
      preview.innerHTML = '<div style="color:#ddd;padding:16px;text-align:center"><p>Pregled ove vrste datoteke nije dostupan. Naljepnicu možete ispisati i zalijepiti na papirnati primjerak.</p></div>';
      preview.firstElementChild.appendChild(c);
    }
  } catch (err) {
    console.error(err);
    preview.innerHTML = `<div style="color:#fbb;padding:24px">Pregled nije moguć: ${esc(err.message)}</div>`;
  }

  m.el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'dl-stamped') {
      try { download(await stampDoc(d, state.settings), stampedFileName(d, state.settings)); }
      catch (err) { toast('Greška: ' + err.message); }
    } else if (a === 'dl-orig') {
      download(d.blob, d.name);
    } else if (a === 'share') {
      try {
        const blob = await stampDoc(d, state.settings);
        const file = new File([blob], stampedFileName(d, state.settings), { type: blob.type });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('Dijeljenje datoteka nije podržano.');
        await navigator.share({ files: [file], title: file.name });
      } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
    } else if (a === 'rename') {
      const name = await promptDialog('Naziv dokumenta', d.name);
      if (name) { d.name = name; await db.put('docs', d); m.close(); render(); openDocViewer(d.id); }
    } else if (a === 'number') {
      const v = await promptDialog(`Broj dokaza (trenutno ${d.exhibitNo})`, String(d.exhibitNo));
      const n = parseInt(v, 10);
      if (v === null) return;
      if (!(n > 0)) { toast('Unesite pozitivan cijeli broj.'); return; }
      const clash = state.docs.find((x) => x.id !== d.id && x.exhibitNo === n);
      if (clash) { clash.exhibitNo = d.exhibitNo; await db.put('docs', clash); }
      d.exhibitNo = n;
      await db.put('docs', d);
      m.close(); render(); openDocViewer(d.id);
      if (clash) toast(`Zamijenjeno s dokazom ${clash.name}.`);
    } else if (a === 'delete') {
      if (!await confirmDialog(`Obrisati dokaz „${d.name}"? Bit će uklonjen i iz svih događaja.`, 'Obriši', true)) return;
      await deleteDoc(d.id);
      m.close();
      render();
      toast('Dokaz obrisan.');
    }
  });
}

async function deleteDoc(id) {
  await db.del('docs', id);
  state.docs = state.docs.filter((d) => d.id !== id);
  for (const e of state.events) {
    if ((e.docs || []).some((r) => r.docId === id)) {
      e.docs = e.docs.filter((r) => r.docId !== id);
      await db.put('events', e);
    }
  }
}

/* =========================================================
   Postavke
   ========================================================= */

function openSettings() {
  const s = state.settings;
  const m = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close aria-label="Zatvori">✕</button>
      <h1>Postavke</h1>
    </div>
    <div class="modal-body" data-settings></div>`, { full: true, onClose: render });
  const body = $('[data-settings]', m.el);

  const draw = () => {
    body.innerHTML = `
      <h2 class="section" style="margin-top:0">Predmet i naljepnica dokaza</h2>
      <div class="field">
        <label for="s-case">Predmet / poslovni broj</label>
        <input class="input" id="s-case" data-s="caseName" value="${esc(s.caseName)}" placeholder="npr. P Ob-123/2026 ili Horvat">
        <div class="hint">Ispisuje se na dnu naljepnice i u izvješćima.</div>
      </div>
      <div class="field">
        <label for="s-title">Tekst naljepnice</label>
        <input class="input" id="s-title" data-s="stickerTitle" value="${esc(s.stickerTitle)}">
        <div class="chips" style="margin-top:6px">
          ${['Prilog predlagatelja', 'Prilog protustranke', 'Prilog tužitelja', 'Prilog tuženika', 'Prilog'].map((t) =>
            `<button type="button" class="btn small" data-preset-title="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="s-prefix">Prefiks broja</label>
          <input class="input" id="s-prefix" data-s="prefix" value="${esc(s.prefix)}" maxlength="6">
          <div class="hint">npr. P → P-01, P-02…</div>
        </div>
        <div class="field">
          <label for="s-pos">Položaj naljepnice</label>
          <select class="input" id="s-pos" data-s="stickerPosition">
            ${Object.entries(POSITIONS).map(([k, v]) => `<option value="${k}" ${s.stickerPosition === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="sticker-preview" data-sticker></div>

      <h2 class="section">Oznake</h2>
      <div data-labels>
        ${state.labels.map((l) => `
          <div class="label-item" style="justify-content:space-between">
            ${chip(l)}
            <span>
              <button class="btn small" data-label-act="rename" data-id="${l.id}">Preimenuj</button>
              <button class="btn small" data-label-act="color" data-id="${l.id}" title="Promijeni boju">🎨</button>
              <button class="btn small danger" data-label-act="delete" data-id="${l.id}" aria-label="Obriši">✕</button>
            </span>
          </div>`).join('')}
      </div>
      <button class="btn small" data-new-label style="margin-top:8px">+ Nova oznaka</button>

      <h2 class="section">Dokazi</h2>
      <p class="small muted">Prenumeriranje dodjeljuje brojeve redom prema datumu prvog događaja na koji se dokaz odnosi.</p>
      <button class="btn" data-renumber>Prenumeriraj kronološki</button>

      <h2 class="section">Sigurnosna kopija</h2>
      <p class="small muted">Svi podaci (uključujući dokumente) spremljeni su <b>samo u ovom pregledniku na ovom uređaju</b>.
      Ako obrišete podatke preglednika ili izgubite uređaj, podaci se gube. Redovito izvezite sigurnosnu kopiju i spremite je na sigurno mjesto.</p>
      <div class="toolbar">
        <button class="btn primary" data-backup>⬇︎ Izvezi kopiju</button>
        <button class="btn" data-restore>⬆︎ Uvezi kopiju</button>
      </div>

      <h2 class="section">Brisanje</h2>
      <button class="btn danger" data-wipe>Obriši sve podatke</button>

      <p class="small muted" style="margin-top:28px">Evidencija pomaže urediti vlastite bilješke i dokaze. Nije pravni savjet – o načinu podnošenja dokaza
      sudu posavjetujte se s odvjetnikom ili centrom za socijalnu skrb / Hrvatskim zavodom za socijalni rad.</p>`;
    drawSticker();
  };

  const drawSticker = () => {
    const box = $('[data-sticker]', body);
    box.innerHTML = '';
    box.appendChild(stickerCanvas(440, { title: s.stickerTitle, code: exhibitCode(s, 3), caption: s.caseName }));
  };

  draw();

  body.addEventListener('input', async (ev) => {
    const k = ev.target.dataset.s;
    if (!k) return;
    await saveSettings({ [k]: ev.target.value });
    drawSticker();
  });

  body.addEventListener('click', async (ev) => {
    const t = ev.target;
    const preset = t.closest('[data-preset-title]');
    if (preset) {
      await saveSettings({ stickerTitle: preset.dataset.presetTitle });
      $('#s-title', body).value = s.stickerTitle;
      drawSticker();
      return;
    }
    const la = t.closest('[data-label-act]');
    if (la) {
      const l = labelById(la.dataset.id);
      if (la.dataset.labelAct === 'rename') {
        const name = await promptDialog('Naziv oznake', l.name);
        if (name) { l.name = name; await db.put('labels', l); }
      } else if (la.dataset.labelAct === 'color') {
        l.hue = (l.hue + 37) % 360;
        await db.put('labels', l);
      } else {
        const used = state.events.filter((e) => (e.labels || []).includes(l.id)).length;
        if (!await confirmDialog(`Obrisati oznaku „${l.name}"?${used ? ` Uklonit će se s ${used} ${plural(used, 'događaja', 'događaja', 'događaja')}.` : ''}`, 'Obriši', true)) return;
        await db.del('labels', l.id);
        state.labels = state.labels.filter((x) => x.id !== l.id);
        state.filter.labels.delete(l.id);
        for (const e of state.events) {
          if ((e.labels || []).includes(l.id)) { e.labels = e.labels.filter((x) => x !== l.id); await db.put('events', e); }
        }
      }
      draw();
      return;
    }
    if (t.closest('[data-new-label]')) {
      const name = await promptDialog('Nova oznaka');
      if (name) {
        const l = { id: db.uid(), name, hue: Math.floor(Math.random() * 360), order: state.labels.length };
        await db.put('labels', l);
        state.labels.push(l);
        draw();
      }
      return;
    }
    if (t.closest('[data-renumber]')) {
      if (!await confirmDialog('Prenumerirati sve dokaze kronološki? Brojevi dokaza će se promijeniti.', 'Prenumeriraj')) return;
      await renumberChronologically();
      toast('Dokazi su prenumerirani.');
      return;
    }
    if (t.closest('[data-backup]')) { await exportBackup(); return; }
    if (t.closest('[data-restore]')) { $('#backupPicker').click(); return; }
    if (t.closest('[data-wipe]')) {
      if (!await confirmDialog('Trajno obrisati SVE događaje, dokaze i postavke s ovog uređaja? Ovo se ne može poništiti.', 'Obriši sve', true)) return;
      for (const st of db.STORES) await db.clear(st);
      await load();
      m.close();
      toast('Svi podaci su obrisani.');
    }
  });
}

async function renumberChronologically() {
  const firstKey = (d) => {
    const evs = eventsForDoc(d.id);
    return evs.length ? evs.map((e) => sortKey(e.start)).sort()[0] : '9999';
  };
  const sorted = [...state.docs].sort((a, b) => firstKey(a).localeCompare(firstKey(b)) || a.exhibitNo - b.exhibitNo);
  for (const [i, d] of sorted.entries()) {
    if (d.exhibitNo !== i + 1) { d.exhibitNo = i + 1; await db.put('docs', d); }
  }
}

/* =========================================================
   Sigurnosna kopija
   ========================================================= */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function exportBackup() {
  toast('Pripremam kopiju…');
  const docs = [];
  for (const d of state.docs) {
    const { blob, ...meta } = d;
    docs.push({ ...meta, data: await blobToDataUrl(blob) });
  }
  const data = {
    app: 'evidencija', version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, labels: state.labels, events: state.events, docs,
  };
  const n = new Date();
  const stamp = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `evidencija-kopija-${stamp}.json`);
  await saveSettings({ lastBackup: Date.now() });
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    toast('Datoteka nije valjana sigurnosna kopija.');
    return;
  }
  if (data.app !== 'evidencija') { toast('Datoteka nije sigurnosna kopija Evidencije.'); return; }
  if (!await confirmDialog(`Uvesti kopiju od ${new Date(data.exportedAt).toLocaleString('hr-HR')}? Postojeći podaci na ovom uređaju bit će zamijenjeni.`, 'Uvezi', true)) return;
  for (const st of db.STORES) await db.clear(st);
  await db.put('kv', { ...DEFAULT_SETTINGS, ...data.settings, id: 'settings' });
  for (const l of data.labels || []) await db.put('labels', l);
  for (const e of data.events || []) await db.put('events', e);
  for (const d of data.docs || []) {
    const { data: url, ...meta } = d;
    const blob = await (await fetch(url)).blob();
    await db.put('docs', { ...meta, blob });
  }
  await load();
  $('#modalRoot').innerHTML = '';
  render();
  toast('Kopija je uvezena.');
}

/* =========================================================
   Ispis i izvoz
   ========================================================= */

function printHtml(html) {
  $('#printArea').innerHTML = html;
  setTimeout(() => window.print(), 50);
}

function printHeader(title) {
  const s = state.settings;
  return `<h1>${esc(title)}</h1><div class="meta">${s.caseName ? `Predmet: ${esc(s.caseName)} · ` : ''}Izrađeno ${esc(formatTimestamp(Date.now()))}</div>`;
}

function printTimeline(events, title) {
  const html = printHeader(title) + events.map((e) => {
    const labels = (e.labels || []).map(labelById).filter(Boolean).map((l) => l.name);
    if (e.kind === 'vidjanje') labels.unshift(`Viđanje: ${VISIT_STATUS[e.visitStatus]?.label || ''}`);
    const docs = (e.docs || []).map((r) => {
      const d = docById(r.docId);
      return d ? `${exhibitCode(state.settings, d.exhibitNo)} ${d.name}${r.page ? `, str. ${r.page}` : ''}` : '';
    }).filter(Boolean);
    return `<div class="p-event">
      <div class="p-date">${esc(formatRange(e.start, e.end))}</div>
      <div class="p-title">${esc(e.title)}</div>
      ${labels.length ? `<div class="p-small">${esc(labels.join(' · '))}</div>` : ''}
      ${e.notes ? `<div class="p-notes">${esc(e.notes)}</div>` : ''}
      ${docs.length ? `<div class="p-small">Dokazi: ${esc(docs.join('; '))}</div>` : ''}
    </div>`;
  }).join('');
  printHtml(html);
}

function exhibitRows() {
  return [...state.docs].sort((a, b) => a.exhibitNo - b.exhibitNo).map((d) => {
    const evs = eventsForDoc(d.id);
    const labels = [...docLabelIds(d.id)].map(labelById).filter(Boolean).map((l) => l.name);
    return {
      code: exhibitCode(state.settings, d.exhibitNo),
      name: d.name,
      date: evs.map((e) => formatShort(e.start)).join(', '),
      desc: evs.map((e) => e.title).join('; '),
      labels: labels.join(', '),
    };
  });
}

function printExhibitList() {
  const rows = exhibitRows();
  printHtml(printHeader('Popis dokaza') + `<table>
    <thead><tr><th>Oznaka</th><th>Dokument</th><th>Datum</th><th>Opis / događaj</th><th>Kategorija</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td>${esc(r.date)}</td><td>${esc(r.desc)}</td><td>${esc(r.labels)}</td></tr>`).join('')}</tbody>
  </table>`);
}

function exportCsv() {
  const rows = exhibitRows();
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [['Oznaka', 'Dokument', 'Datum', 'Opis / događaj', 'Kategorija'].map(q).join(';')]
    .concat(rows.map((r) => [r.code, r.name, r.date, r.desc, r.labels].map(q).join(';')));
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'popis-dokaza.csv');
}

function printStickers() {
  const s = state.settings;
  const imgs = [...state.docs].sort((a, b) => a.exhibitNo - b.exhibitNo).map((d) =>
    `<img src="${stickerCanvas(600, { title: s.stickerTitle, code: exhibitCode(s, d.exhibitNo), caption: s.caseName }).toDataURL()}" alt="">`);
  printHtml(`<div class="stickers">${imgs.join('')}</div>`);
}

async function downloadAllStamped() {
  const docs = [...state.docs].sort((a, b) => a.exhibitNo - b.exhibitNo);
  toast(`Preuzimam ${docs.length} ${plural(docs.length, 'dokument', 'dokumenta', 'dokumenata')}…`);
  for (const d of docs) {
    try {
      download(await stampDoc(d, state.settings), stampedFileName(d, state.settings));
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      toast(`${d.name}: ${err.message}`);
    }
  }
}

/* =========================================================
   Događaji sučelja
   ========================================================= */

function closeFab() {
  $('.fab').classList.remove('open');
  $('#fabMenu').hidden = true;
  $('.scrim')?.remove();
}

async function newEventWithDoc(kind = 'dogadaj') {
  const files = await pickFiles();
  if (files.length) openEventForm(null, { kind, files });
}

async function handleAction(action, el) {
  switch (action) {
    case 'fab': {
      const open = $('#fabMenu').hidden;
      if (!open) { closeFab(); return; }
      $('.fab').classList.add('open');
      $('#fabMenu').hidden = false;
      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.addEventListener('click', closeFab);
      document.body.appendChild(scrim);
      return;
    }
    case 'new-event': closeFab(); openEventForm(null, { kind: 'dogadaj' }); return;
    case 'new-visit': closeFab(); openEventForm(null, { kind: 'vidjanje' }); return;
    case 'new-event-with-doc': closeFab(); newEventWithDoc(); return;
    case 'new-doc': {
      closeFab();
      const files = await pickFiles();
      if (!files.length) return;
      const created = await addFiles(files);
      state.tab = 'docs';
      render();
      toast(`Dodano: ${created.map((d) => exhibitCode(state.settings, d.exhibitNo)).join(', ')}`);
      return;
    }
    case 'settings': openSettings(); return;
    case 'toggle-filters': state.filter.open = !state.filter.open; render(); return;
    case 'filter-kind': state.filter.kind = el.dataset.kind; render(); return;
    case 'filter-label': {
      const s = state.filter.labels;
      if (s.has(el.dataset.id)) s.delete(el.dataset.id); else s.add(el.dataset.id);
      render();
      return;
    }
    case 'clear-filters': state.filter.labels.clear(); state.filter.kind = 'sve'; render(); return;
    case 'toggle-notes': {
      const id = el.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      render();
      return;
    }
    case 'open-doc': openDocViewer(el.dataset.id); return;
    case 'event-menu': {
      const e = state.events.find((x) => x.id === el.dataset.id);
      const act = await sheet(e.title, [
        { label: 'Uredi', icon: '✏️', value: 'edit' },
        { label: 'Dodaj dokaz', icon: '📎', value: 'add-doc' },
        { label: 'Kopiraj kao novi', icon: '⧉', value: 'dup' },
        { label: 'Obriši', icon: '🗑️', value: 'delete', danger: true },
      ]);
      if (act === 'edit') openEventForm(e);
      else if (act === 'add-doc') {
        const files = await pickFiles();
        if (files.length) openEventForm(e, { files });
      } else if (act === 'dup') {
        openEventForm({ ...structuredClone(e), id: db.uid(), docs: [], createdAt: Date.now() });
      } else if (act === 'delete') {
        if (!await confirmDialog(`Obrisati „${e.title}"? Priloženi dokazi ostaju u popisu dokaza.`, 'Obriši', true)) return;
        await db.del('events', e.id);
        state.events = state.events.filter((x) => x.id !== e.id);
        render();
        toast('Događaj obrisan.');
      }
      return;
    }
    case 'docs-group': state.docsGrouped = !state.docsGrouped; render(); return;
    case 'docs-export-menu': {
      const act = await sheet('Izvoz dokaza', [
        { label: 'Ispiši / spremi popis dokaza (PDF)', icon: '🖨️', value: 'print' },
        { label: 'Popis dokaza kao tablica (CSV za Excel)', icon: '📊', value: 'csv' },
        { label: 'Preuzmi sve dokaze s naljepnicama', icon: '⬇︎', value: 'all' },
        { label: 'Ispiši naljepnice za papirnate dokaze', icon: '🏷️', value: 'stickers' },
      ]);
      if (act === 'print') printExhibitList();
      else if (act === 'csv') exportCsv();
      else if (act === 'all') downloadAllStamped();
      else if (act === 'stickers') printStickers();
      return;
    }
    case 'print-timeline': {
      const list = filteredEvents();
      printTimeline(list, list.length === state.events.length ? 'Kronologija događaja' : 'Kronologija događaja (filtrirano)');
      return;
    }
    case 'print-visits': printTimeline(state.events.filter((e) => e.kind === 'vidjanje'), 'Evidencija viđanja djeteta'); return;
    default:
  }
}

document.addEventListener('click', (ev) => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = ev.target.closest('[data-action]');
  if (el && !el.closest('.modal')) {
    ev.preventDefault();
    handleAction(el.dataset.action, el);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    const last = $('#modalRoot').lastElementChild;
    if (last) last.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    else closeFab();
  }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-action="filter-label"]')) {
    ev.preventDefault();
    handleAction('filter-label', ev.target);
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.dataset.input === 'search') {
    state.filter.q = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const inp = $('[data-input="search"]');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  }
});

$('#backupPicker').addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) importBackup(f);
});

window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

/* =========================================================
   Dijeljenje u aplikaciju (Android, instalirana aplikacija)
   ========================================================= */

async function consumeSharedFiles() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('evidencija-shared');
  const reqs = await cache.keys();
  const files = [];
  for (const r of reqs) {
    const res = await cache.match(r);
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-name') || 'dijeljeno');
    files.push(new File([blob], name, { type: blob.type }));
    await cache.delete(r);
  }
  if (files.length) openEventForm(null, { files });
}

/* =========================================================
   Pokretanje
   ========================================================= */

async function start() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="empty"><h2>Pohrana nije dostupna</h2><p>Preglednik ne dopušta spremanje podataka (možda ste u privatnom načinu rada). ${esc(err.message || '')}</p></div>`;
    return;
  }
  render();
  db.requestPersistence();
  consumeSharedFiles();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  // Podsjetnik na sigurnosnu kopiju nakon 14 dana
  const last = state.settings.lastBackup || 0;
  if (state.events.length >= 3 && Date.now() - last > 14 * 864e5) {
    setTimeout(() => toast('Savjet: izradite sigurnosnu kopiju u Postavkama.'), 1500);
  }
}

start();

// Za testiranje u konzoli
window.__evidencija = { state, formatPoint };
