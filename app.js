'use strict';

const DAY_HOURS = 24;
const STORE_KEY = 'timetrack.v1';
const DEFAULT_ID = 'default';
const PALETTE = [
  '#e5534b', '#f08c3a', '#e8b72f', '#57ab5a', '#2fa59a', '#3d8bd9',
  '#6c6fdc', '#a35bd6', '#d65ba8', '#8b6f5c', '#6e7781', '#2d3436',
];

// ---------- Данные ----------

function initialState() {
  return {
    defaultCat: { id: DEFAULT_ID, name: 'Прочее', color: '#b8b5ad' },
    categories: [
      { id: uid(), name: 'Работа', color: '#3d8bd9' },
      { id: uid(), name: 'Спорт', color: '#57ab5a' },
      { id: uid(), name: 'Отдых', color: '#e8b72f' },
      { id: uid(), name: 'Дорога', color: '#a35bd6' },
    ],
    entries: [],
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.entries) && Array.isArray(s.categories) && s.defaultCat) return s;
  } catch (e) { /* пусто или повреждено */ }
  return initialState();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* нет места */ }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let state = load();

function allCats() { return [...state.categories, state.defaultCat]; }
function catById(id) { return allCats().find(c => c.id === id) || state.defaultCat; }

// ---------- Даты ----------

