// The screen: tabs, checklists, the editor sheets, Mention / Handover / History, and Codes.
// All state rules live in store.js; the encrypted codes in vault.js; photos in photos.js.

import {
  load, save, rollover, normalise, normaliseTask, weekday, isDue, isLate, isSkipped, DAYS, uid,
  stepsFromText, progress, move, summariseList, snapshot, handoverText, prettyDate, photoIds,
  normaliseLink, HOW_URL, normaliseMemo, HANDOVER_PARTS, normaliseDelivery, dueDeliveries, isOverdue, summariseDeliveries, arrivalFor, normaliseArrival, deliveryStatus,
} from './store.js';
import * as vault from './vault.js';
import * as photos from './photos.js';

const $ = (s) => document.querySelector(s);

// Tiny DOM builder. User text always goes in as text nodes, never as HTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const SPECIAL = [
  ['#deliveries', 'Deliveries', 'Deliveries'],
  ['#mention', 'Mention', 'Things to mention'],
  ['#handover', 'Handover', 'Handover'],
  ['#history', 'History', 'History'],
  ['#how', 'How', 'How do I'],
  ['#codes', 'Codes', 'Codes'],
  ['#memos', 'Voice memos', 'Voice memos'],
  ['#notes', 'My notes', 'My notes'],
  ['#more', 'More', 'More'],
];

// The pages reached from More, with the line shown under each on that page.
const MORE_PAGES = [
  ['#notes', 'My notes', 'Private notes, never in the handover'],
  ['#memos', 'Voice memos', 'Record by voice with a transcript, plus your notes'],
  ['#history', 'History', 'What was done on past days'],
  ['#how', 'How do I', 'Open how.coop.co.uk and your shortcuts'],
  ['#codes', 'Codes', 'Door codes, logins and passwords'],
];
const inMore = (id) => MORE_PAGES.some((p) => p[0] === id);

// Bottom bar icons (static artwork, never user text).
const ICONS = {
  lists: 'M4 6.5l2 2 3.5-4M4 15.5l2 2 3.5-4M13 7h7M13 16h7',
  deliveries: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7zM6.5 19.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  mention: 'M4 5h16v11H10l-5 4v-4H4z',
  handover: 'M6 3h9l4 4v14H6zM9.5 12h6M9.5 16h6M9.5 8h3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
function icon(name) {
  const el = document.createElement('span');
  el.className = `ico ico-${name}`;
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  return el;
}

let state = load();
save(state);
let tab = localStorage.getItem('shiftlist.tab');
let editing = false;
let dragging = false;
let lastList = null; // the list the handover is written for
const expanded = new Set(); // task ids showing their steps
const revealed = new Set(); // code ids showing their value

const currentList = () => state.lists.find((l) => l.id === tab) || null;
const isSpecial = (id) => SPECIAL.some((s) => s[0] === id);

const persist = () => save(state) || toast('Could not save: phone storage is full');

// For typing: saves shortly after the last keystroke instead of on every one.
let saveTimer = 0;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

function commit() {
  persist();
  render();
}

/* ---------- toast (with optional Undo) + sheets ---------- */

let toastTimer = 0;
function toast(text, actionLabel, action) {
  const el = $('#toast');
  el.replaceChildren(h('span', {}, text));
  if (action) {
    el.append(h('button', { type: 'button', onclick: () => { el.classList.remove('show'); action(); } }, actionLabel));
  }
  el.classList.toggle('action', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2400);
}

// Runs a change, then offers to put everything back exactly as it was.
function withUndo(label, change) {
  const before = JSON.stringify(state);
  change();
  commit();
  toast(label, 'Undo', () => {
    state = normalise(JSON.parse(before));
    commit();
  });
}

const sheet = $('#sheet');
let onSheetClose = null;
sheet.addEventListener('close', () => {
  const fn = onSheetClose;
  onSheetClose = null;
  if (fn) fn();
});

function openSheet(title, ...kids) {
  sheet.replaceChildren(
    h('form', { class: 'sheet', onsubmit: (e) => e.preventDefault() }, h('h2', {}, title), kids),
  );
  if (!sheet.open) sheet.showModal();
}
const closeSheet = () => sheet.open && sheet.close();

const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick }, label);
const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);

// Resolves true / false.
function confirmSheet(title, body, okLabel, danger = true) {
  return new Promise((resolve) => {
    let answer = false;
    onSheetClose = () => resolve(answer);
    openSheet(
      title,
      body && h('p', { class: 'muted' }, body),
      h('div', { class: 'actions' },
        btn('Cancel', closeSheet),
        btn(okLabel, () => { answer = true; closeSheet(); }, danger ? 'danger' : 'primary')),
    );
  });
}

// Resolves the text, or null if cancelled.
function askText(title, label, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    let answer = null;
    const input = h('input', { type: 'text', value, autocomplete: 'off', maxLength: 60 });
    const ok = () => {
      if (!input.value.trim()) return input.focus();
      answer = input.value.trim();
      closeSheet();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
    onSheetClose = () => resolve(answer);
    openSheet(title, field(label, input), h('div', { class: 'actions' }, btn('Cancel', closeSheet), btn(okLabel, ok, 'primary')));
    input.focus();
  });
}

// A delete button that needs a second tap (for things Undo cannot bring back).
function deleteButton(label, fn) {
  let armed = false;
  const b = btn(label, () => {
    if (armed) return fn();
    armed = true;
    b.textContent = 'Tap again to delete';
    setTimeout(() => { armed = false; b.textContent = label; }, 3000);
  }, 'danger ghost');
  return b;
}

/* ---------- header + tabs ---------- */

// Every change of page goes through here.
function go(id) {
  if (rec) stopRecording();
  if (tab === '#codes' && id !== tab) revealed.clear();
  tab = id;
  editing = false;
  render();
  window.scrollTo(0, 0);
}

function renderTop() {
  const list = currentList();
  const title = list ? list.name : SPECIAL.find((s) => s[0] === tab)[2];
  let sub = prettyDate(state.ticks.date);
  if (list) {
    const p = progress(list, state.ticks, weekday());
    if (p.total) sub += ` · ${p.done} of ${p.total} done`;
  }
  const canEdit = list || (tab === '#codes' && vault.status() === 'open');
  $('#top').replaceChildren(...[
    inMore(tab) && h('button', { type: 'button', class: 'chip back', 'aria-label': 'Back to More', onclick: () => go('#more') }, '‹'),
    h('div', { class: 'heading' }, h('h1', {}, title), h('p', {}, sub)),
    canEdit && h('button', { type: 'button', class: `chip${editing ? ' on' : ''}`, 'aria-pressed': String(editing), onclick: () => { editing = !editing; render(); } }, editing ? 'Done' : 'Edit'),
    h('button', { type: 'button', class: 'chip', 'aria-label': 'More options', onclick: openMenu }, '⋮'),
  ].filter(Boolean));
}

// Five fixed places. The checklists share one (switch between them at the top of the list);
// Voice memos, History, How and Codes live under More.
function renderTabs() {
  const wd = weekday();
  const list = currentList() || state.lists.find((l) => l.id === lastList) || state.lists[0];
  const listCount = () => {
    if (!list) return '';
    const p = progress(list, state.ticks, wd);
    return p.total ? `${p.done}/${p.total}` : '';
  };
  const deliveryCount = () => {
    const rows = summariseDeliveries(state.deliveries, state.ticks, wd);
    return rows.length ? `${rows.filter((d) => d.at).length}/${rows.length}` : '';
  };
  const items = [
    ['lists', 'Checklist', list ? list.id : '#more', !!currentList(), listCount()],
    ['deliveries', 'Deliveries', '#deliveries', tab === '#deliveries', deliveryCount()],
    ['mention', 'Mention', '#mention', tab === '#mention', state.mentions.length ? String(state.mentions.length) : ''],
    ['handover', 'Handover', '#handover', tab === '#handover', ''],
    ['more', 'More', '#more', tab === '#more' || inMore(tab), ''],
  ];
  $('#tabs').replaceChildren(...items.map(([ico, name, target, on, count]) =>
    h('button', { type: 'button', class: `tab${on ? ' on' : ''}`, 'aria-current': on ? 'page' : null, onclick: () => go(target) },
      icon(ico), h('b', {}, name), count && h('span', { class: 'count' }, count))));
}

