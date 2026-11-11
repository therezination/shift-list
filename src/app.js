// The screen: tabs, checklists, the editor sheets, Mention / Handover / History, and Codes.
// All state rules live in store.js; the encrypted codes in vault.js.

import {
  load, save, rollover, normalise, normaliseTask, weekday, isDue, isLate, DAYS, uid,
  stepsFromText, progress, move, summariseList, snapshot, handoverText, prettyDate,
} from './store.js';
import * as vault from './vault.js';

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
  ['#mention', 'Mention', 'Things to mention'],
  ['#handover', 'Handover', 'Handover'],
  ['#history', 'History', 'History'],
  ['#codes', 'Codes', 'Codes'],
];

let state = load();
save(state);
let tab = localStorage.getItem('shiftlist.tab');
let editing = false;
let lastList = null; // the list the handover is written for
const expanded = new Set(); // task ids showing their steps
const revealed = new Set(); // code ids showing their value

const currentList = () => state.lists.find((l) => l.id === tab) || null;
const isSpecial = (id) => SPECIAL.some((s) => s[0] === id);

function commit() {
  if (!save(state)) toast('Could not save: phone storage is full');
  render();
}

/* ---------- toast + sheets ---------- */

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
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

// A delete button that needs a second tap.
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

function renderTop() {
  const list = currentList();
  const title = list ? list.name : SPECIAL.find((s) => s[0] === tab)[2];
  let sub = prettyDate(state.ticks.date);
  if (list) {
    const p = progress(list, state.ticks.done, weekday());
    if (p.total) sub += ` · ${p.done} of ${p.total} done`;
  }
  const canEdit = list || (tab === '#codes' && vault.status() === 'open');
  $('#top').replaceChildren(...[
    h('div', { class: 'heading' }, h('h1', {}, title), h('p', {}, sub)),
    canEdit && h('button', { type: 'button', class: `chip${editing ? ' on' : ''}`, 'aria-pressed': String(editing), onclick: () => { editing = !editing; render(); } }, editing ? 'Done' : 'Edit'),
    h('button', { type: 'button', class: 'chip', 'aria-label': 'More options', onclick: openMenu }, '⋮'),
  ].filter(Boolean));
}

