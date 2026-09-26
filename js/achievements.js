// achievements.js — definitions, progress and checks. Each test reads the
// lifetime stats object (see storage.js). `progress` returns [current, goal]
// for the achievements screen. `secret` ones stay hidden until unlocked.
// Pure, so it's unit-tested in Node.

const count = (field, goal) => ({ test: (L) => (L[field] || 0) >= goal, progress: (L) => [Math.min(L[field] || 0, goal), goal] });
const level = (id) => ({ test: (L) => L.levelsDone.includes(id), progress: (L) => [L.levelsDone.includes(id) ? 1 : 0, 1] });
const flag = (name) => ({ test: (L) => !!(L.secrets && L.secrets[name]), progress: (L) => [L.secrets && L.secrets[name] ? 1 : 0, 1] });

export const ACHIEVEMENTS = [
  { id: 'first', name: 'First Bean', desc: 'Sort one bean.', ...count('sorted', 1) },
  { id: 'b100', name: 'Getting Started', desc: 'Sort 100 beans.', ...count('sorted', 100) },
  { id: 'b1000', name: 'Bean There, Done That', desc: 'Sort 1,000 beans.', ...count('sorted', 1000) },
  { id: 'b5000', name: 'Seriously?', desc: 'Sort 5,000 beans.', ...count('sorted', 5000) },
  { id: 'b10k', name: 'Are You Okay?', desc: 'Sort 10,000 beans.', ...count('sorted', 10000) },
  { id: 'b100k', name: 'Touch Grass', desc: 'Sort 50,000 beans.', ...count('sorted', 50000) },
  { id: 'wrong', name: 'Wrong Bin Enthusiast', desc: 'Make 50 mistakes.', ...count('mistakes', 50) },
  { id: 'incident', name: 'The Bean Incident', desc: 'Make 100 mistakes.', ...count('mistakes', 100) },
  { id: 'perfect', name: 'Perfection', desc: 'Finish a level with 100% accuracy.', ...count('perfectLevels', 1) },
  { id: 'c10', name: 'Nice Sort', desc: 'Sort 10 beans in a row without a mistake.', ...count('bestStreak', 10) },
  { id: 'c50', name: 'Certified Sorter', desc: 'Reach a 50-bean combo.', ...count('bestStreak', 50) },
  { id: 'c100', name: 'Bean Machine', desc: 'Reach a 100-bean combo.', ...count('bestStreak', 100) },
  { id: 'c500', name: 'Unstoppable', desc: 'Reach a 500-bean combo.', ...count('bestStreak', 500) },
  { id: 'c1000', name: 'Absolute Sorter', desc: 'Sort 1,000 beans in a row without a mistake.', ...count('bestStreak', 1000) },
  { id: 'legendary', name: '???', desc: 'Discover a legendary bean.', ...count('legendaries', 1) },
  { id: 'rare', name: 'Keen Eye', desc: 'Discover a rare bean.', ...count('raresFound', 1) },
  { id: 'dex10', name: 'Collector', desc: 'Record 10 Beandex entries.', ...count('dexEntries', 10) },
  { id: 'slip', name: 'Butterfingers', desc: 'Let a bean escape your grip.', ...count('escapes', 1) },
  { id: 'inspect', name: 'Bean Inspector', desc: 'Inspect 25 beans.', ...count('inspected', 25) },
  { id: 'belt', name: 'Straight Off the Belt', desc: 'Grab a bean off the conveyor belt.', ...count('beltGrabs', 1) },
  { id: 'thousand', name: 'The Thousand', desc: 'Complete Level 5.', ...level(5) },
  { id: 'night', name: 'Night Owl', desc: 'Complete Darkness.', ...level(6) },
  { id: 'quake', name: 'Structurally Sound', desc: 'Complete Earthquake.', ...level(7) },
  { id: 'hell', name: 'Blue Period', desc: 'Complete Color Hell.', ...level(9) },
  { id: 'apocalypse', name: 'Beanpocalypse Survivor', desc: 'Complete Level 10.', ...level(10) },
  { id: 'fast', name: 'Speed Legume', desc: 'Reach a peak of 40 beans per minute.', ...count('peakBpm', 40) },
  { id: 'esports', name: 'Esports Ready', desc: 'Reach a peak of 60 beans per minute.', ...count('peakBpm', 60) },
  { id: 'overtime', name: 'Overtime', desc: 'Sort 500 beans in one Endless shift.', ...count('endlessBest', 500) },
  { id: 'career', name: 'Career Path', desc: 'Spend one hour sorting beans.', ...count('playTime', 3600) },
  // Secret achievements: hidden until found.
  { id: 'notfound', name: 'Bean Not Found', desc: 'Inspect bean #404.', secret: true, ...flag('b404') },
  { id: 'warranty', name: 'Warranty Void', desc: 'Tamper with the serial plate.', secret: true, ...flag('serial') },
  { id: 'cheat', name: 'Cheat Code Enthusiast', desc: 'Enter a very old code.', secret: true, ...flag('konami') },
];

/** Returns achievements that pass now but weren't unlocked before. */
export function newlyUnlocked(life, unlocked) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked[a.id] && a.test(life)) out.push(a);
  }
  return out;
}
