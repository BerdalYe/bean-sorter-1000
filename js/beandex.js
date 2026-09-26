// ---------------------------------------------------------------------------
// beandex.js — bean rarity and the BEANDEX collection.
//
// Rarity is purely cosmetic: a rare bean still belongs in the container of
// its colour. Every bean colour has a "common" entry; special varieties
// (uncommon → legendary) are overlays that can appear on any colour.
// No purchases, no loot boxes: beans are found by playing.
// Pure logic + data, unit-tested in Node.
// ---------------------------------------------------------------------------

export const RARITIES = {
  common: { name: 'Common', order: 0, color: '#7c8781' },
  uncommon: { name: 'Uncommon', order: 1, color: '#2f8a52' },
  rare: { name: 'Rare', order: 2, color: '#2f63c8' },
  legendary: { name: 'Legendary', order: 3, color: '#c9921a' },
};

/** Chance per bean. The remainder (94%) is common. */
export const RARITY_ODDS = { uncommon: 0.05, rare: 0.009, legendary: 0.001 };

/** Special varieties. `look` selects the sprite treatment in beans.js. */
export const VARIETIES = [
  { id: 'mk4', name: 'Bean Mk. IV', rarity: 'uncommon', look: 'speckled', desc: 'Fourth revision. Speckled for improved grip.' },
  { id: 'executive', name: 'Executive Bean', rarity: 'uncommon', look: 'pinstripe', desc: 'Pinstriped. Has a corner office.' },
  { id: 'glossy', name: 'Suspiciously Glossy Bean', rarity: 'uncommon', look: 'glossy', desc: 'Nobody polished it. It is just like this.' },
  { id: 'prime', name: 'Bean Prime', rarity: 'rare', look: 'goldrim', desc: 'The reference bean all other beans are measured against.' },
  { id: 'forbidden', name: 'Forbidden Bean', rarity: 'rare', look: 'swirl', desc: 'Do not ask what is inside.' },
  { id: 'perfect', name: 'Perfect Bean', rarity: 'rare', look: 'perfect', desc: 'Zero defects. Deeply unsettling.' },
  { id: 'golden', name: 'The Golden Bean', rarity: 'legendary', look: 'golden', desc: 'Management would like a word.' },
  { id: 'cosmic', name: 'The Bean', rarity: 'legendary', look: 'cosmic', secret: true, desc: 'It was here before the table.' },
];

export const VARIETY = Object.fromEntries(VARIETIES.map((v) => [v.id, v]));

/** Unnecessarily serious names for the standard bean of each colour. */
export const COMMON_NAMES = {
  red: 'Regulation Red Bean', blue: 'Cerulean Agricultural Unit', yellow: 'Legally Yellow Bean',
  green: 'Extremely Normal Bean', purple: 'Purple Bean (Pending Review)', white: 'Blank Bean',
  black: 'Bean Noir', pink: 'Pink Bean, Standard Issue', orange: 'Suspiciously Orange Bean',
  brown: 'The Brown One', darkred: 'Dark Red Bean, Night Edition', crimson: 'Standard Crimson Bean',
  scarlet: 'Scarlet Bean of Record', burgundy: 'Burgundy Bean, Aged', orangered: 'Orange-Red Bean (Disputed)',
  brownred: 'Brown-Red Transitional Bean', navy: 'Navy Bean (Actual)', cobalt: 'Cobalt Compliance Bean',
  royal: 'Royal Blue Bean', azure: 'Azure Bean Unit', cerulean: 'Cerulean Bean, Second Opinion',
  steel: 'Steel Blue Bean', indigo: 'Indigo Bean', sky: 'Sky Bean',
};

/**
 * Roll a bean's variety with the given random source (0…1).
 * Returns null for a common bean, or a variety id.
 */
export function rollVariety(rand) {
  const r = rand();
  if (r < RARITY_ODDS.legendary) return rand() < 0.1 ? 'cosmic' : 'golden';
  const pool = (rarity) => VARIETIES.filter((v) => v.rarity === rarity && !v.secret);
  const pick = (list) => list[Math.floor(rand() * list.length)].id;
  if (r < RARITY_ODDS.legendary + RARITY_ODDS.rare) return pick(pool('rare'));
  if (r < RARITY_ODDS.legendary + RARITY_ODDS.rare + RARITY_ODDS.uncommon) return pick(pool('uncommon'));
  return null;
}

export const rarityOf = (varietyId) => (varietyId ? VARIETY[varietyId].rarity : 'common');

/** Full list of Beandex entries in display order. */
export function beandexEntries(colorKeys) {
  const commons = colorKeys.map((k) => ({ id: `c:${k}`, kind: 'common', key: k, name: COMMON_NAMES[k] || `${k} bean`, rarity: 'common' }));
  const specials = VARIETIES.map((v) => ({ id: `v:${v.id}`, kind: 'variety', variety: v.id, name: v.name, rarity: v.rarity, secret: !!v.secret, desc: v.desc }));
  return [...commons, ...specials];
}

/**
 * Record a discovery. `dex` is the saved map { entryId: { n, first, key } }.
 * Returns true if this is the first time the entry was found.
 */
export function discover(dex, entryId, key, now = Date.now()) {
  const e = dex[entryId];
  if (e) { e.n++; return false; }
  dex[entryId] = { n: 1, first: now, key };
  return true;
}

export function countRare(dex) {
  let n = 0;
  for (const id of Object.keys(dex)) {
    if (!id.startsWith('v:')) continue;
    const v = VARIETY[id.slice(2)];
    if (v && (v.rarity === 'rare' || v.rarity === 'legendary')) n += dex[id].n;
  }
  return n;
}

export const hasLegendary = (dex) => Object.keys(dex).some((id) => id.startsWith('v:') && VARIETY[id.slice(2)]?.rarity === 'legendary');