/* ---------- checklists ---------- */

const isFinished = (t) => !!state.ticks.done[t.id] || isSkipped(t, state.ticks);

function isVisible(t) {
  if (editing) return true;
  if (!isDue(t, weekday())) return false;
  return !(state.settings.hideDone && isFinished(t));
}

// After a tick only the card that changed is redrawn, plus the counters. No full re-render.
function refreshTask(list, t) {
  persist();
  const view = $('#view');
  const old = view.querySelector(`.task[data-id="${t.id}"]`);
  if (!old) return render();
  if (isVisible(t)) old.replaceWith(taskCard(list, t));
  else old.remove();
  const p = progress(list, state.ticks, weekday());
  const bar = view.querySelector('.bar');
  if (bar) {
    bar.setAttribute('aria-valuenow', p.done);
    bar.firstChild.style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
  }
  const toggle = view.querySelector('.hidetoggle');
  if (toggle) toggle.replaceWith(hideToggle(list));
  const chips = view.querySelector('.listchips');
  if (chips) chips.replaceWith(listChips());
  renderTop();
  renderTabs();
}

function toggleTask(list, t, on) {
  const done = state.ticks.done;
  if (on) done[t.id] = Date.now();
  else delete done[t.id];
  refreshTask(list, t);
  if (!on) return;
  const p = progress(list, state.ticks, weekday());
  if (state.settings.hideDone) {
    toast(p.done === p.total ? `${list.name}: all done` : `Done: ${t.title}`, 'Undo', () => { delete done[t.id]; commit(); });
  } else if (p.done === p.total) {
    toast(`${list.name}: all done`);
  }
}

function toggleStep(list, t, s, on) {
  const done = state.ticks.done;
  if (on) done[s.id] = Date.now();
  else delete done[s.id];
  const finishes = on && !done[t.id] && t.steps.every((x) => done[x.id]);
  if (finishes) return toggleTask(list, t, true);
  refreshTask(list, t);
}

function skipTask(t) {
  withUndo(`Skipped for today: ${t.title}`, () => {
    state.ticks.skipped[t.id] = true;
    expanded.delete(t.id);
  });
}

// Finger-drag on the handle (edit mode). Cards swap as the dragged one passes their middle.
function startDrag(e, list, card) {
  if (e.button > 0) return;
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  dragging = true;
  card.classList.add('dragging');
  const GAP = 10;
  let startY = e.clientY;
  let lastY = e.clientY;
  let raf = 0;
  const place = () => { card.style.transform = `translateY(${lastY - startY}px)`; };
  const isCard = (el) => el && el.classList.contains('task');

  const settle = () => {
    for (let guard = 0; guard < 50; guard++) {
      const r = card.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const next = card.nextElementSibling;
      const prev = card.previousElementSibling;
      if (isCard(next)) {
        const nr = next.getBoundingClientRect();
        if (mid > nr.top + nr.height / 2) { next.after(card); startY += nr.height + GAP; place(); continue; }
      }
      if (isCard(prev)) {
        const pr = prev.getBoundingClientRect();
        if (mid < pr.top + pr.height / 2) { prev.before(card); startY -= pr.height + GAP; place(); continue; }
      }
      break;
    }
  };

  // Scroll the page when the finger is near the top or bottom.
  const autoScroll = () => {
    const top = $('#top').offsetHeight + 60;
    const bottom = window.innerHeight - $('#tabs').offsetHeight - 60;
    const dy = lastY < top ? -12 : lastY > bottom ? 12 : 0;
    if (dy) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      const moved = window.scrollY - before;
      if (moved) { startY -= moved; place(); settle(); }
    }
    raf = requestAnimationFrame(autoScroll);
  };

  const onMove = (ev) => { lastY = ev.clientY; place(); settle(); };
  const onEnd = () => {
    cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
    dragging = false;
    const order = [...$('#view').querySelectorAll('.task')].map((c) => c.dataset.id);
    list.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    commit();
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);
  raf = requestAnimationFrame(autoScroll);
}

const INPUT_KINDS = [['number', 'Number'], ['counter', 'Tap counter'], ['text', 'Text'], ['time', 'Time'], ['deliveries', 'Deliveries link']];

// The boxes a task asks you to fill in on the day. They sit on the card, always visible, and
// save as you type without redrawing anything (so the keyboard stays up).
function inputsBlock(t) {
  const values = state.ticks.values;
  const set = (i, v) => {
    if (v === '' || v == null) delete values[i.id];
    else values[i.id] = v;
    persistSoon();
  };
  return h('div', { class: 'inputs' }, t.inputs.map((i) => {
    if (i.type === 'counter') {
      const out = h('output', { class: 'count' }, String(values[i.id] || 0));
      const bump = (by) => {
        const n = Math.max(0, (Number(values[i.id]) || 0) + by);
        set(i, n || '');
        out.textContent = String(n);
        if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(10);
      };
      return h('div', { class: 'input counter' },
        h('span', { class: 'lbl' }, i.label),
        h('button', { type: 'button', class: 'minus', 'aria-label': `One fewer: ${i.label}`, onclick: () => bump(-1) }, '−'),
        out,
        h('button', { type: 'button', class: 'plus', 'aria-label': `Add one: ${i.label}`, onclick: () => bump(1) }, '+1'));
    }
    if (i.type === 'deliveries') {
      const rows = summariseDeliveries(state.deliveries, state.ticks, weekday());
      const inn = rows.filter((d) => d.at);
      return h('div', { class: 'input jump' },
        h('span', { class: 'lbl' }, rows.length ? `${inn.length} of ${rows.length} in, temps done on ${inn.filter((d) => d.temps).length}` : 'No deliveries logged yet'),
        btn('Log deliveries', () => { tab = '#deliveries'; render(); window.scrollTo(0, 0); }, 'small outline'));
    }
    if (i.type === 'text') {
      return h('label', { class: 'input text' }, h('span', { class: 'lbl' }, i.label),
        h('textarea', { rows: 2, value: values[i.id] || '', oninput: (e) => set(i, e.target.value) }));
    }
    return h('label', { class: 'input' }, h('span', { class: 'lbl' }, i.label),
      h('input', i.type === 'time'
        ? { type: 'time', value: values[i.id] || '', oninput: (e) => set(i, e.target.value) }
        : { type: 'number', inputMode: 'numeric', min: 0, value: values[i.id] ?? '', oninput: (e) => set(i, e.target.value) }));
  }));
}

