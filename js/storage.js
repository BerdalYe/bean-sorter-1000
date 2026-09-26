// storage.js — local save data (settings, progress, lifetime stats,
// achievements, Beandex and an in-progress level). The format is versioned:
// older saves are migrated forward, and anything unreadable falls back to a
// fresh save instead of crashing. Every access is wrapped in try/catch:
// private windows and blocked storage just mean no saving.

import { STORAGE_KEY } from './config.js';

export const SAVE_VERSION = 2;

export function defaults() {
  return {
    version: SAVE_VERSION,
    settings: {
      sound: true, masterVolume: 0.8, sfxVolume: 0.8,
      particles: 'medium', shadows: true, screenShake: true, reducedMotion: false,
      colorAssist: false, uiScale: 1, performance: false, showFps: false,
      haptics: true, hints: true, environment: 'office',
    },
    progress: { unlocked: 1, endless: false, levels: {} },
    life: {
      sorted: 0, mistakes: 0, inspected: 0, escapes: 0, pickups: 0,
      perfectLevels: 0, bestStreak: 0, bestBpm: 0, peakBpm: 0, fastestSort: 0,
      levelsDone: [], endlessBest: 0, endlessRuns: 0, playTime: 0, longestSession: 0,
      beltGrabs: 0, finalBeans: 0, attempts: 0, drops: 0,
      raresFound: 0, legendaries: 0, dexEntries: 0, contemplated: 0,
      secrets: {},
    },
    achievements: {},
    dex: {},
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
    else if (b !== undefined && s !== null && typeof b !== typeof s && b !== null) continue; // wrong type: keep default
    else out[k] = s;
  }
  return out;
}

/** Bring an older save up to the current format. */
export function migrate(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const v = saved.version || 1;
  if (v < 2) {
    const st = saved.settings || {};
    if (typeof st.volume === 'number') st.masterVolume = st.volume;
    delete st.volume;
    const L = saved.life || {};
    if (typeof L.bestBpm === 'number') L.peakBpm = L.bestBpm;
    // Levels 2–4 changed their colour sets, so an old unfinished run can't
    // be rebuilt faithfully. Finished progress is kept.
    saved.run = null;
    saved.version = 2;
  }
  return saved;
}

export function load(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const data = merge(defaults(), migrate(JSON.parse(raw)));
    data.version = SAVE_VERSION;
    if (!Array.isArray(data.life.levelsDone)) data.life.levelsDone = [];
    if (data.run && (typeof data.run !== 'object' || !Array.isArray(data.run.beans))) data.run = null;
    return data;
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
