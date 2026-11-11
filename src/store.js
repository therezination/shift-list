// State shape, persistence and the pure rules (what is due, what is late, day rollover).
// Nothing here touches the DOM, so `npm test` can run it in plain Node.

import { seedLists, eveningTasks } from './seed.js';

export const KEY = 'shiftlist.v1';
export const SCHEMA = 1;
export const SEED_VERSION = 2;
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

export function progress(list, ticks, wd) {
  const due = list.tasks.filter((t) => isDue(t, wd) && !isSkipped(t, ticks));
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
  };
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

export const isOverdue = (d, ticks, now = new Date()) => !!d.time && !ticks.done[d.id] && isLate({ by: d.time }, now);

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
  const state = {
    schema: SCHEMA,
    seedVersion: SEED_VERSION,
    lists,
    // the delivery schedule: what is due on which days and at what time
    deliveries: (raw && Array.isArray(raw.deliveries) ? raw.deliveries : []).map(normaliseDelivery),
    // done: task or step id -> the time (ms) it was ticked
    ticks: raw && raw.ticks && raw.ticks.date
      ? { date: raw.ticks.date, done: { ...raw.ticks.done }, skipped: { ...raw.ticks.skipped } }
      : { date: dayKey(now), done: {}, skipped: {} },
    settings: { hideDone: !!(raw && raw.settings && raw.settings.hideDone) },
    // things to mention at handover, for the current working day
    mentions: (raw && Array.isArray(raw.mentions) ? raw.mentions : [])
      .filter((m) => m && String(m.text || '').trim())
      .map((m) => ({ id: m.id || uid(), text: String(m.text).trim(), at: m.at || now.getTime(), photo: m.photo || '' })),
    history: raw && Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_DAYS) : [],
  };
  rollover(state, now);
  return state;
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
  const out = { name: list.name, total: 0, done: [], missed: [], skipped: [] };
  for (const t of due) {
    if (isSkipped(t, ticks)) {
      out.skipped.push({ title: t.title });
      continue;
    }
    out.total += 1;
    if (done[t.id]) {
      out.done.push({ title: t.title, at: typeof done[t.id] === 'number' ? hhmm(done[t.id]) : '' });
    } else {
      const stepsDone = t.steps.filter((s) => done[s.id]).length;
      out.missed.push({ title: t.title, by: t.by || '', stepsDone, steps: t.steps.length });
    }
  }
  return out;
}

// Today's deliveries with the time each one was marked as arrived ('' if it was not).
export function summariseDeliveries(deliveries, ticks, wd) {
  return dueDeliveries(deliveries, wd).map((d) => ({
    name: d.name,
    time: d.time,
    at: ticks.done[d.id] ? (typeof ticks.done[d.id] === 'number' ? hhmm(ticks.done[d.id]) : 'yes') : '',
  }));
}

// The record of a whole working day, kept in history.
export function snapshot(state) {
  const wd = weekdayOfKey(state.ticks.date);
  return {
    date: state.ticks.date,
    lists: state.lists.map((l) => summariseList(l, state.ticks, wd)).filter((l) => l.total + l.skipped.length > 0),
    mentions: state.mentions.map((m) => ({ text: m.text, at: hhmm(m.at), photo: m.photo || '' })),
    deliveries: summariseDeliveries(state.deliveries, state.ticks, wd),
  };
}

const worthKeeping = (snap) => snap.mentions.length > 0
  || snap.lists.some((l) => l.done.length > 0)
  || snap.deliveries.some((d) => d.at);

// The handover write-up for one list, as plain text ready to paste or send.
export function handoverText(summary, mentions, dateKey, deliveries = []) {
  const lines = [`Handover: ${summary.name}, ${prettyDate(dateKey)}`, ''];
  lines.push(`Done (${summary.done.length} of ${summary.total}):`);
  if (summary.done.length) for (const t of summary.done) lines.push(`- ${t.title}${t.at ? ` (${t.at})` : ''}`);
  else lines.push('- Nothing ticked yet');
  lines.push('');
  if (summary.missed.length) {
    lines.push('Not done:');
    for (const t of summary.missed) {
      const bits = [];
      if (t.steps && t.stepsDone) bits.push(`${t.stepsDone} of ${t.steps} steps done`);
      if (t.by) bits.push(`due by ${t.by}`);
      lines.push(`- ${t.title}${bits.length ? ` (${bits.join(', ')})` : ''}`);
    }
  } else if (summary.total) {
    lines.push('Not done: nothing, all complete.');
  }
  if (summary.skipped && summary.skipped.length) {
    lines.push('');
    lines.push('Skipped today (not needed):');
    for (const t of summary.skipped) lines.push(`- ${t.title}`);
  }
  if (deliveries.length) {
    lines.push('');
    lines.push('Deliveries:');
    for (const d of deliveries) {
      const due = d.time ? `, due ${d.time}` : '';
      lines.push(`- ${d.name}${due}: ${d.at ? (d.at === 'yes' ? 'arrived' : `arrived ${d.at}`) : 'not arrived'}`);
    }
  }
  lines.push('');
  lines.push('Things to mention:');
  if (mentions.length) for (const m of mentions) lines.push(`- ${m.text}${m.photo ? ' (photo attached)' : ''}`);
  else lines.push('- Nothing to pass on');
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
  state.ticks = { date: today, done: {}, skipped: {} };
  state.mentions = [];
  return true;
}

// Every photo still referenced by today's notes or by history; anything else can be deleted.
export function photoIds(state) {
  return [
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