function taskCard(list, t) {
  const done = state.ticks.done;
  const index = list.tasks.indexOf(t);
  const isDone = !!done[t.id];
  const skipped = isSkipped(t, state.ticks);
  const due = isDue(t, weekday());
  const stepsDone = t.steps.filter((s) => done[s.id]).length;
  const isOpen = expanded.has(t.id) && !editing;

  const badges = [];
  if (skipped) badges.push(h('span', { class: 'badge' }, 'skipped today'));
  if (t.optional) badges.push(h('span', { class: 'badge' }, 'if needed'));
  if (t.by) badges.push(h('span', { class: `badge${!isDone && !skipped && due && isLate(t) ? ' late' : ''}` }, `by ${t.by}`));
  if (t.days.length) badges.push(h('span', { class: 'badge' }, t.days.map((d) => DAYS[d]).join(' ')));
  if (t.steps.length) badges.push(h('span', { class: 'badge' }, `${stepsDone}/${t.steps.length} steps`));

  const onBody = () => {
    if (editing) return editTask(list, t);
    if (expanded.has(t.id)) expanded.delete(t.id);
    else expanded.add(t.id);
    card.replaceWith(taskCard(list, t));
  };

  const card = h('article', { class: `task${isDone ? ' done' : ''}${skipped ? ' skipped' : ''}${due ? '' : ' off'}`, 'data-id': t.id },
    h('div', { class: 'row' },
      editing
        ? h('button', { type: 'button', class: 'handle', 'aria-label': `Drag to reorder ${t.title}`, onpointerdown: (e) => startDrag(e, list, card) }, '⠿')
        : h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: isDone, 'aria-label': `Done: ${t.title}`, onchange: (e) => toggleTask(list, t, e.target.checked) }),
          h('span', {})),
      h('button', { type: 'button', class: 'body', 'aria-expanded': editing ? null : String(isOpen), onclick: onBody },
        h('span', { class: 'title' }, t.title),
        badges.length > 0 && h('span', { class: 'meta' }, badges)),
      editing
        ? h('div', { class: 'tools' },
          h('button', { type: 'button', 'aria-label': `Move ${t.title} up`, disabled: index === 0, onclick: () => { move(list.tasks, index, -1); commit(); } }, '↑'),
          h('button', { type: 'button', 'aria-label': `Move ${t.title} down`, disabled: index === list.tasks.length - 1, onclick: () => { move(list.tasks, index, 1); commit(); } }, '↓'))
        : h('span', { class: 'chev', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸')),
    !editing && t.inputs.length > 0 && inputsBlock(t),
    isOpen && h('div', { class: 'more' },
      t.note && h('p', { class: 'note' }, t.note),
      t.steps.length > 0 && h('ul', { class: 'steps' }, t.steps.map((s) =>
        h('li', {}, h('label', { class: `step${done[s.id] ? ' done' : ''}` },
          h('input', { type: 'checkbox', checked: !!done[s.id], onchange: (e) => toggleStep(list, t, s, e.target.checked) }),
          h('span', {}, s.text))))),
      !isDone && h('div', { class: 'cardactions' },
        skipped
          ? btn('Bring back', () => { delete state.ticks.skipped[t.id]; commit(); }, 'small')
          : btn('Skip for today', () => skipTask(t), 'small'))),
  );
  return card;
}

// Morning / Evening / … switcher at the top of a checklist.
function listChips() {
  const wd = weekday();
  return h('div', { class: 'listchips', role: 'tablist', 'aria-label': 'Checklists' }, state.lists.map((l) => {
    const p = progress(l, state.ticks, wd);
    return h('button', {
      type: 'button', role: 'tab', class: `chip${l.id === tab ? ' on' : ''}`, 'aria-selected': String(l.id === tab),
      onclick: () => go(l.id),
    }, l.name, p.total > 0 && h('small', {}, `${p.done}/${p.total}`));
  }));
}

function hideToggle(list) {
  const wd = weekday();
  const finished = list.tasks.filter((t) => isDue(t, wd) && isFinished(t)).length;
  const hide = state.settings.hideDone;
  return h('div', { class: 'hidetoggle' },
    (hide || finished > 0) && h('button', {
      type: 'button', class: 'link', 'aria-pressed': String(hide),
      onclick: () => { state.settings.hideDone = !hide; commit(); },
    }, hide ? `Show completed (${finished})` : 'Hide completed'));
}

