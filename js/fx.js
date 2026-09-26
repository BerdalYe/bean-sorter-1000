// fx.js — screen-space particles: sort sparks, rings, floating text,
// confetti, bean rain and fireworks for the (absurdly dramatic) finale.

import { BEAN } from './config.js';
import { rgbCss, shade, TAU } from './util.js';

const MAX_PARTICLES = 1600;

export class Fx {
  constructor() {
    this.p = [];
    this.flash = 0;
  }

  add(o) {
    if (this.p.length >= MAX_PARTICLES) this.p.shift();
    this.p.push(o);
  }

  /** Little burst when a bean lands in the right container. */
  sparks(x, y, rgb, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 120 + Math.random() * 260;
      this.add({ type: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 700, life: 0, max: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 3, color: rgbCss(i % 3 === 0 ? [255, 255, 255] : shade(rgb, 0.2)) });
    }
    this.add({ type: 'ring', x, y, life: 0, max: 0.45, size: 10, grow: 140, color: 'rgba(255,255,255,0.9)' });
  }

  text(x, y, str, color = '#fff', size = 16) {
    this.add({ type: 'text', x, y, vx: 0, vy: -60, g: 0, life: 0, max: 1.1, str, color, size });
  }

  /** Coloured paper confetti falling from the top edge. */
  confetti(w, n, palette) {
    for (let i = 0; i < n; i++) {
      this.add({
        type: 'rect', x: Math.random() * w, y: -20 - Math.random() * 300,
        vx: (Math.random() - 0.5) * 120, vy: 60 + Math.random() * 160, g: 120, drag: 0.6,
        life: 0, max: 4 + Math.random() * 2.5, size: 5 + Math.random() * 6,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12,
        color: palette[i % palette.length], wobble: Math.random() * TAU,
      });
    }
  }

  /** Real beans raining down (drawn with bean sprites). */
  beanRain(w, n, keys, variants = 12) {
    for (let i = 0; i < n; i++) {
      const s = 0.9 + Math.random() * 0.8;
      this.add({
        type: 'bean', x: Math.random() * w, y: -40 - Math.random() * 500,
        vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 200, g: 380, drag: 0.2,
        life: 0, max: 4 + Math.random() * 2,
        bean: { key: keys[i % keys.length], variant: (Math.random() * variants) | 0, s, a: Math.random() * TAU, flip: Math.random() < 0.5 ? -1 : 1, len: BEAN.len * s, wid: BEAN.wid * s },
        vr: (Math.random() - 0.5) * 8,
      });
    }
  }

  firework(x, y, rgb) {
    const n = 46;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.1;
      const s = 180 + Math.random() * 160;
      this.add({ type: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 220, drag: 1.4, life: 0, max: 1.1 + Math.random() * 0.6, size: 2.5 + Math.random() * 2, color: rgbCss(i % 4 === 0 ? [255, 250, 230] : rgb), trail: true });
    }
    this.add({ type: 'ring', x, y, life: 0, max: 0.6, size: 20, grow: 260, color: rgbCss(shade(rgb, 0.5), 0.8) });
  }

  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const p = this.p;
    let w = 0;
    for (let i = 0; i < p.length; i++) {
      const o = p[i];
      o.life += dt;
      if (o.life >= o.max) continue;
      if (o.vx !== undefined) {
        if (o.drag) { const k = Math.exp(-o.drag * dt); o.vx *= k; o.vy *= k; }
        o.vy += (o.g || 0) * dt;
        o.x += o.vx * dt; o.y += o.vy * dt;
      }
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
        g.font = `800 ${o.size}px "Archivo", Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(20,26,23,0.75)';
        g.strokeText(o.str, o.x, o.y);
        g.fillStyle = o.color;
        g.fillText(o.str, o.x, o.y);
      }
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
