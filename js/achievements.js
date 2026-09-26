// achievements.js — definitions and checks. Each test reads the lifetime
// stats object (see storage.js). Pure, so it's unit-tested in Node.

export const ACHIEVEMENTS = [
  { id: 'first', name: 'First Bean', desc: 'Sort your first bean.', test: (L) => L.sorted >= 1 },
  { id: 'b100', name: 'Bean Counter', desc: 'Sort 100 beans.', test: (L) => L.sorted >= 100 },
  { id: 'b1000', name: 'Bean There, Done That', desc: 'Sort 1,000 beans.', test: (L) => L.sorted >= 1000 },
  { id: 'b10k', name: 'Are You Okay?', desc: 'Sort 10,000 beans.', test: (L) => L.sorted >= 10000 },
  { id: 'b100k', name: 'Touch Grass', desc: 'Sort 100,000 beans.', test: (L) => L.sorted >= 100000 },
  { id: 'perfect', name: 'No Mistakes', desc: 'Complete a level with 100% accuracy.', test: (L) => L.perfectLevels >= 1 },
  { id: 'c10', name: 'Nice Sorting', desc: 'Sort 10 beans in a row without a mistake.', test: (L) => L.bestStreak >= 10 },
  { id: 'c50', name: 'Sorting God', desc: 'Reach a 50-bean streak.', test: (L) => L.bestStreak >= 50 },
  { id: 'c100', name: 'Bean Overlord', desc: 'Reach a 100-bean streak.', test: (L) => L.bestStreak >= 100 },
  { id: 'slip', name: 'Butterfingers', desc: 'Let a bean escape your grip.', test: (L) => L.escapes >= 1 },
  { id: 'inspect', name: 'Bean Inspector', desc: 'Inspect 25 beans.', test: (L) => L.inspected >= 25 },
  { id: 'wrong', name: 'Wrong Bin Enthusiast', desc: 'Make 50 mistakes in total.', test: (L) => L.mistakes >= 50 },
  { id: 'belt', name: 'Straight Off the Belt', desc: 'Grab a bean off the conveyor belt.', test: (L) => L.beltGrabs >= 1 },
  { id: 'night', name: 'Night Owl', desc: 'Complete the Night Shift.', test: (L) => L.levelsDone.includes(4) },
  { id: 'thousand', name: 'The Thousand', desc: 'Complete Level 5.', test: (L) => L.levelsDone.includes(5) },
  { id: 'fast', name: 'Speed Legume', desc: 'Finish a level at 40+ beans per minute.', test: (L) => L.bestBpm >= 40 },
  { id: 'overtime', name: 'Overtime', desc: 'Sort 500 beans in one Endless shift.', test: (L) => L.endlessBest >= 500 },
  { id: 'career', name: 'Career Path', desc: 'Spend one hour sorting beans.', test: (L) => L.playTime >= 3600 },
];

/** Returns achievements that pass now but weren't unlocked before. */
export function newlyUnlocked(life, unlocked) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked[a.id] && a.test(life)) out.push(a);
  }
  return out;
}