function listView(list) {
  const wd = weekday();
  const p = progress(list, state.ticks, wd);
  const off = list.tasks.filter((t) => !isDue(t, wd));
  const out = [];
  if (p.total) {
    out.push(h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${list.name} progress`, 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.done },
      h('i', { style: `width:${(p.done / p.total) * 100}%` })));
  }
  if (editing) out.push(h('p', { class: 'hint' }, 'Tap a task to change it. Drag the handle or use the arrows to reorder.'));
  else out.push(hideToggle(list));
  if (!list.tasks.length) out.push(h('p', { class: 'empty' }, `Nothing in ${list.name} yet. Add your first task below.`));
  if (state.lists.length > 1) out.unshift(listChips());
  for (const t of list.tasks) if (isVisible(t)) out.push(taskCard(list, t));
  if (!editing && off.length) {
    out.push(h('p', { class: 'hint' }, `Not today: ${off.map((t) => `${t.title} (${t.days.map((d) => DAYS[d]).join(' ')})`).join(', ')}`));
  }
  out.push(btn('+ Add a task', () => editTask(list, null), 'add'));
  return out;
}

// Weekday chips that add to / remove from the given Set. None picked means every day.
function dayPicker(days) {
  return h('div', { class: 'field' }, h('span', {}, 'Only on these days (none picked = every day)'),
    h('div', { class: 'chips' }, DAYS.map((name, d) => {
      const chip = h('button', { type: 'button', class: `chip${days.has(d) ? ' on' : ''}`, 'aria-pressed': String(days.has(d)) }, name);
      chip.addEventListener('click', () => {
        if (days.has(d)) days.delete(d);
        else days.add(d);
        chip.classList.toggle('on', days.has(d));
        chip.setAttribute('aria-pressed', String(days.has(d)));
      });
      return chip;
    })));
}

function editTask(list, t) {
  const isNew = !t;
  const days = new Set(t ? t.days : []);
  const title = h('input', { type: 'text', value: t ? t.title : '', autocomplete: 'off', maxLength: 120, placeholder: 'What needs doing' });
  const steps = h('textarea', { rows: 5, value: t ? t.steps.map((s) => s.text).join('\n') : '', placeholder: 'One step per line (optional)' });
  const note = h('textarea', { rows: 2, value: t ? t.note : '', placeholder: 'Anything to remember (optional)' });
  const by = h('input', { type: 'time', value: t ? t.by : '' });

  const optional = h('input', { type: 'checkbox', checked: !!(t && t.optional) });
  const inputRows = h('div', { class: 'inputrows' });
  const addInputRow = (i = { label: '', type: 'number' }) => {
    const label = h('input', { type: 'text', value: i.label, autocomplete: 'off', maxLength: 40, placeholder: 'What to fill in', 'aria-label': 'Box name' });
    const type = h('select', { 'aria-label': 'Box type' }, INPUT_KINDS.map(([v, name]) => h('option', { value: v, selected: v === i.type }, name)));
    const row = h('div', { class: 'inline inputrow' }, label, type,
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Remove this box', onclick: () => row.remove() }, '×'));
    row.read = () => ({ id: i.id, label: label.value.trim(), type: type.value });
    inputRows.append(row);
    return label;
  };
  (t ? t.inputs : []).forEach((i) => addInputRow(i));

  const saveTask = () => {
    if (!title.value.trim()) return title.focus();
    const next = normaliseTask({
      id: t ? t.id : uid(),
      title: title.value,
      note: note.value.trim(),
      steps: stepsFromText(steps.value, t ? t.steps : []),
      days: [...days],
      by: by.value,
      inputs: [...inputRows.children].map((row) => row.read()),
      optional: optional.checked,
    });
    if (isNew) list.tasks.push(next);
    else Object.assign(t, next);
    closeSheet();
    commit();
  };

  openSheet(
    isNew ? `New task in ${list.name}` : 'Edit task',
    field('Task', title),
    field('Steps', steps),
    field('Note', note),
    h('div', { class: 'field' }, h('span', {}, 'Boxes to fill in on the day (optional)'), inputRows,
      btn('+ Add a box', () => addInputRow().focus(), 'ghost')),
    h('label', { class: 'tickrow' }, optional, h('span', {}, 'Only if needed: do not count it or report it as not done')),
    dayPicker(days),
    h('div', { class: 'field' }, h('span', {}, 'Finish by (optional)'),
      h('div', { class: 'inline' }, by, btn('Clear', () => { by.value = ''; }, 'ghost'))),
    h('div', { class: 'actions' },
      !isNew && btn('Delete', () => {
        closeSheet();
        withUndo(`Deleted: ${t.title}`, () => list.tasks.splice(list.tasks.indexOf(t), 1));
      }, 'danger ghost'),
      btn('Cancel', closeSheet),
      btn('Save', saveTask, 'primary')),
  );
  if (isNew) title.focus();
}

/* ---------- deliveries ---------- */

function deliveriesView() {
  const wd = weekday();
  const ticks = state.ticks;
  const today = dueDeliveries(state.deliveries, wd);
  const other = state.deliveries.filter((d) => !isDue(d, wd));
  const extras = ticks.arrivals.filter((a) => !a.deliveryId || !state.deliveries.some((d) => d.id === a.deliveryId));
  const next = today.find((d) => !arrivalFor(d, ticks) && d.time && !isOverdue(d, ticks));
  const dayNames = (d) => d.days.map((x) => DAYS[x]).join(' ');

  // What gets filled in once a delivery is in: when, how many cages, and whether temps are done.
  const arrivalFields = (a) => {
    const tempsLabel = () => (a.temps ? '✓ Temps done' : 'Temps done?');
    const temps = h('button', {
      type: 'button', class: `btn small temps${a.temps ? ' on' : ''}`, 'aria-pressed': String(a.temps),
      onclick: () => {
        a.temps = !a.temps;
        persist();
        temps.classList.toggle('on', a.temps);
        temps.setAttribute('aria-pressed', String(a.temps));
        temps.textContent = tempsLabel();
      },
    }, tempsLabel());
    return h('div', { class: 'inputs arrival' },
      h('label', { class: 'input' }, h('span', { class: 'lbl' }, 'Arrived at'),
        h('input', { type: 'time', value: a.at, oninput: (e) => { if (e.target.value) { a.at = e.target.value; persistSoon(); } } })),
      h('label', { class: 'input' }, h('span', { class: 'lbl' }, 'Cages'),
        h('input', {
          type: 'number', inputMode: 'numeric', min: 0, value: a.cages,
          oninput: (e) => { a.cages = e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value) || 0)); persistSoon(); },
        })),
      h('div', { class: 'input wide' }, temps,
        btn('Remove', () => withUndo('Arrival removed', () => state.ticks.arrivals.splice(state.ticks.arrivals.indexOf(a), 1)), 'small ghost')));
  };

  // A delivery from the schedule.
  const card = (d, due) => {
    const a = due ? arrivalFor(d, ticks) : null;
    const badges = [];
    if (a) badges.push(h('span', { class: 'badge in' }, 'arrived'));
    else if (due && isOverdue(d, ticks)) badges.push(h('span', { class: 'badge late' }, 'not arrived yet'));
    else if (due && d === next) badges.push(h('span', { class: 'badge next' }, 'next'));
    if (d.days.length) badges.push(h('span', { class: 'badge' }, dayNames(d)));
    return h('article', { class: `task delivery${a ? ' arrived' : ''}${due ? '' : ' off'}` },
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'body', 'aria-label': `Edit ${d.name} in the schedule`, onclick: () => editDelivery(d) },
          h('span', { class: 'title' }, d.name),
          badges.length > 0 && h('span', { class: 'meta' }, badges),
          d.note && h('span', { class: 'note' }, d.note)),
        h('span', { class: 'when' }, h('small', {}, 'due'), d.time || '--:--'),
        due && !a && h('div', { class: 'tools' },
          h('button', { type: 'button', class: 'word arrive', onclick: () => { ticks.arrivals.push(normaliseArrival({ deliveryId: d.id })); commit(); } }, 'Arrived'))),
      a && arrivalFields(a));
  };

  // A delivery that was not on the schedule: it carries its own type.
  const extraCard = (a) => {
    const type = h('input', {
      type: 'text', value: a.name, autocomplete: 'off', maxLength: 40, placeholder: 'Chilled, frozen, bread…',
      oninput: (e) => { a.name = e.target.value; persistSoon(); },
    });
    type.setAttribute('list', 'delivery-types');
    return h('article', { class: 'task delivery arrived extra', 'data-arrival': a.id },
      h('div', { class: 'inputs' }, h('label', { class: 'input wide' }, h('span', { class: 'lbl' }, 'Type'), type)),
      arrivalFields(a));
  };

  const nothing = !state.deliveries.length && !extras.length;
  return [
    h('datalist', { id: 'delivery-types' }, [...new Set(state.deliveries.map((d) => d.name))].map((n) => h('option', { value: n }))),
    nothing && h('p', { class: 'empty' }, 'No deliveries yet. Log one as it arrives, or add your regular deliveries to the schedule so they are listed each day with the time they are due.'),
    ...today.map((d) => card(d, true)),
    ...extras.map(extraCard),
    btn('+ Log a delivery that arrived', () => {
      const a = normaliseArrival({});
      ticks.arrivals.push(a);
      commit();
      $(`[data-arrival="${a.id}"] input[type="text"]`)?.focus();
    }, 'primary'),
    btn('+ Add a regular delivery to the schedule', () => editDelivery(null), 'add'),
    other.length > 0 && h('p', { class: 'hint' }, 'Other days'),
    ...other.sort((x, y) => (x.time || '99').localeCompare(y.time || '99')).map((d) => card(d, false)),
    !nothing && h('p', { class: 'hint' }, 'Tap Arrived when a scheduled delivery comes in, then fill in the time, cages and temps. Tap its name to change the schedule.'),
  ];
}

function editDelivery(d) {
  const isNew = !d;
  const days = new Set(d ? d.days : []);
  const name = h('input', { type: 'text', value: d ? d.name : '', autocomplete: 'off', maxLength: 60, placeholder: 'Who or what is being delivered' });
  const time = h('input', { type: 'time', value: d ? d.time : '' });
  const note = h('input', { type: 'text', value: d ? d.note : '', autocomplete: 'off', maxLength: 200, placeholder: 'Door, cages, temp check… (optional)' });
  openSheet(
    isNew ? 'New delivery' : 'Edit delivery',
    field('Delivery', name),
    h('div', { class: 'field' }, h('span', {}, 'Due at'),
      h('div', { class: 'inline' }, time, btn('Clear', () => { time.value = ''; }, 'ghost'))),
    dayPicker(days),
    field('Note', note),
    h('div', { class: 'actions' },
      !isNew && btn('Delete', () => {
        closeSheet();
        withUndo(`Deleted: ${d.name}`, () => state.deliveries.splice(state.deliveries.indexOf(d), 1));
      }, 'danger ghost'),
      btn('Cancel', closeSheet),
      btn('Save', () => {
        if (!name.value.trim()) return name.focus();
        const next = normaliseDelivery({ id: d ? d.id : uid(), name: name.value, time: time.value, days: [...days], note: note.value.trim() });
        if (isNew) state.deliveries.push(next);
        else Object.assign(d, next);
        closeSheet();
        commit();
      }, 'primary')),
  );
  if (isNew) name.focus();
}

/* ---------- How (the Co-op "How do I" site) ---------- */

// The site refuses to be shown inside another page and needs its own sign-in, so it opens
// beside the app in the phone's browser. Shortcuts to the pages used most are kept here.
const outLink = (label, url, cls) => h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer' }, label);

function howView() {
  return [
    outLink('Open How do I', HOW_URL, 'btn primary big'),
    h('p', { class: 'hint' }, 'Opens how.coop.co.uk in your browser, where you sign in as usual. Press back to return here.'),
    state.links.length > 0 && h('p', { class: 'hint' }, 'Your shortcuts'),
    ...state.links.map((l) => h('article', { class: 'card code' },
      outLink([h('span', { class: 'title' }, l.name), h('small', {}, l.url.replace(/^https?:\/\//, ''))], l.url, 'body'),
      h('div', { class: 'tools' }, h('button', { type: 'button', class: 'word', 'aria-label': `Edit shortcut ${l.name}`, onclick: () => editLink(l) }, 'Edit')))),
    btn('+ Add a shortcut', () => editLink(null), 'add'),
    !state.links.length && h('p', { class: 'hint' }, 'Tip: when you find a page you use a lot (a process, a form), copy its address from the browser and save it here as a shortcut.'),
  ];
}

function editLink(l) {
  const name = h('input', { type: 'text', value: l ? l.name : '', autocomplete: 'off', maxLength: 60, placeholder: 'What the page is' });
  const url = h('input', { type: 'url', value: l ? l.url : '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, maxLength: 500, placeholder: 'Paste the address' });
  openSheet(l ? 'Edit shortcut' : 'New shortcut',
    field('Name', name), field('Address', url),
    h('div', { class: 'actions' },
      l && btn('Delete', () => { closeSheet(); withUndo(`Deleted: ${l.name}`, () => state.links.splice(state.links.indexOf(l), 1)); }, 'danger ghost'),
      btn('Cancel', closeSheet),
      btn('Save', () => {
        const next = normaliseLink({ id: l ? l.id : uid(), name: name.value, url: url.value });
        if (!next) { toast('That does not look like a web address'); return url.focus(); }
        if (l) Object.assign(l, next);
        else state.links.push(next);
        closeSheet();
        commit();
      }, 'primary')));
  (l ? name : url).focus();
}

/* ---------- More ---------- */

function moreView() {
  return MORE_PAGES.map(([id, name, desc]) =>
    h('button', { type: 'button', class: 'card line', onclick: () => go(id) },
      h('span', { class: 'grow' }, h('span', { class: 'title' }, name), h('small', {}, desc)),
      id === '#memos' && state.memos.length > 0 && h('span', { class: 'badge' }, String(state.memos.length)),
      id === '#notes' && state.notes.length > 0 && h('span', { class: 'badge' }, String(state.notes.length)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
}

/* ---------- my notes (private) ---------- */

// Notes for yourself. They are kept until deleted and never go into the handover, things to
// mention or the history.
const fitHeight = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };

const notesView = () => notesBlock();

// The note box and the list of notes. Shown on My notes and under the voice memos.
function notesBlock() {
  const draft = h('textarea', { rows: 3, maxLength: 5000, placeholder: 'Write a note for yourself', 'aria-label': 'New note' });
  const add = () => {
    const text = draft.value.trim();
    if (!text) return draft.focus();
    state.notes.unshift({ id: uid(), text, at: Date.now() });
    commit();
  };
  const card = (n) => {
    const stamp = h('small', {}, noteDate(n.at));
    const area = h('textarea', {
      rows: 2, value: n.text, maxLength: 5000, 'aria-label': 'Note',
      oninput: (e) => { n.text = e.target.value; n.at = Date.now(); stamp.textContent = noteDate(n.at); fitHeight(e.target); persistSoon(); },
    });
    requestAnimationFrame(() => fitHeight(area));
    return h('article', { class: 'card memo' }, area,
      h('div', { class: 'memohead' }, stamp,
        btn('Delete', () => withUndo('Note deleted', () => state.notes.splice(state.notes.indexOf(n), 1)), 'small danger ghost')));
  };
  return [
    draft,
    h('div', { class: 'actions' }, btn('Add note', add, 'primary')),
    h('p', { class: 'hint' }, 'Only for you: these never go into the handover or things to mention, and they stay until you delete them. Tap a note to change it.'),
    ...state.notes.map(card),
  ];
}

const noteDate = (ms) => `${new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(ms)}`;

/* ---------- voice memos ---------- */

// Recording is done by the phone (MediaRecorder) and stays on the phone. The transcript comes
// from the browser's speech recognition, which works while you speak; in Chrome that sends the
// audio to Google, which is why it has its own switch.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let rec = null; // the recording in progress

function listen(track) {
  if (!SR || !state.settings.transcribe) return;
  const r = new SR();
  r.lang = 'en-GB';
  r.interimResults = true;
  // Android repeats itself in continuous mode, so there it listens one phrase at a time.
  r.continuous = !/Android/i.test(navigator.userAgent);
  let base = '';
  let session = '';
  rec.recog = r;
  rec.heard = new Promise((resolve) => { rec.heardDone = resolve; });
  r.onresult = (e) => {
    let interim = '';
    session = '';
    for (let i = 0; i < e.results.length; i++) {
      const said = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) session += `${said} `;
      else interim += `${said} `;
    }
    if (!rec || rec.recog !== r) return;
    rec.text = (base + session).trim();
    const live = $('#rec-text');
    if (live) live.textContent = (base + session + interim).trim() || 'Listening…';
  };
  r.onerror = (e) => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(e.error) && rec && rec.recog === r) {
      rec.recogFailed = true;
      const live = $('#rec-text');
      if (live && !rec.text) live.textContent = 'Transcription is not available right now. Still recording.';
    }
  };
  r.onend = () => {
    base += session;
    session = '';
    if (!rec || rec.recog !== r || rec.stopping || rec.recogFailed) return rec && rec.recog === r && rec.heardDone();
    try {
      r.start(track);
    } catch {
      rec.heardDone();
    }
  };
  try {
    r.start(track);
  } catch {
    rec.recog = null;
  }
}

async function startRecording() {
  if (rec) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('The microphone is blocked. Allow it for this app in your phone settings.');
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec = { stream, recorder, chunks, started: Date.now(), text: '', stopping: false, recog: null };
  recorder.start(1000);
  rec.timer = setInterval(() => {
    const el = $('#rec-time');
    if (el && rec) el.textContent = mmss((Date.now() - rec.started) / 1000);
  }, 500);
  listen(stream.getAudioTracks()[0]);
  render();
}

async function stopRecording() {
  const r = rec;
  if (!r || r.stopping) return;
  r.stopping = true;
  clearInterval(r.timer);
  const stopped = new Promise((resolve) => { r.recorder.onstop = resolve; });
  try { r.recorder.stop(); } catch { /* already stopped */ }
  if (r.recog) {
    try { r.recog.stop(); } catch { /* not running */ }
    await Promise.race([r.heard, pause(1500)]);
  }
  await Promise.race([stopped, pause(2000)]);
  r.stream.getTracks().forEach((t) => t.stop());
  const audio = uid();
  let saved = true;
  try {
    await photos.put(audio, new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' }));
  } catch {
    saved = false;
  }
  rec = null;
  if (!saved && !r.text) {
    toast('Could not save the recording');
    return render();
  }
  state.memos.unshift(normaliseMemo({ at: r.started, secs: Math.max(1, (Date.now() - r.started) / 1000), text: r.text, audio: saved ? audio : '' }));
  commit();
  toast(r.text ? 'Memo saved with its transcript' : 'Memo saved');
}

function player(id) {
  const el = h('audio', { controls: true, preload: 'metadata' });
  photos.url(id).then((u) => { if (u) el.src = u; else el.replaceWith(h('small', {}, 'The recording is not on this phone.')); });
  return el;
}

function memoCard(m) {
  const when = `${new Date(m.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(m.at)}`;
  return h('article', { class: 'card memo' },
    h('div', { class: 'memohead' }, h('span', { class: 'title' }, when), h('small', {}, mmss(m.secs))),
    m.audio ? player(m.audio) : h('small', {}, 'Transcript only'),
    h('textarea', {
      rows: 3, value: m.text, 'aria-label': `Transcript of the memo from ${when}`,
      placeholder: 'No transcript. Type what it says if you want it in the handover.',
      oninput: (e) => { m.text = e.target.value; persistSoon(); },
    }),
    h('div', { class: 'actions' },
      btn('Delete', () => withUndo('Memo deleted', () => state.memos.splice(state.memos.indexOf(m), 1)), 'small danger ghost'),
      btn('Copy', () => (m.text.trim() ? copyText(m.text.trim(), 'Transcript copied') : toast('There is no transcript to copy')), 'small outline'),
      btn('Save to notes', () => {
        if (!m.text.trim()) return toast('Type or record a transcript first');
        state.notes.unshift({ id: uid(), text: m.text.trim(), at: Date.now() });
        commit();
        toast('Saved to your notes');
      }, 'small outline'),
      btn('Add to Mention', () => {
        if (!m.text.trim()) return toast('Type or record a transcript first');
        state.mentions.push({ id: uid(), text: m.text.trim(), at: Date.now(), photo: '' });
        commit();
        toast('Added to things to mention');
      }, 'small outline')));
}

function memosView() {
  if (!canRecord()) {
    return [
      h('p', { class: 'empty' }, 'This browser cannot record sound. Open the installed app in Chrome on your phone.'),
      h('h2', { class: 'sectionhead' }, 'Notes'),
      ...notesBlock(),
    ];
  }
  const toggle = h('input', {
    type: 'checkbox', checked: !!SR && state.settings.transcribe, disabled: !SR || !!rec,
    onchange: (e) => { state.settings.transcribe = e.target.checked; persist(); },
  });
  return [
    rec
      ? h('div', { class: 'card recording' },
        h('div', { class: 'recrow' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('b', { id: 'rec-time' }, mmss((Date.now() - rec.started) / 1000)), h('span', {}, 'Recording')),
        h('p', { id: 'rec-text', class: 'note', 'aria-live': 'polite' }, rec.text || (rec.recog ? 'Listening…' : 'Recording without a transcript.')),
        btn('Stop and save', stopRecording, 'primary big'))
      : btn('Record a voice memo', startRecording, 'primary big'),
    h('label', { class: 'tickrow' }, toggle, h('span', {}, SR
      ? 'Write down what I say as I speak'
      : 'Transcripts are not available in this browser; memos are saved as recordings.')),
    SR && h('p', { class: 'hint' }, 'The recording stays on this phone. The transcript uses your phone\'s speech recognition, which sends what you say to Google while you record, and needs signal. Turn it off to keep everything on the phone.'),
    !state.memos.length && !rec && h('p', { class: 'empty' }, 'No memos yet. Record one and it is kept here until you delete it. You can correct the transcript and add it to things to mention.'),
    ...state.memos.map(memoCard),
    h('h2', { class: 'sectionhead' }, 'Notes'),
    ...notesBlock(),
  ];
}

/* ---------- photos ---------- */

function thumb(id, cls = 'thumb') {
  const img = h('img', { class: cls, alt: 'Attached photo' });
  photos.url(id).then((u) => { if (u) img.src = u; else img.replaceWith(h('span', { class: `${cls} missing` }, 'no photo')); });
  return img;
}

function viewPhoto(id) {
  openSheet('Photo', thumb(id, 'fullphoto'), h('div', { class: 'actions' }, btn('Close', closeSheet)));
}

// Opens the camera / gallery picker; resolves the stored photo id, or null.
function pickPhoto() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const source = input.files[0];
      if (!source) return resolve(null);
      try {
        const id = uid();
        await photos.put(id, await photos.shrink(source));
        resolve(id);
      } catch {
        toast('Could not add that photo');
        resolve(null);
      }
    });
    input.click();
  });
}

/* ---------- things to mention ---------- */

const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function mentionView() {
  const input = h('input', { type: 'text', autocomplete: 'off', maxLength: 300, placeholder: 'Something the next shift should know', 'aria-label': 'New thing to mention' });
  const add = (photo = '') => {
    const text = input.value.trim() || (photo ? 'Photo' : '');
    if (!text) return input.focus();
    state.mentions.push({ id: uid(), text, at: Date.now(), photo });
    commit();
    if (!photo) $('#view input')?.focus();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return [
    input,
    h('div', { class: 'actions' },
      btn('Add with photo', async () => { const id = await pickPhoto(); if (id) add(id); }),
      btn('Add', () => add(), 'primary')),
    !state.mentions.length && h('p', { class: 'empty' }, 'Nothing noted yet. Jot things down here during your shift, with a photo if it helps, and they go into the handover.'),
    ...state.mentions.map((m) =>
      h('button', { type: 'button', class: 'card line', onclick: () => editMention(m) },
        m.photo && thumb(m.photo),
        h('span', { class: 'title' }, m.text), h('small', {}, clock(m.at)))),
  ];
}

function editMention(m) {
  const text = h('textarea', { rows: 3, value: m.text });
  let photo = m.photo || '';
  const slot = h('div', { class: 'photoslot' });
  const drawSlot = () => slot.replaceChildren(...(photo
    ? [thumb(photo, 'thumb big'), btn('Remove photo', () => { photo = ''; drawSlot(); }, 'ghost')]
    : [btn('Add a photo', async () => { const id = await pickPhoto(); if (id) { photo = id; drawSlot(); } })]));
  drawSlot();
  openSheet('Edit note',
    field('Note', text),
    slot,
    h('div', { class: 'actions' },
      btn('Delete', () => {
        closeSheet();
        withUndo('Note deleted', () => state.mentions.splice(state.mentions.indexOf(m), 1));
      }, 'danger ghost'),
      btn('Cancel', closeSheet),
      btn('Save', () => {
        if (!text.value.trim()) return text.focus();
        m.text = text.value.trim();
        m.photo = photo;
        closeSheet();
        commit();
      }, 'primary')));
}

/* ---------- handover ---------- */

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Could not copy. Select the text and copy it by hand.');
  }
}

const partOn = (key) => state.settings.handover[key] !== false;

// The photos that go with the handover: those on things to mention that are still included.
function handoverPhotos() {
  if (!partOn('mentions') || !partOn('photos')) return [];
  return state.mentions.filter((m) => m.photo && !state.ticks.omit[m.id]);
}

// Shares the write-up, with the photos as attachments where the phone allows it.
async function shareHandover(text) {
  const ids = handoverPhotos().map((m) => m.photo);
  const files = (await Promise.all(ids.map((id, i) => photos.file(id, `handover-photo-${i + 1}.jpg`)))).filter(Boolean);
  const withFiles = files.length > 0 && navigator.canShare && navigator.canShare({ files });
  try {
    await navigator.share(withFiles ? { text, files } : { text });
  } catch (err) {
    if (err && err.name !== 'AbortError') toast('Could not open the share menu');
  }
}

let pickerOpen = false; // the "what to include" panel
const pickOpen = new Set(); // parts whose item list is showing

// Tickboxes for what goes into the handover: whole parts, and single items within them.
function handoverPicker(summary, deliveries) {
  const omit = state.ticks.omit;
  const items = {
    figures: summary.figures.map((f) => [f.id, `${f.title}: ${f.items.map((i) => `${i.label} ${i.value}`).join(', ')}`]),
    notDone: summary.missed.map((t) => [t.id, t.title]),
    done: summary.done.map((t) => [t.id, t.title]),
    skipped: summary.skipped.map((t) => [t.id, t.title]),
    deliveries: deliveries.map((d) => [d.id, d.name]),
    notes: summary.notes.map((n) => [n.id, n.label]),
    mentions: state.mentions.map((m) => [m.id, m.text]),
  };
  const tick = (checked, label, onchange, cls = '') => h('label', { class: `tickrow ${cls}` },
    h('input', { type: 'checkbox', checked, onchange: (e) => { onchange(e.target.checked); persist(); render(); } }),
    h('span', {}, label));

  const rows = HANDOVER_PARTS.map(([key, label]) => {
    const list = items[key] || [];
    const left = list.filter(([id]) => !omit[id]).length;
    const open = pickOpen.has(key);
    return h('div', { class: 'part' },
      h('div', { class: 'partrow' },
        tick(partOn(key), list.length ? `${label} (${left} of ${list.length})` : label, (v) => { state.settings.handover[key] = v; }),
        list.length > 0 && partOn(key) && h('button', {
          type: 'button', class: 'link', 'aria-expanded': String(open),
          onclick: () => { if (open) pickOpen.delete(key); else pickOpen.add(key); render(); },
        }, open ? 'Hide items' : 'Choose items')),
      open && partOn(key) && h('div', { class: 'partitems' }, list.map(([id, text]) =>
        tick(!omit[id], text, (v) => { if (v) delete omit[id]; else omit[id] = true; }, 'item'))));
  });

  const changed = HANDOVER_PARTS.some(([key]) => !partOn(key)) || Object.keys(omit).length > 0;
  return h('div', { class: 'card picker' },
    h('button', { type: 'button', class: 'pickhead', 'aria-expanded': String(pickerOpen), onclick: () => { pickerOpen = !pickerOpen; render(); } },
      h('span', { class: 'title' }, 'What to include'),
      h('small', {}, changed ? 'Some things are left out' : 'Everything'),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, pickerOpen ? '▾' : '▸')),
    pickerOpen && h('div', { class: 'pickbody' }, rows,
      changed && btn('Include everything', () => { state.settings.handover = {}; state.ticks.omit = {}; persist(); render(); }, 'small outline')));
}

function handoverView() {
  if (!state.lists.length) return [h('p', { class: 'empty' }, 'Add a list first, then the handover is written from it.')];
  const list = state.lists.find((l) => l.id === lastList) || state.lists[0];
  const summary = summariseList(list, state.ticks, weekday());
  const deliveries = summariseDeliveries(state.deliveries, state.ticks, weekday());
  const text = handoverText(summary, state.mentions, state.ticks.date, deliveries, new Date(),
    { parts: state.settings.handover, omit: state.ticks.omit });
  const area = h('textarea', { class: 'handover', rows: 16, value: text, 'aria-label': 'Handover text' });
  const pics = handoverPhotos();
  return [
    h('div', { class: 'chips' }, state.lists.map((l) =>
      h('button', { type: 'button', class: `chip${l === list ? ' on' : ''}`, 'aria-pressed': String(l === list), onclick: () => { lastList = l.id; render(); } }, l.name))),
    handoverPicker(summary, deliveries),
    area,
    pics.length > 0 && h('div', { class: 'thumbs' }, pics.map((m) =>
      h('button', { type: 'button', class: 'thumbbtn', 'aria-label': `Photo: ${m.text}`, onclick: () => viewPhoto(m.photo) }, thumb(m.photo, 'thumb big')))),
    h('div', { class: 'actions' },
      navigator.share && btn(pics.length ? `Share with ${pics.length} photo${pics.length > 1 ? 's' : ''}` : 'Share', () => shareHandover(area.value)),
      btn('Copy text', () => copyText(area.value, 'Handover copied'), 'primary')),
    h('p', { class: 'hint' }, 'Tick or untick under "What to include" first, then change any wording in the box: changing a tick rewrites the text. Which parts are included is remembered; single items you untick come back tomorrow.'),
  ];
}

/* ---------- history ---------- */

function dayBlock(snap, label, open) {
  const counts = snap.lists.map((l) => `${l.name} ${l.done.length}/${l.total}`).join(' · ');
  return h('details', { class: 'card day', open },
    h('summary', {}, h('span', { class: 'title' }, label), h('small', {}, counts || 'Notes only')),
    snap.lists.map((l) => [
      h('h3', {}, `${l.name}: ${l.done.length} of ${l.total}`),
      l.done.length > 0 && h('ul', { class: 'log' }, l.done.map((t) => h('li', { class: 'ok' }, t.title, t.at && h('small', {}, t.at)))),
      l.missed.length > 0 && h('ul', { class: 'log' }, l.missed.map((t) => h('li', { class: 'miss' }, t.title, h('small', {}, 'not done')))),
      (l.skipped || []).length > 0 && h('ul', { class: 'log' }, l.skipped.map((t) => h('li', { class: 'miss' }, t.title, h('small', {}, 'skipped')))),
      (l.figures || []).length > 0 && h('ul', { class: 'log' }, l.figures.map((f) => h('li', {},
        h('span', { class: 'grow' }, f.title), h('small', {}, f.items.map((i) => `${i.label} ${i.value}`).join(', '))))),
      (l.notes || []).map((n) => [h('h3', {}, n.label), h('p', { class: 'note' }, n.text)]),
    ]),
    (snap.deliveries || []).length > 0 && [
      h('h3', {}, 'Deliveries'),
      h('ul', { class: 'log' }, snap.deliveries.map((d) => h('li', { class: d.at ? 'ok' : 'miss' },
        h('span', { class: 'grow' }, `${d.name}${d.time ? `, due ${d.time}` : ''}`), h('small', {}, deliveryStatus(d))))),
    ],
    snap.mentions.length > 0 && [
      h('h3', {}, 'Things to mention'),
      h('ul', { class: 'log' }, snap.mentions.map((m) => h('li', {},
        m.photo && h('button', { type: 'button', class: 'thumbbtn', 'aria-label': `Photo: ${m.text}`, onclick: () => viewPhoto(m.photo) }, thumb(m.photo)),
        h('span', { class: 'grow' }, m.text), m.at && h('small', {}, m.at)))),
    ],
  );
}

function historyView() {
  return [
    dayBlock(snapshot(state), `Today, ${prettyDate(state.ticks.date)}`, true),
    ...state.history.map((snap) => dayBlock(snap, prettyDate(snap.date), false)),
    !state.history.length && h('p', { class: 'hint' }, 'Each finished day is filed here automatically (the day turns over at 4am).'),
  ];
}

/* ---------- codes ---------- */

function codesView() {
  const status = vault.status();
  if (status === 'new') return codesSetup();
  if (status === 'locked') return codesUnlock();
  const items = vault.list();
  const store = () => vault.save().then(render, () => toast('Could not save the codes'));
  return [
    editing && h('p', { class: 'hint' }, 'Tap a code to change it. Use the arrows to reorder.'),
    !items.length && h('p', { class: 'empty' }, 'No codes yet. Add door codes, logins and anything else you need to hand.'),
    ...items.map((c, i) => {
      const show = revealed.has(c.id);
      const flip = () => { if (show) revealed.delete(c.id); else revealed.add(c.id); render(); };
      return h('article', { class: 'card code' },
        h('button', { type: 'button', class: 'body', onclick: () => (editing ? editCode(c) : flip()) },
          h('span', { class: 'title' }, c.label),
          h('code', {}, show ? c.value : '•'.repeat(Math.min(Math.max(c.value.length, 4), 10))),
          c.note && h('small', {}, c.note)),
        editing
          ? h('div', { class: 'tools' },
            h('button', { type: 'button', 'aria-label': `Move ${c.label} up`, disabled: i === 0, onclick: () => { move(items, i, -1); store(); } }, '↑'),
            h('button', { type: 'button', 'aria-label': `Move ${c.label} down`, disabled: i === items.length - 1, onclick: () => { move(items, i, 1); store(); } }, '↓'))
          : h('div', { class: 'tools' },
            h('button', { type: 'button', class: 'word', onclick: flip }, show ? 'Hide' : 'Show'),
            h('button', { type: 'button', class: 'word', onclick: () => copyText(c.value, `${c.label} copied`) }, 'Copy')));
    }),
    btn('+ Add a code', () => editCode(null), 'add'),
    h('p', { class: 'hint' }, vault.hasPin()
      ? 'Encrypted on this phone with your PIN. Locks when you leave the app.'
      : 'No PIN set: anyone holding your unlocked phone can read these. Set one from the ⋮ menu.'),
  ];
}

function editCode(c) {
  const items = vault.list();
  const label = h('input', { type: 'text', value: c ? c.label : '', autocomplete: 'off', maxLength: 60, placeholder: 'What it is for' });
  const value = h('input', { type: 'text', value: c ? c.value : '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, maxLength: 200, placeholder: 'The code or password' });
  const note = h('input', { type: 'text', value: c ? c.note : '', autocomplete: 'off', maxLength: 200, placeholder: 'Username, where it is used… (optional)' });
  const done = () => { closeSheet(); vault.save().then(render, () => toast('Could not save the codes')); };
  openSheet(c ? 'Edit code' : 'New code',
    field('Name', label), field('Code', value), field('Note', note),
    h('div', { class: 'actions' },
      c && deleteButton('Delete', () => { items.splice(items.indexOf(c), 1); done(); }),
      btn('Cancel', closeSheet),
      btn('Save', () => {
        if (!label.value.trim()) return label.focus();
        if (!value.value) return value.focus();
        const next = { id: c ? c.id : uid(), label: label.value.trim(), value: value.value, note: note.value.trim() };
        if (c) Object.assign(c, next);
        else items.push(next);
        done();
      }, 'primary')));
  if (!c) label.focus();
}

const pinInput = (placeholder) => h('input', { type: 'password', autocomplete: 'off', placeholder, 'aria-label': placeholder, maxLength: 64 });

// Returns the two inputs and a function that gives the PIN (or null after showing why not).
function pinPair() {
  const a = pinInput('PIN or passphrase (4 or more characters)');
  const b = pinInput('Type it again');
  const read = () => {
    if (a.value.length < 4) { toast('Use at least 4 characters'); a.focus(); return null; }
    if (a.value !== b.value) { toast('The two do not match'); b.focus(); return null; }
    return a.value;
  };
  return { a, b, read };
}

function codesSetup() {
  const { a, b, read } = pinPair();
  const start = (pin) => vault.setPin(pin).then(render, () => toast('Could not set that up'));
  if (!vault.canLock()) {
    return [
      h('p', { class: 'empty' }, 'This page is not on a secure (https) address, so the codes cannot be encrypted here. Open the installed app instead, or carry on without a PIN.'),
      btn('Use without a PIN', () => start(null)),
    ];
  }
  return [
    h('p', { class: 'empty' }, 'Keep door codes, logins and passwords here. Set a PIN and they are encrypted on this phone; nothing is ever sent anywhere.'),
    a, b,
    h('div', { class: 'actions' },
      btn('Use without a PIN', () => start(null), 'ghost'),
      btn('Set PIN', () => { const pin = read(); if (pin) start(pin); }, 'primary')),
    h('p', { class: 'hint' }, 'If you forget the PIN the codes cannot be recovered, so pick one you will remember.'),
  ];
}

function codesUnlock() {
  const pin = pinInput('PIN');
  const go = btn('Unlock', async () => {
    if (!pin.value) return pin.focus();
    go.disabled = true;
    go.textContent = 'Unlocking…';
    if (await vault.unlock(pin.value)) return render();
    go.disabled = false;
    go.textContent = 'Unlock';
    pin.value = '';
    pin.focus();
    toast('That PIN did not work');
  }, 'primary');
  pin.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  return [
    h('p', { class: 'empty' }, 'Codes are locked.'),
    pin,
    h('div', { class: 'actions' }, go),
    btn('Forgot the PIN? Erase the codes', async () => {
      if (await confirmSheet('Erase all codes?', 'This deletes every saved code so you can start again. It cannot be undone.', 'Erase')) {
        vault.erase();
        render();
      }
    }, 'ghost small'),
  ];
}

function changePin() {
  const { a, b, read } = pinPair();
  openSheet(vault.hasPin() ? 'Change PIN' : 'Set a PIN', a, b,
    h('p', { class: 'muted' }, 'If you forget the PIN the codes cannot be recovered.'),
    h('div', { class: 'actions' }, btn('Cancel', closeSheet),
      btn('Save', () => { const pin = read(); if (pin) vault.setPin(pin).then(() => { closeSheet(); toast('PIN set'); render(); }); }, 'primary')));
  a.focus();
}

/* ---------- menu, lists, backup ---------- */

function openMenu() {
  const list = currentList();
  const items = [];
  const add = (label, fn, cls = '') => items.push(btn(label, () => { closeSheet(); fn(); }, `menu ${cls}`));

  if (list) {
    const i = state.lists.indexOf(list);
    add(state.settings.hideDone ? 'Show completed tasks' : 'Hide completed tasks', () => { state.settings.hideDone = !state.settings.hideDone; commit(); });
    add(`Untick everything in ${list.name}`, () => withUndo(`${list.name} unticked`, () => {
      for (const t of list.tasks) {
        delete state.ticks.done[t.id];
        delete state.ticks.skipped[t.id];
        for (const s of t.steps) delete state.ticks.done[s.id];
        for (const i of t.inputs) delete state.ticks.values[i.id];
      }
    }));
    add('Rename this list', async () => {
      const name = await askText('Rename list', 'Name', list.name);
      if (name) { list.name = name; commit(); }
    });
    if (i > 0) add('Move this list earlier', () => { move(state.lists, i, -1); commit(); });
    if (i < state.lists.length - 1) add('Move this list later', () => { move(state.lists, i, 1); commit(); });
    add('Delete this list', async () => {
      if (!(await confirmSheet(`Delete ${list.name}?`, `Removes the list and its ${list.tasks.length} tasks. History is kept.`, 'Delete list'))) return;
      withUndo(`${list.name} deleted`, () => state.lists.splice(i, 1));
    }, 'danger');
  }
  add('Add a new list', async () => {
    const name = await askText('New list', 'Name', '', 'Add');
    if (!name) return;
    const l = { id: uid(), name, tasks: [] };
    state.lists.push(l);
    tab = l.id;
    commit();
  });
  if (tab === '#codes' && vault.status() === 'open' && vault.canLock()) {
    add(vault.hasPin() ? 'Change PIN' : 'Set a PIN', changePin);
    if (vault.hasPin()) {
      add('Lock now', () => { vault.lock(); revealed.clear(); render(); });
      add('Remove PIN', async () => {
        if (await confirmSheet('Remove the PIN?', 'The codes will be stored without encryption.', 'Remove PIN')) vault.setPin(null).then(render);
      }, 'danger');
    }
  }
  if (tab === '#history' && state.history.length) {
    add('Clear history', async () => {
      if (await confirmSheet('Clear history?', `Deletes the record of ${state.history.length} past days.`, 'Clear')) withUndo('History cleared', () => { state.history = []; });
    }, 'danger');
  }
  add('Back up to a file', backup);
  add('Restore from a file', restore);
  openSheet('Options', items, h('div', { class: 'actions' }, btn('Close', closeSheet)));
}

function backup() {
  const data = { app: 'shift-list', schema: state.schema, saved: new Date().toISOString(), state, vault: vault.exportRaw() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  h('a', { href: url, download: `shift-list-backup-${state.ticks.date}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(photoIds(state).length ? 'Backup saved (photos are not included)' : 'Backup saved to your downloads');
}

function restore() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    let data = null;
    try {
      data = JSON.parse(await file.text());
    } catch { /* handled below */ }
    if (!data || data.app !== 'shift-list' || !data.state || !Array.isArray(data.state.lists)) return toast('That is not a Shift List backup');
    if (!(await confirmSheet('Restore this backup?', `Replaces everything in the app with the backup from ${String(data.saved).slice(0, 10)}.`, 'Restore'))) return;
    state = normalise(data.state);
    vault.importRaw(data.vault);
    revealed.clear();
    commit();
    toast('Backup restored');
  });
  input.click();
}

