// session.js — scorekeeping for one shift (a level or an endless run).
// Pure logic, no DOM: tested in Node.

import { COMBOS, computeRank } from './config.js';

const BPM_WINDOW = 20;       // seconds of history behind "current BPM"
const RING = 512;

/**
 * Beans-per-minute meter. "Current" BPM counts correct sorts in a sliding
 * window and is then eased, so the readout glides instead of jumping.
 * Peak BPM only counts once a shift has enough data to be meaningful.
 */
export class BpmMeter {
  constructor() {
    this.times = new Float64Array(RING);
    this.n = 0;
    this.smooth = 0;
    this.peak = 0;
  }

  record(t) { this.times[this.n++ % RING] = t; }

  raw(now) {
    let c = 0;
    const count = Math.min(this.n, RING);
    for (let i = 0; i < count; i++) if (now - this.times[i] <= BPM_WINDOW) c++;
    const span = Math.min(BPM_WINDOW, Math.max(now, 5));
    return (c / span) * 60;
  }

  update(now, dt, sortedSoFar) {
    const target = this.raw(now);
    this.smooth += (target - this.smooth) * Math.min(1, dt * 1.2);
    if (sortedSoFar >= 12 && now >= 15 && this.smooth > this.peak) this.peak = this.smooth;
    return this.smooth;
  }
}

export class Session {
  /**
   * @param {object} o { mode: 'level'|'endless', levelId, total, challenge, limit }
   */
  constructor(o) {
    this.mode = o.mode;
    this.levelId = o.levelId || 0;
    this.total = o.total || 0;
    this.challenge = !!o.challenge;
    this.limit = o.limit || 0;
    this.sorted = 0;
    this.mistakes = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.elapsed = 0;
    this.inspected = 0;
    this.escapes = 0;
    this.lastSortAt = -1;
    this.fastest = 0;            // shortest gap between two correct sorts (s)
    this.bpmMeter = new BpmMeter();
    this.done = false;
  }

  get attempts() { return this.sorted + this.mistakes; }
  get accuracy() { return this.attempts === 0 ? 100 : (this.sorted / this.attempts) * 100; }
  /** Average beans per minute over the whole shift. */
  get bpm() { return this.elapsed < 1 ? 0 : this.sorted / (this.elapsed / 60); }
  get currentBpm() { return this.bpmMeter.smooth; }
  get peakBpm() { return Math.max(this.bpmMeter.peak, this.done ? this.bpm : 0); }
  get remaining() { return Math.max(0, this.total - this.sorted); }
  get timeLeft() { return this.challenge ? Math.max(0, this.limit - this.elapsed) : Infinity; }

  tick(dt) {
    if (this.done) return;
    this.elapsed += dt;
    this.bpmMeter.update(this.elapsed, dt, this.sorted);
  }

  /** Record a correct sort. Returns a combo milestone object or null. */
  correct() {
    this.sorted++;
    this.streak++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    if (this.lastSortAt >= 0) {
      const gap = this.elapsed - this.lastSortAt;
      if (gap > 0.05 && (this.fastest === 0 || gap < this.fastest)) this.fastest = gap;
    }
    this.lastSortAt = this.elapsed;
    this.bpmMeter.record(this.elapsed);
    const hit = COMBOS.find((c) => c.n === this.streak);
    if (hit) return hit;
    const last = COMBOS[COMBOS.length - 1];
    if (this.streak > last.n && (this.streak - last.n) % 500 === 0) {
      return { n: this.streak, text: 'BEYOND COMPREHENSION', tier: 8 };
    }
    return null;
  }

  wrong() {
    this.mistakes++;
    const lost = this.streak;
    this.streak = 0;
    return lost;
  }

  summary() {
    const rank = computeRank(this.accuracy, this.bpm);
    return {
      mode: this.mode, levelId: this.levelId, total: this.total,
      sorted: this.sorted, mistakes: this.mistakes,
      accuracy: this.accuracy, longest: this.bestStreak,
      time: this.elapsed, bpm: this.bpm, peakBpm: Math.max(this.bpmMeter.peak, this.bpm), rank,
      fastest: this.fastest,
      complete: this.mode === 'level' && this.sorted >= this.total,
      perfect: this.mistakes === 0 && this.sorted > 0,
    };
  }

  toJSON() {
    const { mode, levelId, total, challenge, limit, sorted, mistakes, streak, bestStreak, elapsed, inspected, escapes, fastest } = this;
    return { mode, levelId, total, challenge, limit, sorted, mistakes, streak, bestStreak, elapsed, inspected, escapes, fastest, peak: this.bpmMeter.peak };
  }

  static from(o) {
    const s = new Session(o);
    Object.assign(s, {
      sorted: o.sorted, mistakes: o.mistakes, streak: o.streak, bestStreak: o.bestStreak,
      elapsed: o.elapsed, inspected: o.inspected || 0, escapes: o.escapes || 0, fastest: o.fastest || 0,
    });
    s.bpmMeter.peak = o.peak || 0;
    return s;
  }
}
