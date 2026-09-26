// ---------------------------------------------------------------------------
// themes.js — cosmetic workstation environments (see career.js for unlocks).
// Each theme generates a tileable tabletop texture procedurally and supplies
// colours for the floor, the table rim, printed markings and the combo glow.
// Textures are built once per theme switch, never per frame.
// ---------------------------------------------------------------------------

import { makeRng, TAU } from './util.js';

function fleck(g, S, rng, n, cols, min = 0.4, max = 1.4) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[i % cols.length];
    const s = rng.range(min, max);
    g.fillRect(rng.range(0, S), rng.range(0, S), s, s * rng.range(0.6, 1.4));
  }
}

function mottle(g, S, rng, n, light, dark) {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(40, 140);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rng.chance(0.5) ? light : dark);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
    }
  }
}

export const THEMES = {
  office: {
    floor: '#2c2e33', floorLine: 'rgba(0,0,0,0.28)',
    rim: ['#e6e2da', '#b3aca0', '#7c766c'], lip: '#6a655c',
    ink: '52,48,40', glow: '240,170,60', station: 'DESK 07  ·  BEAN ADMINISTRATION',
    texture(g, S, rng) {
      g.fillStyle = '#cec8bb'; g.fillRect(0, 0, S, S);
      mottle(g, S, rng, 30, 'rgba(255,252,244,0.05)', 'rgba(90,80,60,0.04)');
      fleck(g, S, rng, 3600, ['rgba(255,255,255,0.4)', 'rgba(90,82,70,0.25)', 'rgba(150,140,125,0.35)']);
    },
    // A coffee ring. Somebody's been here before you.
    extra(ctx, r) {
      const x = r.x + r.w * 0.86, y = r.y + r.h * 0.2;
      ctx.strokeStyle = 'rgba(110,70,30,0.13)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 24, 0.3, TAU - 0.4); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x + 2, y + 1, 21, 1.2, TAU - 0.2); ctx.stroke();
    },
  },
  lab: {
    floor: '#28312d', floorLine: 'rgba(0,0,0,0.3)',
    rim: ['#dfe4e0', '#a7b0ab', '#6f7873'], lip: '#56605b',
    ink: '38,54,46', glow: '240,150,60', station: 'STATION 07  ·  DEPT. OF LEGUME CLASSIFICATION',
    texture(g, S, rng) {
      g.fillStyle = '#c4ccc2'; g.fillRect(0, 0, S, S);
      mottle(g, S, rng, 40, 'rgba(255,255,250,0.05)', 'rgba(60,76,66,0.045)');
      fleck(g, S, rng, 5200, ['rgba(255,255,255,0.55)', 'rgba(70,84,76,0.35)', 'rgba(40,50,44,0.3)', 'rgba(230,236,226,0.6)', 'rgba(120,132,122,0.4)']);
    },
  },
  wood: {
    floor: '#231b16', floorLine: 'rgba(0,0,0,0.35)',
    rim: ['#d8b06a', '#9b7134', '#5e3f18'], lip: '#3b2616',
    ink: '40,22,10', glow: '255,200,90', station: 'EXECUTIVE SORTING SUITE',
    texture(g, S, rng) {
      g.fillStyle = '#9a6a42'; g.fillRect(0, 0, S, S);
      // Long grain lines; every wave period divides the tile so it repeats.
      for (let i = 0; i < 140; i++) {
        const y0 = rng.range(0, S), amp = rng.range(2, 9), k = (TAU / S) * rng.int(1, 3), ph = rng.range(0, TAU);
        g.strokeStyle = rng.chance(0.5) ? `rgba(60,32,14,${rng.range(0.08, 0.22).toFixed(2)})` : `rgba(210,160,110,${rng.range(0.05, 0.14).toFixed(2)})`;
        g.lineWidth = rng.range(0.6, 2.6);
        g.beginPath();
        for (let x = 0; x <= S; x += 8) { const y = y0 + Math.sin(x * k + ph) * amp; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      mottle(g, S, rng, 16, 'rgba(255,220,170,0.05)', 'rgba(40,20,5,0.06)');
    },
  },
  industrial: {
    floor: '#1d2124', floorLine: 'rgba(0,0,0,0.4)',
    rim: ['#f2c21b', '#d8a90f', '#9e7a05'], lip: '#222',
    ink: '20,24,26', glow: '255,190,40', station: 'LINE 3  ·  HIGH-VOLUME LEGUME PROCESSING',
    texture(g, S, rng) {
      g.fillStyle = '#8b9295'; g.fillRect(0, 0, S, S);
      mottle(g, S, rng, 24, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.06)');
      // Diamond tread plate
      const step = 32;
      for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
        const cx = x + (y / step % 2 ? step / 2 : 0) + step / 4, cy = y + step / 2;
        const a = (y / step + x / step) % 2 ? 0.7 : -0.7;
        g.save(); g.translate(cx % S, cy); g.rotate(a);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-8, -1.5, 16, 4);
        g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(-8, -2.5, 16, 3);
        g.restore();
      }
      fleck(g, S, rng, 1400, ['rgba(255,255,255,0.2)', 'rgba(0,0,0,0.2)']);
    },
    // Hazard stripes on the rim.
    rimExtra(ctx, r) {
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x - 12, r.y - 12, r.w + 24, r.h + 24); ctx.rect(r.x - 3, r.y - 3, r.w + 6, r.h + 6); ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(20,20,20,0.85)';
      for (let d = -r.h; d < r.w + r.h; d += 28) {
        ctx.beginPath(); ctx.moveTo(r.x + d, r.y - 14); ctx.lineTo(r.x + d + 14, r.y - 14); ctx.lineTo(r.x + d + 14 - r.h - 30, r.y + r.h + 14); ctx.lineTo(r.x + d - r.h - 30, r.y + r.h + 14); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },
  },
  corporate: {
    floor: '#171b24', floorLine: 'rgba(255,255,255,0.03)',
    rim: ['#6b4a2e', '#4a3019', '#2a1a0c'], lip: '#1b120a',
    ink: '220,210,170', glow: '120,180,255', station: 'CORPORATE BEAN DIVISION  ·  FLOOR 41',
    texture(g, S, rng) {
      g.fillStyle = '#28374f'; g.fillRect(0, 0, S, S);
      mottle(g, S, rng, 36, 'rgba(255,255,255,0.035)', 'rgba(0,0,0,0.07)');
      fleck(g, S, rng, 2600, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.2)'], 0.4, 1);
    },
    // Stitched leather edge.
    extra(ctx, r) {
      ctx.save();
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(214,190,130,0.55)';
      ctx.strokeRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20);
      ctx.restore();
    },
  },
  secret: {
    floor: '#0f1214', floorLine: 'rgba(80,200,220,0.05)',
    rim: ['#3a4043', '#23282a', '#111416'], lip: '#b3261e',
    ink: '140,220,230', glow: '80,220,240', station: 'SITE B-12  ·  CLASSIFICATION LEVEL: BEAN',
    texture(g, S, rng) {
      g.fillStyle = '#262c2f'; g.fillRect(0, 0, S, S);
      fleck(g, S, rng, 2000, ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.25)']);
      g.strokeStyle = 'rgba(90,210,230,0.1)'; g.lineWidth = 1;
      for (let i = 0; i <= S; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    },
    extra(ctx, r) {
      ctx.save();
      ctx.translate(r.x + r.w * 0.5, r.y + r.h * 0.5); ctx.rotate(-0.12);
      ctx.font = '900 64px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(200,40,30,0.08)';
      ctx.fillText('CLASSIFIED', 0, 0);
      ctx.restore();
    },
  },
  void: {
    floor: '#000000', floorLine: 'rgba(120,80,200,0.04)',
    rim: ['#4d2a8a', '#241246', '#0c0618'], lip: '#9b6bff',
    ink: '170,140,255', glow: '170,120,255', station: 'THERE IS NO TABLE  ·  THERE ARE ONLY BEANS',
    texture(g, S, rng) {
      g.fillStyle = '#07060d'; g.fillRect(0, 0, S, S);
      mottle(g, S, rng, 20, 'rgba(120,60,220,0.05)', 'rgba(20,80,160,0.04)');
      for (let i = 0; i < 380; i++) {
        g.fillStyle = `rgba(255,255,255,${rng.range(0.15, 0.9).toFixed(2)})`;
        const s = rng.chance(0.08) ? 1.8 : rng.range(0.4, 1.1);
        g.fillRect(rng.range(0, S), rng.range(0, S), s, s);
      }
    },
  },
};

export function buildTexture(themeId) {
  const theme = THEMES[themeId] || THEMES.office;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  theme.texture(c.getContext('2d'), S, makeRng(20240926 + themeId.length));
  return c;
}
