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
  assert.deepEqual(task(s.lists[0], 'AM gap scan').inputs.map((i) => `${i.label}:${i.type}`), ['Gaps found:number', 'Gaps picked:number']);
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
  assert.equal(task(m, 'AM gap scan').inputs.length, 2);
  assert.ok(!task(m, 'Chilled backup')); // deleted by hand before: not brought back
  assert.deepEqual(s.lists[1].tasks.map((t) => t.title), ['Mine']);
  assert.equal(s.seedVersion, 3);

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
  s.ticks.values[gap.inputs[0].id] = '34';
  s.mentions.push({ id: 'm', text: 'Freezer 2 alarm', at: at('2026-11-11T09:00:00').getTime(), photo: 'p1' });

  assert.equal(rollover(s, at('2026-11-11T22:00:00')), false);
  assert.equal(rollover(s, at('2026-11-12T06:00:00')), true);
  assert.deepEqual(s.ticks, emptyTicks('2026-11-12'));
  assert.deepEqual(s.mentions, []);
  const day = s.history[0];
  assert.equal(day.date, '2026-11-11');
  assert.deepEqual(day.lists.map((l) => l.name), ['Morning', 'Evening']);
  assert.deepEqual(day.lists[0].done, [{ title: a.title, at: '08:05' }]);
  assert.deepEqual(day.lists[0].figures, [{ title: 'AM gap scan', items: [{ label: 'Gaps found', value: '34' }] }]);
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
  assert.deepEqual(sum[0], { name: 'Greencore', time: '06:30', at: '06:42', cages: 4, temps: true });
  assert.deepEqual(sum.at(-1), { name: 'Ambient', time: '', at: '07:00', cages: 1, temps: false });
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
    values: { [gap.inputs[0].id]: '34', [gap.inputs[1].id]: '28', [orders.inputs[0].id]: 6, [adj.inputs[0].id]: 'Milk 2L, wrote off 3\n\nCrisps count looked wrong' },
  };
  const sum = summariseList(list, ticks, WED);
  assert.equal(sum.total, list.tasks.length - 2); // minus Frozen backup (not Wednesday) and the skipped one
  assert.deepEqual(progress(list, ticks, WED), { done: sum.total - 1, total: sum.total });

  const deliveries = [
    { name: 'Greencore', time: '06:30', at: '06:42', cages: 4, temps: true },
    { name: 'Bread', time: '07:15', at: '', cages: '', temps: false },
  ];
  const text = handoverText(sum, [{ text: 'Short on milk' }, { text: 'Damaged delivery', photo: 'p1' }], '2026-11-11', deliveries, at('2026-11-11T13:58:00'));
  const expectStart = [
    'HANDOVER: MORNING',
    'Wed 11 Nov, written 13:58',
    '',
    'SUMMARY',
    `- Tasks: ${sum.total - 1} of ${sum.total} done, 1 not done, 1 skipped`,
    '- AM gap scan: Gaps found 34, Gaps picked 28',
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

  const empty = handoverText(summariseList(list, emptyTicks('2026-11-11'), WED), [], '2026-11-11', [], at('2026-11-11T06:00:00'));
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
  assert.deepEqual(sum.figures, [{ title: orders.title, items: [{ label: 'Orders', value: '3' }] }]);
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
