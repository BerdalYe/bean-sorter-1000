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
  // Color Hell (level 9): eight blues, each at least 35 RGB units apart.
  navy:      { name: 'Navy',       rgb: [22, 38, 104] },
  cobalt:    { name: 'Cobalt',     rgb: [0, 72, 170] },
  royal:     { name: 'Royal Blue', rgb: [58, 96, 218] },
  azure:     { name: 'Azure',      rgb: [30, 134, 222] },
  cerulean:  { name: 'Cerulean',   rgb: [24, 160, 196] },
  steel:     { name: 'Steel Blue', rgb: [84, 120, 150] },
  indigo:    { name: 'Indigo',     rgb: [78, 48, 150] },
  sky:       { name: 'Sky Blue',   rgb: [120, 176, 236] },
};

/** Colour-assist symbols, assigned by a colour's position in the level. */
export const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '♥', '⬢', '✖', '◐'];

/**
 * Campaign levels. 1–5 are the main game; 6–10 are challenge levels that
 * unlock after The Thousand.
 * table: [width, height] in world units (turned sideways on portrait screens).
 * mods:  which chaos modifiers run, with their parameters.
 * intro: extra lines for the cinematic introduction.
 */
export const LEVELS = [
  {
    id: 1, title: 'Orientation', count: 50,
    colors: ['red', 'blue', 'yellow'],
    table: [720, 450],
    mods: {},
    briefing: 'Drag each bean into the container with the matching label. That is the whole job.',
    intro: { k: 'Objective', v: 'Sort the beans' },
  },
  {
    id: 2, title: 'Getting Serious', count: 100,
    colors: ['red', 'blue', 'green', 'yellow'],
    table: [820, 510],
    mods: { fan: { interval: [22, 34], duration: [5, 7], strength: 65 } },
    briefing: 'A colleague has installed a desk fan. You are not allowed to turn it off.',
    intro: { k: 'Notice', v: 'Desk fan installed' },
  },
  {
    id: 3, title: 'Bean Technician', count: 200,
    colors: ['red', 'blue', 'green', 'yellow', 'purple'],
    table: [960, 600],
    mods: {
      fan: { interval: [24, 36], duration: [5, 8], strength: 75 },
      sizes: { tiny: 0.12, huge: 0.07 },
    },
    briefing: 'The supplier has stopped standardising bean sizes. Nobody knows why.',
    intro: { k: 'Notice', v: 'Bean sizes not standardised' },
  },
  {
    id: 4, title: 'Color Theory', count: 400,
    colors: ['red', 'darkred', 'orange', 'brown', 'yellow', 'green', 'blue'],
    table: [1100, 690],
    mods: {
      shake: { interval: [26, 38], strength: 80 },
      sizes: { tiny: 0.1, huge: 0.06 },
    },
    briefing: 'Several colours are now similar. Right-click or long-press a bean to inspect it.',
    intro: { warn: 'Similar colors detected' },
  },
  {
    id: 5, title: 'The Thousand', count: 1000, boss: true,
    colors: ['crimson', 'red', 'scarlet', 'darkred', 'burgundy', 'orangered', 'brownred'],
    table: [1340, 830],
    mods: {
      tilt: { strength: 15 },
      shuffle: { interval: [32, 48] },
      fan: { interval: [26, 40], duration: [5, 8], strength: 80 },
      shake: { interval: [20, 32], strength: 100 },
      sizes: { tiny: 0.1, huge: 0.06 },
    },
    briefing: 'Seven shades of red. The table is not level and the containers are not bolted down.',
    intro: { k: 'Mission', v: 'Sort them all', last: 'Good luck.' },
    finale: 'The Thousand has fallen',
  },
  {
    id: 6, title: 'Darkness', count: 300, challenge: true,
    colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'],
    table: [1000, 630],
    mods: {
      lighting: { base: 0.12, peak: [0.62, 0.8], interval: [9, 15], duration: [6, 10] },
      sizes: { tiny: 0.08, huge: 0.05 },
    },
    briefing: 'Facilities has been notified about the lights. The lights have not been notified about Facilities.',
    intro: { warn: 'Lighting unreliable' },
  },
  {
    id: 7, title: 'Earthquake', count: 300, challenge: true,
    colors: ['red', 'blue', 'green', 'yellow', 'white', 'black'],
    table: [1000, 630],
    mods: {
      shake: { interval: [7, 12], strength: 170, aftershock: true },
    },
    briefing: 'The building was not designed for this. Neither were the beans.',
    intro: { warn: 'Seismic activity detected' },
  },
  {
    id: 8, title: 'Conveyor', count: 400, challenge: true,
    colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'],
    table: [1100, 690],
    mods: {
      conveyor: { initial: 60, interval: 0.5 },
      sizes: { tiny: 0.08, huge: 0.05 },
    },
    briefing: 'The intake belt runs continuously. Keep up.',
    intro: { warn: 'Beans inbound' },
  },
  {
    id: 9, title: 'Color Hell', count: 400, challenge: true,
    colors: ['navy', 'cobalt', 'royal', 'azure', 'cerulean', 'steel', 'indigo', 'sky'],
    table: [1100, 690],
    mods: {},
    briefing: 'Eight shades of blue. The Department apologises for nothing.',
    intro: { warn: 'Color separation: minimal' },
  },
  {
    id: 10, title: 'Beanpocalypse', count: 1200, boss: true, challenge: true,
    colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown'],
    table: [1440, 900],
    mods: {
      conveyor: { initial: 760, interval: 0.32 },
      shake: { interval: [22, 34], strength: 110 },
      fan: { interval: [26, 40], duration: [5, 8], strength: 75 },
      tilt: { strength: 13 },
      lighting: { base: 0.05, peak: [0.4, 0.55], interval: [24, 36], duration: [6, 9] },
      shuffle: { interval: [40, 55] },
      sizes: { tiny: 0.08, huge: 0.05 },
    },
    briefing: 'Everything, all at once. 1,200 beans. Every modifier the Department owns.',
    intro: { warn: 'All modifiers active', last: 'It has been an honour.' },
    finale: 'The Beanpocalypse is over',
  },
];

