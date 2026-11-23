import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, weekday, isDue, isLate, stepsFromText, normalise, rollover, progress, emptyTicks,
  summariseList, handoverText, move, photoIds, dueDeliveries, isOverdue, summariseDeliveries,
  snapshot, normaliseArrival, deliveryStatus,
} from '../src/store.js';

const at = (iso) => new Date(iso);
const WED = 3;
const fresh = (iso = '2026-11-11T08:00:00') => normalise(null, at(iso));
const task = (list, title) => list.tasks.find((t) => t.title === title);

test('the working day rolls over at 04:00, not midnight', () => {
  assert.equal(dayKey(at('2026-11-11T23:30:00')), '2026-11-11');
  assert.equal(dayKey(at('2026-11-12T01:30:00')), '2026-11-11');
  assert.equal(dayKey(at('2026-11-12T04:00:00')), '2026-11-12');
  assert.equal(weekday(at('2026-11-12T01:30:00')), WED);
});

test('day rules: no days means every day', () => {
  assert.ok(isDue({ days: [] }, 2));
  assert.ok(isDue({ days: [1, 4, 6] }, 4));
  assert.ok(!isDue({ days: [1, 4, 6] }, 2));
});

test('late badge respects the rollover', () => {
  const t = { by: '10:00' };
  assert.ok(!isLate(t, at('2026-11-11T09:59:00')));
  assert.ok(isLate(t, at('2026-11-11T10:00:00')));
  assert.ok(isLate(t, at('2026-11-12T01:00:00'))); // late shift, same working day
  assert.ok(!isLate(t, at('2026-11-12T05:00:00')));
  assert.ok(!isLate({ by: '' }, at('2026-11-11T23:00:00')));
});

test('editing steps keeps the ids of unchanged lines', () => {
  const old = [{ id: 'a', text: 'Papers' }, { id: 'b', text: 'Red keys' }];
  const next = stepsFromText('Red keys\n\n  Headset \nPapers', old);
  assert.deepEqual(next.map((s) => s.text), ['Red keys', 'Headset', 'Papers']);
  assert.equal(next[0].id, 'b');
  assert.equal(next[2].id, 'a');
});

test('a fresh install has the morning in working order, with its fill-in boxes', () => {
  const s = fresh();
  assert.deepEqual(s.lists.map((l) => l.name), ['Morning', 'Evening']);
  const titles = s.lists[0].tasks.map((t) => t.title);
  assert.deepEqual(titles.slice(0, 5), [
    'MyWork AM manual temp checks', 'MyWork store checks before store opens', 'Chilled backup', 'Frozen backup', 'AM gap scan',
  ]);
  assert.ok(!titles.includes('OSA app'));
  assert.deepEqual(task(s.lists[0], 'Frozen backup').days, [1, 4, 6]);
  assert.deepEqual(task(s.lists[0], 'AM gap scan').inputs.map((i) => `${i.label}:${i.type}`), ['Gaps scanned:number', 'Gaps found:number', 'Gaps picked:number', 'Gaps correct:number']);
  assert.equal(task(s.lists[0], 'Orders that needed picking').inputs[0].type, 'counter');
  assert.equal(titles.at(-1), "Adjustments I wasn't sure of");
  const ids = s.lists.flatMap((l) => l.tasks.flatMap((t) => [t.id, ...t.steps.map((x) => x.id), ...t.inputs.map((x) => x.id)]));
  assert.equal(new Set(ids).size, ids.length);
});

