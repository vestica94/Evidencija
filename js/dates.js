(function () {
'use strict';
// Hrvatsko oblikovanje datuma. Datum događaja može biti nepotpun
// (obavezna je samo godina), pa ga čuvamo kao { y, m, d, time }.

const MJESECI = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj',
  'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
const MJESECI_GEN = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja',
  'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];
const DANI = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

const pad = (n) => String(n).padStart(2, '0');

function weekday(y, m, d) {
  if (!y || !m || !d) return '';
  return DANI[new Date(y, m - 1, d).getDay()];
}

/** Ključ za sortiranje: nepoznati mjesec/dan idu na početak razdoblja. */
function sortKey(p) {
  if (!p || !p.y) return '9999';
  return `${p.y}-${pad(p.m || 0)}-${pad(p.d || 0)}T${p.time || '00:00'}`;
}

/** Npr. „subota, 27. lipnja 2026. u 18:00" ili „lipanj 2026." */
function formatPoint(p, { withWeekday = true } = {}) {
  if (!p || !p.y) return '';
  let s;
  if (p.m && p.d) {
    s = `${p.d}. ${MJESECI_GEN[p.m - 1]} ${p.y}.`;
    if (withWeekday) s = `${weekday(p.y, p.m, p.d)}, ${s}`;
  } else if (p.m) {
    s = `${MJESECI[p.m - 1]} ${p.y}.`;
  } else {
    s = `${p.y}.`;
  }
  if (p.time) s += ` u ${p.time}`;
  return s;
}

function formatRange(start, end) {
  const a = formatPoint(start);
  if (!end || !end.y) return a;
  return `${a} – ${formatPoint(end)}`;
}

/** Kratki oblik za tablice: 27.06.2026. 18:00 */
function formatShort(p) {
  if (!p || !p.y) return '';
  let s = p.m && p.d ? `${pad(p.d)}.${pad(p.m)}.${p.y}.` : p.m ? `${pad(p.m)}/${p.y}` : `${p.y}.`;
  if (p.time) s += ` ${p.time}`;
  return s;
}

function todayPoint() {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), time: `${pad(n.getHours())}:${pad(n.getMinutes())}` };
}

function toIso(p) {
  if (!p || !p.y || !p.m || !p.d) return '';
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function fromIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function formatTimestamp(ms) {
  const d = new Date(ms);
  return `${d.getDate()}.${pad(d.getMonth() + 1)}.${d.getFullYear()}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

window.EvDates = { MJESECI, MJESECI_GEN, DANI, weekday, sortKey, formatPoint, formatRange, formatShort, todayPoint, toIso, fromIso, formatTimestamp };
})();
