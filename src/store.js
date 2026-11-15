// State shape, persistence and the pure rules (what is due, what is late, day rollover).
// Nothing here touches the DOM, so `npm test` can run it in plain Node.

import { seedLists, eveningTasks, morningTasks, GAP_LABELS } from './seed.js';

export const KEY = 'shiftlist.v1';
export const SCHEMA = 1;
export const SEED_VERSION = 4;
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The working day rolls over at 04:00, so a late shift keeps its ticks past midnight.
const ROLLOVER_MIN = 4 * 60;

export const uid = () => Math.random().toString(36).slice(2, 10);

const shifted = (now) => new Date(now.getTime() - ROLLOVER_MIN * 60000);

export function dayKey(now = new Date()) {
  const d = shifted(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function weekday(now = new Date()) {
  return shifted(now).getDay();
}

export function isDue(task, wd) {
  return !task.days || task.days.length === 0 || task.days.includes(wd);
}

// Minutes since the 04:00 rollover, so "by 10:00" is not late at 01:00 on a late shift.
const sinceRollover = (mins) => (mins - ROLLOVER_MIN + 1440) % 1440;

export function isLate(task, now = new Date()) {
  if (!task.by) return false;
  const [h, m] = task.by.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  return sinceRollover(now.getHours() * 60 + now.getMinutes()) >= sinceRollover(h * 60 + m);
}

// Steps are edited as one line each. A line that is unchanged keeps its id, so its tick survives.
export function stepsFromText(text, old = []) {
  const pool = [...old];
  return String(text)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => {
      const i = pool.findIndex((o) => o.text === t);
      return i >= 0 ? pool.splice(i, 1)[0] : { id: uid(), text: t };
    });
}

// A task skipped for today is out of the count: it is neither done nor missed.
export const isSkipped = (t, ticks) => !!(ticks.skipped && ticks.skipped[t.id]) && !ticks.done[t.id];

// An optional ("only if needed") task counts once it is ticked, and is never reported as missed.
export const isIdleOptional = (t, ticks) => !!t.optional && !ticks.done[t.id];

export function progress(list, ticks, wd) {
  const due = list.tasks.filter((t) => isDue(t, wd) && !isSkipped(t, ticks) && !isIdleOptional(t, ticks));
  return { done: due.filter((t) => ticks.done[t.id]).length, total: due.length };
}

export function normaliseTask(t = {}) {
  return {
    id: t.id || uid(),
    title: String(t.title || '').trim() || 'Untitled',
    note: String(t.note || ''),
    steps: (t.steps || [])
      .map((s) => (typeof s === 'string' ? { id: uid(), text: s } : { id: s.id || uid(), text: String(s.text || '') }))
      .filter((s) => s.text.trim()),
    days: Array.isArray(t.days) ? [...new Set(t.days.filter((d) => d >= 0 && d <= 6))].sort() : [],
    by: /^\d{1,2}:\d{2}$/.test(t.by || '') ? t.by : '',
    optional: !!t.optional,
    // things to fill in on the day: a number, a tap-to-count counter, some text, a time,
    // or a link to the Deliveries tab. The values live in ticks.values, keyed by input id.
    inputs: (t.inputs || [])
      .map((i) => ({ id: i.id || uid(), label: String(i.label || '').trim(), type: INPUT_TYPES.includes(i.type) ? i.type : 'number' }))
      .filter((i) => i.label),
  };
}

export const INPUT_TYPES = ['number', 'counter', 'text', 'time', 'deliveries'];

const nowHHMM = (now = new Date()) => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

// One delivery that actually turned up today. deliveryId links it to the schedule; a delivery
// that was not on the schedule has none and carries its own name (its "type").
export function normaliseArrival(a = {}, now = new Date()) {
  return {
    id: a.id || uid(),
    deliveryId: a.deliveryId || '',
    name: String(a.name || '').trim(),
    at: /^\d{1,2}:\d{2}$/.test(a.at || '') ? a.at.padStart(5, '0') : nowHHMM(now),
    cages: a.cages === '' || a.cages == null || Number.isNaN(Number(a.cages)) ? '' : Math.max(0, Math.round(Number(a.cages))),
    temps: !!a.temps,
  };
}

export const arrivalFor = (d, ticks) => (ticks.arrivals || []).find((a) => a.deliveryId === d.id) || null;

export const HOW_URL = 'https://how.coop.co.uk/';

// A voice memo: when it was recorded, how long it is, its transcript (may be empty) and the
// id of the recording in the phone's blob store.
export function normaliseMemo(m = {}, now = new Date()) {
  return {
    id: m.id || uid(),
    at: Number(m.at) || now.getTime(),
    secs: Math.max(0, Math.round(Number(m.secs) || 0)),
    text: String(m.text || ''),
    audio: String(m.audio || ''),
  };
}

// A saved shortcut. Only web addresses are kept; "how.coop.co.uk/x" gets https:// put in front.
export function normaliseLink(l = {}) {
  let url = String(l.url || '').trim();
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { id: l.id || uid(), name: String(l.name || '').trim() || u.hostname, url: u.href };
  } catch {
    return null;
  }
}