test('an older install is brought up to the new morning without losing its own changes', () => {
  const now = at('2026-11-12T08:00:00');
  const old = {
    seedVersion: 2,
    lists: [{
      id: 'morning',
      name: 'Morning',
      tasks: [
        { id: 't1', title: 'MyWork AM manual temp checks', steps: ['My own step'] },
        { id: 'mine', title: 'Check the car park' },
        { id: 'gap', title: 'AM gap scan', by: '10:00' },
        { id: 'osa', title: 'OSA app' },
        { id: 'costa', title: 'Costa milk' },
        { id: 'plg', title: 'Picking list gap' },
        { id: 'pw', title: 'MyWork AM power walk' },
      ],
    }, { id: 'evening', name: 'Evening', tasks: [{ title: 'Mine' }] }],
  };
  const s = normalise(old, now);
  const m = s.lists[0];
  assert.deepEqual(m.tasks.map((t) => t.title), [
    'MyWork AM manual temp checks',
    'Check the car park', // hand-added: stays after the task it followed
    'AM gap scan',
    'MyWork AM power walk',
    'Later picking list / gap scan (if needed)', // was "Picking list gap", same id
    'Orders that needed picking',
    'Costa milk',
    "Adjustments I wasn't sure of",
  ]);
  assert.equal(task(m, 'Later picking list / gap scan (if needed)').id, 'plg');
  assert.deepEqual(task(m, 'MyWork AM manual temp checks').steps.map((x) => x.text), ['My own step']);
  assert.equal(task(m, 'AM gap scan').inputs.length, 4);
  assert.ok(!task(m, 'Chilled backup')); // deleted by hand before: not brought back
  assert.deepEqual(s.lists[1].tasks.map((t) => t.title), ['Mine']);
  assert.equal(s.seedVersion, 4);

  // and it only ever happens once
  const again = JSON.parse(JSON.stringify(s));
  again.lists[0].tasks.reverse();
  assert.equal(normalise(again, now).lists[0].tasks[0].title, "Adjustments I wasn't sure of");
});

test('an install from before the evening list existed gets it once, if Evening is still empty', () => {
  const now = at('2026-11-11T18:00:00');
  const old = JSON.parse(JSON.stringify(normalise(null, now)));
  delete old.seedVersion;
  old.lists[1].tasks = [];
  assert.equal(normalise(old, now).lists[1].tasks.length, 16);
  const emptied = JSON.parse(JSON.stringify(normalise(old, now)));
  emptied.lists[1].tasks = [];
  assert.equal(normalise(emptied, now).lists[1].tasks.length, 0);
});

test('rollover files the day in history and clears everything filled in', () => {
  const s = fresh();
  const [a, b] = s.lists[0].tasks;
  const gap = task(s.lists[0], 'AM gap scan');
  s.ticks.done[a.id] = at('2026-11-11T08:05:00').getTime();
  s.ticks.done[b.steps[0].id] = 1;
  s.ticks.values[gap.inputs[1].id] = '34';
  s.mentions.push({ id: 'm', text: 'Freezer 2 alarm', at: at('2026-11-11T09:00:00').getTime(), photo: 'p1' });

  assert.equal(rollover(s, at('2026-11-11T22:00:00')), false);
  assert.equal(rollover(s, at('2026-11-12T06:00:00')), true);
  assert.deepEqual(s.ticks, emptyTicks('2026-11-12'));
  assert.deepEqual(s.mentions, []);
  const day = s.history[0];
  assert.equal(day.date, '2026-11-11');
  assert.deepEqual(day.lists.map((l) => l.name), ['Morning', 'Evening']);
  assert.deepEqual(day.lists[0].done, [{ id: a.id, title: a.title, at: '08:05' }]);
  assert.deepEqual(day.lists[0].figures, [{ id: gap.id, title: 'AM gap scan', items: [{ label: 'Gaps found', value: '34' }] }]);
  assert.equal(day.mentions[0].photo, 'p1');
  assert.deepEqual(photoIds(s), ['p1']);
  // Wednesday: Frozen backup (Mon Thu Sat) was not due, so it is not "missed"
  assert.ok(!day.lists[0].missed.some((t) => t.title === 'Frozen backup'));
});

test('an untouched day off is not filed, and an old save is rolled over when loaded', () => {
  const s = fresh();
  rollover(s, at('2026-11-12T08:00:00'));
  assert.equal(s.history.length, 0);

  const t = fresh();
  t.ticks.done[t.lists[0].tasks[0].id] = 1;
  const later = normalise(JSON.parse(JSON.stringify(t)), at('2026-11-13T08:00:00'));
  assert.equal(later.ticks.date, '2026-11-13');
  assert.equal(later.history[0].date, '2026-11-11');
});

test('skipped tasks leave the count; ticking one counts it again', () => {
  const s = fresh();
  const [a] = s.lists[0].tasks;
  const before = progress(s.lists[0], s.ticks, WED).total;
  s.ticks.skipped[a.id] = true;
  assert.equal(progress(s.lists[0], s.ticks, WED).total, before - 1);
  s.ticks.done[a.id] = 1;
  assert.deepEqual(progress(s.lists[0], s.ticks, WED), { done: 1, total: before });
});

