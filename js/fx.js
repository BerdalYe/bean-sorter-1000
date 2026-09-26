// ---------------------------------------------------------------------------
// fx.js — screen-space particles: sort sparks, touch ripples, floating text,
// combo embers, confetti, bean rain and fireworks.
//
// Particles are pooled: objects are recycled instead of allocated per burst,
// so long combos and celebrations don't churn the garbage collector.
// `scale` (from the Particles setting) multiplies every burst size.
// ---------------------------------------------------------------------------

import { BEAN } from './config.js';
import { rgbCss, shade, TAU } from './util.js';

const HARD_CAP = 1800;

export class Fx {
  constructor() {
    this.p = [];          // live particles
    this.pool = [];       // recycled particle objects
    this.scale = 1;       // Particles setting: 0.35 / 1 / 1.6
  }

  n(count) { return Math.max(1, Math.round(count * this.scale)); }

  /** Get a clean particle object from the pool. */
  obtain() {
    if (this.p.length >= HARD_CAP * Math.max(0.5, this.scale)) return null;
    const o = this.pool.pop() || {};
    o.type = 'dot'; o.x = 0; o.y = 0; o.vx = 0; o.vy = 0; o.g = 0; o.drag = 0;
    o.life = 0; o.max = 1; o.size = 2; o.grow = 0; o.color = '#fff';
    o.rot = 0; o.vr = 0; o.wobble = 0; o.str = ''; o.bean = null; o.font = 16; o.glow = false;
    this.p.push(o);
    return o;
  }

  clear() {
    for (const o of this.p) { o.bean = null; this.pool.push(o); }
    this.p.length = 0;
  }

