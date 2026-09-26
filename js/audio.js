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
    this.volume = 0.7;
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
    if (this.master) this.master.gain.value = this.enabled ? this.volume * 0.8 : 0;
  }
  setEnabled(on) { this.enabled = on; this.applyGain(); }
  setVolume(v) { this.volume = v; this.applyGain(); }

  get ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  tone({ type = 'sine', f = 440, f2 = null, dur = 0.15, gain = 0.2, attack = 0.005, delay = 0, lp = null, detune = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    o.detune.value = detune;
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

  /** Pitch climbs with the streak so a good run literally sounds better. */
  correct(streak) {
    if (!this.ok) return;
    const step = PENTA[Math.min(PENTA.length - 1, Math.floor(streak / 3))];
    const f = 523.25 * Math.pow(2, step / 12);
    this.tone({ type: 'triangle', f, dur: 0.2, gain: 0.16 });
    this.tone({ type: 'sine', f: f * 1.5, dur: 0.16, gain: 0.07, delay: 0.045 });
    // Rattle of the bean hitting the bottom of the container
    for (let i = 0; i < 4; i++) {
      this.noise({ dur: 0.025, gain: 0.06 - i * 0.012, freq: 2600 + Math.random() * 800, q: 3, delay: 0.03 + i * 0.035 + Math.random() * 0.01 });
    }
  }

  wrong() {
    if (!this.ok) return;
    this.tone({ type: 'square', f: 155, f2: 92, dur: 0.32, gain: 0.09, lp: 1100 });
    this.tone({ type: 'square', f: 150, f2: 88, dur: 0.32, gain: 0.07, lp: 1100, detune: 25 });
    this.noise({ dur: 0.06, gain: 0.07, type: 'lowpass', freq: 700, delay: 0.02 });
  }

  milestone() {
    if (!this.ok) return;
    [0, 4, 7, 12, 16].forEach((s, i) => {
      this.tone({ type: 'triangle', f: 523.25 * Math.pow(2, s / 12), dur: 0.22, gain: 0.13, delay: i * 0.07 });
    });
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

  /** The final bean. Timpani roll, brass chord, bells. Completely excessive. */
  finale() {
    if (!this.ok) return;
    for (let i = 0; i < 18; i++) {
      this.noise({ dur: 0.12, gain: 0.08 + i * 0.012, type: 'lowpass', freq: 180, delay: i * 0.055 });
    }
    this.tone({ f: 70, f2: 40, dur: 1.2, gain: 0.4, delay: 1.0 });
    const chord = [261.63, 329.63, 392.0, 523.25, 659.25];
    chord.forEach((f, i) => {
      this.tone({ type: 'sawtooth', f, dur: 2.6, gain: 0.07, attack: 0.08, delay: 1.0 + i * 0.02, lp: 2200 });
      this.tone({ type: 'sawtooth', f: f * 1.003, dur: 2.6, gain: 0.05, attack: 0.08, delay: 1.0, lp: 1600 });
    });
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      this.tone({ type: 'sine', f, dur: 0.9, gain: 0.08, delay: 1.5 + i * 0.16 });
    });
    [0, 4, 7, 12].forEach((s, i) => {
      this.tone({ type: 'triangle', f: 523.25 * Math.pow(2, s / 12), dur: 0.5, gain: 0.1, delay: 3.2 + i * 0.12 });
    });
  }
}