test('deliveries: due by weekday, earliest first, overdue until one arrives', () => {
  const now = at('2026-11-11T07:00:00');
  const s = normalise({
    lists: [],
    deliveries: [
      { id: 'b', name: 'Bread', time: '7:15' },
      { id: 'g', name: 'Greencore', time: '06:30', days: [1, 3, 5] },
      { id: 'n', name: 'Newspapers' },
      { id: 'f', name: 'Frozen', time: '05:00', days: [2] },
    ],
  }, now);
  assert.equal(s.deliveries[0].time, '07:15');
  const today = dueDeliveries(s.deliveries, WED);
  assert.deepEqual(today.map((d) => d.name), ['Greencore', 'Bread', 'Newspapers']);
  assert.ok(isOverdue(today[0], s.ticks, now));
  assert.ok(!isOverdue(today[1], s.ticks, now)); // 07:15 not reached
  assert.ok(!isOverdue(today[2], s.ticks, now)); // no time set

  s.ticks.arrivals.push(normaliseArrival({ deliveryId: 'g', at: '6:42', cages: '4', temps: true }, now));
  s.ticks.arrivals.push(normaliseArrival({ name: 'Ambient', cages: 1 }, now)); // not on the schedule, arrived "now"
  assert.ok(!isOverdue(today[0], s.ticks, now));

  const sum = summariseDeliveries(s.deliveries, s.ticks, WED);
  assert.deepEqual(sum[0], { id: 'g', name: 'Greencore', time: '06:30', at: '06:42', cages: 4, temps: true });
  assert.deepEqual(sum.at(-1), { id: s.ticks.arrivals[1].id, name: 'Ambient', time: '', at: '07:00', cages: 1, temps: false });
  assert.equal(deliveryStatus(sum[0]), 'arrived 06:42, 4 cages, temps done');
  assert.equal(deliveryStatus(sum.at(-1)), 'arrived 07:00, 1 cage, temps NOT done');
  assert.equal(deliveryStatus(sum[1]), 'not arrived');

  assert.equal(snapshot(s).deliveries.length, 4);
  rollover(s, at('2026-11-12T08:00:00'));
  assert.equal(s.history[0].deliveries[0].at, '06:42'); // an arrival alone is worth filing
  assert.deepEqual(s.ticks.arrivals, []);
});

test('a delivery ticked in the previous version becomes an arrival', () => {
  const now = at('2026-11-11T09:00:00');
  const s = normalise({
    lists: [],
    deliveries: [{ id: 'g', name: 'Greencore', time: '06:30' }],
    ticks: { date: '2026-11-11', done: { g: at('2026-11-11T06:42:00').getTime() } },
  }, now);
  assert.equal(s.ticks.done.g, undefined);
  assert.equal(s.ticks.arrivals[0].deliveryId, 'g');
  assert.equal(s.ticks.arrivals[0].at, '06:42');
});

