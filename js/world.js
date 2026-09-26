// ---------------------------------------------------------------------------
// world.js — the physical workstation: table, beans, conveyor, fan, tilt,
// shaking. It owns the simulation and the chaos-modifier schedule, and
// reports anything noteworthy through `this.events` (drained by game.js).
// ---------------------------------------------------------------------------

import { createBean, SpriteBank } from './beans.js';
import { Physics, MAX_LAYER, wake } from './physics.js';
import { makeRng, shuffle, clamp, TAU } from './util.js';

const STEP = 1 / 120;          // fixed physics step
const MAX_STEPS = 4;

export class World {
  constructor(sprites) {
    this.sprites = sprites || new SpriteBank();
    this.physics = new Physics();
    this.beans = [];
    this.events = [];
    this.time = 0;
    this.acc = 0;
    this.rng = makeRng(1);
    this.mods = {};
    this.belt = null;
    this.fan = null;
    this.tilt = { x: 0, y: 0, tx: 0, ty: 0, t: 0, phase: 'idle', timer: 30 };
    this.darkness = 0;
    this.flicker = 0;
    this.shakeTimer = 0;
    this.shuffleTimer = 0;
    this.nextId = 1;
  }

  /**
   * Build a fresh table.
   * opts: { seed, count, colors, table:[w,h], mods, conveyorInitial, sizes }
   */
  setup(opts) {
    this.rng = makeRng(opts.seed);
    this.mods = opts.mods || {};
    this.setupId = (this.setupId || 0) + 1;   // invalidates the renderer's table cache
    const [w, h] = opts.table;
    this.rect = { x: -w / 2, y: -h / 2, w, h };
    this.physics.setBounds(this.rect);
    this.beans = [];
    this.events = [];
    this.time = 0;
    this.acc = 0;
    this.nextId = 1;

    // Pre-warm sprites so the first frame doesn't hitch.
    for (const k of opts.colors) this.sprites.ensure(k);

    // Colour assignment: as even as possible, then shuffled.
    const keys = [];
    for (let i = 0; i < opts.count; i++) keys.push(opts.colors[i % opts.colors.length]);
    shuffle(keys, this.rng);
    for (const k of keys) this.beans.push(createBean(this.nextId++, k, this.rng, this.mods.sizes));

    const onTable = this.mods.conveyor ? Math.min(opts.count, this.mods.conveyor.initial) : opts.count;
    this.scatter(this.beans.slice(0, onTable));
    for (let i = onTable; i < this.beans.length; i++) this.beans[i].state = 'queued';

    this.setupModifiers(opts.endless);
  }

  setupModifiers(endless) {
    const m = this.mods;
    const r = this.rect;
    const needBelt = !!m.conveyor || endless;
    this.belt = needBelt ? {
      y: r.y - 42, x0: r.x + 10, x1: r.x + r.w - 44,
      speed: 90, interval: m.conveyor ? m.conveyor.interval : 1.2, timer: 0.5, offset: 0,
      paused: false,
    } : null;
    this.fan = m.fan ? {
      x: r.x - 70, y: r.y + r.h * 0.5, angle: 0, base: 0, on: false,
      timer: this.rng.range(...m.fan.interval) * 0.6, blade: 0, spin: 0, cfg: m.fan,
    } : null;
    this.tilt = { x: 0, y: 0, tx: 0, ty: 0, phase: 'idle', t: 0, timer: m.tilt ? this.rng.range(14, 22) : Infinity };
    this.darkness = m.lighting ? m.lighting.darkness : 0;
    this.shakeTimer = m.shake ? this.rng.range(...m.shake.interval) : Infinity;
    this.shuffleTimer = m.shuffle ? this.rng.range(...m.shuffle.interval) : Infinity;
  }