/* ---------- render loop ---------- */

function render() {
  if (rollover(state)) save(state);
  if (!isSpecial(tab) && !currentList()) tab = state.lists[0] ? state.lists[0].id : '#mention';
  if (currentList()) lastList = tab;
  localStorage.setItem('shiftlist.tab', tab);
  renderTop();
  renderTabs();
  const list = currentList();
  const view = list ? listView(list)
    : tab === '#deliveries' ? deliveriesView()
    : tab === '#how' ? howView()
    : tab === '#more' ? moreView()
    : tab === '#memos' ? memosView()
    : tab === '#notes' ? notesView()
    : tab === '#mention' ? mentionView()
      : tab === '#handover' ? handoverView()
        : tab === '#history' ? historyView()
          : codesView();
  $('#view').replaceChildren(...view.flat(Infinity).filter((n) => n != null && n !== false));
}

const typing = () => {
  const el = document.activeElement;
  return !!el && $('#view').contains(el)
    && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox'));
};
const busy = () => sheet.open || dragging || typing();

// Leaving the app locks the codes; coming back checks whether the day has turned over.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(saveTimer);
    persist();
    if (rec) stopRecording();
    if (vault.hasPin() && vault.status() === 'open') {
      vault.lock();
      revealed.clear();
      if (tab === '#codes') { closeSheet(); render(); }
    }
  } else if (rollover(state)) {
    commit();
  } else if (currentList() && !busy()) {
    render();
  }
});

// Keeps the "by 10:00" badges honest while the checklist is on screen.
setInterval(() => {
  if ((currentList() || tab === '#deliveries') && !busy() && !document.hidden) render();
}, 60000);

render();

// Photos nothing refers to any more (deleted notes, expired history) are cleared at start-up,
// never straight away, so Undo can still bring a note back with its photo.
photos.sweep(photoIds(state)).catch(() => {});

/* ---------- offline + "update ready" ---------- */

$('#update').addEventListener('click', () => location.reload());

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // If a worker was already in charge when the page opened, a change of worker means a new
  // version has just been downloaded: offer it instead of waiting for the next launch.
  const hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) $('#update').hidden = false;
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  }).catch(() => {});
}