/** Levels 1–5 are the main campaign; finishing 5 unlocks Endless and 6–10. */
export const MAIN_LEVELS = 5;

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

/**
 * Consecutive-correct milestones. `tier` drives how loud the pop-up,
 * sound and haptic are (0 = modest … 8 = absurd).
 */
export const COMBOS = [
  { n: 5, text: 'GOOD BEANS', tier: 0 },
  { n: 10, text: 'NICE SORT', tier: 1 },
  { n: 25, text: 'BEAN MACHINE', tier: 2 },
  { n: 50, text: 'CERTIFIED SORTER', tier: 3 },
  { n: 75, text: 'BEAN TECHNOLOGY', tier: 4 },
  { n: 100, text: 'BEAN OVERLORD', tier: 5 },
  { n: 250, text: 'ASCENDED BEAN ENTITY', tier: 6 },
  { n: 500, text: 'THE BEANS FEAR YOU', tier: 7 },
  { n: 1000, text: 'BEAN SORTING HAS BEEN COMPLETED', tier: 8 },
];

/** 0…1 "hype" level for the environment, from the current streak. */
export const comboEnergy = (streak) => Math.max(0, Math.min(1, (streak - 25) / 175));

/** Per-shift grade shown on the shift report (stamp). */
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
  if (level.id === 4 || level.id === 5 || level.id === 9) out.push('Similar colours');
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
  'Beans per minute is now a key performance indicator.',
  'The Beandex is not a legal document.',
];

/** Rare, harmless office events during a shift (see game.js). */
export const EVENT_LINES = [
  'Bean sorting efficiency increased by 0.00%.',
  'Corporate is pleased with your bean performance.',
  'Management has noticed your bean activity.',
  'Your bean throughput has been forwarded to the board.',
  'A consultant has reviewed your technique. The invoice is in the post.',
  'Reminder: this is a professional bean environment.',
];

/** Purely comedic inspector statistics. One is shown per bean. */
export const INSPECT_STATS = [
  (r) => ['Structural bean integrity', `${r.int(88, 100)}%`],
  (r) => ['Bean confidence', r.pick(['HIGH', 'MODERATE', 'CONCERNING', 'UNSHAKEABLE', 'LOW'])],
  (r) => ['Aerodynamic rating', r.pick(['QUESTIONABLE', 'ADEQUATE', 'NONE', 'SURPRISING'])],
  (r) => ['Professionalism', `${r.int(40, 99)}%`],
  (r) => ['Bean energy', r.pick(['UNREMARKABLE', 'CALM', 'CHAOTIC', 'NEUTRAL', r.chance(0.05) ? 'IMMEASURABLE' : 'MILD'])],
  (r) => ['Sortability index', `${(r.range(6, 9.9)).toFixed(1)} / 10`],
  (r) => ['Emotional availability', r.pick(['LIMITED', 'OPEN', 'N/A (BEAN)'])],
  (r) => ['Legal status', r.pick(['COMPLIANT', 'UNDER REVIEW', 'EXEMPT'])],
];

/** Special notes for particular bean numbers. */
export const SPECIAL_NOTES = {
  1: 'The first of many.',
  42: 'Has the answer. Will not share it.',
  404: 'Bean not found.',
  1000: 'The thousandth bean. It knows.',
  1200: 'The last one. Probably.',
};

/** Messages when a bean escapes the player's grip. */
export const SLIP_LINES = [
  'The bean has escaped.', 'Slippery one.', 'It got away.',
  'Bean has left the hand.', 'Grip failure.',
];

export const STORAGE_KEY = 'beansorter1000.save.v1';
