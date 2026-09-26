// career.js — lifetime career rank and unlockable workstation environments.
// Pure logic, unit-tested in Node.

import { hasLegendary } from './beandex.js';

export const CAREER = [
  'Bean Intern', 'Junior Bean Sorter', 'Bean Sorting Assistant', 'Certified Bean Technician',
  'Senior Bean Technician', 'Bean Specialist', 'Professional Bean Sorter', 'Bean Engineer',
  'Bean Scientist', 'Bean Master', 'Grand Beanmaster', 'Supreme Bean Authority',
];

/** Career XP needed for each rank. Tuned so the first promotions come fast. */
export const CAREER_XP = [0, 40, 150, 400, 800, 1500, 2600, 4200, 6500, 10000, 16000, 25000];

/** XP = beans sorted + 100 per achievement. */
export const careerXp = (life, achievementCount) => life.sorted + achievementCount * 100;

export function careerRank(xp) {
  let i = 0;
  while (i + 1 < CAREER_XP.length && xp >= CAREER_XP[i + 1]) i++;
  const next = CAREER_XP[i + 1];
  const progress = next === undefined ? 1 : (xp - CAREER_XP[i]) / (next - CAREER_XP[i]);
  return { index: i, name: CAREER[i], xp, next: next ?? null, nextName: CAREER[i + 1] || null, progress };
}

/**
 * Cosmetic table environments. `test(ctx)` gets { life, dex, rank } and says
 * whether the environment is unlocked. Only one is visible at a time.
 */
export const ENVIRONMENTS = [
  { id: 'office', name: 'Basic Office Desk', req: 'Standard issue', test: () => true },
  { id: 'lab', name: 'Science Laboratory', req: 'Complete Level 1', test: (c) => c.life.levelsDone.includes(1) },
  { id: 'wood', name: 'Fancy Wooden Desk', req: 'Complete Level 3', test: (c) => c.life.levelsDone.includes(3) },
  { id: 'industrial', name: 'Industrial Sorting Facility', req: 'Complete Level 5', test: (c) => c.life.levelsDone.includes(5) },
  { id: 'corporate', name: 'Corporate Bean Division', req: 'Reach Professional Bean Sorter', test: (c) => c.rank.index >= 6 },
  { id: 'secret', name: 'Top Secret Bean Facility', req: 'Complete Level 10', test: (c) => c.life.levelsDone.includes(10) },
  { id: 'void', name: 'VOID', req: 'Find a legendary bean or reach Grand Beanmaster', test: (c) => hasLegendary(c.dex) || c.rank.index >= 10 },
];

export const unlockedEnvironments = (ctx) => ENVIRONMENTS.filter((e) => e.test(ctx)).map((e) => e.id);
