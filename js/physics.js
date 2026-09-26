// ---------------------------------------------------------------------------
// physics.js — lightweight top-down bean physics.
//
// Model
//  • Each bean is a capsule (a line segment with radius = half its width),
//    which lets beans nestle against each other more convincingly than circles.
//  • Beans live on integer "layers" (z). Collisions only happen within a layer,
//    so a bean dropped onto a heap sits on top of it. A bean on layer z>0 must
//    overlap something on layer z-1 or it falls one layer; while supported it
//    slowly slides away from what it rests on, so heaps spread out over time
//    and hidden beans are eventually revealed.
//  • Broad phase is a uniform grid rebuilt every step (a linked list in typed
//    arrays — no allocation per frame). Cell size ≥ the largest bean, so the
//    3×3 neighbourhood always contains every possible contact.
//  • Resting beans fall asleep and cost almost nothing until something wakes
//    them (a collision, the fan, a shake, a tilt).
// ---------------------------------------------------------------------------

import { segSegClosest, clamp } from './util.js';

export const MAX_LAYER = 4;
const CELL = 46;
const MARGIN = 140;
const SLIDE = 36;           // how hard piled beans slide off their supports
const MAX_SPEED = 900;
const STATIC_ACCEL = 9;     // external forces below this don't unstick a bean

const tmp = { c1x: 0, c1y: 0, c2x: 0, c2y: 0, d2: 0 };

export function wake(b) {
  b.awake = true;
  b.sleep = 0;
}

export class Physics {
  constructor() {
    this.head = new Int32Array(1);
    this.next = new Int32Array(64);
    this.impacts = 0;       // hard collisions this step (for click sounds)
  }

  setBounds(rect) {
    this.rect = rect;
    this.ox = rect.x - MARGIN;
    this.oy = rect.y - MARGIN;
    this.cols = Math.ceil((rect.w + MARGIN * 2) / CELL);
    this.rows = Math.ceil((rect.h + MARGIN * 2) / CELL);
    this.head = new Int32Array(this.cols * this.rows);
    this.head.fill(-1);
  }

  cellX(x) { return clamp(((x - this.ox) / CELL) | 0, 0, this.cols - 1); }
  cellY(y) { return clamp(((y - this.oy) / CELL) | 0, 0, this.rows - 1); }

  /** Rebuild the broad-phase grid from beans currently on the table. */
  rebuild(beans) {
    if (this.next.length < beans.length) this.next = new Int32Array(beans.length * 2);
    const head = this.head;
    head.fill(-1);
    for (let i = 0; i < beans.length; i++) {
      const b = beans[i];
      if (b.state !== 'table') continue;
      const c = this.cellY(b.y) * this.cols + this.cellX(b.x);
      this.next[i] = head[c];
      head[c] = i;
    }
  }

