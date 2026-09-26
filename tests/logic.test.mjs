// Unit tests for the pure game logic. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS, COLORS, RANKS, COMBOS, computeRank, challengeLimit, hazardsOf } from '../js/config.js';
import { Session } from '../js/session.js';
import { ACHIEVEMENTS, newlyUnlocked } from '../js/achievements.js';
import { defaults, load, save } from '../js/storage.js';
import { makeRng, segSegClosest, fmtTime, fmtPct } from '../js/util.js';

test('levels match the design brief', () => {
  assert.deepEqual(LEVELS.map((l) => l.count), [50, 100, 200, 400, 1000]);
  assert.deepEqual(LEVELS.map((l) => l.colors.length), [3, 4, 5, 5, 7]);
  for (const l of LEVELS) for (const k of l.colors) assert.ok(COLORS[k], `unknown colour ${k}`);
});

test('similar colours in level 5 are still distinguishable', () => {
  const cols = LEVELS[4].colors.map((k) => COLORS[k].rgb);
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const d = Math.hypot(...cols[i].map((v, n) => v - cols[j][n]));
      assert.ok(d >= 25, `${LEVELS[4].colors[i]} vs ${LEVELS[4].colors[j]} too close (${d.toFixed(1)})`);
    }
  }
});

test('tables have room for their beans', () => {
  for (const l of LEVELS) {
    const area = l.table[0] * l.table[1];
    assert.ok(area / l.count >= 1000, `level ${l.id} is too crowded`);
  }
});

test('rank ladder', () => {
  assert.equal(RANKS.length, 7);
  assert.equal(computeRank(100, 35).name, 'Grand Beanmaster');
  assert.equal(computeRank(50, 10).name, 'Bean Beginner');
  assert.ok(computeRank(97, 20).index > computeRank(90, 20).index);
  assert.ok(computeRank(95, 30).index >= computeRank(95, 5).index);
  assert.equal(computeRank(NaN, NaN).index, 0);
});

test('session scoring, streaks and combo milestones', () => {
  const s = new Session({ mode: 'level', levelId: 1, total: 120 });
  const hits = [];
  for (let i = 0; i < 100; i++) { const m = s.correct(); if (m) hits.push(m.text); }
  assert.deepEqual(hits, COMBOS.filter((c) => c.n <= 100).map((c) => c.text));
  assert.equal(s.wrong(), 100);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 100);
  assert.equal(s.remaining, 20);
  assert.ok(Math.abs(s.accuracy - (100 / 101) * 100) < 1e-9);
  s.tick(60);
  assert.equal(s.bpm, 100);
  const again = Session.from(JSON.parse(JSON.stringify(s)));
  assert.equal(again.sorted, 100);
  assert.equal(again.bestStreak, 100);
});

test('achievements unlock once', () => {
  const life = defaults().life;
  const unlocked = {};
  assert.equal(newlyUnlocked(life, unlocked).length, 0);
  life.sorted = 1000; life.bestStreak = 12;
  const got = newlyUnlocked(life, unlocked).map((a) => a.id);
  assert.deepEqual(got.sort(), ['b100', 'b1000', 'c10', 'first'].sort());
  for (const id of got) unlocked[id] = 1;
  assert.equal(newlyUnlocked(life, unlocked).length, 0);
  assert.ok(ACHIEVEMENTS.some((a) => a.name === 'Touch Grass'));
});

test('storage round-trips and survives garbage', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const d = defaults();
  d.life.sorted = 42;
  d.progress.unlocked = 3;
  save(d, store);
  const back = load(store);
  assert.equal(back.life.sorted, 42);
  assert.equal(back.progress.unlocked, 3);
  assert.equal(back.settings.sound, true);        // default filled in
  mem.set([...mem.keys()][0], '{not json');
  assert.equal(load(store).life.sorted, 0);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(load(broken).version, 1);
  assert.equal(save(d, broken), false);
});

test('helpers', () => {
  const a = makeRng(7), b = makeRng(7);
  for (let i = 0; i < 10; i++) assert.equal(a.next(), b.next());
  const o = {};
  segSegClosest(0, 0, 10, 0, 5, 3, 5, 10, o);
  assert.equal(o.d2, 9);
  assert.equal(fmtTime(522), '08:42');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtPct(97.44), '97.4%');
  assert.ok(challengeLimit(1000) > 1000);
  assert.ok(hazardsOf(LEVELS[4]).includes('Tilted table'));
});
