// session.js — scorekeeping for one shift (a level or an endless run).
// Pure logic, no DOM: tested in Node.

import { COMBOS, computeRank } from './config.js';

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
    this.done = false;
  }

  get attempts() { return this.sorted + this.mistakes; }
  get accuracy() { return this.attempts === 0 ? 100 : (this.sorted / this.attempts) * 100; }
  get bpm() { return this.elapsed < 1 ? 0 : this.sorted / (this.elapsed / 60); }
  get remaining() { return Math.max(0, this.total - this.sorted); }
  get timeLeft() { return this.challenge ? Math.max(0, this.limit - this.elapsed) : Infinity; }

  tick(dt) { if (!this.done) this.elapsed += dt; }

  /** Record a correct sort. Returns a combo milestone object or null. */
  correct() {
    this.sorted++;
    this.streak++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    const hit = COMBOS.find((c) => c.n === this.streak);
    if (hit) return hit;
    const last = COMBOS[COMBOS.length - 1];
    if (this.streak > last.n && (this.streak - last.n) % 250 === 0) {
      return { n: this.streak, text: 'UNSTOPPABLE LEGUME' };
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
      time: this.elapsed, bpm: this.bpm, rank,
      complete: this.mode === 'level' && this.sorted >= this.total,
      perfect: this.mistakes === 0 && this.sorted > 0,
    };
  }

  toJSON() {
    const { mode, levelId, total, challenge, limit, sorted, mistakes, streak, bestStreak, elapsed, inspected, escapes } = this;
    return { mode, levelId, total, challenge, limit, sorted, mistakes, streak, bestStreak, elapsed, inspected, escapes };
  }

  static from(o) {
    const s = new Session(o);
    Object.assign(s, {
      sorted: o.sorted, mistakes: o.mistakes, streak: o.streak, bestStreak: o.bestStreak,
      elapsed: o.elapsed, inspected: o.inspected || 0, escapes: o.escapes || 0,
    });
    return s;
  }
}