  /** Call fn(index) for every table bean in the 3×3 cells around (x, y). */
  near(x, y, fn) {
    const cx = this.cellX(x), cy = this.cellY(y);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= this.rows) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= this.cols) continue;
        let j = this.head[gy * this.cols + gx];
        while (j !== -1) { fn(j); j = this.next[j]; }
      }
    }
  }

  /**
   * Advance the simulation by dt seconds.
   * env: { tiltX, tiltY, fan: {x,y,dx,dy,range,cos,strength}|null }
   */
  step(beans, dt, env) {
    const rect = this.rect;
    this.impacts = 0;

    // --- 1. forces & integration -----------------------------------------
    for (let i = 0; i < beans.length; i++) {
      const b = beans[i];
      if (b.state !== 'table') continue;

      if (b.land < 1) b.land += dt;        // drives the drop-bounce animation
      if (b.zf !== b.z) {
        b.zf += (b.z - b.zf) * Math.min(1, dt * 14);
        if (Math.abs(b.zf - b.z) < 0.01) { b.zf = b.z; b.land = 0; }
      }

      let ax = 0, ay = 0;
      if (env.tiltX || env.tiltY) { ax += env.tiltX; ay += env.tiltY; }
      const fan = env.fan;
      if (fan) {
        const dx = b.x - fan.x, dy = b.y - fan.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < fan.range) {
          const c = (dx * fan.dx + dy * fan.dy) / d;
          if (c > fan.cos) {
            // Stronger near the fan and near the centre of the cone.
            const f = fan.strength * (1 - d / fan.range) * ((c - fan.cos) / (1 - fan.cos)) / (b.s * b.s);
            ax += fan.dx * f + (Math.random() - 0.5) * f * 0.6;
            ay += fan.dy * f + (Math.random() - 0.5) * f * 0.6;
            b.va += (Math.random() - 0.5) * 0.15;
          }
        }
      }
      if (b.z > 0) { ax += b.slideX || 0; ay += b.slideY || 0; }

      const ext = ax * ax + ay * ay > STATIC_ACCEL * STATIC_ACCEL || b.z > 0;
      b.ext = ext;
      if (ext && !b.awake) wake(b);
      if (!b.awake) continue;

      if (ext) { b.vx += ax * dt; b.vy += ay * dt; }
      const fr = Math.exp(-(b.z > 0 ? 2.4 : 3.6) * dt);
      b.vx *= fr; b.vy *= fr;
      b.va *= Math.exp(-4.5 * dt);
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      if (sp2 > MAX_SPEED * MAX_SPEED) {
        const k = MAX_SPEED / Math.sqrt(sp2);
        b.vx *= k; b.vy *= k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.va * dt;
    }

    // --- 2. collisions (two relaxation passes) ----------------------------
    this.rebuild(beans);
    const head = this.head, next = this.next, cols = this.cols, rows = this.rows;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < beans.length; i++) {
        const b = beans[i];
        if (b.state !== 'table' || !b.awake) continue;
        const ux = Math.cos(b.a), uy = Math.sin(b.a);
        const h = Math.max(0, (b.len - b.wid) * 0.5);
        const r1 = b.wid * 0.48;
        const p1x = b.x - ux * h, p1y = b.y - uy * h, q1x = b.x + ux * h, q1y = b.y + uy * h;
        const cx = this.cellX(b.x), cy = this.cellY(b.y);

        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= rows) continue;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= cols) continue;
            let j = head[gy * cols + gx];
            while (j !== -1) {
              const o = beans[j];
              // Each awake pair is handled once (i<j); sleeping partners are
              // always handled by the awake bean.
              if (j !== i && o.z === b.z && o.state === 'table' && !(o.awake && j < i)) {
                const dx = o.x - b.x, dy = o.y - b.y;
                const lim = (b.len + o.len) * 0.5;
                if (dx * dx + dy * dy < lim * lim) this.resolvePair(b, o, p1x, p1y, q1x, q1y, r1);
              }
              j = next[j];
            }
          }
        }
      }
    }

    // --- 3. walls, piles, sleep -------------------------------------------
    for (let i = 0; i < beans.length; i++) {
      const b = beans[i];
      if (b.state !== 'table') continue;
      if (b.z > 0) this.support(b, beans);
      if (!b.awake) continue;
      this.walls(b, rect);

      if (b.z === 0 && !b.ext && b.vx * b.vx + b.vy * b.vy < 2.5 && Math.abs(b.va) < 0.2) {
        b.sleep += dt;
        if (b.sleep > 0.5) { b.awake = false; b.vx = b.vy = b.va = 0; }
      } else {
        b.sleep = 0;
      }
    }
  }

  resolvePair(b, o, p1x, p1y, q1x, q1y, r1) {
    const ux = Math.cos(o.a), uy = Math.sin(o.a);
    const h = Math.max(0, (o.len - o.wid) * 0.5);
    const r2 = o.wid * 0.48;
    segSegClosest(p1x, p1y, q1x, q1y, o.x - ux * h, o.y - uy * h, o.x + ux * h, o.y + uy * h, tmp);
    const rs = r1 + r2;
    if (tmp.d2 >= rs * rs) return;

    let d = Math.sqrt(tmp.d2);
    let nx, ny;
    if (d > 1e-4) { nx = (tmp.c2x - tmp.c1x) / d; ny = (tmp.c2y - tmp.c1y) / d; }
    else { const a = Math.random() * 6.283; nx = Math.cos(a); ny = Math.sin(a); d = 0; }

    const pen = rs - d;
    const wa = b.invMass, wb = o.invMass, sum = wa + wb;
    const corr = pen * 0.7;
    b.x -= nx * corr * (wa / sum); b.y -= ny * corr * (wa / sum);
    o.x += nx * corr * (wb / sum); o.y += ny * corr * (wb / sum);

    // Off-centre contacts twist the beans a little so they nestle.
    const r1x = tmp.c1x - b.x, r1y = tmp.c1y - b.y;
    const r2x = tmp.c2x - o.x, r2y = tmp.c2y - o.y;
    b.a += (-r1x * ny + r1y * nx) * corr * 0.006 * (wa / sum);
    o.a += (r2x * ny - r2y * nx) * corr * 0.006 * (wb / sum);

    // Velocity impulse along the normal (slightly bouncy).
    const vn = (o.vx - b.vx) * nx + (o.vy - b.vy) * ny;
    if (vn < 0) {
      const jn = (-1.15 * vn) / sum;
      b.vx -= jn * wa * nx; b.vy -= jn * wa * ny;
      o.vx += jn * wb * nx; o.vy += jn * wb * ny;
      b.va += (-r1x * ny + r1y * nx) * jn * wa * 0.012;
      o.va += (r2x * ny - r2y * nx) * jn * wb * 0.012;
      if (vn < -70) this.impacts++;
    }
    if (!o.awake && (pen > 0.35 || vn < -8)) wake(o);
  }

  walls(b, rect) {
    const ux = Math.cos(b.a), uy = Math.sin(b.a);
    const h = Math.max(0, (b.len - b.wid) * 0.5);
    const r = b.wid * 0.5;
    for (let e = -1; e <= 1; e += 2) {
      const px = b.x + ux * h * e, py = b.y + uy * h * e;
      if (px - r < rect.x) { b.x += rect.x - (px - r); if (b.vx < 0) { b.vx = -b.vx * 0.35; b.va += e * 0.4 * uy; } }
      else if (px + r > rect.x + rect.w) { b.x -= px + r - (rect.x + rect.w); if (b.vx > 0) { b.vx = -b.vx * 0.35; b.va -= e * 0.4 * uy; } }
      if (py - r < rect.y) { b.y += rect.y - (py - r); if (b.vy < 0) { b.vy = -b.vy * 0.35; b.va -= e * 0.4 * ux; } }
      else if (py + r > rect.y + rect.h) { b.y -= py + r - (rect.y + rect.h); if (b.vy > 0) { b.vy = -b.vy * 0.35; b.va += e * 0.4 * ux; } }
    }
  }

  /** Is a piled bean still resting on something? If not, it drops a layer. */
  support(b, beans) {
    let n = 0, sx = 0, sy = 0;
    const want = b.z - 1;
    this.near(b.x, b.y, (j) => {
      const o = beans[j];
      if (o.z !== want || o.state !== 'table') return;
      const dx = b.x - o.x, dy = b.y - o.y;
      const reach = (b.wid + o.wid) * 0.42 + (b.len + o.len) * 0.16;
      if (dx * dx + dy * dy < reach * reach) { n++; sx += dx; sy += dy; }
    });
    if (n === 0) {
      b.z -= 1;
      b.slideX = b.slideY = 0;
      wake(b);
      b.vx *= 0.6; b.vy *= 0.6;
      b.va += (Math.random() - 0.5) * 1.5;
      return;
    }
    const m = Math.sqrt(sx * sx + sy * sy);
    if (m < 0.5) {
      const a = Math.random() * 6.283;
      b.slideX = Math.cos(a) * SLIDE; b.slideY = Math.sin(a) * SLIDE;
    } else {
      b.slideX = (sx / m) * SLIDE; b.slideY = (sy / m) * SLIDE;
    }
  }

  /** Layer a bean would rest on if dropped at (x, y). */
  layerAt(beans, x, y, self) {
    let top = -1;
    const r = self.wid * 0.5;
    this.near(x, y, (j) => {
      const o = beans[j];
      if (o === self || o.state !== 'table') return;
      const dx = x - o.x, dy = y - o.y;
      const reach = r + o.wid * 0.45 + o.len * 0.2;
      if (dx * dx + dy * dy < reach * reach && o.z > top) top = o.z;
    });
    return Math.min(MAX_LAYER, top + 1);
  }

  /**
   * Bean under world point (x, y). A bean directly under the point wins
   * (topmost layer first); otherwise the nearest bean within `slop` units,
   * which makes small beans easy to grab with a finger.
   */
  pick(beans, x, y, slop) {
    let best = null, bestZ = -1, bestI = -1;
    let near = null, nearD = Infinity;
    this.near(x, y, (j) => {
      const b = beans[j];
      if (b.state !== 'table') return;
      const d = capsuleDistance(b, x, y);
      if (d <= 0) {
        if (b.z > bestZ || (b.z === bestZ && j > bestI)) { best = b; bestZ = b.z; bestI = j; }
      } else if (d <= slop && (d < nearD - 0.5 || (Math.abs(d - nearD) <= 0.5 && near && b.z > near.z))) {
        near = b; nearD = d;
      }
    });
    return best || near;
  }

  /** Give every table bean a random shove (the "table shakes" modifier). */
  shake(beans, strength) {
    for (const b of beans) {
      if (b.state !== 'table') continue;
      wake(b);
      const k = strength / Math.sqrt(b.s);
      b.vx += (Math.random() - 0.5) * k;
      b.vy += (Math.random() - 0.5) * k;
      b.va += (Math.random() - 0.5) * 6;
    }
  }
}

/** Signed distance from a point to a bean's capsule outline (≤ 0 inside). */
export function capsuleDistance(b, x, y) {
  const ux = Math.cos(b.a), uy = Math.sin(b.a);
  const h = Math.max(0, (b.len - b.wid) * 0.5);
  const px = x - b.x, py = y - b.y;
  const t = clamp(px * ux + py * uy, -h, h);
  const dx = px - ux * t, dy = py - uy * t;
  return Math.sqrt(dx * dx + dy * dy) - b.wid * 0.5;
}

export function pointInCapsule(b, x, y, slop = 0) {
  return capsuleDistance(b, x, y) <= slop;
}