  /**
   * Initial "big pile" layout: most beans heaped around a couple of centres,
   * the rest strewn about. Layers are assigned greedily so overlapping beans
   * stack instead of exploding apart on the first physics step.
   */
  scatter(list) {
    const r = this.rect, rng = this.rng;
    const heaps = [];
    const nHeaps = list.length > 300 ? 3 : list.length > 80 ? 2 : 1;
    for (let i = 0; i < nHeaps; i++) {
      heaps.push({ x: r.x + r.w * rng.range(0.3, 0.7), y: r.y + r.h * rng.range(0.35, 0.65) });
    }
    const cell = 30;
    const grid = new Map();
    const keyOf = (x, y) => ((x / cell) | 0) * 100003 + ((y / cell) | 0);
    for (const b of list) {
      let x, y;
      if (rng.chance(0.62)) {
        const hp = rng.pick(heaps);
        x = hp.x + rng.gauss() * r.w * 0.13;
        y = hp.y + rng.gauss() * r.h * 0.14;
      } else {
        x = r.x + rng.range(0.06, 0.94) * r.w;
        y = r.y + rng.range(0.08, 0.92) * r.h;
      }
      x = clamp(x, r.x + 20, r.x + r.w - 20);
      y = clamp(y, r.y + 20, r.y + r.h - 20);
      // Highest layer among beans overlapping this spot.
      let top = -1;
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const arr = grid.get(gx * 100003 + gy);
          if (!arr) continue;
          for (const o of arr) {
            const dx = o.x - x, dy = o.y - y;
            const reach = (o.wid + b.wid) * 0.5;
            if (dx * dx + dy * dy < reach * reach && o.z > top) top = o.z;
          }
        }
      }
      b.x = x; b.y = y;
      b.z = b.zf = Math.min(MAX_LAYER, top + 1);
      b.state = 'table';
      b.awake = true;
      const k = keyOf(x, y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
    }
  }

  /** Add a bean to the belt queue (endless mode). */
  enqueue(key) {
    const b = createBean(this.nextId++, key, this.rng, this.mods.sizes);
    b.state = 'queued';
    this.beans.push(b);
    return b;
  }

  /** Remove sorted beans from the array (endless mode keeps it bounded). */
  compact() {
    this.beans = this.beans.filter((b) => b.state !== 'sorted');
  }

  counts() {
    let table = 0, belt = 0, queued = 0, sorted = 0, other = 0;
    for (const b of this.beans) {
      if (b.state === 'table') table++;
      else if (b.state === 'belt') belt++;
      else if (b.state === 'queued') queued++;
      else if (b.state === 'sorted') sorted++;
      else other++;
    }
    return { table, belt, queued, sorted, other };
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  // ----------------------------------------------------------------------
  update(dt, ctx) {
    this.time += dt;
    this.updateModifiers(dt, ctx);
    this.updateBelt(dt, ctx);

    // Fixed-step physics with an accumulator (stable regardless of fps).
    this.acc += dt;
    let steps = 0;
    const env = this.env();
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.physics.step(this.beans, STEP, env);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    if (this.physics.impacts > 0) this.emit('impacts', { n: this.physics.impacts });
  }

  env() {
    let fan = null;
    if (this.fan && this.fan.on && this.fan.spin > 0.3) {
      const a = this.fan.angle;
      fan = {
        x: this.fan.x, y: this.fan.y, dx: Math.cos(a), dy: Math.sin(a),
        range: this.rect.w * 0.6, cos: Math.cos(0.42), strength: this.fan.cfg.strength * this.fan.spin,
      };
    }
    return { tiltX: this.tilt.x, tiltY: this.tilt.y, fan };
  }

  updateModifiers(dt, ctx) {
    const rng = this.rng, m = this.mods;
    const holding = ctx && ctx.holding;

    // Fan: turns on for a few seconds, sweeping back and forth.
    const f = this.fan;
    if (f) {
      f.timer -= dt;
      if (f.timer <= 0) {
        f.on = !f.on;
        f.timer = f.on ? rng.range(...f.cfg.duration) : rng.range(...f.cfg.interval);
        if (f.on) {
          // Pick a side each time so the fan pushes beans around differently.
          const r = this.rect;
          const side = rng.int(0, 1);
          f.x = side === 0 ? r.x - 70 : r.x + r.w + 70;
          f.y = r.y + r.h * rng.range(0.3, 0.7);
          f.base = side === 0 ? 0 : Math.PI;
          this.emit('fan', { on: true });
        } else this.emit('fan', { on: false });
      }
      f.spin += ((f.on ? 1 : 0) - f.spin) * Math.min(1, dt * (f.on ? 1.6 : 0.8));
      f.blade += f.spin * dt * 38;
      f.angle = f.base + Math.sin(this.time * 0.9) * 0.32;
    }

    // Shake: a short jolt to every bean on the table.
    this.shakeTimer -= dt;
    if (this.shakeTimer <= 0 && m.shake) {
      this.shakeTimer = rng.range(...m.shake.interval);
      this.physics.shake(this.beans, m.shake.strength);
      this.emit('shake', { strength: m.shake.strength });
    }

    // Tilt: eases into a random direction, holds, then levels out.
    const t = this.tilt;
    if (m.tilt) {
      t.timer -= dt;
      if (t.phase === 'idle' && t.timer <= 0) {
        const a = rng.range(0, TAU);
        const s = m.tilt.strength * rng.range(1.1, 1.6);
        t.tx = Math.cos(a) * s; t.ty = Math.sin(a) * s;
        t.phase = 'tilted'; t.timer = rng.range(7, 10);
        this.emit('tilt', { on: true });
      } else if (t.phase === 'tilted' && t.timer <= 0) {
        t.tx = t.ty = 0; t.phase = 'idle'; t.timer = rng.range(20, 32);
        this.emit('tilt', { on: false });
      }
      t.x += (t.tx - t.x) * Math.min(1, dt * 0.9);
      t.y += (t.ty - t.y) * Math.min(1, dt * 0.9);
    }

    // Moving containers: request a swap, but never mid-drag (that'd be unfair).
    if (m.shuffle) {
      this.shuffleTimer -= dt;
      if (this.shuffleTimer <= 0 && !holding) {
        this.shuffleTimer = rng.range(...m.shuffle.interval);
        this.emit('shuffle', {});
      }
    }

    // Bad lighting flickers now and then.
    if (this.darkness > 0) {
      const flick = Math.random() < dt * 0.25 ? 1 : 0;
      this.flicker = Math.max(0, this.flicker - dt * 3) + flick * 0.8;
    }
  }

  updateBelt(dt, ctx) {
    const belt = this.belt;
    if (!belt || !(ctx && ctx.feed)) return;
    belt.offset = (belt.offset + belt.speed * dt) % 40;

    // Feed the belt: faster when the table is nearly empty so nobody waits.
    let onTable = 0;
    for (const b of this.beans) if (b.state === 'table') onTable++;
    const boost = onTable < 12 ? 4 : onTable < 30 ? 2 : 1;
    belt.timer -= dt * boost;
    if (belt.timer <= 0) {
      const next = this.beans.find((b) => b.state === 'queued');
      if (next) {
        // Leave a gap between beans on the belt.
        let clear = true;
        for (const b of this.beans) if (b.state === 'belt' && b.x < belt.x0 + 30) { clear = false; break; }
        if (clear) {
          next.state = 'belt';
          next.x = belt.x0; next.y = belt.y + this.rng.range(-5, 5);
          next.a = this.rng.range(-0.4, 0.4); next.z = next.zf = 0;
          belt.timer = ctx && ctx.beltInterval ? ctx.beltInterval : belt.interval;
        }
      } else belt.timer = 0.3;
    }

    for (const b of this.beans) {
      if (b.state !== 'belt') continue;
      b.x += belt.speed * dt * boost;
      if (b.x >= belt.x1) {
        // Tumble off the end of the belt onto the table.
        b.state = 'table';
        b.x = belt.x1 - 10;
        b.y = this.rect.y + 12;
        b.vx = -this.rng.range(20, 140);
        b.vy = this.rng.range(90, 200);
        b.va = this.rng.range(-5, 5);
        b.z = b.zf = 0;
        b.z = this.physics.layerAt(this.beans, b.x, b.y, b);
        b.zf = b.z + 1.5;
        wake(b);
        this.emit('beltDrop', {});
      }
    }
  }

  /** Topmost bean (table or belt) at a world point. */
  pick(wx, wy, slop) {
    const hit = this.physics.pick(this.beans, wx, wy, slop);
    if (hit) return hit;
    if (this.belt) {
      for (const b of this.beans) {
        if (b.state !== 'belt') continue;
        const dx = b.x - wx, dy = b.y - wy;
        const r = b.len * 0.5 + slop;
        if (dx * dx + dy * dy < r * r) return b;
      }
    }
    return null;
  }

  /** Put a held bean back down on the table at its current position. */
  place(b, vx, vy) {
    const r = this.rect;
    b.state = 'table';
    b.x = clamp(b.x, r.x + b.wid * 0.5, r.x + r.w - b.wid * 0.5);
    b.y = clamp(b.y, r.y + b.wid * 0.5, r.y + r.h - b.wid * 0.5);
    b.vx = vx; b.vy = vy;
    b.z = this.physics.layerAt(this.beans, b.x, b.y, b);
    b.zf = b.z + 1;
    wake(b);
    // Nudge neighbours awake so they react to the new arrival.
    this.physics.near(b.x, b.y, (j) => {
      const o = this.beans[j];
      if (o.state === 'table' && Math.abs(o.x - b.x) < 40 && Math.abs(o.y - b.y) < 40) wake(o);
    });
  }

  /** Serialisable snapshot of bean positions (for resuming a level). */
  snapshot() {
    const codes = { table: 0, belt: 1, queued: 2, sorted: 3, held: 0, flying: 0 };
    // A bean flying into the correct container already counts as sorted.
    const code = (b) => (b.state === 'flying' && b.flyOk ? 3 : codes[b.state] ?? 0);
    return this.beans.map((b) => [code(b), Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.a * 100) / 100, b.z]);
  }

  restore(snap) {
    const states = ['table', 'belt', 'queued', 'sorted'];
    snap.forEach((s, i) => {
      const b = this.beans[i];
      if (!b) return;
      b.state = states[s[0]] || 'table';
      b.x = s[1]; b.y = s[2]; b.a = s[3]; b.z = b.zf = s[4] || 0;
      b.vx = b.vy = b.va = 0;
      b.awake = true;
    });
  }
}