  /** Little burst when a bean lands in the right container. */
  sparks(x, y, rgb, count = 14) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const o = this.obtain(); if (!o) return;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 120 + Math.random() * 260;
      o.x = x; o.y = y; o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s; o.g = 700;
      o.max = 0.45 + Math.random() * 0.35; o.size = 2 + Math.random() * 2.5;
      o.color = rgbCss(i % 3 === 0 ? [255, 255, 255] : shade(rgb, 0.2));
    }
    this.ring(x, y, 'rgba(255,255,255,0.9)', 10, 120, 0.4);
  }

  ring(x, y, color, size = 8, grow = 60, max = 0.35) {
    const o = this.obtain(); if (!o) return;
    o.type = 'ring'; o.x = x; o.y = y; o.size = size; o.grow = grow; o.max = max; o.color = color;
  }

  text(x, y, str, color = '#fff', size = 16, max = 1.1) {
    const o = this.obtain(); if (!o) return;
    o.type = 'text'; o.x = x; o.y = y; o.vy = -60; o.max = max; o.str = str; o.color = color; o.font = size;
  }

  /** Rising embers around the screen edge during big combos. */
  embers(w, h, energy, color) {
    const o = this.obtain(); if (!o) return;
    const side = Math.random();
    o.x = side < 0.5 ? Math.random() * w : (side < 0.75 ? 8 : w - 8);
    o.y = side < 0.5 ? h * (0.35 + Math.random() * 0.5) : h * Math.random();
    o.vx = (Math.random() - 0.5) * 30; o.vy = -40 - Math.random() * 80 * energy; o.g = -20;
    o.max = 1 + Math.random(); o.size = 1.2 + Math.random() * 2 * energy; o.color = color; o.glow = true;
  }

  /** Coloured paper confetti falling from the top edge. */
  confetti(w, count, palette) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const o = this.obtain(); if (!o) return;
      o.type = 'rect'; o.x = Math.random() * w; o.y = -20 - Math.random() * 300;
      o.vx = (Math.random() - 0.5) * 120; o.vy = 60 + Math.random() * 160; o.g = 120; o.drag = 0.6;
      o.max = 4 + Math.random() * 2.5; o.size = 5 + Math.random() * 6;
      o.rot = Math.random() * TAU; o.vr = (Math.random() - 0.5) * 12;
      o.color = palette[i % palette.length]; o.wobble = Math.random() * TAU;
    }
  }

  /** Confetti cannon: bursts up from the bottom corners. */
  cannons(w, h, count, palette) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const o = this.obtain(); if (!o) return;
      const left = i % 2 === 0;
      o.type = 'rect'; o.x = left ? 0 : w; o.y = h * 0.85;
      const a = left ? -Math.PI / 2 + 0.25 + Math.random() * 0.5 : -Math.PI / 2 - 0.25 - Math.random() * 0.5;
      const s = 700 + Math.random() * 600;
      o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s; o.g = 520; o.drag = 1.6;
      o.max = 3.5 + Math.random() * 2; o.size = 5 + Math.random() * 6;
      o.rot = Math.random() * TAU; o.vr = (Math.random() - 0.5) * 14;
      o.color = palette[i % palette.length]; o.wobble = Math.random() * TAU;
    }
  }

  /** Real beans raining down (drawn with bean sprites). */
  beanRain(w, count, keys, variants = 12) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const o = this.obtain(); if (!o) return;
      const s = 0.9 + Math.random() * 0.8;
      o.type = 'bean'; o.x = Math.random() * w; o.y = -40 - Math.random() * 500;
      o.vx = (Math.random() - 0.5) * 80; o.vy = 80 + Math.random() * 200; o.g = 380; o.drag = 0.2;
      o.max = 4 + Math.random() * 2; o.vr = (Math.random() - 0.5) * 8;
      o.bean = { key: keys[i % keys.length], variant: (Math.random() * variants) | 0, s, a: Math.random() * TAU, flip: Math.random() < 0.5 ? -1 : 1, len: BEAN.len * s, wid: BEAN.wid * s, look: 'plain' };
    }
  }

  firework(x, y, rgb, count = 46) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const o = this.obtain(); if (!o) return;
      const a = (i / n) * TAU + Math.random() * 0.1;
      const s = 180 + Math.random() * 160;
      o.x = x; o.y = y; o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s; o.g = 220; o.drag = 1.4;
      o.max = 1.1 + Math.random() * 0.6; o.size = 2.5 + Math.random() * 2;
      o.color = rgbCss(i % 4 === 0 ? [255, 250, 230] : rgb); o.glow = true;
    }
    this.ring(x, y, rgbCss(shade(rgb, 0.5), 0.8), 20, 260, 0.6);
  }

  update(dt) {
    const p = this.p;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const o = p[i];
      o.life += dt;
      if (o.life >= o.max) { o.bean = null; this.pool.push(o); continue; }
      if (o.drag) { const k = Math.exp(-o.drag * dt); o.vx *= k; o.vy *= k; }
      o.vy += o.g * dt;
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.vr) { if (o.bean) o.bean.a += o.vr * dt; else o.rot += o.vr * dt; }
      p[w++] = o;
    }
    p.length = w;
  }

  draw(renderer) {
    const g = renderer.fctx, dpr = renderer.dpr;
    for (const o of this.p) {
      const t = o.life / o.max;
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      if (o.type === 'bean') {
        renderer.drawBean(g, o.bean, o.x, o.y, 1);
        continue;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = fade;
      if (o.glow) g.globalCompositeOperation = 'lighter';
      if (o.type === 'dot') {
        g.fillStyle = o.color;
        g.beginPath(); g.arc(o.x, o.y, o.size * (1 - t * 0.5), 0, TAU); g.fill();
      } else if (o.type === 'ring') {
        g.strokeStyle = o.color;
        g.lineWidth = 3 * (1 - t);
        g.beginPath(); g.arc(o.x, o.y, o.size + o.grow * t, 0, TAU); g.stroke();
      } else if (o.type === 'rect') {
        g.translate(o.x + Math.sin(o.life * 3 + o.wobble) * 10, o.y);
        g.rotate(o.rot);
        g.scale(1, Math.cos(o.life * 6 + o.wobble));
        g.fillStyle = o.color;
        g.fillRect(-o.size / 2, -o.size * 0.3, o.size, o.size * 0.6);
      } else if (o.type === 'text') {
        const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.5 : t < 0.2 ? 1.1 - ((t - 0.12) / 0.08) * 0.1 : 1;
        g.translate(o.x, o.y); g.scale(pop, pop);
        g.font = `800 ${o.font}px "Archivo", Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(20,26,23,0.75)';
        g.strokeText(o.str, 0, 0);
        g.fillStyle = o.color;
        g.fillText(o.str, 0, 0);
      }
      if (o.glow) g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
