import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, weekday, isDue, isLate, stepsFromText, normalise, rollover, progress,
  summariseList, handoverText, move,
} from '../src/store.js';

const at = (iso) => new Date(iso);

test('the working day rolls over at 04:00, not midnight', () => {
  assert.equal(dayKey(at('2026-11-11T23:30:00')), '2026-11-11');
  assert.equal(dayKey(at('2026-11-12T01:30:00')), '2026-11-11');
  assert.equal(dayKey(at('2026-11-12T04:00:00')), '2026-11-12');
  assert.equal(weekday(at('2026-11-12T01:30:00')), 3); // still Wednesday
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
  assert.notEqual(next[1].id, undefined);
});

test('a fresh install is seeded with Morning and Evening', () => {
  const s = normalise(null, at('2026-11-11T08:00:00'));
  assert.deepEqual(s.lists.map((l) => l.name), ['Morning', 'Evening']);
  assert.ok(s.lists[0].tasks.length >= 11);
  const frozen = s.lists[0].tasks.find((t) => t.title === 'Frozen backup');
  assert.deepEqual(frozen.days, [1, 4, 6]);
  const ids = s.lists.flatMap((l) => l.tasks.flatMap((t) => [t.id, ...t.steps.map((x) => x.id)]));
  assert.equal(new Set(ids).size, ids.length);
});

test('rollover files the day in history and clears ticks and mentions', () => {
  const s = normalise(null, at('2026-11-11T08:00:00'));
  const [a, b] = s.lists[0].tasks;
  s.ticks.done[a.id] = at('2026-11-11T08:05:00').getTime();
  s.ticks.done[b.steps[0].id] = 1;
  s.mentions.push({ id: 'm', text: 'Freezer 2 alarm', at: at('2026-11-11T09:00:00').getTime() });

  assert.equal(rollover(s, at('2026-11-11T22:00:00')), false);
  assert.equal(rollover(s, at('2026-11-12T06:00:00')), true);
  assert.deepEqual(s.ticks, { date: '2026-11-12', done: {} });
  assert.deepEqual(s.mentions, []);
  assert.equal(s.history.length, 1);
  const day = s.history[0];
  assert.equal(day.date, '2026-11-11');
  assert.deepEqual(day.lists.map((l) => l.name), ['Morning', 'Evening']);
  assert.equal(day.lists[1].done.length, 0);
  assert.deepEqual(day.lists[0].done, [{ title: a.title, at: '08:05' }]);
  assert.equal(day.mentions[0].text, 'Freezer 2 alarm');
  // Wednesday: Frozen backup (Mon Thu Sat) was not due, so it is not "missed"
  assert.ok(!day.lists[0].missed.some((t) => t.title === 'Frozen backup'));
});

test('an install from before the evening list existed gets it once, if Evening is still empty', () => {
  const now = at('2026-11-11T18:00:00');
  const old = JSON.parse(JSON.stringify(normalise(null, now)));
  delete old.seedVersion;
  old.lists[1].tasks = [];
  const filled = normalise(old, now);
  assert.equal(filled.lists[1].tasks.length, 16);
  assert.equal(filled.seedVersion, 2);

  // Evening already has the user's own tasks: left alone
  old.lists[1].tasks = [{ title: 'Mine' }];
  assert.deepEqual(normalise(old, now).lists[1].tasks.map((t) => t.title), ['Mine']);

  // Emptied on purpose after the update: stays empty
  const emptied = JSON.parse(JSON.stringify(filled));
  emptied.lists[1].tasks = [];
  assert.equal(normalise(emptied, now).lists[1].tasks.length, 0);
});

test('an untouched day off is not filed', () => {
  const s = normalise(null, at('2026-11-11T08:00:00'));
  rollover(s, at('2026-11-12T08:00:00'));
  assert.equal(s.history.length, 0);
});

test('a save from an earlier day is rolled over when loaded', () => {
  const s = normalise(null, at('2026-11-11T08:00:00'));
  s.ticks.done[s.lists[0].tasks[0].id] = 1;
  const later = normalise(JSON.parse(JSON.stringify(s)), at('2026-11-13T08:00:00'));
  assert.equal(later.ticks.date, '2026-11-13');
  assert.equal(later.history[0].date, '2026-11-11');
});

test('handover text lists done, not done and things to mention', () => {
  const s = normalise(null, at('2026-11-11T08:00:00'));
  const list = s.lists[0];
  const done = {};
  for (const t of list.tasks) done[t.id] = at('2026-11-11T07:30:00').getTime();
  const gap = list.tasks.find((t) => t.title === 'AM gap scan');
  delete done[gap.id];
  done[gap.steps[0].id] = 1;
  const sum = summariseList(list, done, 3);
  assert.deepEqual(progress(list, done, 3), { done: sum.total - 1, total: sum.total });
  const text = handoverText(sum, [{ text: 'Short on milk' }], '2026-11-11');
  assert.match(text, /^Handover: Morning, Wed 11 Nov/);
  assert.match(text, /- OSA app \(07:30\)/);
  assert.match(text, /Not done:\n- AM gap scan \(1 of 5 steps done, due by 10:00\)/);
  assert.match(text, /Things to mention:\n- Short on milk/);
  assert.doesNotMatch(text, /Frozen backup/);
});

test('move stays inside the array', () => {
  const a = [1, 2, 3];
  assert.equal(move(a, 0, -1), false);
  assert.equal(move(a, 0, 1), true);
  assert.deepEqual(a, [2, 1, 3]);
});
