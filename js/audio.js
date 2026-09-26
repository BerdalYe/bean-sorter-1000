// ---------------------------------------------------------------------------
// audio.js — all sound effects are synthesised with the Web Audio API.
// No audio files, nothing to license. The context is created on the first
// user gesture (browsers block audio before that).
// ---------------------------------------------------------------------------

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.8;       // master
    this.sfxVolume = 0.8;    // effects
    this.lastImpact = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (_) { return; }
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.connect(comp);
      this.applyGain();
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  applyGain() {
    if (this.master) this.master.gain.value = this.enabled ? this.volume * this.sfxVolume : 0;
  }
  setEnabled(on) { this.enabled = on; this.applyGain(); }
  setVolume(v) { this.volume = v; this.applyGain(); }
  setSfxVolume(v) { this.sfxVolume = v; this.applyGain(); }

  get ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  /**
   * One oscillator note. `vary` adds a few random cents of detune so that
   * sorting hundreds of beans never sounds exactly the same twice.
   */
  tone({ type = 'sine', f = 440, f2 = null, dur = 0.15, gain = 0.2, attack = 0.005, delay = 0, lp = null, detune = 0, vary = 14 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    o.detune.value = detune + (Math.random() - 0.5) * vary;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(gain, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.value = lp;
      o.connect(fl); node = fl;
    }
    node.connect(gn); gn.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.1, gain = 0.2, type = 'bandpass', freq = 1000, q = 1, delay = 0, attack = 0.002 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(gain, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  // --- game sounds -------------------------------------------------------
  pickup() {
    if (!this.ok) return;
    this.tone({ f: 620, f2: 1050, dur: 0.07, gain: 0.12 });
    this.noise({ dur: 0.03, gain: 0.05, type: 'highpass', freq: 3500 });
  }

  drop() {
    if (!this.ok) return;
    this.tone({ f: 190, f2: 85, dur: 0.12, gain: 0.22 });
    this.noise({ dur: 0.05, gain: 0.08, type: 'lowpass', freq: 900 });
  }

  /**
   * Pitch climbs with the streak so a good run literally sounds better.
   * `energy` (0…1, long combos) adds a bright shimmer on top.
   */
  correct(streak, energy = 0) {
    if (!this.ok) return;
    const idx = Math.min(PENTA.length - 1, Math.floor(streak / 3));
    const step = PENTA[idx] + (Math.random() < 0.3 ? PENTA[Math.max(0, idx - 1)] - PENTA[idx] : 0);
    const f = 523.25 * Math.pow(2, step / 12);
    this.tone({ f: 2400 + Math.random() * 300, dur: 0.02, gain: 0.05, type: 'square', lp: 5000 }); // the snap
    this.tone({ type: 'triangle', f, dur: 0.2, gain: 0.15, delay: 0.01 });
    this.tone({ type: 'sine', f: f * 1.5, dur: 0.16, gain: 0.06, delay: 0.05 });
    if (energy > 0.3) this.tone({ type: 'sine', f: f * 3, dur: 0.12, gain: 0.03 * energy, delay: 0.07 });
    // Rattle of the bean hitting the bottom of the container
    for (let i = 0; i < 4; i++) {
      this.noise({ dur: 0.025, gain: 0.05 - i * 0.01, freq: 2600 + Math.random() * 900, q: 3, delay: 0.03 + i * 0.035 + Math.random() * 0.012 });
    }
  }

  wrong() {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 155, f2: 92, dur: 0.32, gain: 0.09, lp: 1100 });
    this.tone({ type: 'square', f: 150, f2: 88, dur: 0.32, gain: 0.07, lp: 1100, detune: 25 });
    this.noise({ dur: 0.06, gain: 0.07, type: 'lowpass', freq: 700, delay: 0.02 });
  }

  /** Combo milestone. Higher tiers: more notes, faster, bass hit, shimmer. */
  milestone(tier = 0) {
    if (!this.ok) return;
    const steps = [0, 4, 7, 12, 16, 19, 24, 28, 31].slice(0, Math.min(9, 3 + tier));
    const gap = Math.max(0.035, 0.08 - tier * 0.006);
    const base = 523.25 * Math.pow(2, Math.min(tier, 5) / 12);
    steps.forEach((s, i) => this.tone({ type: 'triangle', f: base * Math.pow(2, s / 12), dur: 0.24, gain: 0.12, delay: i * gap }));
    if (tier >= 3) this.tone({ f: 110, f2: 55, dur: 0.4, gain: 0.3 });
    if (tier >= 5) {
      [1, 1.25, 1.5, 2].forEach((m, i) => this.tone({ type: 'sawtooth', f: base * m, dur: 0.9, gain: 0.035, attack: 0.05, delay: steps.length * gap, lp: 2600 }));
    }
    if (tier >= 7) this.noise({ dur: 0.9, gain: 0.08, type: 'highpass', freq: 6000, attack: 0.3, delay: steps.length * gap });
  }

  /** Rare bean found: a little magic sparkle (longer for legendary). */
  rare(rarity) {
    if (!this.ok) return;
    const notes = rarity === 'legendary' ? [0, 7, 12, 16, 19, 24, 28] : rarity === 'rare' ? [0, 7, 12, 16, 19] : [0, 7, 12];
    notes.forEach((s, i) => this.tone({ type: 'sine', f: 880 * Math.pow(2, s / 12), dur: 0.35, gain: 0.08, delay: i * 0.06 }));
    if (rarity === 'legendary') {
      [261.63, 329.63, 392, 523.25].forEach((f) => this.tone({ type: 'sawtooth', f, dur: 2, gain: 0.04, attack: 0.3, lp: 1800 }));
    }
  }

  promotion() {
    if (!this.ok) return;
    [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'square', f: 392 * Math.pow(2, s / 12), dur: 0.18, gain: 0.05, delay: i * 0.1, lp: 2400 }));
    this.tone({ type: 'triangle', f: 784, dur: 0.6, gain: 0.1, delay: 0.4 });
  }

  /** Level intro: a low swell and a tick for each line of text. */
  introSwell() {
    if (!this.ok) return;
    this.noise({ dur: 1.2, gain: 0.06, type: 'lowpass', freq: 400, attack: 0.8 });
    this.tone({ f: 55, dur: 1.4, gain: 0.18, attack: 0.5 });
  }
  introLine(i) {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 660 + i * 40, dur: 0.05, gain: 0.04, lp: 3000 });
  }
  introWarn() {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 440, dur: 0.14, gain: 0.05, lp: 1800 });
    this.tone({ type: 'square', f: 440, dur: 0.14, gain: 0.05, lp: 1800, delay: 0.22 });
  }

  achievement() {
    if (!this.ok) return;
    this.tone({ type: 'sine', f: 1318, dur: 0.35, gain: 0.1 });
    this.tone({ type: 'sine', f: 1760, dur: 0.5, gain: 0.08, delay: 0.1 });
  }

  slip() {
    if (!this.ok) return;
    this.tone({ type: 'sine', f: 900, f2: 260, dur: 0.38, gain: 0.12 });
  }

  shake() {
    if (!this.ok) return;
    this.noise({ dur: 0.7, gain: 0.35, type: 'lowpass', freq: 140, attack: 0.03 });
    this.tone({ f: 48, f2: 38, dur: 0.6, gain: 0.25 });
  }

  fan(on) {
    if (!this.ok) return;
    if (on) this.noise({ dur: 1.4, gain: 0.07, type: 'bandpass', freq: 420, q: 0.7, attack: 0.5 });
    else this.tone({ f: 220, f2: 90, dur: 0.6, gain: 0.05 });
  }

  impact() {
    if (!this.ok) return;
    const now = performance.now();
    if (now - this.lastImpact < 45) return;
    this.lastImpact = now;
    this.noise({ dur: 0.02, gain: 0.03, type: 'highpass', freq: 3000 + Math.random() * 2000 });
  }

  click() {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 1400, dur: 0.025, gain: 0.04 });
  }

  stamp() {
    if (!this.ok) return;
    this.tone({ f: 110, f2: 45, dur: 0.25, gain: 0.35 });
    this.noise({ dur: 0.12, gain: 0.2, type: 'lowpass', freq: 800 });
  }

  notice() {
    if (!this.ok) return;
    this.tone({ type: 'sine', f: 880, dur: 0.09, gain: 0.06 });
    this.tone({ type: 'sine', f: 660, dur: 0.12, gain: 0.06, delay: 0.1 });
  }

  /** The last bean hits the container: deep impact, then a timpani roll. */
  finalHit(rollLength = 0.8) {
    if (!this.ok) return;
    this.tone({ f: 60, f2: 30, dur: 1.4, gain: 0.45 });
    this.noise({ dur: 0.5, gain: 0.2, type: 'lowpass', freq: 500 });
    const n = Math.round(rollLength / 0.05);
    for (let i = 0; i < n; i++) this.noise({ dur: 0.12, gain: 0.05 + (i / n) * 0.14, type: 'lowpass', freq: 180, delay: 0.25 + i * 0.05 });
  }

  /** The reveal: brass chord, bells, final flourish. Bigger for boss levels. */
  finale(big = false) {
    if (!this.ok) return;
    this.tone({ f: 70, f2: 40, dur: 1.2, gain: 0.4 });
    const chord = big ? [130.81, 261.63, 329.63, 392.0, 523.25, 659.25, 783.99] : [261.63, 329.63, 392.0, 523.25];
    const len = big ? 3.4 : 2.2;
    chord.forEach((f, i) => {
      this.tone({ type: 'sawtooth', f, dur: len, gain: 0.06, attack: 0.08, delay: i * 0.02, lp: 2200 });
      this.tone({ type: 'sawtooth', f: f * 1.003, dur: len, gain: 0.04, attack: 0.08, lp: 1600 });
    });
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone({ type: 'sine', f, dur: 0.9, gain: 0.07, delay: 0.5 + i * 0.16 }));
    if (big) {
      for (let k = 0; k < 3; k++) this.tone({ f: 55, f2: 35, dur: 0.6, gain: 0.35, delay: 1.2 + k * 0.45 });
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone({ type: 'triangle', f: 523.25 * Math.pow(2, s / 12), dur: 0.5, gain: 0.09, delay: 2.4 + i * 0.09 }));
    } else {
      [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'triangle', f: 523.25 * Math.pow(2, s / 12), dur: 0.5, gain: 0.09, delay: 1.4 + i * 0.1 }));
    }
  }

  /** Numbers ticking up on the results screen. */
  tick() {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 1800, dur: 0.015, gain: 0.025, lp: 4000, vary: 60 });
  }
}
