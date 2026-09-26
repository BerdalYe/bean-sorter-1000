// storage.js — local save data (settings, progress, lifetime stats,
// achievements and an in-progress level). Everything is wrapped in
// try/catch: private windows and blocked storage just mean no saving.

import { STORAGE_KEY } from './config.js';

export function defaults() {
  return {
    version: 1,
    settings: { sound: true, volume: 0.7, screenShake: true, reducedMotion: false, hints: true },
    progress: { unlocked: 1, endless: false, levels: {} },
    life: {
      sorted: 0, mistakes: 0, inspected: 0, escapes: 0, pickups: 0,
      perfectLevels: 0, bestStreak: 0, bestBpm: 0, levelsDone: [],
      endlessBest: 0, endlessRuns: 0, playTime: 0, beltGrabs: 0, finalBeans: 0,
    },
    achievements: {},
    run: null,
  };
}

/** Deep-merge saved data over defaults so new fields appear after updates. */
function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    const b = base[k], s = saved[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && s && typeof s === 'object' && !Array.isArray(s)) out[k] = merge(b, s);
    else out[k] = s;
  }
  return out;
}

export function load(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    return merge(defaults(), JSON.parse(raw));
  } catch (_) {
    return defaults();
  }
}

export function save(data, storage = safeStorage()) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    return false;
  }
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (_) {
    return null;
  }
}