export function normaliseDelivery(d = {}) {
  return {
    id: d.id || uid(),
    name: String(d.name || '').trim() || 'Delivery',
    time: /^\d{1,2}:\d{2}$/.test(d.time || '') ? d.time.padStart(5, '0') : '',
    days: Array.isArray(d.days) ? [...new Set(d.days.filter((x) => x >= 0 && x <= 6))].sort() : [],
    note: String(d.note || ''),
  };
}

// Deliveries due on a weekday, earliest first; ones with no time set go last.
export function dueDeliveries(deliveries, wd) {
  return deliveries
    .filter((d) => isDue(d, wd))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.name.localeCompare(b.name));
}

export const isOverdue = (d, ticks, now = new Date()) => !!d.time && !arrivalFor(d, ticks) && isLate({ by: d.time }, now);

// Seed 4: gap scans record four numbers (scanned, found, picked, correct). Any task that has
// the earlier found / picked pair gains the other two, keeping what it already has; the
// evening gap scan gets the set if it has no boxes of its own yet.
export function upgradeGapBoxes(lists) {
  const full = (inputs) => {
    const has = (label) => inputs.find((i) => i.label === label);
    const gaps = GAP_LABELS.map((label) => has(label) || { id: uid(), label, type: 'number' });
    return [...gaps, ...inputs.filter((i) => !GAP_LABELS.includes(i.label))];
  };
  for (const list of lists) {
    for (const t of list.tasks) {
      const labels = t.inputs.map((i) => i.label);
      const pair = labels.includes('Gaps found') && labels.includes('Gaps picked');
      const evening = t.title === 'Focused picking lists or full gap scan' && !t.inputs.length;
      if (pair || evening) t.inputs = full(t.inputs);
    }
  }
}

export const MORNING_ORDER_VERSION = 3;
const LATER_SCAN = 'Later picking list / gap scan (if needed)';

// Seed 3 (the morning routine as it is actually worked): drops OSA, turns "Picking list gap"
// into the later scan, adds the fill-in boxes and the new tasks, and puts the starting tasks in
// order. Tasks are matched by their starting titles, so anything renamed or added by hand is
// left alone and keeps its place after the task it followed.
export function upgradeMorning(list) {
  const seed = morningTasks().map(normaliseTask);
  const find = (title) => list.tasks.find((t) => t.title === title);
  list.tasks = list.tasks.filter((t) => t.title !== 'OSA app');
  const old = find('Picking list gap');
  if (old && !find(LATER_SCAN)) old.title = LATER_SCAN;
  const added = [LATER_SCAN, 'Orders that needed picking', "Adjustments I wasn't sure of"];
  for (const s of seed) {
    const mine = find(s.title);
    if (mine) {
      if (!mine.inputs.length) mine.inputs = s.inputs;
      mine.optional = mine.optional || s.optional;
    } else if (added.includes(s.title)) {
      list.tasks.push(s);
    }
  }
  let last = -1;
  const keyed = list.tasks.map((t, i) => {
    const rank = seed.findIndex((s) => s.title === t.title);
    last = rank >= 0 ? rank : last + 0.001;
    return { t, key: last, i };
  });
  list.tasks = keyed.sort((a, b) => a.key - b.key || a.i - b.i).map((k) => k.t);
}

