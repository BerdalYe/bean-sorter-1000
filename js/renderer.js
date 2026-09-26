// ---------------------------------------------------------------------------
// renderer.js — draws the workstation.
//
// Two stacked canvases:
//   • world  — floor, table, conveyor, fan, beans on the table, lighting.
//   • fx     — (above the DOM container tray) the bean in your hand, beans
//              flying into or out of containers, particles and confetti.
// Beans are stamped from cached sprites (see beans.js); each frame costs two
// drawImage calls per visible bean (shadow + body) with off-screen culling.
// ---------------------------------------------------------------------------

import { MAX_LAYER } from './physics.js';
import { TAU } from './util.js';
import { THEMES, buildTexture } from './themes.js';

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export class Renderer {
  constructor(world, fx, sprites) {
    this.cw = world; this.cf = fx;
    this.ctx = world.getContext('2d', { alpha: false });
    this.fctx = fx.getContext('2d');
    this.sprites = sprites;
    this.dpr = 1; this.w = 1; this.h = 1;
    this.hover = null;
    this.shadows = true;     // setting / adaptive quality on slow devices
    this.symbols = null;     // colour-assist glyphs: { colorKey: canvas }
    this.setTheme('office');
  }

  /** Switch workstation environment (rebuilds the texture and table cache). */
  setTheme(id) {
    if (this.themeId === id) return;
    this.themeId = id;
    this.theme = THEMES[id] || THEMES.office;
    this.tableTex = buildTexture(id);
    this.tablePattern = this.ctx.createPattern(this.tableTex, 'repeat');
    this.layer = null;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    for (const c of [this.cw, this.cf]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    // Patterns are tied to the context; recreate after a resize.
    this.tablePattern = this.ctx.createPattern(this.tableTex, 'repeat');
    this.layer = null;
  }

  // ----------------------------------------------------------------------
  // World canvas
  // ----------------------------------------------------------------------
  drawWorld(world, cam, opts) {
    const ctx = this.ctx, dpr = this.dpr, z = cam.zoom;
    const ox = cam.cx - cam.x * z + cam.sx, oy = cam.cy - cam.y * z + cam.sy;
    const r = world.rect;

    // Floor: flat colour plus tile seams (a full-screen pattern fill is slow
    // on software-rendered canvases, so this is deliberately simple).
    const th = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = th.floor;
    ctx.fillRect(0, 0, this.cw.width, this.cw.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    const vx0 = cam.toWorldX(0), vy0 = cam.toWorldY(0);
    const vx1 = cam.toWorldX(cam.w), vy1 = cam.toWorldY(cam.h);
    const T = 240;
    ctx.strokeStyle = th.floorLine;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = Math.floor(vx0 / T) * T; x <= vx1; x += T) { ctx.moveTo(x, vy0); ctx.lineTo(x, vy1); }
    for (let y = Math.floor(vy0 / T) * T; y <= vy1; y += T) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
    ctx.stroke();

    if (!r) return;

    // Table: drawn from a cached image (see staticLayer) when possible.
    const layer = this.staticLayer(world, z);
    if (layer) {
      const e = layer.ext;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer.canvas, (ox + e.x * z) * dpr, (oy + e.y * z) * dpr, e.w * z * dpr, e.h * z * dpr);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    } else {
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
      this.drawTable(ctx, world, z, dpr * z);
    }

    // Combo hype: the table edge starts to glow on long streaks.
    if (opts.energy > 0.01) {
      const pulse = 0.65 + 0.35 * Math.sin(opts.time * (4 + opts.energy * 6));
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(${th.glow},${(opts.energy * 0.32 * pulse / (i + 1)).toFixed(3)})`;
        ctx.lineWidth = 4 + i * 7;
        roundRect(ctx, r.x - 14 - i * 5, r.y - 14 - i * 5, r.w + 28 + i * 10, r.h + 28 + i * 10, 18 + i * 5);
        ctx.stroke();
      }
    }

    if (world.belt) this.drawBelt(ctx, world);
    if (world.fan) this.drawFan(ctx, world, z, opts.time);

    // Beans, bottom layer first. Per layer: shadows, then bodies.
    const beans = world.beans;
    const pad = 40;
    const minX = cam.toWorldX(-pad), maxX = cam.toWorldX(cam.w + pad);
    const minY = cam.toWorldY(-pad), maxY = cam.toWorldY(cam.h + pad);
    let drawn = 0;
    for (let L = 0; L <= MAX_LAYER; L++) {
      let any = false;
      for (let i = 0; i < beans.length; i++) {
        const b = beans[i];
        if (b.z !== L || (b.state !== 'table' && b.state !== 'belt')) continue;
        if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;
        any = true;
        if (this.shadows) this.drawShadow(ctx, b, ox + b.x * z, oy + b.y * z, z, 1.4 + b.zf * 1.8, 2.2 + b.zf * 2.6, 0.5);
      }
      if (!any) continue;
      for (let i = 0; i < beans.length; i++) {
        const b = beans[i];
        if (b.z !== L || (b.state !== 'table' && b.state !== 'belt')) continue;
        if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;
        const lift = b.zf * 1.3;
        const bx = ox + b.x * z, by = oy + (b.y - lift) * z;
        if (b === this.hover) this.drawHoverRing(ctx, b, bx, by, z);
        this.drawBean(ctx, b, bx, by, z * (1 + b.zf * 0.025));
        if (this.symbols && b.wid * z > 9) this.drawGlyph(ctx, b, bx, by, z);
        drawn++;
      }
    }
    this.lastDrawn = drawn;

    // Rare beans twinkle now and then so sharp-eyed players can spot them.
    const sp = world.specials;
    if (sp && sp.length) {
      for (const b of sp) {
        if ((b.state !== 'table' && b.state !== 'belt') || b.rarity === 'uncommon') continue;
        const period = b.rarity === 'legendary' ? 1.6 : 3.2;
        const ph = (opts.time + b.id * 0.37) % period;
        if (ph > 0.6) continue;
        const a = Math.sin((ph / 0.6) * Math.PI);
        const size = (b.rarity === 'legendary' ? 20 : 14) * z * a;
        if (size < 2) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = a;
        const x = ox + (b.x + b.len * 0.22) * z, y = oy + (b.y - b.zf * 1.3 - b.wid * 0.2) * z;
        ctx.drawImage(this.sprites.sparkle, x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    // Lighting (Night Shift): darkness with a pool of light where you work.
    if (world.darkness > 0) {
      const d = Math.min(0.92, world.darkness + world.flicker * 0.25);
      const lx = opts.light ? opts.light.x : cam.w / 2, ly = opts.light ? opts.light.y : cam.h / 2;
      const rad = Math.max(160, Math.min(cam.w, cam.h) * 0.34);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grd = ctx.createRadialGradient(lx, ly, rad * 0.15, lx, ly, rad);
      grd.addColorStop(0, `rgba(10,14,26,${d * 0.08})`);
      grd.addColorStop(0.6, `rgba(10,14,26,${d * 0.55})`);
      grd.addColorStop(1, `rgba(8,10,22,${d})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, cam.w, cam.h);
    }
  }

  /** Static parts of the workstation: table shadow, rim, laminate, markings, belt frame. */
  drawTable(ctx, world, z, pxPerUnit) {
    const r = world.rect;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 40 * pxPerUnit;
    ctx.shadowOffsetY = 16 * pxPerUnit;
    ctx.fillStyle = '#8f9893';
    roundRect(ctx, r.x - 12, r.y - 12, r.w + 24, r.h + 24, 16);
    ctx.fill();
    ctx.restore();
    const th = this.theme;
    const band = ctx.createLinearGradient(0, r.y - 12, 0, r.y + r.h + 12);
    band.addColorStop(0, th.rim[0]); band.addColorStop(0.5, th.rim[1]); band.addColorStop(1, th.rim[2]);
    ctx.fillStyle = band;
    roundRect(ctx, r.x - 12, r.y - 12, r.w + 24, r.h + 24, 16);
    ctx.fill();
    if (th.rimExtra) th.rimExtra(ctx, r);
    ctx.fillStyle = th.lip;
    roundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 7);
    ctx.fill();
    ctx.fillStyle = this.tablePattern;
    roundRect(ctx, r.x, r.y, r.w, r.h, 5);
    ctx.fill();
    if (th.extra) th.extra(ctx, r);
    this.drawMarkings(ctx, r, z);
    if (world.belt) this.drawBeltFrame(ctx, world, z);
  }

  /**
   * Cache the static workstation into an offscreen canvas at the current
   * zoom (quantised to ~26% steps). While the zoom is changing we keep
   * stretching the old image and only re-render once it settles, so pinch
   * zooming never stalls. Returns null when the image would be too large
   * (very high zoom), in which case the table is drawn directly.
   */
  staticLayer(world, z) {
    const r = world.rect;
    const top = world.belt ? 100 : 60;
    const ext = { x: r.x - 70, y: r.y - top, w: r.w + 140, h: r.h + top + 110 };
    const want = z * this.dpr;
    const q = Math.pow(2, Math.round(Math.log2(want) * 4) / 4);
    if (ext.w * q > 4096 || ext.h * q > 4096) return null;
    const key = `${q}|${world.setupId}|${this.dpr}|${this.themeId}`;
    const now = performance.now();
    if (this.layerZoom !== z) { this.layerZoom = z; this.layerChanged = now; }
    const cached = this.layer;
    const sameWorld = cached && cached.world === world.setupId && cached.theme === this.themeId;
    if (cached && cached.key === key) return cached;
    if (sameWorld && now - this.layerChanged < 160) return cached;

    const c = this.layerCanvas || (this.layerCanvas = document.createElement('canvas'));
    c.width = Math.ceil(ext.w * q); c.height = Math.ceil(ext.h * q);
    const g = c.getContext('2d');
    g.setTransform(q, 0, 0, q, -ext.x * q, -ext.y * q);
    g.clearRect(ext.x, ext.y, ext.w, ext.h);
    // Patterns belong to a context: make one for the cache context.
    const keep = this.tablePattern;
    this.tablePattern = g.createPattern(this.tableTex, 'repeat');
    this.drawTable(g, world, q / this.dpr, q);
    this.tablePattern = keep;
    this.layer = { canvas: c, ext, key, world: world.setupId, theme: this.themeId };
    return this.layer;
  }

  /** Ruler ticks and station stencils printed on the laminate. */
  drawMarkings(ctx, r, z) {
    ctx.save();
    const ink = this.theme.ink;
    ctx.strokeStyle = `rgba(${ink},0.32)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= r.w; x += 10) {
      const len = x % 100 === 0 ? 10 : x % 50 === 0 ? 7 : 4;
      ctx.moveTo(r.x + x, r.y); ctx.lineTo(r.x + x, r.y + len);
    }
    for (let y = 0; y <= r.h; y += 10) {
      const len = y % 100 === 0 ? 10 : y % 50 === 0 ? 7 : 4;
      ctx.moveTo(r.x, r.y + y); ctx.lineTo(r.x + len, r.y + y);
    }
    ctx.stroke();
    if (z > 0.35) {
      ctx.fillStyle = `rgba(${ink},0.38)`;
      ctx.font = '600 7px "Martian Mono", ui-monospace, monospace';
      ctx.textBaseline = 'top';
      for (let x = 100; x < r.w; x += 100) ctx.fillText(String(x / 10), r.x + x + 2, r.y + 11);
      ctx.font = '800 11px "Archivo", Arial, sans-serif';
      ctx.fillStyle = `rgba(${ink},0.22)`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.theme.station, r.x + r.w - 14, r.y + r.h - 10);
    }
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = `rgba(${ink},0.14)`;
    ctx.strokeRect(r.x + 24, r.y + 24, r.w - 48, r.h - 48);
    ctx.restore();
  }

  drawBeltFrame(ctx, world, z) {
    const b = world.belt, r = world.rect;
    const x0 = b.x0 - 26, x1 = b.x1 + 34, y = b.y - 20, h = 40;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(ctx, x0 - 4, y - 2, x1 - x0 + 12, h + 14, 8); ctx.fill();
    ctx.fillStyle = '#6d7571';
    roundRect(ctx, x0 - 6, y - 7, x1 - x0 + 12, h + 14, 8); ctx.fill();
    // Chute onto the table
    ctx.fillStyle = 'rgba(160,170,165,0.95)';
    ctx.beginPath();
    ctx.moveTo(b.x1 - 30, y + h); ctx.lineTo(b.x1 + 10, y + h); ctx.lineTo(b.x1 + 4, r.y + 6); ctx.lineTo(b.x1 - 24, r.y + 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f0c419';
    ctx.fillRect(x0 + 16, y - 7, 64, 7);
    ctx.fillStyle = '#1b1f1d';
    ctx.font = '800 6px "Archivo", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('INTAKE  \u2192', x0 + 22, y - 3.3);
    ctx.restore();
  }

  /** Moving belt surface (drawn every frame on top of the cached frame). */
  drawBelt(ctx, world) {
    const b = world.belt;
    const x0 = b.x0 - 26, x1 = b.x1 + 34, y = b.y - 20, h = 40;
    ctx.fillStyle = '#262b29';
    ctx.fillRect(x0, y, x1 - x0, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = x0 + b.offset; x < x1 - 10; x += 40) {
      ctx.moveTo(x, y + 4); ctx.lineTo(x + 10, y + h / 2); ctx.lineTo(x, y + h - 4);
    }
    ctx.stroke();
    ctx.fillStyle = '#a9b1ad';
    for (const x of [x0 + 2, x1 - 2]) { ctx.beginPath(); ctx.ellipse(x, y + h / 2, 5, h / 2, 0, 0, TAU); ctx.fill(); }
  }

  drawFan(ctx, world, z, t) {
    const f = world.fan;
    if (f.spin < 0.02 && !f.on) return;
    ctx.save();
    // Airflow streaks inside the cone
    if (f.spin > 0.1) {
      const range = world.rect.w * 0.55;
      ctx.strokeStyle = `rgba(235,245,255,${0.22 * f.spin})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        const ph = (t * 0.9 + i * 0.137) % 1;
        const a = f.angle + Math.sin(i * 12.9898) * 0.36;
        const d0 = 40 + ph * range, d1 = d0 + 30 + 20 * f.spin;
        ctx.globalAlpha = (1 - ph) * f.spin;
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * d0, f.y + Math.sin(a) * d0);
        ctx.lineTo(f.x + Math.cos(a) * d1, f.y + Math.sin(a) * d1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Fan body (seen from above)
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(6, 8, 30, 40, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8ddd6';
    roundRect(ctx, -40, -16, 26, 32, 6); ctx.fill();
    ctx.fillStyle = '#b9c0ba';
    ctx.fillRect(-18, -5, 14, 10);
    ctx.fillStyle = '#e8ebe5';
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 36, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8b938e'; ctx.lineWidth = 1.5; ctx.stroke();
    // Blades (foreshortened: we see them edge-on-ish from above)
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 34, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = 'rgba(90,110,120,0.55)';
    for (let i = 0; i < 3; i++) {
      const a = f.blade + (i * TAU) / 3;
      ctx.beginPath(); ctx.ellipse(0, Math.sin(a) * 18, 9, 10 * Math.abs(Math.cos(a)) + 2, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(60,70,66,0.5)'; ctx.lineWidth = 0.8;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(-10, i * 10); ctx.lineTo(10, i * 10); ctx.stroke(); }
    ctx.restore();
  }

  drawShadow(ctx, b, sx, sy, z, offX, offY, alpha) {
    const dpr = this.dpr, S = z * dpr;
    const c = Math.cos(b.a) * S, s = Math.sin(b.a) * S;
    ctx.setTransform(c, s, -s, c, (sx + offX * z) * dpr, (sy + offY * z) * dpr);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.sprites.shadow, -b.len * 0.6, -b.wid * 0.74, b.len * 1.2, b.wid * 1.48);
    ctx.globalAlpha = 1;
  }

  /** Stamp one bean. (sx, sy) are CSS px; z is CSS px per world unit. */
  drawBean(ctx, b, sx, sy, z) {
    const dpr = this.dpr, S = z * dpr;
    const spr = this.sprites.sprite(b.key, b.variant, S * b.s, b.look);
    // Drop bounce: a quick damped squash right after the bean lands.
    let bx = b.sx || 1, by = b.sy || 1;
    const t = b.land;
    if (t !== undefined && t < 0.45) {
      const k = Math.exp(-t * 9) * Math.sin(t * 36) * 0.11;
      bx *= 1 + k; by *= 1 - k;
    }
    const w = (spr.canvas.width / spr.res) * b.s * bx, h = (spr.canvas.height / spr.res) * b.s * by;
    const c = Math.cos(b.a) * S, s = Math.sin(b.a) * S;
    ctx.setTransform(c, s, -s * b.flip, c * b.flip, sx * dpr, sy * dpr);
    ctx.drawImage(spr.canvas, -w / 2, -h / 2, w, h);
  }

  /** Colour-assist symbol stamped on the bean (upright, so it stays readable). */
  drawGlyph(ctx, b, sx, sy, z) {
    const g = this.symbols[b.key];
    if (!g) return;
    const size = Math.min(b.wid * 0.8, 16) * z;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(g, sx - size / 2, sy - size / 2, size, size);
  }

  drawHoverRing(ctx, b, sx, sy, z) {
    const dpr = this.dpr, S = z * dpr;
    const c = Math.cos(b.a) * S, s = Math.sin(b.a) * S;
    ctx.setTransform(c, s, -s, c, sx * dpr, sy * dpr);
    ctx.fillStyle = 'rgba(255,255,240,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 0, b.len * 0.66, b.wid * 0.74, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.4 / z;
    ctx.stroke();
  }

  // ----------------------------------------------------------------------
  // FX canvas (screen space)
  // ----------------------------------------------------------------------
  beginFx() {
    const g = this.fctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cf.width, this.cf.height);
  }

  /** Bean held in the hand or flying: bigger, with a far-away shadow. */
  drawLifted(b, sx, sy, z, lift, alpha = 1) {
    const g = this.fctx;
    this.drawShadow(g, b, sx, sy, z, 3 + lift * 5, 5 + lift * 8, 0.35 / (1 + lift * 0.4));
    g.globalAlpha = alpha;
    this.drawBean(g, b, sx, sy, z * (1 + lift * 0.1));
    g.globalAlpha = 1;
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
