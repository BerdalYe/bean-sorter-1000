// ---------------------------------------------------------------------------
// input.js — unified mouse / touch / pen handling via Pointer Events.
//
// Gestures
//  Mouse: left-drag bean → move it; left-drag empty table, middle-drag or
//         Space+drag → pan; wheel → zoom at cursor; right-click → inspect.
//  Touch: one finger on a bean → drag it; one finger elsewhere → pan;
//         two fingers → pinch-zoom + pan; long-press a bean → inspect.
//
// The Input class only interprets gestures. What a "grab" or "inspect"
// actually does is decided by the handlers passed in from game.js.
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP = 9;

export class Input {
  /**
   * @param {HTMLElement} el   element that receives pointer events
   * @param {object} h         handlers: grab, drag, release, cancelGrab,
   *                           inspect, pan, zoom, hover, key, tap
   */
  constructor(el, h) {
    this.el = el;
    this.h = h;
    this.enabled = true;
    this.pointers = new Map();
    this.mode = 'idle';            // idle | bean | pan | pinch | wait
    this.beanPointer = -1;
    this.spaceHeld = false;
    this.longTimer = 0;
    this.pinch = null;
    this.mouse = { x: -1, y: -1, inside: false };

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.mouse.inside = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keyup(e));
    window.addEventListener('blur', () => { this.spaceHeld = false; this.updateCursor(); });
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.reset();
  }

  /** Abort whatever gesture is in progress (e.g. when a menu opens). */
  reset() {
    if (this.mode === 'bean') this.h.cancelGrab();
    clearTimeout(this.longTimer);
    this.pointers.clear();
    this.mode = 'idle';
    this.beanPointer = -1;
    this.pinch = null;
    this.updateCursor();
  }

  down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, moved: false };
    this.pointers.set(e.pointerId, p);
    this.h.userGesture?.();

    if (e.pointerType === 'mouse') {
      if (e.button === 2) { this.h.inspect(e.clientX, e.clientY); return; }
      if (e.button === 1 || this.spaceHeld) { this.mode = 'pan'; this.updateCursor(); return; }
      if (e.button !== 0) return;
      if (this.mode === 'idle' && this.h.grab(e.clientX, e.clientY, 'mouse')) {
        this.mode = 'bean'; this.beanPointer = e.pointerId;
      } else if (this.mode === 'idle') {
        this.mode = 'pan';
      }
      this.updateCursor();
      return;
    }

    // Touch / pen
    if (this.pointers.size === 1) {
      if (this.h.grab(e.clientX, e.clientY, e.pointerType)) {
        this.mode = 'bean'; this.beanPointer = e.pointerId;
        clearTimeout(this.longTimer);
        this.longTimer = setTimeout(() => {
          const q = this.pointers.get(e.pointerId);
          if (this.mode === 'bean' && q && !q.moved) {
            this.h.longPress(q.x, q.y);   // puts the bean back and inspects it
            this.mode = 'wait';
          }
        }, LONG_PRESS_MS);
      } else {
        this.mode = 'pan';
      }
    } else if (this.pointers.size === 2) {
      // Second finger: switch to pinch. A held bean is put down gently.
      if (this.mode === 'bean') this.h.cancelGrab();
      clearTimeout(this.longTimer);
      this.mode = 'pinch';
      this.pinch = this.pinchState();
    }
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  move(e) {
    if (e.pointerType === 'mouse') {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    }
    const p = this.pointers.get(e.pointerId);
    if (!this.enabled) return;
    if (!p) {
      if (e.pointerType === 'mouse' && this.mode === 'idle') {
        this.h.hover(e.clientX, e.clientY);
        this.updateCursor();
      }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > LONG_PRESS_SLOP) p.moved = true;

    if (this.mode === 'bean' && e.pointerId === this.beanPointer) {
      this.h.drag(p.x, p.y);
    } else if (this.mode === 'pan') {
      this.h.pan(dx, dy);
    } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const s = this.pinchState();
      this.h.zoom(s.d / this.pinch.d, s.mx, s.my);
      this.h.pan(s.mx - this.pinch.mx, s.my - this.pinch.my);
      this.pinch = s;
    }
  }

  up(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    try { this.el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (!this.enabled) return;

    if (this.mode === 'bean' && e.pointerId === this.beanPointer) {
      clearTimeout(this.longTimer);
      if (cancelled) this.h.cancelGrab(); else this.h.release(e.clientX, e.clientY);
      this.beanPointer = -1;
      this.mode = 'idle';
    } else if (this.mode === 'pinch') {
      if (this.pointers.size === 1) {
        this.mode = 'pan';           // keep panning with the remaining finger
      } else if (this.pointers.size === 0) {
        this.mode = 'idle';
      } else {
        this.pinch = this.pinchState();
      }
    } else if (this.pointers.size === 0) {
      if (this.mode === 'pan' && !p.moved) this.h.tap?.(e.clientX, e.clientY);
      this.mode = 'idle';
    }
    this.updateCursor();
  }

  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0016;
    const k = e.ctrlKey ? 2.2 : 1;   // trackpad pinch arrives as ctrl+wheel
    this.h.zoom(Math.exp(-e.deltaY * unit * k), e.clientX, e.clientY);
  }

  keydown(e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'Space') {
      if (this.enabled) e.preventDefault();
      this.spaceHeld = true;
      this.updateCursor();
      return;
    }
    this.h.key(e);
  }

  keyup(e) {
    if (e.code === 'Space') { this.spaceHeld = false; this.updateCursor(); }
  }

  updateCursor() {
    let c = 'default';
    if (this.mode === 'bean') c = 'grabbing';
    else if (this.mode === 'pan') c = 'grabbing';
    else if (this.spaceHeld) c = 'grab';
    else if (this.h.isHovering?.()) c = 'grab';
    this.el.style.cursor = c;
  }
}
