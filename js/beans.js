// ---------------------------------------------------------------------------
// beans.js — bean data objects and the sprite bank that draws them.
//
// Performance note: drawing 1,000 gradient-filled paths every frame would be
// slow, so each bean *look* is rendered once to an offscreen canvas and then
// stamped with drawImage. Every colour gets VARIANTS unique shapes (kidney
// dent, asymmetry, wobble, hilum, specks, a little RGB jitter), each at three
// resolutions ("mips") so zoomed-out beans stay crisp and zoomed-in beans
// stay sharp. Mirroring doubles the visible variety for free.
// ---------------------------------------------------------------------------

import { BEAN, COLORS, SIZE_CLASSES, BEAN_NOTES, SPECIAL_NOTES } from './config.js';
import { TAU, makeRng, hashString, shade, rgbCss, clamp } from './util.js';
import { rollVariety, VARIETY } from './beandex.js';

export const VARIANTS = 12;
const SPECIAL_VARIANTS = 4;         // rarer looks need fewer shapes
const MIP_RES = [1.5, 3, 6];          // sprite pixels per world unit
const PAD_W = 1.18, PAD_H = 1.42;     // sprite box relative to bean size

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Trace a kidney-bean outline centred on the origin, long axis along x. */
function beanPath(ctx, L, W, p) {
  const N = 48;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * TAU;
    const cx = Math.cos(t), sy = Math.sin(t);
    let x = cx * L * 0.5;
    let y = sy * W * 0.5;
    y *= 1 + p.asym * cx;                                   // one end fatter
    if (sy < 0) y += p.dent * W * Math.exp(-((x / (L * 0.3)) ** 2)) * -sy; // kidney dent
    const wob = 1 + p.wa * Math.sin(3 * t + p.p1) + p.wb * Math.sin(5 * t + p.p2);
    x *= wob; y *= wob;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Render one bean variant at `res` pixels per unit, with an optional rarity look. */
function renderVariant(rgb, p, res, look = 'plain') {
  const L = BEAN.len * p.ls, W = BEAN.wid * p.ws;
  const cw = BEAN.len * PAD_W * res, ch = BEAN.wid * PAD_H * res;
  const c = makeCanvas(cw, ch);
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.scale(res, res);

  const lum = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;

  // Body: offset radial gradient gives a rounded, tactile look.
  beanPath(g, L, W, p);
  const body = g.createRadialGradient(-L * 0.12, W * 0.02, W * 0.1, 0, 0, L * 0.62);
  body.addColorStop(0, rgbCss(shade(rgb, 0.16)));
  body.addColorStop(0.5, rgbCss(rgb));
  body.addColorStop(1, rgbCss(shade(rgb, -0.5)));
  g.fillStyle = body;
  g.fill();

  g.save();
  beanPath(g, L, W, p);
  g.clip();

  // Soft ridge highlight along the convex back.
  const hx = -L * 0.06, hy = W * 0.14;
  const hl = g.createRadialGradient(hx, hy, 0, hx, hy, L * 0.34);
  hl.addColorStop(0, `rgba(255,255,255,${0.3 + (1 - lum) * 0.12})`);
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.save();
  g.translate(hx, hy); g.scale(1, 0.45); g.translate(-hx, -hy);
  g.fillRect(-L, -W, L * 2, W * 2);
  g.restore();

  // Sharp specular glint.
  g.fillStyle = `rgba(255,255,255,${0.45 + (1 - lum) * 0.2})`;
  g.beginPath();
  g.ellipse(-L * 0.16, W * 0.06, L * 0.1 * p.gloss, W * 0.05 * p.gloss, -0.15, 0, TAU);
  g.fill();

  // Imperfections: a few darker specks and maybe a wrinkle.
  const r = makeRng(p.seed);
  const specks = r.int(0, 3);
  for (let i = 0; i < specks; i++) {
    g.fillStyle = rgbCss(shade(rgb, -0.4), 0.35);
    g.beginPath();
    g.arc(r.range(-L * 0.35, L * 0.35), r.range(-W * 0.15, W * 0.3), r.range(0.3, 0.8), 0, TAU);
    g.fill();
  }
  if (p.wrinkle) {
    g.strokeStyle = rgbCss(shade(rgb, -0.45), 0.35);
    g.lineWidth = 0.45;
    g.beginPath();
    const wx = r.range(-L * 0.25, L * 0.2);
    g.arc(wx, W * 0.9, W * 0.8, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.25);
    g.stroke();
  }
  if (look !== 'plain') drawLook(g, look, rgb, L, W, r);
  g.restore();

  // Hilum: the pale "eye" in the concave side of a real bean.
  const hyPos = -W * 0.5 + p.dent * W + W * 0.1;
  g.fillStyle = rgbCss(shade(rgb, lum > 0.75 ? -0.25 : 0.55), 0.85);
  g.beginPath();
  g.ellipse(L * 0.02, hyPos, L * 0.11, W * 0.065, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgbCss(shade(rgb, -0.55), 0.55);
  g.lineWidth = 0.35;
  g.beginPath();
  g.moveTo(-L * 0.06, hyPos); g.lineTo(L * 0.1, hyPos);
  g.stroke();

  // Rim.
  beanPath(g, L, W, p);
  g.strokeStyle = rgbCss(shade(rgb, -0.62), 0.45);
  g.lineWidth = 0.55;
  g.stroke();
  if (look === 'goldrim' || look === 'golden') {
    beanPath(g, L, W, p);
    g.strokeStyle = '#e2b640'; g.lineWidth = 1.1; g.stroke();
    g.strokeStyle = 'rgba(255,244,196,0.8)'; g.lineWidth = 0.35; g.stroke();
  } else if (look === 'cosmic') {
    beanPath(g, L, W, p);
    g.strokeStyle = 'rgba(190,150,255,0.9)'; g.lineWidth = 0.8; g.stroke();
  }

  return { canvas: c, res };
}

/** Rarity treatments, drawn inside the bean's clip. Colour stays readable. */
function drawLook(g, look, rgb, L, W, r) {
  if (look === 'speckled') {
    for (let i = 0; i < 26; i++) {
      g.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.35)' : rgbCss(shade(rgb, -0.55), 0.5);
      g.beginPath(); g.arc(r.range(-L / 2, L / 2), r.range(-W / 2, W / 2), r.range(0.35, 0.9), 0, TAU); g.fill();
    }
  } else if (look === 'pinstripe') {
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 0.35;
    for (let y = -W / 2; y < W / 2; y += W / 7) { g.beginPath(); g.moveTo(-L / 2, y); g.lineTo(L / 2, y + W * 0.05); g.stroke(); }
  } else if (look === 'glossy') {
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath(); g.ellipse(-L * 0.08, W * 0.02, L * 0.3, W * 0.12, -0.1, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.ellipse(L * 0.2, W * 0.12, L * 0.05, W * 0.04, 0.2, 0, TAU); g.fill();
  } else if (look === 'swirl') {
    g.strokeStyle = 'rgba(30,0,45,0.42)'; g.lineWidth = 0.8;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let t = 0; t < 12; t += 0.2) {
        const rr = t * 0.9, a = t + k * 2.1;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.6;
        if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (look === 'perfect') {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    star(g, -L * 0.18, W * 0.06, 2.2);
  } else if (look === 'goldrim') {
    g.fillStyle = 'rgba(255,236,160,0.95)';
    star(g, L * 0.24, -W * 0.08, 1.8);
  } else if (look === 'golden') {
    const gr = g.createLinearGradient(-L / 2, -W / 2, L / 2, W / 2);
    gr.addColorStop(0, 'rgba(255,226,120,0.45)'); gr.addColorStop(0.45, 'rgba(255,200,60,0.12)');
    gr.addColorStop(0.55, 'rgba(255,250,210,0.55)'); gr.addColorStop(1, 'rgba(200,140,20,0.35)');
    g.fillStyle = gr; g.fillRect(-L, -W, L * 2, W * 2);
    g.fillStyle = '#fffbe6';
    star(g, -L * 0.2, W * 0.05, 2.4); star(g, L * 0.22, -W * 0.12, 1.4);
  } else if (look === 'cosmic') {
    g.fillStyle = 'rgba(18,8,40,0.45)'; g.fillRect(-L, -W, L * 2, W * 2);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(255,255,255,${r.range(0.4, 1).toFixed(2)})`;
      g.fillRect(r.range(-L / 2, L / 2), r.range(-W / 2, W / 2), r.range(0.25, 0.6), r.range(0.25, 0.6));
    }
    g.fillStyle = 'rgba(200,170,255,0.9)'; star(g, 0, 0, 1.8);
  }
}

function star(g, x, y, s) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, rr = i % 2 === 0 ? s : s * 0.28;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

function downscale(src, res) {
  const k = res / src.res;
  const c = makeCanvas(src.canvas.width * k, src.canvas.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src.canvas, 0, 0, c.width, c.height);
  return { canvas: c, res };
}

/** Lazily builds and caches sprites per colour. */
export class SpriteBank {
  constructor() {
    this.sets = new Map();
    this.shadow = this.makeShadow();
  }

  makeShadow() {
    const c = makeCanvas(96, 64);
    const g = c.getContext('2d');
    g.translate(48, 32);
    g.scale(1, 0.62);
    const grd = g.createRadialGradient(0, 0, 4, 0, 0, 44);
    grd.addColorStop(0, 'rgba(18,24,20,0.55)');
    grd.addColorStop(0.55, 'rgba(18,24,20,0.28)');
    grd.addColorStop(1, 'rgba(18,24,20,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.fill();
    return c;
  }

  /** Variant list for a colour (and rarity look): [{ rgb, mips:[{canvas,res}] }]. */
  ensure(key, look = 'plain') {
    const id = look === 'plain' ? key : `${key}|${look}`;
    let set = this.sets.get(id);
    if (set) return set;
    set = [];
    const base = COLORS[key].rgb;
    const n = look === 'plain' ? VARIANTS : SPECIAL_VARIANTS;
    for (let v = 0; v < n; v++) {
      const r = makeRng(hashString(key) * 31 + v * 977);
      // A few points of per-variant colour jitter (shown in the inspector).
      const rgb = base.map((c) => clamp(Math.round(c + r.range(-4, 4)), 0, 255));
      const p = {
        seed: hashString(key) + v * 7919,
        dent: r.range(0.1, 0.2), asym: r.range(-0.09, 0.09),
        wa: r.range(0, 0.025), wb: r.range(0, 0.018),
        p1: r.range(0, TAU), p2: r.range(0, TAU),
        ls: r.range(0.95, 1.05), ws: r.range(0.93, 1.07),
        gloss: r.range(0.75, 1.25), wrinkle: r.chance(0.35),
      };
      if (look === 'perfect') Object.assign(p, { dent: 0.15, asym: 0, wa: 0, wb: 0, ls: 1, ws: 1, wrinkle: false, seed: 1 });
      const top = renderVariant(rgb, p, MIP_RES[2], look);
      const mid = downscale(top, MIP_RES[1]);
      const low = downscale(mid, MIP_RES[0]);
      set.push({ rgb, mips: [low, mid, top] });
    }
    this.sets.set(id, set);
    return set;
  }

  /** Best sprite for a bean drawn at `pxPerUnit` screen pixels per unit. */
  sprite(key, variant, pxPerUnit, look = 'plain') {
    const set = this.ensure(key, look);
    const mips = set[variant % set.length].mips;
    for (let i = 0; i < mips.length; i++) if (mips[i].res >= pxPerUnit) return mips[i];
    return mips[mips.length - 1];
  }

  rgbOf(key, variant, look = 'plain') { const set = this.ensure(key, look); return set[variant % set.length].rgb; }

  /**
   * A still image of a bean for the Beandex (data URL, cached). With
   * `silhouette` the bean is a flat dark shape for undiscovered entries.
   */
  portrait(key, look = 'plain', silhouette = false) {
    const id = `${key}|${look}|${silhouette ? 1 : 0}`;
    this.portraits = this.portraits || new Map();
    if (this.portraits.has(id)) return this.portraits.get(id);
    const src = this.ensure(key, look)[0].mips[2].canvas;
    const c = makeCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate(-0.25); g.translate(-c.width / 2, -c.height / 2);
    g.drawImage(src, 0, 0);
    if (silhouette) {
      g.globalCompositeOperation = 'source-in';
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#2a332f';
      g.fillRect(0, 0, c.width, c.height);
    }
    let url = '';
    try { url = c.toDataURL('image/png'); } catch (_) { url = ''; }
    this.portraits.set(id, url);
    return url;
  }

  /** Small white-on-dark glyph for the colour-assist option. */
  glyph(sym) {
    this.glyphs = this.glyphs || new Map();
    let c = this.glyphs.get(sym);
    if (c) return c;
    c = makeCanvas(48, 48);
    const g = c.getContext('2d');
    g.font = '700 30px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineJoin = 'round';
    g.strokeText(sym, 24, 26);
    g.fillStyle = '#fff'; g.fillText(sym, 24, 26);
    this.glyphs.set(sym, c);
    return c;
  }

  /** Four-point twinkle drawn over rare beans on the table. */
  get sparkle() {
    if (this._sparkle) return this._sparkle;
    const c = makeCanvas(32, 32), g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,240,0.9)'); grd.addColorStop(1, 'rgba(255,255,240,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(16, 1); g.lineTo(18, 14); g.lineTo(31, 16); g.lineTo(18, 18); g.lineTo(16, 31); g.lineTo(14, 18); g.lineTo(1, 16); g.lineTo(14, 14); g.closePath(); g.fill();
    this._sparkle = c;
    return c;
  }
}

/** Size of the sprite box (world units) for a bean of scale `s`. */
export const spriteBox = (s) => ({ w: BEAN.len * PAD_W * s, h: BEAN.wid * PAD_H * s });

/**
 * Create a bean object. Beans are plain objects (fast to iterate, easy to
 * serialise). `state` is one of: table | belt | queued | held | flying | sorted.
 */
export function createBean(id, key, rng, sizes) {
  let sizeClass = 'normal';
  if (sizes) {
    const roll = rng.next();
    if (roll < sizes.tiny) sizeClass = 'tiny';
    else if (roll < sizes.tiny + sizes.huge) sizeClass = 'huge';
  }
  const s = SIZE_CLASSES[sizeClass] * rng.range(0.93, 1.07);
  // Every bean is individually a little longer/shorter and fatter/thinner.
  const sx = rng.range(0.93, 1.07), sy = rng.range(0.92, 1.08);
  const variety = rollVariety(rng.next);
  const look = variety ? VARIETY[variety].look : 'plain';
  return {
    id, key, sizeClass, s, sx, sy, variety, look,
    variant: rng.int(0, VARIANTS - 1),
    flip: rng.chance(0.5) ? -1 : 1,
    len: BEAN.len * s * sx, wid: BEAN.wid * s * sy,
    invMass: 1 / (s * s),
    x: 0, y: 0, vx: 0, vy: 0, a: rng.range(0, TAU), va: 0,
    z: 0, zf: 0,            // pile layer (int) and its animated value
    state: 'table',
    awake: true, sleep: 0,
    note: SPECIAL_NOTES[id] || (variety ? VARIETY[variety].desc : rng.pick(BEAN_NOTES)),
    statSeed: rng.int(0, 1e9),
    land: 1,               // seconds since it last landed (drives the drop bounce)
    grams: +(0.42 * s * s * s * rng.range(0.9, 1.1)).toFixed(2),
    cell: -1,
    // Declared up front so every bean shares one object shape. Fields added
    // later would give beans different hidden classes and make the physics
    // loop's property access polymorphic (measured ~4× slower).
    ext: false, slideX: 0, slideY: 0,
    rarity: variety ? VARIETY[variety].rarity : 'common',
    found: false, flyOk: false,
  };
}