export function normalise(raw, now = new Date()) {
  const lists = (raw && Array.isArray(raw.lists) ? raw.lists : seedLists()).map((l) => ({
    id: l.id || uid(),
    name: String(l.name || 'List'),
    tasks: (l.tasks || []).map(normaliseTask),
  }));
  // Starting content added after the first release reaches existing installs once, and only
  // where it cannot overwrite anything: seed 2 fills the Evening list if it is still empty.
  if (raw && Array.isArray(raw.lists) && (raw.seedVersion || 1) < 2) {
    const evening = lists.find((l) => l.id === 'evening');
    if (evening && evening.tasks.length === 0) evening.tasks = eveningTasks().map(normaliseTask);
  }
  if (raw && Array.isArray(raw.lists) && (raw.seedVersion || 1) < MORNING_ORDER_VERSION) {
    const morning = lists.find((l) => l.id === 'morning');
    if (morning) upgradeMorning(morning);
  }
  if (raw && Array.isArray(raw.lists) && (raw.seedVersion || 1) < 4) upgradeGapBoxes(lists);
  const state = {
    schema: SCHEMA,
    seedVersion: SEED_VERSION,
    lists,
    // the delivery schedule: what is due on which days and at what time
    deliveries: (raw && Array.isArray(raw.deliveries) ? raw.deliveries : []).map(normaliseDelivery),
    // done: task or step id -> the time (ms) it was ticked
    ticks: raw && raw.ticks && raw.ticks.date
      ? {
        date: raw.ticks.date,
        done: { ...raw.ticks.done },
        skipped: { ...raw.ticks.skipped },
        values: { ...raw.ticks.values },
        omit: { ...raw.ticks.omit },
        cash: { ...raw.ticks.cash },
        arrivals: (raw.ticks.arrivals || []).map((a) => normaliseArrival(a, now)),
      }
      : emptyTicks(dayKey(now)),
    settings: {
      hideDone: !!(raw && raw.settings && raw.settings.hideDone),
      transcribe: !(raw && raw.settings && raw.settings.transcribe === false),
      // which parts of the handover are written; anything not set to false is included
      handover: { ...(raw && raw.settings && raw.settings.handover) },
    },
    // private notes: kept until deleted, never part of the handover or the history
    notes: (raw && Array.isArray(raw.notes) ? raw.notes : [])
      .map((n) => ({ id: n.id || uid(), text: String(n.text || ''), at: Number(n.at) || now.getTime() })),
    // voice memos, newest first. They are kept until deleted (they do not reset each day).
    memos: (raw && Array.isArray(raw.memos) ? raw.memos : []).map((m) => normaliseMemo(m, now)),
    // shortcuts to pages on the How site (or anywhere else), shown on the How tab
    links: (raw && Array.isArray(raw.links) ? raw.links : []).map(normaliseLink).filter(Boolean),
    // things to mention at handover, for the current working day
    mentions: (raw && Array.isArray(raw.mentions) ? raw.mentions : [])
      .filter((m) => m && String(m.text || '').trim())
      .map((m) => ({ id: m.id || uid(), text: String(m.text).trim(), at: m.at || now.getTime(), photo: m.photo || '' })),
    history: raw && Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_DAYS) : [],
  };
  // Before arrivals had their own record, a delivery was just ticked: carry those ticks over.
  for (const d of state.deliveries) {
    const at = state.ticks.done[d.id];
    if (!at) continue;
    if (!arrivalFor(d, state.ticks)) {
      state.ticks.arrivals.push(normaliseArrival({ deliveryId: d.id, at: typeof at === 'number' ? hhmm(at) : '' }, now));
    }
    delete state.ticks.done[d.id];
  }
  rollover(state, now);
  return state;
}

// done: id -> time ticked. skipped: task id -> true. values: input id -> what was filled in.
// arrivals: the deliveries that turned up.
// omit: id -> true for single items left out of today's handover.
// cash: bag id -> how many bags were counted (Cashing up).
export const emptyTicks = (date) => ({ date, done: {}, skipped: {}, values: {}, arrivals: [], omit: {}, cash: {} });

// Bags of change: [id, coin, value of one full bag in pence]. These are the standard bank bag
// amounts. Everything is counted in whole pence so the totals never pick up rounding errors.
export const CASH_BAGS = [
  ['1p', '1p', 100],
  ['2p', '2p', 100],
  ['5p', '5p', 500],
  ['10p', '10p', 500],
  ['20p', '20p', 1000],
  ['50p', '50p', 1000],
  ['1', '£1', 2000],
  ['2', '£2', 2000],
];

