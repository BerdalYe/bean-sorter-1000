// camera.js — world ↔ screen transform with zoom, pan and screen shake.
// Screen coordinates are CSS pixels relative to the window. The usable view
// is the area between the HUD (top inset) and the container tray (bottom).

import { clamp } from './util.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;          // world point at the centre of the view
    this.zoom = 1;
    this.minZoom = 0.2; this.maxZoom = 5;
    this.w = 1; this.h = 1;          // viewport size (CSS px)
    this.top = 0; this.bottom = 0;   // insets taken by HUD and tray
    this.right = 0;                  // tray on the side (landscape phones)
    this.shakeT = 0; this.shakeMag = 0;
    this.sx = 0; this.sy = 0;        // current shake offset
    this.bounds = null;
  }

  setViewport(w, h, top, bottom, right = 0) {
    this.w = w; this.h = h; this.top = top; this.bottom = bottom; this.right = right;
  }

  get cx() { return (this.w - this.right) / 2; }
  get cy() { return this.top + (this.h - this.top - this.bottom) / 2; }

  toScreenX(wx) { return (wx - this.x) * this.zoom + this.cx + this.sx; }
  toScreenY(wy) { return (wy - this.y) * this.zoom + this.cy + this.sy; }
  toWorldX(sx) { return (sx - this.cx - this.sx) / this.zoom + this.x; }
  toWorldY(sy) { return (sy - this.cy - this.sy) / this.zoom + this.y; }

  /** Zoom that fits `rect` into the usable view, with `pad` CSS px margin. */
  fitZoom(rect, pad = 24) {
    const uw = Math.max(50, this.w - this.right - pad * 2);
    const uh = Math.max(50, this.h - this.top - this.bottom - pad * 2);
    return Math.min(uw / rect.w, uh / rect.h);
  }

  fit(rect, pad = 24) {
    const z = this.fitZoom(rect, pad);
    this.minZoom = z * 0.6;
    this.maxZoom = Math.max(4, z * 7);
    this.zoom = z;
    this.x = rect.x + rect.w / 2;
    this.y = rect.y + rect.h / 2;
    this.bounds = rect;
  }

  zoomAt(sx, sy, factor) {
    const wx = this.toWorldX(sx), wy = this.toWorldY(sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.x += wx - this.toWorldX(sx);
    this.y += wy - this.toWorldY(sy);
    this.clampToBounds();
  }

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampToBounds();
  }

  /** Keep the table from being dragged completely out of view. */
  clampToBounds() {
    const b = this.bounds;
    if (!b) return;
    const m = 120;
    this.x = clamp(this.x, b.x - m, b.x + b.w + m);
    this.y = clamp(this.y, b.y - m - 60, b.y + b.h + m);
  }

  shake(mag, dur) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  update(dt, allowShake = true) {
    if (this.shakeT > 0 && allowShake) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT) * this.shakeMag;
      this.sx = (Math.random() - 0.5) * k;
      this.sy = (Math.random() - 0.5) * k;
      if (this.shakeT <= 0) { this.shakeMag = 0; this.sx = this.sy = 0; }
    } else {
      this.shakeT = 0; this.sx = this.sy = 0;
    }
  }
}
