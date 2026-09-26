// ---------------------------------------------------------------------------
// config.js — every tunable number and every piece of flavour text lives here.
// Pure data + pure functions only (no DOM), so it can be unit-tested in Node.
// ---------------------------------------------------------------------------

/** Base bean dimensions in world units (1 unit ≈ 1 CSS px at zoom 1). */
export const BEAN = { len: 26, wid: 17 };

/** Size classes for the "tiny" / "huge" modifiers. */
export const SIZE_CLASSES = { tiny: 0.62, normal: 1, huge: 1.6 };

/**
 * Bean colours. `rgb` is the reference colour printed on each container.
 * Individual beans carry a few points of jitter around it (see beans.js).
 */
export const COLORS = {
  red:       { name: 'Red',        rgb: [200, 38, 38] },
  blue:      { name: 'Blue',       rgb: [38, 88, 196] },
  yellow:    { name: 'Yellow',     rgb: [240, 196, 40] },
  green:     { name: 'Green',      rgb: [58, 146, 64] },
  purple:    { name: 'Purple',     rgb: [118, 64, 164] },
  white:     { name: 'White',      rgb: [236, 230, 212] },
  black:     { name: 'Black',      rgb: [44, 40, 42] },
  pink:      { name: 'Pink',       rgb: [236, 124, 164] },
  orange:    { name: 'Orange',     rgb: [236, 124, 30] },
  brown:     { name: 'Brown',      rgb: [124, 80, 44] },
  darkred:   { name: 'Dark Red',   rgb: [126, 22, 26] },
  crimson:   { name: 'Crimson',    rgb: [184, 22, 58] },
  scarlet:   { name: 'Scarlet',    rgb: [232, 58, 28] },
  burgundy:  { name: 'Burgundy',   rgb: [106, 20, 56] },
  orangered: { name: 'Orange-Red', rgb: [242, 96, 36] },
  brownred:  { name: 'Brown-Red',  rgb: [148, 60, 40] },
};

/**
 * Campaign levels.
 * table: [width, height] in world units.
 * mods:  which chaos modifiers run, with their parameters.
 */
export const LEVELS = [
  {
    id: 1, title: 'Orientation', count: 50,
    colors: ['red', 'blue', 'yellow'],
    table: [720, 450],
    mods: {},
    briefing: 'Welcome to the Department of Legume Classification. Drag each bean into the container with the matching label. That is the whole job.',
  },
  {
    id: 2, title: 'Probation', count: 100,
    colors: ['red', 'blue', 'green', 'yellow'],
    table: [820, 510],
    mods: { fan: { interval: [20, 32], duration: [5, 8], strength: 75 } },
    briefing: 'A colleague has installed a desk fan. It will occasionally turn on. You are not allowed to turn it off.',
  },
  {
    id: 3, title: 'Quality Control', count: 200,
    colors: ['red', 'blue', 'green', 'yellow', 'purple'],
    table: [960, 600],
    mods: {
      fan: { interval: [24, 36], duration: [5, 8], strength: 80 },
      shake: { interval: [15, 25], strength: 110 },
      sizes: { tiny: 0.12, huge: 0.07 },
    },
    briefing: 'The supplier has stopped standardising bean sizes. The table also shakes sometimes. Nobody knows why.',
  },
  {
    id: 4, title: 'Night Shift', count: 400,
    colors: ['red', 'darkred', 'orange', 'brown', 'yellow'],
    table: [1100, 690],
    mods: {
      conveyor: { initial: 170, interval: 0.75 },
      lighting: { darkness: 0.62 },
      shake: { interval: [18, 30], strength: 100 },
      sizes: { tiny: 0.1, huge: 0.06 },
    },
    briefing: 'Facilities has been notified about the lights. Beans now arrive by conveyor. Several colours are similar. Right-click or long-press a bean to inspect it.',
  },
  {
    id: 5, title: 'The Thousand', count: 1000,
    colors: ['crimson', 'red', 'scarlet', 'darkred', 'burgundy', 'orangered', 'brownred'],
    table: [1340, 830],
    mods: {
      tilt: { strength: 15 },
      shuffle: { interval: [32, 48] },
      fan: { interval: [26, 40], duration: [5, 8], strength: 80 },
      shake: { interval: [20, 32], strength: 100 },
      sizes: { tiny: 0.1, huge: 0.06 },
    },
    briefing: 'One thousand beans. Seven shades of red. The table is not level and the containers are not bolted down. Management believes in you.',
  },
];