function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function today() { return iso(new Date()); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function weekStart(s) { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); }

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function dayLabel(s) {
  const t = today();
  if (s === t) return 'Сегодня';
  if (s === addDays(t, -1)) return 'Вчера';
  const d = parse(s);
  const base = `${WDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
function weekLabel(ws) {
  const a = parse(ws), b = parse(addDays(ws, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

// ---------- Форматирование ----------

function fmtH(h) {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60), mm = total % 60;
  if (!mm) return `${hh} ч`;
  if (!hh) return `${mm} мин`;
  return `${hh} ч ${mm} мин`;
}
function fmtP(x) { return `${Math.round(x * 100)}%`; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = sel => document.querySelector(sel);

// ---------- Подсчёты ----------

function firstDate() {
  let min = null;
  for (const e of state.entries) if (!min || e.date < min) min = e.date;
  return min;
}

// Часы по категориям за день; остаток до суток уходит в категорию по умолчанию.
// Дни до первой записи и после сегодня не считаются.
function dayTotals(date, first = firstDate()) {
  const t = {};
  let sum = 0;
  for (const e of state.entries) {
    if (e.date !== date) continue;
    t[e.catId] = (t[e.catId] || 0) + e.hours;
    sum += e.hours;
  }
  const counted = first && date >= first && date <= today();
  if (counted && sum < DAY_HOURS) t[DEFAULT_ID] = (t[DEFAULT_ID] || 0) + DAY_HOURS - sum;
  return { totals: t, logged: sum, counted };
}

function merge(into, add) {
  for (const k in add) into[k] = (into[k] || 0) + add[k];
  return into;
}

function sortedParts(totals) {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const parts = Object.entries(totals)
    .filter(([, h]) => h > 0)
    .map(([id, h]) => ({ cat: catById(id), h, p: sum ? h / sum : 0 }))
    .sort((a, b) => (a.cat.id === DEFAULT_ID) - (b.cat.id === DEFAULT_ID) || b.h - a.h);
  return { parts, sum };
}

function barHTML(parts, scale) {
  return parts.map(x => `<i style="width:${(x.h / scale) * 100}%;background:${x.cat.color}"></i>`).join('');
}
function legendHTML(parts) {
  return `<div class="legend">${parts.map(x => `
    <div><span class="dot" style="--c:${x.cat.color}"></span>
    <span class="name">${esc(x.cat.name)}</span>
    <span class="h">${fmtH(x.h)}</span>
    <span class="p">${fmtP(x.p)}</span></div>`).join('')}</div>`;
}

// ---------- Экран добавления ----------

let selCat = null;
let entryDate = today();
let dateTouched = false;

function renderAdd() {
  if (!dateTouched) entryDate = today();
  if (selCat && !state.categories.some(c => c.id === selCat)) selCat = null;

  const chip = $('#date-chip');
  $('#date-label').textContent = dayLabel(entryDate);
  chip.classList.toggle('past', entryDate !== today());
  $('#date-input').value = entryDate;
  $('#date-input').max = today();

  const { logged } = dayTotals(entryDate);
  $('#day-sum').textContent = `${fmtH(logged)} из ${DAY_HOURS}`;
  const dayParts = state.entries.filter(e => e.date === entryDate).reduce((t, e) => merge(t, { [e.catId]: e.hours }), {});
  $('#day-strip').innerHTML = barHTML(sortedParts(dayParts).parts, Math.max(DAY_HOURS, logged));

  const grid = $('#cat-grid');
  grid.innerHTML = state.categories.map(c =>
    `<button type="button" class="cat-tile${c.id === selCat ? ' sel' : ''}" data-id="${c.id}" style="--c:${c.color}">${esc(c.name)}</button>`
  ).join('') + (state.categories.length ? '' : `<button type="button" class="cat-tile empty" data-new>+ Добавить категорию</button>`);

  const hours = $('#hours');
  const cat = selCat && catById(selCat);
  hours.classList.toggle('off', !cat);
  hours.classList.toggle('on', !!cat);
  hours.style.setProperty('--c', cat ? cat.color : '');
}

$('#cat-grid').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.new !== undefined) return openCatSheet(null);
  selCat = selCat === b.dataset.id ? null : b.dataset.id;
  renderAdd();
});

$('#hours').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && selCat) addEntry(Number(b.dataset.h));
});

$('#date-input').addEventListener('change', e => {
  if (!e.target.value) return;
  entryDate = e.target.value > today() ? today() : e.target.value;
  dateTouched = entryDate !== today();
  renderAdd();
});

$('#precise-toggle').addEventListener('click', () => {
  const row = $('#precise-row');
  row.hidden = !row.hidden;
  if (!row.hidden) $('#precise-h').focus();
});

$('#precise-add').addEventListener('click', () => {
  const h = (Number($('#precise-h').value) || 0) + (Number($('#precise-m').value) || 0) / 60;
  if (!selCat) return toast('Сначала выберите категорию');
  if (h <= 0) return;
  addEntry(Math.min(h, 24));
  $('#precise-h').value = '';
  $('#precise-m').value = '';
  $('#precise-row').hidden = true;
});

function addEntry(hours) {
  const entry = { id: uid(), catId: selCat, hours, date: entryDate, createdAt: Date.now() };
  state.entries.push(entry);
  save();
  if (navigator.vibrate) navigator.vibrate(10);
  const cat = catById(selCat);
  selCat = null;
  renderAdd();
  toast(`+${fmtH(hours)} · ${cat.name}`, 'Отменить', () => {
    state.entries = state.entries.filter(x => x.id !== entry.id);
    save();
    renderAll();
  });
}

// ---------- Список записей ----------

function renderList() {
  const list = $('#list');
  if (!state.entries.length) {
    list.innerHTML = `<div class="empty-state">Пока нет записей</div>`;
    return;
  }
  const byDate = {};
  for (const e of state.entries) (byDate[e.date] ||= []).push(e);
  list.innerHTML = Object.keys(byDate).sort().reverse().map(d => {
    const items = byDate[d].sort((a, b) => b.createdAt - a.createdAt);
    const sum = items.reduce((a, e) => a + e.hours, 0);
    return `<div class="day-group">
      <div class="day-head"><span>${dayLabel(d)}</span><span>${fmtH(sum)}</span></div>
      <div class="card">${items.map(e => {
        const c = catById(e.catId);
        return `<button type="button" class="row" data-id="${e.id}">
          <span class="dot" style="--c:${c.color}"></span>
          <span class="name">${esc(c.name)}</span>
          <span class="val">${fmtH(e.hours)}</span></button>`;
      }).join('')}</div></div>`;
  }).join('');
}

$('#list').addEventListener('click', e => {
  const b = e.target.closest('.row');
  if (b) openEntrySheet(b.dataset.id);
});

// ---------- Статистика ----------

let statsMode = 'days';
let statsWeek = weekStart(today());

function renderStats() {
  const el = $('#stats');
  const first = firstDate();
  if (!first) {
    el.innerHTML = `<div class="empty-state">Статистика появится после первой записи</div>`;
    return;
  }
  if (statsMode === 'days') renderDays(el, first);
  else renderWeeks(el, first);
}

function weekData(ws, first) {
  const days = [];
  const total = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const r = dayTotals(d, first);
    days.push({ date: d, ...r });
    merge(total, r.totals);
  }
  return { days, total };
}

function renderDays(el, first) {
  const curWeek = weekStart(today());
  const firstWeek = weekStart(first);
  if (statsWeek > curWeek) statsWeek = curWeek;
  if (statsWeek < firstWeek) statsWeek = firstWeek;

  const { days, total } = weekData(statsWeek, first);
  const { parts, sum } = sortedParts(total);

  el.innerHTML = `
    <div class="week-nav">
      <button type="button" data-step="-1" ${statsWeek <= firstWeek ? 'disabled' : ''} aria-label="Предыдущая неделя">‹</button>
      <span class="label">${weekLabel(statsWeek)}</span>
      <button type="button" data-step="1" ${statsWeek >= curWeek ? 'disabled' : ''} aria-label="Следующая неделя">›</button>
    </div>
    <div class="stat-card">
      <h3>За неделю <span>${fmtH(sum)}</span></h3>
      ${sum ? `<div class="bar">${barHTML(parts, sum)}</div>${legendHTML(parts)}` : '<div class="muted">Нет данных</div>'}
    </div>
    <div class="stat-card days">
      ${days.map(d => {
        const { parts: dp, sum: ds } = sortedParts(d.totals);
        const wd = WDAYS[parse(d.date).getDay()];
        return `<button type="button" class="day-row${d.counted ? '' : ' future'}" data-date="${d.date}">
          <div class="top"><span>${wd}, ${parse(d.date).getDate()} ${MONTHS[parse(d.date).getMonth()]}</span>
          <span class="muted">${d.counted ? `${fmtH(d.logged)} записано` : '—'}</span></div>
          <div class="bar">${barHTML(dp, Math.max(DAY_HOURS, ds))}</div>
          ${openDays.has(d.date) && ds ? legendHTML(dp) : ''}
        </button>`;
      }).join('')}
    </div>`;
}

const openDays = new Set();

function renderWeeks(el, first) {
  const weeks = [];
  for (let ws = weekStart(today()); ws >= weekStart(first); ws = addDays(ws, -7)) weeks.push(ws);
  el.innerHTML = weeks.map(ws => {
    const { total } = weekData(ws, first);
    const { parts, sum } = sortedParts(total);
    return `<div class="stat-card">
      <h3>${weekLabel(ws)} <span>${fmtH(sum)}</span></h3>
      <div class="bar">${barHTML(parts, sum)}</div>
      ${legendHTML(parts)}
    </div>`;
  }).join('');
}

$('#stats').addEventListener('click', e => {
  const step = e.target.closest('[data-step]');
  if (step) {
    statsWeek = addDays(statsWeek, 7 * Number(step.dataset.step));
    return renderStats();
  }
  const row = e.target.closest('.day-row');
  if (row) {
    const d = row.dataset.date;
    openDays.has(d) ? openDays.delete(d) : openDays.add(d);
    renderStats();
  }
});

document.querySelector('.seg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  statsMode = b.dataset.mode;
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  renderStats();
});

// ---------- Категории ----------

function renderCats() {
  const counts = {};
  for (const e of state.entries) counts[e.catId] = (counts[e.catId] || 0) + 1;
  const row = (c, extra = '') => `<button type="button" class="row" data-id="${c.id}">
    <span class="dot" style="--c:${c.color}"></span>
    <span class="name">${esc(c.name)}</span>${extra}
    <span class="val">${counts[c.id] ? counts[c.id] : ''}</span></button>`;
  $('#cat-list').innerHTML = `
    <div class="card">${state.categories.map(c => row(c)).join('') || '<div class="row muted">Нет категорий</div>'}</div>
    <div class="card" style="margin-top:12px">${row(state.defaultCat, '<span class="tag">по умолчанию</span>')}</div>`;
}

$('#cat-list').addEventListener('click', e => {
  const b = e.target.closest('.row[data-id]');
  if (b) openCatSheet(b.dataset.id);
});
$('#cat-new').addEventListener('click', () => openCatSheet(null));

// ---------- Шторки ----------

function openSheet(html, bind) {
  // Свежий контейнер на каждое открытие, чтобы обработчики прошлых шторок не копились.
  const sheet = $('#sheet');
  const body = document.createElement('div');
  body.innerHTML = html;
  sheet.replaceChildren(body);
  sheet.hidden = false;
  $('#sheet-backdrop').hidden = false;
  bind(body);
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  $('#sheet').innerHTML = '';
}
$('#sheet-backdrop').addEventListener('click', closeSheet);

function openEntrySheet(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  let catId = entry.catId;
  let hours = entry.hours;

  const cats = catById(catId).id === DEFAULT_ID ? allCats() : state.categories;
  openSheet(`
    <h2>Запись</h2>
    <label class="f">Категория</label>
    <div class="chips">${cats.map(c =>
      `<button type="button" class="chip${c.id === catId ? ' sel' : ''}" data-cat="${c.id}" style="--c:${c.color}">
        <span class="dot"></span>${esc(c.name)}</button>`).join('')}</div>
    <label class="f">Часы</label>
    <div class="hours">${[1, 2, 3, 4, 5, 6, 7, 8].map(h => `<button type="button" data-h="${h}">${h}</button>`).join('')}</div>
    <div class="time-row">
      <input type="number" inputmode="numeric" min="0" max="24" data-t="h" aria-label="Часы"> ч
      <input type="number" inputmode="numeric" min="0" max="59" step="5" data-t="m" aria-label="Минуты"> мин
    </div>
    <label class="f">Дата</label>
    <input class="text" type="date" data-t="date" value="${entry.date}" max="${today()}">
    <div class="actions">
      <button type="button" class="btn danger" data-act="del">Удалить</button>
      <button type="button" class="btn" data-act="save">Сохранить</button>
    </div>`, sheet => {
    const hIn = sheet.querySelector('[data-t="h"]');
    const mIn = sheet.querySelector('[data-t="m"]');
    const sync = () => {
      const total = Math.round(hours * 60);
      hIn.value = Math.floor(total / 60);
      mIn.value = total % 60;
      sheet.querySelectorAll('.hours button').forEach(b => b.classList.toggle('sel', Number(b.dataset.h) === hours));
    };
    sync();

    sheet.addEventListener('click', e => {
      const chip = e.target.closest('[data-cat]');
      if (chip) {
        catId = chip.dataset.cat;
        sheet.querySelectorAll('.chip').forEach(c => c.classList.toggle('sel', c === chip));
      }
      const hb = e.target.closest('.hours button');
      if (hb) { hours = Number(hb.dataset.h); sync(); }
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'del') {
        const idx = state.entries.indexOf(entry);
        state.entries.splice(idx, 1);
        save();
        closeSheet();
        renderAll();
        toast('Запись удалена', 'Вернуть', () => {
          state.entries.splice(idx, 0, entry);
          save();
          renderAll();
        });
      } else if (act?.dataset.act === 'save') {
        if (hours <= 0) return;
        const date = sheet.querySelector('[data-t="date"]').value;
        entry.catId = catId;
        entry.hours = hours;
        if (date) entry.date = date;
        save();
        closeSheet();
        renderAll();
      }
    });
    const onTime = () => {
      hours = (Number(hIn.value) || 0) + (Number(mIn.value) || 0) / 60;
      sheet.querySelectorAll('.hours button').forEach(b => b.classList.toggle('sel', Number(b.dataset.h) === hours));
    };
    hIn.addEventListener('input', onTime);
    mIn.addEventListener('input', onTime);
  });
}

function openCatSheet(id) {
  const isDefault = id === DEFAULT_ID;
  const existing = id ? catById(id) : null;
  let color = existing ? existing.color : PALETTE.find(p => !state.categories.some(c => c.color === p)) || PALETTE[0];

  openSheet(`
    <h2>${existing ? (isDefault ? 'Категория по умолчанию' : 'Категория') : 'Новая категория'}</h2>
    ${isDefault ? '<p class="muted" style="margin-top:-8px;font-size:14px">Сюда уходит остаток суток до ' + DAY_HOURS + ' часов.</p>' : ''}
    <label class="f">Название</label>
    <input class="text" type="text" maxlength="40" data-t="name" value="${existing ? esc(existing.name) : ''}" placeholder="Например, Учёба">
    <label class="f">Цвет</label>
    <div class="swatches">
      ${PALETTE.map(p => `<button type="button" class="swatch" data-color="${p}" style="--c:${p}" aria-label="${p}"></button>`).join('')}
    </div>
    <div class="time-row">
      <span>Свой цвет</span>
      <span class="swatch custom" style="width:36px"><input type="color" data-t="color" value="${color}"></span>
    </div>
    <div class="actions">
      ${existing && !isDefault ? '<button type="button" class="btn danger" data-act="del">Удалить</button>' : ''}
      <button type="button" class="btn" data-act="save">${existing ? 'Сохранить' : 'Создать'}</button>
    </div>`, sheet => {
    const nameIn = sheet.querySelector('[data-t="name"]');
    const sync = () => sheet.querySelectorAll('.swatch[data-color]').forEach(s =>
      s.classList.toggle('sel', s.dataset.color.toLowerCase() === color.toLowerCase()));
    sync();
    if (!existing) setTimeout(() => nameIn.focus(), 250);

    sheet.querySelector('[data-t="color"]').addEventListener('input', e => { color = e.target.value; sync(); });
    sheet.addEventListener('click', e => {
      const sw = e.target.closest('.swatch[data-color]');
      if (sw) { color = sw.dataset.color; sync(); }
      const act = e.target.closest('[data-act]');
      if (act?.dataset.act === 'save') {
        const name = nameIn.value.trim();
        if (!name) return nameIn.focus();
        if (existing) Object.assign(existing, { name, color });
        else state.categories.push({ id: uid(), name, color });
        save();
        closeSheet();
        renderAll();
      } else if (act?.dataset.act === 'del') {
        const n = state.entries.filter(x => x.catId === id).length;
        const msg = n
          ? `Удалить «${existing.name}»? ${n} зап. перейдут в «${state.defaultCat.name}».`
          : `Удалить «${existing.name}»?`;
        if (!confirm(msg)) return;
        state.entries.forEach(x => { if (x.catId === id) x.catId = DEFAULT_ID; });
        state.categories = state.categories.filter(c => c.id !== id);
        save();
        closeSheet();
        renderAll();
      }
    });
  });
}

// ---------- Тост ----------

let toastTimer;
function toast(text, actionLabel, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  t.hidden = false;
  if (actionLabel) t.querySelector('button').onclick = () => { action(); t.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- Резервная копия ----------

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `timetrack-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!s || !Array.isArray(s.entries) || !Array.isArray(s.categories) || !s.defaultCat) throw new Error();
    if (!confirm('Заменить текущие данные данными из файла?')) return;
    state = s;
    save();
    renderAll();
    toast('Данные загружены');
  } catch (err) {
    toast('Не удалось прочитать файл');
  }
});

// ---------- Навигация ----------

function renderAll() {
  renderAdd();
  renderList();
  renderStats();
  renderCats();
}

document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${b.dataset.view}`));
  if (b.dataset.view === 'add') { dateTouched = false; selCat = null; }
  if (b.dataset.view === 'stats') statsWeek = weekStart(today());
  renderAll();
  window.scrollTo(0, 0);
});

// Вернулись в приложение (например, на следующий день) — дата снова «сегодня».
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { dateTouched = false; renderAll(); }
});

renderAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