export const money = (pence) => (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

export function cashTotals(counts = {}) {
  const rows = CASH_BAGS.map(([id, coin, bag]) => {
    const count = Math.max(0, Math.round(Number(counts[id]) || 0));
    return { id, coin, bag, count, pence: count * bag };
  });
  return {
    rows,
    bags: rows.reduce((n, r) => n + r.count, 0),
    pence: rows.reduce((n, r) => n + r.pence, 0),
  };
}

export const HISTORY_DAYS = 120;

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const weekdayOfKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

// One list as it stood on a day: what was ticked (and when) and what was left.
export function summariseList(list, ticks, wd) {
  const { done } = ticks;
  const due = list.tasks.filter((t) => isDue(t, wd));
  const values = ticks.values || {};
  // figures: numbers, counts and times filled in on a task. notes: free text filled in.
  const out = { name: list.name, total: 0, done: [], missed: [], skipped: [], figures: [], notes: [] };
  for (const t of due) {
    if (isSkipped(t, ticks)) {
      out.skipped.push({ id: t.id, title: t.title });
      continue;
    }
    const items = [];
    for (const i of t.inputs || []) {
      const v = values[i.id];
      if (v == null || String(v).trim() === '' || i.type === 'deliveries') continue;
      if (i.type === 'text') out.notes.push({ id: i.id, label: t.title === i.label || t.inputs.length === 1 ? t.title : `${t.title}: ${i.label}`, text: String(v).trim() });
      else items.push({ label: i.label, value: String(v) });
    }
    if (items.length) out.figures.push({ id: t.id, title: t.title, items });
    if (isIdleOptional(t, ticks)) continue;
    out.total += 1;
    if (done[t.id]) {
      out.done.push({ id: t.id, title: t.title, at: typeof done[t.id] === 'number' ? hhmm(done[t.id]) : '' });
    } else {
      const stepsDone = t.steps.filter((s) => done[s.id]).length;
      out.missed.push({ id: t.id, title: t.title, by: t.by || '', stepsDone, steps: t.steps.length });
    }
  }
  return out;
}

// Today's deliveries: the scheduled ones (arrived or not), then any that were not on the
// schedule. time is when it was due, at is when it arrived ('' if it has not).
export function summariseDeliveries(deliveries, ticks, wd) {
  const row = (name, time, a, id) => ({ id, name, time, at: a ? a.at : '', cages: a ? a.cages : '', temps: a ? a.temps : false });
  const extra = (ticks.arrivals || [])
    .filter((a) => !a.deliveryId || !deliveries.some((d) => d.id === a.deliveryId))
    .sort((a, b) => a.at.localeCompare(b.at));
  return [
    ...dueDeliveries(deliveries, wd).map((d) => row(d.name, d.time, arrivalFor(d, ticks), d.id)),
    ...extra.map((a) => row(a.name || 'Delivery', '', a, a.id)),
  ];
}

// "arrived 06:42, 4 cages, temps done" / "not arrived"
export function deliveryStatus(d) {
  if (!d.at) return 'not arrived';
  const bits = [d.at === 'yes' ? 'arrived' : `arrived ${d.at}`];
  if (d.cages !== '' && d.cages != null) bits.push(`${d.cages} cage${Number(d.cages) === 1 ? '' : 's'}`);
  if (d.temps != null) bits.push(d.temps ? 'temps done' : 'temps NOT done');
  return bits.join(', ');
}

// The record of a whole working day, kept in history.
export function snapshot(state) {
  const wd = weekdayOfKey(state.ticks.date);
  return {
    date: state.ticks.date,
    lists: state.lists.map((l) => summariseList(l, state.ticks, wd)).filter((l) => l.total + l.skipped.length > 0),
    mentions: state.mentions.map((m) => ({ text: m.text, at: hhmm(m.at), photo: m.photo || '' })),
    deliveries: summariseDeliveries(state.deliveries, state.ticks, wd),
    cash: cashTotals(state.ticks.cash),
  };
}

// "£109.00 in 14 bags"
export const cashLine = (c) => `${money(c.pence)} in ${c.bags} bag${c.bags === 1 ? '' : 's'}`;

const worthKeeping = (snap) => snap.mentions.length > 0
  || snap.lists.some((l) => l.done.length > 0 || l.figures.length > 0 || l.notes.length > 0)
  || snap.deliveries.some((d) => d.at)
  || snap.cash.bags > 0;

// The handover write-up for one list, as plain text ready to paste or send. Short capital
// headings and one fact per line, so it reads at a glance in a message. What still needs
// doing comes first, because that is what the next shift acts on.
// The parts of the handover that can be switched on or off. `full` marks parts that only exist
// in the detailed write-up.
export const HANDOVER_PARTS = [
  ['detailed', 'Detailed write-up (task lists)'],
  ['summary', 'Tasks done line'],
  ['figures', 'Numbers and counts'],
  ['notDone', 'Not done', 'full'],
  ['done', 'Done', 'full'],
  ['times', 'Times on done tasks', 'full'],
  ['skipped', 'Skipped today', 'full'],
  ['deliveries', 'Deliveries'],
  ['cash', 'Cashing up'],
  ['notes', 'Text boxes (adjustments and the like)'],
  ['mentions', 'Things to mention'],
  ['photos', 'Photos (with Share)'],
];

// Parts that are off until switched on: the handover is short by default and never lists
// what was not done unless asked to.
const PART_DEFAULT_OFF = { detailed: true, notDone: true };
export const handoverPartOn = (parts = {}, key) => (key in parts ? parts[key] !== false : !PART_DEFAULT_OFF[key]);

// "Morning" -> "AM", "Evening" -> "PM", anything else as it is.
export const shiftName = (name) => ({ morning: 'AM', evening: 'PM' }[String(name).trim().toLowerCase()] || name);

// "Gaps scanned 40, Gaps found 34" -> "40 scanned, 34 found"; a single box shows just its value.
function figureText(f) {
  if (f.items.length === 1) return f.items[0].value;
  const first = (l) => l.split(' ')[0].toLowerCase();
  const shared = f.items.every((i) => i.label.includes(' ') && first(i.label) === first(f.items[0].label));
  return f.items.map((i) => `${i.value} ${(shared ? i.label.slice(i.label.indexOf(' ') + 1) : i.label).toLowerCase()}`).join(', ');
}

// "Chilled 06:42, 4 cages, temps done" / "Bread (due 07:15) not in yet"
function deliveryShort(d) {
  if (!d.at) return `${d.name}${d.time ? ` (due ${d.time})` : ''} not in yet`;
  return `${d.name} ${deliveryStatus(d).replace(/^arrived /, '').replace(/^arrived$/, 'in')}`;
}

// The short handover: a line for the tasks, then only what the next shift needs to know.
function compactHandover(summary, mentions, dateKey, deliveries, now, on, kept, cash) {
  const shift = shiftName(summary.name);
  const lines = [`HANDOVER: ${shift}, ${prettyDate(dateKey)}, ${nowHHMM(now)}`, ''];
  if (on('summary') && summary.total) {
    const all = summary.done.length === summary.total;
    lines.push(all ? `${shift} tasks done` : `${shift} tasks done: ${summary.done.length} of ${summary.total}`);
  }
  if (on('figures')) for (const f of kept(summary.figures || [])) lines.push(`${f.title}: ${figureText(f)}`);
  const dels = on('deliveries') ? kept(deliveries) : [];
  if (dels.length) lines.push(`Deliveries: ${dels.map(deliveryShort).join('; ')}`);
  if (on('cash') && cash && cash.bags) lines.push(`Cashing up: ${cashLine(cash)}`);
  if (on('notes')) {
    for (const n of kept(summary.notes || [])) {
      lines.push(`${n.label}: ${n.text.split('\n').map((l) => l.trim()).filter(Boolean).join('; ')}`);
    }
  }
  if (on('mentions')) {
    const rows = kept(mentions);
    if (rows.length) lines.push('', 'To mention:', ...rows.map((m) => `- ${m.text}${m.photo && on('photos') ? ' (photo)' : ''}`));
  }
  while (lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

// opts.parts: { key: false } switches a whole part off. opts.omit: { id: true } leaves a
// single task, delivery, text box or thing to mention out. The counts in the summary are
// always the true ones, whatever is left out of the lists below it.
export function handoverText(summary, mentions, dateKey, deliveries = [], now = new Date(), opts = {}) {
  const parts = opts.parts || {};
  const omit = opts.omit || {};
  const on = (key) => handoverPartOn(parts, key);
  const kept = (rows) => rows.filter((r) => !omit[r.id]);
  if (!on('detailed')) return compactHandover(summary, mentions, dateKey, deliveries, now, on, kept, opts.cash);
  const lines = [];
  const section = (title, rows) => {
    if (!rows.length) return;
    lines.push('', title, ...rows);
  };
  const missedLine = (t) => {
    const bits = [];
    if (t.steps && t.stepsDone) bits.push(`${t.stepsDone} of ${t.steps} steps done`);
    if (t.by) bits.push(`due by ${t.by}`);
    return `- ${t.title}${bits.length ? ` (${bits.join(', ')})` : ''}`;
  };
  const skipped = summary.skipped || [];
  const figures = summary.figures || [];
  const notes = summary.notes || [];
  const arrived = deliveries.filter((d) => d.at);

  lines.push(`HANDOVER: ${summary.name.toUpperCase()}`, `${prettyDate(dateKey)}, written ${nowHHMM(now)}`);

  if (on('summary')) {
    const tasks = [`${summary.done.length} of ${summary.total} done`];
    if (summary.missed.length) tasks.push(`${summary.missed.length} not done`);
    if (skipped.length) tasks.push(`${skipped.length} skipped`);
    const overview = [`- Tasks: ${tasks.join(', ')}`];
    if (on('figures')) for (const f of kept(figures)) overview.push(`- ${f.title}: ${f.items.map((i) => `${i.label} ${i.value}`).join(', ')}`);
    if (deliveries.length && on('deliveries')) {
      overview.push(`- Deliveries: ${arrived.length} of ${deliveries.length} in, temps done on ${arrived.filter((d) => d.temps).length}`);
    }
    section('SUMMARY', overview);
  }

  if (on('notDone')) {
    const missed = kept(summary.missed);
    section(`NOT DONE (${missed.length})`, summary.missed.length
      ? missed.map(missedLine)
      : (summary.total ? ['- Nothing: everything is complete.'] : []));
  }
  if (on('done')) {
    const done = kept(summary.done);
    section(`DONE (${done.length})`, done.map((t) => `- ${t.at && on('times') ? `${t.at}  ` : ''}${t.title}`));
  }
  if (on('skipped')) {
    const rows = kept(skipped);
    section(`SKIPPED TODAY, NOT NEEDED (${rows.length})`, rows.map((t) => `- ${t.title}`));
  }
  if (on('deliveries')) {
    section('DELIVERIES', kept(deliveries).map((d) => `- ${d.name}${d.time ? ` (due ${d.time})` : ''}: ${deliveryStatus(d)}`));
  }
  if (on('cash') && opts.cash && opts.cash.bags) {
    section(`CASHING UP: ${cashLine(opts.cash)}`, opts.cash.rows.filter((r) => r.count)
      .map((r) => `- ${r.coin}: ${r.count} × ${money(r.bag)} = ${money(r.pence)}`));
  }
  if (on('notes')) {
    for (const n of kept(notes)) section(n.label.toUpperCase(), n.text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `- ${l}`));
  }
  if (on('mentions')) {
    const rows = kept(mentions);
    section('THINGS TO MENTION', rows.length
      ? rows.map((m) => `- ${m.text}${m.photo && on('photos') ? ' (photo attached)' : ''}`)
      : ['- Nothing to pass on']);
  }
  return lines.join('\n');
}

export function load(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(KEY));
  } catch {
    raw = null;
  }
  return normalise(raw);
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// When the working day has changed: file the old day in history, then start clean.
// Returns true if it did.
export function rollover(state, now = new Date()) {
  const today = dayKey(now);
  if (state.ticks.date === today) return false;
  const snap = snapshot(state);
  if (worthKeeping(snap)) {
    state.history = [snap, ...state.history.filter((h) => h.date !== snap.date)].slice(0, HISTORY_DAYS);
  }
  state.ticks = emptyTicks(today);
  state.mentions = [];
  return true;
}

// Every stored file (photo or recording) still referenced by today's notes, history or a
// memo; anything else can be deleted.
export function photoIds(state) {
  return [
    ...(state.memos || []).map((m) => m.audio),
    ...state.mentions.map((m) => m.photo),
    ...state.history.flatMap((h) => (h.mentions || []).map((m) => m.photo)),
  ].filter(Boolean);
}

export function move(arr, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= arr.length) return false;
  const [item] = arr.splice(index, 1);
  arr.splice(to, 0, item);
  return true;
}