/** Endless mode tuning. Colours are added in this order as time passes. */
export const ENDLESS = {
  colorPool: ['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'white', 'black', 'pink', 'brown'],
  startColors: 4,
  addColorEvery: 75,     // seconds
  startInterval: 1.5,    // seconds between beans on the belt
  minInterval: 0.33,
  intervalDecay: 0.02,   // interval shrinks by this factor per 10s
  capacity: 260,         // beans allowed on the table before overflow
  overflowGrace: 4,      // seconds over capacity before the shift ends
  initial: 40,
  table: [1100, 690],
};

/** Consecutive-correct milestones. */
export const COMBOS = [
  { n: 10, text: 'NICE SORTING' },
  { n: 25, text: 'BEAN MACHINE' },
  { n: 50, text: 'SORTING GOD' },
  { n: 100, text: 'BEAN OVERLORD' },
  { n: 250, text: 'LEGUME ASCENDANT' },
  { n: 500, text: 'THE BEAN IS YOU' },
];

export const RANKS = [
  'Bean Beginner',
  'Bean Assistant',
  'Certified Bean Sorter',
  'Senior Bean Technician',
  'Bean Specialist',
  'Bean Master',
  'Grand Beanmaster',
];

/**
 * Rank from accuracy (percent 0–100) and pace (beans per minute).
 * Accuracy carries most of the weight; pace and a perfect run add bonuses.
 * Returns { index, name, score }.
 */
export function computeRank(accuracy, bpm) {
  const acc = Number.isFinite(accuracy) ? accuracy : 0;
  const pace = Number.isFinite(bpm) ? bpm : 0;
  const accPts = Math.min(1, Math.max(0, (acc - 70) / 30)) * 4.5;
  const pacePts = Math.min(1, Math.max(0, pace / 30)) * 1.5;
  const perfect = acc >= 100 ? 0.5 : 0;
  const score = accPts + pacePts + perfect;
  const index = Math.max(0, Math.min(RANKS.length - 1, Math.floor(score)));
  return { index, name: RANKS[index], score };
}

/** Time limit for challenge mode, in seconds. */
export const challengeLimit = (count) => Math.round(count * 2.3 + 20);

/** Short hazard labels shown in level select and briefings. */
export function hazardsOf(level) {
  const m = level.mods || {};
  const out = [];
  if (m.fan) out.push('Desk fan');
  if (m.shake) out.push('Table shakes');
  if (m.sizes) out.push('Irregular sizes');
  if (m.conveyor) out.push('Conveyor belt');
  if (m.lighting) out.push('Poor lighting');
  if (m.tilt) out.push('Tilted table');
  if (m.shuffle) out.push('Moving containers');
  if (level.id >= 4) out.push('Similar colours');
  return out;
}

/** Things the inspector notices about individual beans. Pure flavour. */
export const BEAN_NOTES = [
  'No defects found.', 'No defects found.', 'No defects found.',
  'Small dent near the hilum.', 'Faint wrinkle on the back.',
  'Slightly asymmetrical.', 'Unusually glossy.', 'Matte finish.',
  'Tiny scuff, left side.', 'Looks tired.', 'Suspiciously perfect.',
  'Hilum slightly off-centre.', 'Minor speckling.', 'Feels confident.',
  'Has seen things.', 'Slight hairline crack. Still a good bean.',
  'Excellent posture.', 'Mildly dusty.', 'Heavier than it looks.',
  'Appears to be judging you.',
];

/** Supervisor memos shown occasionally during a shift. */
export const MEMOS = [
  'Reminder: beans are not a snack.',
  'The break room kettle is out of order until further notice.',
  'Please do not name the beans.',
  'Sorting accuracy is being monitored for quality purposes.',
  'Casual Friday has been postponed indefinitely.',
  'A bean was found in the photocopier. We are not asking questions.',
  'Hydrate. Beans cannot. You can.',
  'Your posture has been noted.',
  'Employee of the Month: still vacant.',
  'The fan is a morale initiative.',
  'Please stop talking to the containers.',
  'Legumes are a vital part of the supply chain. Probably.',
  'This workstation is inspected every 1,000 beans.',
  'Reminder: the tall container is not a chair.',
];

/** Messages when a bean escapes the player's grip. */
export const SLIP_LINES = [
  'The bean has escaped.', 'Slippery one.', 'It got away.',
  'Bean has left the hand.', 'Grip failure.',
];

export const STORAGE_KEY = 'beansorter1000.save.v1';
