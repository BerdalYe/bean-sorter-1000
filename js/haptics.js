// ---------------------------------------------------------------------------
// haptics.js — small vibrations on phones.
//
// • Android (Chrome, Firefox): the Vibration API, with real patterns.
// • iPhone: Safari has no Vibration API, but since iOS 18 toggling an
//   <input type="checkbox" switch> produces a system haptic tick. We keep a
//   hidden one and click its label; patterns become one tick per pulse.
//   This only fires during a user gesture (tap, drag release), which is
//   exactly when we want feedback anyway.
// • Anything else: silently does nothing.
// ---------------------------------------------------------------------------

const PATTERNS = {
  pickup: [7],
  drop: [5],
  correct: [12],
  wrong: [35, 45, 35],
  milestone: [18, 40, 18, 40, 45],
  big: [25, 40, 25, 40, 25, 40, 90],
  rare: [10, 30, 10, 30, 70],
  final: [60, 70, 60, 70, 180],
  shake: [70],
  achievement: [15, 30, 25],
  tap: [4],
};

export class Haptics {
  constructor() {
    this.enabled = true;
    this.last = 0;
    this.vibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    this.ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    this.label = null;
    if (!this.vibrate && this.ios) this.makeSwitch();
  }

  /** True when this device can produce some kind of haptic. */
  get supported() { return this.vibrate || !!this.label; }

  makeSwitch() {
    try {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      this.label = label;
    } catch (_) {
      this.label = null;
    }
  }

  play(name) {
    if (!this.enabled) return;
    const pattern = PATTERNS[name];
    if (!pattern) return;
    const now = performance.now();
    // Don't buzz constantly: light taps are rate-limited.
    if (pattern.length === 1 && pattern[0] < 15 && now - this.last < 45) return;
    this.last = now;
    try {
      if (this.vibrate) {
        navigator.vibrate(pattern);
      } else if (this.label) {
        // One tick per "on" segment of the pattern, spaced like the pattern.
        let t = 0;
        for (let i = 0; i < pattern.length; i += 2) {
          if (t === 0) this.label.click();
          else setTimeout(() => this.label && this.label.click(), t);
          t += pattern[i] + (pattern[i + 1] || 0);
          if (i >= 4) break;
        }
      }
    } catch (_) { /* haptics are optional */ }
  }
}