function renderTabs() {
  const wd = weekday();
  const tabs = [
    ...state.lists.map((l) => {
      const p = progress(l, state.ticks.done, wd);
      return [l.id, l.name, p.total ? `${p.done}/${p.total}` : ''];
    }),
    ...SPECIAL.map(([id, name]) => [id, name, id === '#mention' && state.mentions.length ? String(state.mentions.length) : '']),
  ];
  $('#tabs').replaceChildren(
    ...tabs.map(([id, name, count]) =>
      h('button', {
        type: 'button', class: `tab${id === tab ? ' on' : ''}`, 'aria-current': id === tab ? 'page' : null,
        onclick: () => { if (tab === '#codes' && id !== tab) revealed.clear(); tab = id; editing = false; render(); window.scrollTo(0, 0); },
      }, h('b', {}, name), h('small', {}, count || ' '))),
  );
  const on = $('#tabs .on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- checklists ---------- */

function toggleTask(list, t, on) {
  if (on) state.ticks.done[t.id] = Date.now();
  else delete state.ticks.done[t.id];
  commit();
  if (on) {
    const p = progress(list, state.ticks.done, weekday());
    if (p.done === p.total) toast(`${list.name}: all done`);
  }
}

function toggleStep(t, s, on) {
  const done = state.ticks.done;
  if (on) done[s.id] = Date.now();
  else delete done[s.id];
  if (on && !done[t.id] && t.steps.every((x) => done[x.id])) done[t.id] = Date.now();
  commit();
}

function taskCard(list, t, index) {
  const done = state.ticks.done;
  const isDone = !!done[t.id];
  const due = isDue(t, weekday());
  const stepsDone = t.steps.filter((s) => done[s.id]).length;
  const hasMore = t.steps.length > 0 || !!t.note;
  const isOpen = expanded.has(t.id) && !editing;

  const badges = [];
  if (t.by) badges.push(h('span', { class: `badge${!isDone && due && isLate(t) ? ' late' : ''}` }, `by ${t.by}`));
  if (t.days.length) badges.push(h('span', { class: 'badge' }, t.days.map((d) => DAYS[d]).join(' ')));
  if (t.steps.length) badges.push(h('span', { class: 'badge' }, `${stepsDone}/${t.steps.length} steps`));

  const onBody = () => {
    if (editing) return editTask(list, t);
    if (!hasMore) return toggleTask(list, t, !isDone);
    if (expanded.has(t.id)) expanded.delete(t.id);
    else expanded.add(t.id);
    render();
  };

  return h('article', { class: `task${isDone ? ' done' : ''}${due ? '' : ' off'}` },
    h('div', { class: 'row' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: isDone, 'aria-label': `Done: ${t.title}`, onchange: (e) => toggleTask(list, t, e.target.checked) }),
        h('span', {})),
      h('button', { type: 'button', class: 'body', 'aria-expanded': hasMore && !editing ? String(isOpen) : null, onclick: onBody },
        h('span', { class: 'title' }, t.title),
        badges.length > 0 && h('span', { class: 'meta' }, badges)),
      editing
        ? h('div', { class: 'tools' },
          h('button', { type: 'button', 'aria-label': `Move ${t.title} up`, disabled: index === 0, onclick: () => { move(list.tasks, index, -1); commit(); } }, '↑'),
          h('button', { type: 'button', 'aria-label': `Move ${t.title} down`, disabled: index === list.tasks.length - 1, onclick: () => { move(list.tasks, index, 1); commit(); } }, '↓'))
        : hasMore && h('span', { class: 'chev', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸')),
    isOpen && h('div', { class: 'more' },
      t.note && h('p', { class: 'note' }, t.note),
      t.steps.length > 0 && h('ul', { class: 'steps' }, t.steps.map((s) =>
        h('li', {}, h('label', { class: `step${done[s.id] ? ' done' : ''}` },
          h('input', { type: 'checkbox', checked: !!done[s.id], onchange: (e) => toggleStep(t, s, e.target.checked) }),
          h('span', {}, s.text)))))),
  );
}

function listView(list) {
  const wd = weekday();
  const p = progress(list, state.ticks.done, wd);
  const off = list.tasks.filter((t) => !isDue(t, wd));
  const out = [];
  if (p.total) {
    out.push(h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${list.name} progress`, 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.done },
      h('i', { style: `width:${(p.done / p.total) * 100}%` })));
  }
  if (editing) out.push(h('p', { class: 'hint' }, 'Tap a task to change it. Use the arrows to reorder.'));
  if (!list.tasks.length) out.push(h('p', { class: 'empty' }, `Nothing in ${list.name} yet. Add your first task below.`));
  list.tasks.forEach((t, i) => {
    if (editing || isDue(t, wd)) out.push(taskCard(list, t, i));
  });
  if (!editing && off.length) {
    out.push(h('p', { class: 'hint' }, `Not today: ${off.map((t) => `${t.title} (${t.days.map((d) => DAYS[d]).join(' ')})`).join(', ')}`));
  }
  out.push(btn('+ Add a task', () => editTask(list, null), 'add'));
  return out;
}

function editTask(list, t) {
  const isNew = !t;
  const days = new Set(t ? t.days : []);
  const title = h('input', { type: 'text', value: t ? t.title : '', autocomplete: 'off', maxLength: 120, placeholder: 'What needs doing' });
  const steps = h('textarea', { rows: 5, value: t ? t.steps.map((s) => s.text).join('\n') : '', placeholder: 'One step per line (optional)' });
  const note = h('textarea', { rows: 2, value: t ? t.note : '', placeholder: 'Anything to remember (optional)' });
  const by = h('input', { type: 'time', value: t ? t.by : '' });

  const dayChips = DAYS.map((name, d) => {
    const chip = h('button', { type: 'button', class: `chip${days.has(d) ? ' on' : ''}`, 'aria-pressed': String(days.has(d)) }, name);
    chip.addEventListener('click', () => {
      if (days.has(d)) days.delete(d);
      else days.add(d);
      chip.classList.toggle('on', days.has(d));
      chip.setAttribute('aria-pressed', String(days.has(d)));
    });
    return chip;
  });

  const saveTask = () => {
    if (!title.value.trim()) return title.focus();
    const next = normaliseTask({
      id: t ? t.id : uid(),
      title: title.value,
      note: note.value.trim(),
      steps: stepsFromText(steps.value, t ? t.steps : []),
      days: [...days],
      by: by.value,
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
    h('div', { class: 'field' }, h('span', {}, 'Only on these days (none picked = every day)'), h('div', { class: 'chips' }, dayChips)),
    h('div', { class: 'field' }, h('span', {}, 'Finish by (optional)'),
      h('div', { class: 'inline' }, by, btn('Clear', () => { by.value = ''; }, 'ghost'))),
    h('div', { class: 'actions' },
      !isNew && deleteButton('Delete', () => {
        list.tasks.splice(list.tasks.indexOf(t), 1);
        closeSheet();
        commit();
      }),
      btn('Cancel', closeSheet),
      btn('Save', saveTask, 'primary')),
  );
  if (isNew) title.focus();
}

/* ---------- things to mention ---------- */

const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function mentionView() {
  const input = h('input', { type: 'text', autocomplete: 'off', maxLength: 300, placeholder: 'Something the next shift should know', 'aria-label': 'New thing to mention' });
  const add = () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    state.mentions.push({ id: uid(), text, at: Date.now() });
    commit();
    $('#view input')?.focus();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return [
    h('div', { class: 'inline addrow' }, input, btn('Add', add, 'primary')),
    !state.mentions.length && h('p', { class: 'empty' }, 'Nothing noted yet. Jot things down here during your shift and they go into the handover.'),
    ...state.mentions.map((m) =>
      h('button', { type: 'button', class: 'card line', onclick: () => editMention(m) },
        h('span', { class: 'title' }, m.text), h('small', {}, clock(m.at)))),
  ];
}

function editMention(m) {
  const text = h('textarea', { rows: 3, value: m.text });
  openSheet('Edit note',
    field('Note', text),
    h('div', { class: 'actions' },
      deleteButton('Delete', () => { state.mentions.splice(state.mentions.indexOf(m), 1); closeSheet(); commit(); }),
      btn('Cancel', closeSheet),
      btn('Save', () => { if (!text.value.trim()) return text.focus(); m.text = text.value.trim(); closeSheet(); commit(); }, 'primary')));
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

function handoverView() {
  if (!state.lists.length) return [h('p', { class: 'empty' }, 'Add a list first, then the handover is written from it.')];
  const list = state.lists.find((l) => l.id === lastList) || state.lists[0];
  const text = handoverText(summariseList(list, state.ticks.done, weekday()), state.mentions, state.ticks.date);
  const area = h('textarea', { class: 'handover', rows: 16, value: text, 'aria-label': 'Handover text' });
  return [
    h('div', { class: 'chips' }, state.lists.map((l) =>
      h('button', { type: 'button', class: `chip${l === list ? ' on' : ''}`, 'aria-pressed': String(l === list), onclick: () => { lastList = l.id; render(); } }, l.name))),
    area,
    h('div', { class: 'actions' },
      navigator.share && btn('Share', () => navigator.share({ text: area.value }).catch(() => {})),
      btn('Copy', () => copyText(area.value, 'Handover copied'), 'primary')),
    h('p', { class: 'hint' }, 'Written from your ticks and your things to mention. You can change the wording here before you copy or share it.'),
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
    ]),
    snap.mentions.length > 0 && [
      h('h3', {}, 'Things to mention'),
      h('ul', { class: 'log' }, snap.mentions.map((m) => h('li', {}, m.text, m.at && h('small', {}, m.at)))),
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
  const persist = () => vault.save().then(render, () => toast('Could not save the codes'));
  return [
    editing && h('p', { class: 'hint' }, 'Tap a code to change it. Use the arrows to reorder.'),
    !items.length && h('p', { class: 'empty' }, 'No codes yet. Add door codes, logins and anything else you need to hand.'),
    ...items.map((c, i) => {
      const show = revealed.has(c.id);
      return h('article', { class: 'card code' },
        h('button', { type: 'button', class: 'body', onclick: () => (editing ? editCode(c) : (show ? revealed.delete(c.id) : revealed.add(c.id), render())) },
          h('span', { class: 'title' }, c.label),
          h('code', {}, show ? c.value : '•'.repeat(Math.min(Math.max(c.value.length, 4), 10))),
          c.note && h('small', {}, c.note)),
        editing
          ? h('div', { class: 'tools' },
            h('button', { type: 'button', 'aria-label': `Move ${c.label} up`, disabled: i === 0, onclick: () => { move(items, i, -1); persist(); } }, '↑'),
            h('button', { type: 'button', 'aria-label': `Move ${c.label} down`, disabled: i === items.length - 1, onclick: () => { move(items, i, 1); persist(); } }, '↓'))
          : h('div', { class: 'tools' },
            h('button', { type: 'button', class: 'word', onclick: () => { show ? revealed.delete(c.id) : revealed.add(c.id); render(); } }, show ? 'Hide' : 'Show'),
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
    add(`Untick everything in ${list.name}`, async () => {
      if (!(await confirmSheet(`Untick everything in ${list.name}?`, 'Clears today\'s ticks for this list.', 'Untick all'))) return;
      for (const t of list.tasks) {
        delete state.ticks.done[t.id];
        for (const s of t.steps) delete state.ticks.done[s.id];
      }
      commit();
    });
    add('Rename this list', async () => {
      const name = await askText('Rename list', 'Name', list.name);
      if (name) { list.name = name; commit(); }
    });
    if (i > 0) add('Move this list earlier', () => { move(state.lists, i, -1); commit(); });
    if (i < state.lists.length - 1) add('Move this list later', () => { move(state.lists, i, 1); commit(); });
    add('Delete this list', async () => {
      if (!(await confirmSheet(`Delete ${list.name}?`, `Removes the list and its ${list.tasks.length} tasks. History is kept.`, 'Delete list'))) return;
      state.lists.splice(i, 1);
      commit();
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
      if (await confirmSheet('Clear history?', `Deletes the record of ${state.history.length} past days.`, 'Clear')) { state.history = []; commit(); }
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
  toast('Backup saved to your downloads');
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
    : tab === '#mention' ? mentionView()
      : tab === '#handover' ? handoverView()
        : tab === '#history' ? historyView()
          : codesView();
  $('#view').replaceChildren(...view.flat(Infinity).filter((n) => n != null && n !== false));
}

// Leaving the app locks the codes; coming back checks whether the day has turned over.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (vault.hasPin() && vault.status() === 'open') {
      vault.lock();
      revealed.clear();
      if (tab === '#codes') { closeSheet(); render(); }
    }
  } else if (rollover(state)) {
    commit();
  } else if (currentList() && !sheet.open) {
    render();
  }
});

// Keeps the "by 10:00" badges honest while the checklist is on screen.
setInterval(() => {
  if (currentList() && !sheet.open && !document.hidden) render();
}, 60000);

render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
