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

import { BEAN, COLORS, SIZE_CLASSES, BEAN_NOTES } from './config.js';
import { TAU, makeRng, hashString, shade, rgbCss, clamp } from './util.js';

export const VARIANTS = 12;
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

/** Render one bean variant at `res` pixels per unit. */
function renderVariant(rgb, p, res) {
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

  return { canvas: c, res };
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

  /** Variant list for a colour: [{ rgb, mips:[{canvas,res}] }]. */
  ensure(key) {
    let set = this.sets.get(key);
    if (set) return set;
    set = [];
    const base = COLORS[key].rgb;
    for (let v = 0; v < VARIANTS; v++) {
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
      const top = renderVariant(rgb, p, MIP_RES[2]);
      const mid = downscale(top, MIP_RES[1]);
      const low = downscale(mid, MIP_RES[0]);
      set.push({ rgb, mips: [low, mid, top] });
    }
    this.sets.set(key, set);
    return set;
  }

  /** Best sprite for a bean drawn at `pxPerUnit` screen pixels per unit. */
  sprite(key, variant, pxPerUnit) {
    const mips = this.ensure(key)[variant].mips;
    for (let i = 0; i < mips.length; i++) if (mips[i].res >= pxPerUnit) return mips[i];
    return mips[mips.length - 1];
  }

  rgbOf(key, variant) { return this.ensure(key)[variant].rgb; }
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
  return {
    id, key, sizeClass, s,
    variant: rng.int(0, VARIANTS - 1),
    flip: rng.chance(0.5) ? -1 : 1,
    len: BEAN.len * s, wid: BEAN.wid * s,
    invMass: 1 / (s * s),
    x: 0, y: 0, vx: 0, vy: 0, a: rng.range(0, TAU), va: 0,
    z: 0, zf: 0,            // pile layer (int) and its animated value
    state: 'table',
    awake: true, sleep: 0,
    note: rng.pick(BEAN_NOTES),
    grams: +(0.42 * s * s * s * rng.range(0.9, 1.1)).toFixed(2),
    cell: -1,
  };
}