test('the handover is a detailed, sectioned write-up', () => {
  const s = fresh();
  const list = s.lists[0];
  const done = {};
  for (const t of list.tasks) done[t.id] = at('2026-11-11T07:30:00').getTime();
  const gap = task(list, 'AM gap scan');
  const power = task(list, 'MyWork AM power walk');
  const orders = task(list, 'Orders that needed picking');
  const adj = task(list, "Adjustments I wasn't sure of");
  delete done[gap.id];
  delete done[power.id];
  done[gap.steps[0].id] = 1;
  const ticks = {
    done,
    skipped: { [power.id]: true },
    values: { [gap.inputs[0].id]: '40', [gap.inputs[1].id]: '34', [gap.inputs[2].id]: '28', [gap.inputs[3].id]: '26', [orders.inputs[0].id]: 6, [adj.inputs[0].id]: 'Milk 2L, wrote off 3\n\nCrisps count looked wrong' },
  };
  const sum = summariseList(list, ticks, WED);
  assert.equal(sum.total, list.tasks.length - 2); // minus Frozen backup (not Wednesday) and the skipped one
  assert.deepEqual(progress(list, ticks, WED), { done: sum.total - 1, total: sum.total });

  const deliveries = [
    { name: 'Greencore', time: '06:30', at: '06:42', cages: 4, temps: true },
    { name: 'Bread', time: '07:15', at: '', cages: '', temps: false },
  ];
  const FULL = { parts: { detailed: true, notDone: true } };
  const text = handoverText(sum, [{ text: 'Short on milk' }, { text: 'Damaged delivery', photo: 'p1' }], '2026-11-11', deliveries, at('2026-11-11T13:58:00'), FULL);
  const expectStart = [
    'HANDOVER: MORNING',
    'Wed 11 Nov, written 13:58',
    '',
    'SUMMARY',
    `- Tasks: ${sum.total - 1} of ${sum.total} done, 1 not done, 1 skipped`,
    '- AM gap scan: Gaps scanned 40, Gaps found 34, Gaps picked 28, Gaps correct 26',
    '- Orders that needed picking: Orders 6',
    '- Deliveries: 1 of 2 in, temps done on 1',
    '',
    'NOT DONE (1)',
    '- AM gap scan (1 of 5 steps done, due by 10:00)',
    '',
    `DONE (${sum.total - 1})`,
    '- 07:30  MyWork AM manual temp checks',
  ].join('\n');
  assert.ok(text.startsWith(expectStart), text);
  assert.match(text, /\nSKIPPED TODAY, NOT NEEDED \(1\)\n- MyWork AM power walk\n/);
  assert.match(text, /\nDELIVERIES\n- Greencore \(due 06:30\): arrived 06:42, 4 cages, temps done\n- Bread \(due 07:15\): not arrived\n/);
  assert.match(text, /\nADJUSTMENTS I WASN'T SURE OF\n- Milk 2L, wrote off 3\n- Crisps count looked wrong\n/);
  assert.ok(text.endsWith('THINGS TO MENTION\n- Short on milk\n- Damaged delivery (photo attached)'));
  assert.doesNotMatch(text, /Frozen backup/);

  const empty = handoverText(summariseList(list, emptyTicks('2026-11-11'), WED), [], '2026-11-11', [], at('2026-11-11T06:00:00'), FULL);
  assert.doesNotMatch(empty, /\nDONE|\nDELIVERIES|\nSKIPPED/);
  assert.match(empty, /THINGS TO MENTION\n- Nothing to pass on$/);
});

test('"only if needed" tasks are not counted or reported as missed until ticked, but their figures still show', () => {
  const s = fresh();
  const list = s.lists[0];
  const orders = task(list, 'Orders that needed picking');
  assert.ok(orders.optional);
  const base = progress(list, s.ticks, WED).total;
  assert.equal(base, list.tasks.filter((t) => !t.optional && isDue(t, WED)).length);
  s.ticks.values[orders.inputs[0].id] = 3;
  let sum = summariseList(list, s.ticks, WED);
  assert.ok(!sum.missed.some((t) => t.title === orders.title));
  assert.deepEqual(sum.figures, [{ id: orders.id, title: orders.title, items: [{ label: 'Orders', value: '3' }] }]);
  s.ticks.done[orders.id] = 1;
  sum = summariseList(list, s.ticks, WED);
  assert.equal(sum.total, base + 1);
  assert.ok(sum.done.some((t) => t.title === orders.title));
});

test('move stays inside the array', () => {
  const a = [1, 2, 3];
  assert.equal(move(a, 0, -1), false);
  assert.equal(move(a, 0, 1), true);
  assert.deepEqual(a, [2, 1, 3]);
});

test('shortcuts keep only web addresses and get https:// when it is left off', async () => {
  const { normaliseLink } = await import('../src/store.js');
  assert.equal(normaliseLink({ name: 'RTC', url: 'how.coop.co.uk/rtc' }).url, 'https://how.coop.co.uk/rtc');
  assert.equal(normaliseLink({ url: 'https://how.coop.co.uk/' }).name, 'how.coop.co.uk');
  assert.equal(normaliseLink({ name: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(normaliseLink({ name: 'x', url: '' }), null);
  const s = normalise({ lists: [], links: [{ name: 'A', url: 'how.coop.co.uk/a' }, { url: 'data:text/html,x' }] }, at('2026-11-14T08:00:00'));
  assert.deepEqual(s.links.map((l) => l.name), ['A']);
});

test('voice memos are kept across days and their recordings are protected from the sweep', () => {
  const s = normalise({ lists: [], memos: [{ at: 5, secs: 12.4, text: 'Check cage 3', audio: 'a1' }, {}] }, at('2026-11-14T08:00:00'));
  assert.deepEqual(s.memos[0], { id: s.memos[0].id, at: 5, secs: 12, text: 'Check cage 3', audio: 'a1' });
  assert.equal(s.memos[1].audio, '');
  assert.equal(s.settings.transcribe, true);
  rollover(s, at('2026-11-15T08:00:00'));
  assert.equal(s.memos.length, 2);
  assert.deepEqual(photoIds(s), ['a1']);
  assert.equal(normalise({ lists: [], settings: { transcribe: false } }).settings.transcribe, false);
});

test('handover parts and single items can be left out; summary counts stay true', () => {
  const s = fresh();
  const list = s.lists[0];
  const [a, b, c] = list.tasks;
  s.ticks.done[a.id] = at('2026-11-11T07:30:00').getTime();
  s.ticks.done[b.id] = at('2026-11-11T07:45:00').getTime();
  const sum = summariseList(list, s.ticks, WED);
  const mentions = [{ id: 'm1', text: 'Short on milk' }, { id: 'm2', text: 'Private note', photo: 'p' }];
  const dels = [{ id: 'd1', name: 'Chilled', time: '06:30', at: '06:42', cages: 4, temps: true }];
  const write = (opts = {}) => handoverText(sum, mentions, '2026-11-11', dels, at('2026-11-11T13:00:00'),
    { ...opts, parts: { detailed: true, notDone: true, ...(opts.parts || {}) } });

  const full = write({});

  assert.match(full, /- 07:30 {2}MyWork AM manual temp checks/);

  const text = write({ parts: { times: false, deliveries: false, skipped: false, photos: false }, omit: { [b.id]: true, [c.id]: true, m2: true } });
  assert.match(text, /- Tasks: 2 of \d+ done/); // true count, though one done task is left out
  assert.match(text, /\nDONE \(1\)\n- MyWork AM manual temp checks\n/);
  assert.doesNotMatch(text, /store checks before store opens|Chilled backup|DELIVERIES|Deliveries:|Private note|07:30/);
  assert.match(text, /THINGS TO MENTION\n- Short on milk$/);

  assert.doesNotMatch(write({ parts: { summary: false } }), /SUMMARY/);
  assert.doesNotMatch(write({ parts: { mentions: false } }), /THINGS TO MENTION/);
  assert.match(write({ omit: { m1: true, m2: true } }), /THINGS TO MENTION\n- Nothing to pass on$/);

  // unticked items come back the next day; switched-off parts are remembered
  s.ticks.omit.m1 = true;
  s.settings.handover.times = false;
  const next = normalise(JSON.parse(JSON.stringify(s)), at('2026-11-12T08:00:00'));
  assert.deepEqual(next.ticks.omit, {});
  assert.equal(next.settings.handover.times, false);
});

test('gap scans gain scanned and correct boxes without losing what was typed', () => {
  const now = at('2026-11-14T09:00:00');
  const old = {
    seedVersion: 3,
    lists: [
      { id: 'morning', name: 'Morning', tasks: [
        { id: 'gap', title: 'My gap scan', inputs: [{ id: 'f', label: 'Gaps found', type: 'number' }, { id: 'p', label: 'Gaps picked', type: 'number' }, { id: 'x', label: 'Aisle', type: 'text' }] },
        { id: 'other', title: 'Orders', inputs: [{ id: 'o', label: 'Orders', type: 'counter' }] },
      ] },
      { id: 'evening', name: 'Evening', tasks: [{ id: 'e', title: 'Focused picking lists or full gap scan' }] },
    ],
    ticks: { date: '2026-11-14', done: {}, values: { f: '34', p: '28' } },
  };
  const s = normalise(old, now);
  const gap = s.lists[0].tasks[0];
  assert.deepEqual(gap.inputs.map((i) => i.label), ['Gaps scanned', 'Gaps found', 'Gaps picked', 'Gaps correct', 'Aisle']);
  assert.deepEqual([gap.inputs[1].id, gap.inputs[2].id], ['f', 'p']);
  assert.equal(s.ticks.values.f, '34');
  assert.deepEqual(s.lists[0].tasks[1].inputs.map((i) => i.label), ['Orders']);
  assert.equal(s.lists[1].tasks[0].inputs.length, 4);
  // only once: removing a box afterwards sticks
  const again = JSON.parse(JSON.stringify(s));
  again.lists[0].tasks[0].inputs.pop();
  again.lists[0].tasks[0].inputs.shift();
  assert.deepEqual(normalise(again, now).lists[0].tasks[0].inputs.map((i) => i.label), ['Gaps found', 'Gaps picked', 'Gaps correct']);
});

test('private notes are kept across days and never reach the handover or history', () => {
  const s = fresh();
  s.notes.push({ id: 'n', text: 'Ask about holiday', at: 5 });
  s.ticks.done[s.lists[0].tasks[0].id] = 1;
  const text = handoverText(summariseList(s.lists[0], s.ticks, WED), s.mentions, s.ticks.date);
  assert.doesNotMatch(text, /holiday/);
  const next = normalise(JSON.parse(JSON.stringify(s)), at('2026-11-12T08:00:00'));
  assert.deepEqual(next.notes, [{ id: 'n', text: 'Ask about holiday', at: 5 }]);
  assert.doesNotMatch(JSON.stringify(next.history), /holiday/);
});

test('cashing up: bag values, totals in whole pence, and a fresh count each day', async () => {
  const { cashTotals, money } = await import('../src/store.js');
  const t = cashTotals({ '1p': 3, '2p': 1, '5p': 2, '10p': 1, '20p': 4, x: 9, '50p': -2 });
  assert.deepEqual(t.rows.filter((r) => r.count).map((r) => [r.coin, r.count, r.pence]),
    [['1p', 3, 300], ['2p', 1, 100], ['5p', 2, 1000], ['10p', 1, 500], ['20p', 4, 4000]]);
  assert.equal(t.bags, 11);
  assert.equal(t.pence, 5900);
  assert.equal(money(t.pence), '£59.00');
  assert.equal(money(123456), '£1,234.56');

  const s = fresh();
  s.ticks.cash['20p'] = 2;
  const same = normalise(JSON.parse(JSON.stringify(s)), at('2026-11-11T22:00:00'));
  assert.equal(same.ticks.cash['20p'], 2);
  const next = normalise(JSON.parse(JSON.stringify(s)), at('2026-11-12T08:00:00'));
  assert.deepEqual(next.ticks.cash, {});
});

test('the handover is short by default: a tasks-done line, the figures, never the not-done list', () => {
  const s = fresh();
  const list = s.lists[0];
  const gap = task(list, 'AM gap scan');
  const orders = task(list, 'Orders that needed picking');
  const adj = task(list, "Adjustments I wasn't sure of");
  for (const t of list.tasks) if (!t.optional) s.ticks.done[t.id] = 1;
  Object.assign(s.ticks.values, {
    [gap.inputs[0].id]: '40', [gap.inputs[1].id]: '34', [gap.inputs[2].id]: '28', [gap.inputs[3].id]: '26',
    [orders.inputs[0].id]: 6, [adj.inputs[0].id]: 'Milk 2L wrote off 3\nCrisps count',
  });
  const dels = [
    { id: 'c', name: 'Chilled', time: '06:30', at: '06:42', cages: 4, temps: true },
    { id: 'b', name: 'Bread', time: '07:15', at: '', cages: '', temps: false },
  ];
  const write = (opts) => handoverText(summariseList(list, s.ticks, WED), [{ id: 'm', text: 'Short on milk', photo: 'p' }], '2026-11-11', dels, at('2026-11-11T13:58:00'), opts);
  assert.equal(write(), [
    'HANDOVER: AM, Wed 11 Nov, 13:58',
    '',
    'AM tasks done',
    'AM gap scan: 40 scanned, 34 found, 28 picked, 26 correct',
    'Orders that needed picking: 6',
    "Adjustments I wasn't sure of: Milk 2L wrote off 3; Crisps count",
    'Deliveries: Chilled 06:42, 4 cages, temps done; Bread (due 07:15) not in yet',
    '',
    'To mention:',
    '- Short on milk (photo)',
  ].join('\n').replace(/\n(Adjustments.*)\n(Deliveries.*)/, '\n$2\n$1'));

  delete s.ticks.done[list.tasks[0].id];
  const partial = write();
  assert.match(partial, /\nAM tasks done: \d+ of \d+\n/);
  assert.doesNotMatch(partial, /NOT DONE|not done|MyWork AM manual/);
  assert.match(handoverText(summariseList(s.lists[1], s.ticks, WED), [], '2026-11-11'), /^HANDOVER: PM, /);
  assert.doesNotMatch(write({ parts: { figures: false, deliveries: false } }), /gap scan|Deliveries/);
});

test('the cashing up total goes into the handover and the history', async () => {
  const { cashTotals } = await import('../src/store.js');
  const s = fresh();
  s.ticks.cash = { '20p': 3, '1': 1 };
  s.ticks.done[s.lists[0].tasks[0].id] = 1;
  const sum = summariseList(s.lists[0], s.ticks, WED);
  const cash = cashTotals(s.ticks.cash);
  const short = handoverText(sum, [], '2026-11-11', [], at('2026-11-11T13:00:00'), { cash });
  assert.match(short, /\nCashing up: £50\.00 in 4 bags/);
  assert.doesNotMatch(handoverText(sum, [], '2026-11-11', [], at('2026-11-11T13:00:00'), { cash, parts: { cash: false } }), /Cashing/);
  assert.doesNotMatch(handoverText(sum, [], '2026-11-11', [], at('2026-11-11T13:00:00'), { cash: cashTotals({}) }), /Cashing/);
  const full = handoverText(sum, [], '2026-11-11', [], at('2026-11-11T13:00:00'), { cash, parts: { detailed: true } });
  assert.match(full, /\nCASHING UP: £50\.00 in 4 bags\n- 20p: 3 × £10\.00 = £30\.00\n- £1: 1 × £20\.00 = £20\.00\n/);
  rollover(s, at('2026-11-12T08:00:00'));
  assert.deepEqual([s.history[0].cash.pence, s.history[0].cash.bags], [5000, 4]);
});

test('condensed handover: tasks as Done, mentions cut to one short line', async () => {
  const { shortMention } = await import('../src/store.js');
  assert.equal(shortMention('Freezer door sticks. Engineer booked for Tuesday.'), 'Freezer door sticks');
  assert.equal(shortMention('First line\nsecond line'), 'First line');
  assert.equal(shortMention('Price 1.50 is wrong on the shelf edge label'), 'Price 1.50 is wrong on the shelf edge label');
  const long = shortMention('The delivery came in with three cages short and one of them had a broken wheel on it');
  assert.ok(long.length <= 60 && long.endsWith('…') && !/\s…$/.test(long), long);
  assert.equal(shortMention('Bins e.g. paper and card need sorting today'), 'Bins e.g. paper and card need sorting today');
  assert.equal(shortMention('Ask Dr. Jones about it. Then file it.'), 'Ask Dr. Jones about it');
  assert.equal(shortMention('Is the chiller on? Yes it is.'), 'Is the chiller on?');
  assert.equal(shortMention('...'), '...');
  assert.equal(shortMention('   '), '');
  const emoji = shortMention(`${'a'.repeat(58)}\u{1F600}\u{1F600} rest`);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(emoji) && Array.from(emoji).length <= 60, emoji);

  const s = fresh();
  const list = s.lists[0];
  s.ticks.done[list.tasks[0].id] = 1; // only one task done: still "Done" when condensed
  const gap = task(list, 'AM gap scan');
  s.ticks.values[gap.inputs[0].id] = '40';
  const mentions = [{ id: 'a', text: 'Short on milk. Ordered more.' }, { id: 'b', text: 'Cage left by the door', photo: 'p' }];
  const text = handoverText(summariseList(list, s.ticks, WED), mentions, '2026-11-11', [], at('2026-11-11T13:58:00'), { parts: { condense: true } });
  assert.equal(text, [
    'HANDOVER: AM, Wed 11 Nov, 13:58',
    '',
    'AM tasks: Done',
    'AM gap scan: 40',
    'To mention: Short on milk; Cage left by the door (photo)',
  ].join('\n'));
  // off by default, and the detailed write-up ignores it
  assert.doesNotMatch(handoverText(summariseList(list, s.ticks, WED), mentions, '2026-11-11'), /tasks: Done/);
  assert.match(handoverText(summariseList(list, s.ticks, WED), mentions, '2026-11-11', [], at('2026-11-11T13:58:00'), { parts: { condense: true, detailed: true } }), /THINGS TO MENTION\n- Short on milk\. Ordered more\./);
});
