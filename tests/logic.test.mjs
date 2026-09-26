// Unit tests for the pure game logic. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS, COLORS, RANKS, COMBOS, computeRank, challengeLimit, hazardsOf, comboEnergy } from '../js/config.js';
import { Session, BpmMeter } from '../js/session.js';
import { rollVariety, beandexEntries, discover, countRare, hasLegendary, VARIETIES, COMMON_NAMES } from '../js/beandex.js';
import { careerRank, CAREER, CAREER_XP, unlockedEnvironments, ENVIRONMENTS } from '../js/career.js';
import { ACHIEVEMENTS, newlyUnlocked } from '../js/achievements.js';
import { defaults, load, save } from '../js/storage.js';
import { makeRng, segSegClosest, fmtTime, fmtPct } from '../js/util.js';

test('levels match the design brief', () => {
  assert.deepEqual(LEVELS.slice(0, 5).map((l) => l.count), [50, 100, 200, 400, 1000]);
  assert.equal(LEVELS.length, 10);
  assert.deepEqual(LEVELS.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const l of LEVELS) for (const k of l.colors) {
    assert.ok(COLORS[k], `unknown colour ${k}`);
    assert.ok(COMMON_NAMES[k], `no Beandex name for ${k}`);
  }
});

test('similar colours are still distinguishable in every level', () => {
  for (const L of LEVELS) {
    const cols = L.colors.map((k) => COLORS[k].rgb);
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const d = Math.hypot(...cols[i].map((v, n) => v - cols[j][n]));
        assert.ok(d >= 25, `level ${L.id}: ${L.colors[i]} vs ${L.colors[j]} too close (${d.toFixed(1)})`);
      }
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
  for (let i = 0; i < 100; i++) { s.tick(0.5); const m = s.correct(); if (m) hits.push(m.text); }
  assert.deepEqual(hits, ['GOOD BEANS', 'NICE SORT', 'BEAN MACHINE', 'CERTIFIED SORTER', 'BEAN TECHNOLOGY', 'BEAN OVERLORD']);
  assert.ok(s.fastest > 0.4 && s.fastest < 0.6);
  assert.equal(s.wrong(), 100);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 100);
  assert.equal(s.remaining, 20);
  assert.ok(Math.abs(s.accuracy - (100 / 101) * 100) < 1e-9);
  s.tick(10);
  assert.equal(s.bpm, 100);
  const again = Session.from(JSON.parse(JSON.stringify(s)));
  assert.equal(again.sorted, 100);
  assert.equal(again.bestStreak, 100);
});

test('achievements unlock once and report progress', () => {
  const life = defaults().life;
  const unlocked = {};
  assert.equal(newlyUnlocked(life, unlocked).length, 0);
  life.sorted = 1000; life.bestStreak = 12;
  const got = newlyUnlocked(life, unlocked).map((a) => a.id);
  assert.deepEqual(got.sort(), ['b100', 'b1000', 'c10', 'first'].sort());
  for (const id of got) unlocked[id] = 1;
  assert.equal(newlyUnlocked(life, unlocked).length, 0);
  const tg = ACHIEVEMENTS.find((a) => a.name === 'Touch Grass');
  assert.deepEqual(tg.progress(life), [1000, 50000]);
  life.secrets.konami = true;
  assert.ok(newlyUnlocked(life, unlocked).some((a) => a.id === 'cheat'));
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  assert.equal(ids.size, ACHIEVEMENTS.length, 'duplicate achievement id');
});

test('BPM meter glides and tracks a peak', () => {
  const m = new BpmMeter();
  let t = 0;
  for (let i = 0; i < 60; i++) { t += 1; m.record(t); m.update(t, 1, i + 1); }
  assert.ok(Math.abs(m.smooth - 60) < 6, `smooth ${m.smooth}`);
  assert.ok(m.peak > 50);
  for (let i = 0; i < 30; i++) { t += 1; m.update(t, 1, 60); }
  assert.ok(m.smooth < 10);
  assert.ok(m.peak > 50);
});

test('rarity odds are close to 94 / 5 / 0.9 / 0.1', () => {
  const rand = makeRng(98765).next;
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  const N = 200000;
  const byId = Object.fromEntries(VARIETIES.map((v) => [v.id, v.rarity]));
  for (let i = 0; i < N; i++) { const v = rollVariety(rand); counts[v ? byId[v] : 'common']++; }
  assert.ok(Math.abs(counts.common / N - 0.94) < 0.005);
  assert.ok(Math.abs(counts.uncommon / N - 0.05) < 0.004);
  assert.ok(Math.abs(counts.rare / N - 0.009) < 0.002);
  assert.ok(Math.abs(counts.legendary / N - 0.001) < 0.0006);
});

test('beandex discovery', () => {
  const dex = {};
  assert.equal(discover(dex, 'v:prime', 'red', 5), true);
  assert.equal(discover(dex, 'v:prime', 'blue', 6), false);
  assert.equal(dex['v:prime'].n, 2);
  assert.equal(dex['v:prime'].first, 5);
  assert.equal(countRare(dex), 2);
  assert.equal(hasLegendary(dex), false);
  discover(dex, 'v:golden', 'red');
  assert.equal(hasLegendary(dex), true);
  const e = beandexEntries(['red', 'blue']);
  assert.equal(e.length, 2 + VARIETIES.length);
});

test('career ranks and environments', () => {
  assert.equal(CAREER.length, 12);
  assert.equal(CAREER_XP.length, 12);
  assert.equal(careerRank(0).name, 'Bean Intern');
  assert.equal(careerRank(40).name, 'Junior Bean Sorter');
  assert.equal(careerRank(1e9).name, 'Supreme Bean Authority');
  assert.equal(careerRank(1e9).progress, 1);
  const life = defaults().life;
  assert.deepEqual(unlockedEnvironments({ life, dex: {}, rank: careerRank(0) }), ['office']);
  life.levelsDone = [1, 3, 5];
  assert.equal(unlockedEnvironments({ life, dex: { 'v:golden': { n: 1 } }, rank: careerRank(0) }).length, 5);
  assert.equal(ENVIRONMENTS.length, 7);
  assert.ok(comboEnergy(10) === 0 && comboEnergy(500) === 1);
});

test('storage round-trips and survives garbage', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  // A version-1 save is migrated forward.
  mem.set('beansorter1000.save.v1', JSON.stringify({ version: 1, settings: { volume: 0.3 }, life: { sorted: 7, bestBpm: 22 }, run: { levelId: 3, beans: [] } }));
  const old = load(store);
  assert.equal(old.version, 2);
  assert.equal(old.settings.masterVolume, 0.3);
  assert.equal(old.life.peakBpm, 22);
  assert.equal(old.run, null);
  assert.deepEqual(old.dex, {});
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
  assert.equal(load(broken).version, 2);
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
