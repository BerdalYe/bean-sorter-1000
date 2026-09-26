// ---------------------------------------------------------------------------
// ui.js — everything made of DOM: HUD readouts, the container tray, menus,
// the cinematic intro, the finale, the shift report, the Beandex and other
// screens, pop-ups and toasts. Game logic never touches the DOM directly;
// it calls methods here. Buttons use data-action attributes and a single
// delegated click listener that forwards to game.onAction().
// ---------------------------------------------------------------------------

import { COLORS, LEVELS, RANKS, MAIN_LEVELS, hazardsOf, challengeLimit } from './config.js';
import { RARITIES, VARIETY } from './beandex.js';
import { CAREER } from './career.js';
import { rgbCss, shade, fmtTime, fmtInt, fmtPct } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const COMMENTS = [
  ['Please try to keep the beans on the table.', 'We have all been there. Some of us are still there.'],
  ['Adequate. The beans have noticed.', 'A promising start to a long career in legumes.'],
  ['You may now call yourself a Sorter. Officially.', 'Solid, dependable, bean-shaped work.'],
  ['The containers speak highly of you.', 'Your technique has been added to the training video.'],
  ['A specialist in a field nobody asked for.', 'Management has learned your name.'],
  ['The beans fear and respect you.', 'You sort like the beans owe you money.'],
  ['There is nothing left to teach you. Please go outside.', 'The Department has commissioned a small statue.'],
];

export function beanSwatch(key) {
  const rgb = COLORS[key].rgb;
  return `<i class="swatch" style="--c:${rgbCss(rgb)};--c-hi:${rgbCss(shade(rgb, 0.3))};--c-lo:${rgbCss(shade(rgb, -0.45))}"></i>`;
}

const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return '—'; } };

export class UI {
  constructor(game) {
    this.game = game;
    this.hudCache = {};
    this.bins = new Map();
    this.binOrder = [];
    this.hoverKey = null;
    this.rectCache = null;
    this.symbols = null;
    this.energyLevel = -1;

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      e.preventDefault();
      game.onAction(t.dataset.action, t.dataset, t);
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.dataset || !t.dataset.setting) return;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
      game.onSetting(t.dataset.setting, v);
    });
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.setting && t.type === 'range') {
        game.onSetting(t.dataset.setting, +t.value, true);
        const out = document.querySelector(`output[for="${t.id}"]`);
        if (out) out.textContent = t.dataset.fmt === 'pct' ? `${Math.round(+t.value * 100)}%` : t.value;
      }
    });
    $('btn-pause').innerHTML = ICONS.pause;
    $('btn-fit').innerHTML = ICONS.fit;
    this.setMuted(false);
  }

  // --- HUD --------------------------------------------------------------
  showHud(on) { $('hud').hidden = !on; }
  showTray(on) { $('tray').hidden = !on; }
  hudHeight() { return $('hud').hidden ? 0 : $('hud').getBoundingClientRect().bottom; }
  traySide() { return document.documentElement.classList.contains('tray-side'); }
  trayHeight() { return $('tray').hidden || this.traySide() ? 0 : window.innerHeight - $('tray').getBoundingClientRect().top; }
  trayWidth() { return $('tray').hidden || !this.traySide() ? 0 : window.innerWidth - $('tray').getBoundingClientRect().left; }
  setTraySide(on) {
    const root = document.documentElement;
    if (root.classList.contains('tray-side') !== on) { root.classList.toggle('tray-side', on); this.rectCache = null; }
  }

  setPlate(k, v) {
    $('plate-k').textContent = k;
    $('plate-v').textContent = v;
  }

  setMuted(muted) {
    const b = $('btn-mute');
    b.innerHTML = muted ? ICONS.muted : ICONS.sound;
    b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
    b.classList.toggle('is-off', muted);
  }

  showFps(on) { $('fps').hidden = !on; }
  setFps(text) { $('fps').textContent = text; }

  /** Only touches the DOM when a value actually changed. */
  updateHud(d) {
    const c = this.hudCache;
    const set = (id, v) => { if (c[id] !== v) { c[id] = v; $(id).textContent = v; } };
    set('ro-remaining-k', d.remainingLabel);
    set('ro-remaining', d.remaining);
    set('ro-acc', d.accuracy);
    set('ro-streak', d.streak);
    set('ro-best', d.best);
    set('ro-bpm', d.bpm);
    set('ro-time-k', d.timeLabel);
    set('ro-time', d.time);
    if (c.progress !== d.progress) {
      c.progress = d.progress;
      $('progress').style.transform = `scaleX(${d.progress})`;
    }
    const flags = [['warn', d.warn, $('hud'), 'is-warn'], ['low', d.lowTime, $('ro-time').parentElement, 'is-low'], ['hot', d.hotBpm, $('ro-bpm').parentElement, 'is-hot']];
    for (const [k, v, el, cls] of flags) if (c[k] !== !!v) { c[k] = !!v; el.classList.toggle(cls, !!v); }
  }

  bumpStreak() {
    const el = $('ro-streak').parentElement;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  /** Combo hype (0…1): CSS reacts with glow and faster animations. */
  setEnergy(e) {
    const lvl = e <= 0 ? 0 : e < 0.34 ? 1 : e < 0.67 ? 2 : 3;
    if (lvl === this.energyLevel) return;
    this.energyLevel = lvl;
    document.documentElement.dataset.energy = String(lvl);
  }

  /** Spirit level gadget (visible while the table can tilt). */
  setBubble(visible, tx = 0, ty = 0) {
    const g = $('bubble');
    if (g.hidden === visible) g.hidden = !visible;
    if (visible) g.firstElementChild.style.transform = `translate(${(-tx * 0.45).toFixed(1)}px, ${(-ty * 0.45).toFixed(1)}px)`;
  }

  // --- Container tray ---------------------------------------------------
  /** bins: [{ key, total }] (total null in endless mode). */
  buildBins(bins) {
    const wrap = $('bins');
    wrap.innerHTML = '';
    this.bins.clear();
    this.binOrder = bins.map((b) => b.key);
    wrap.style.setProperty('--n', bins.length);
    bins.forEach((b, i) => this.appendBin(b, i));
    this.rectCache = null;
  }

  appendBin(b, order = this.bins.size) {
    const wrap = $('bins');
    const rgb = COLORS[b.key].rgb;
    const el = document.createElement('div');
    el.className = 'bin';
    el.style.order = order;
    el.style.setProperty('--c', rgbCss(rgb));
    el.style.setProperty('--c-hi', rgbCss(shade(rgb, 0.25)));
    el.style.setProperty('--c-lo', rgbCss(shade(rgb, -0.4)));
    el.innerHTML = `
      <div class="bin-tub">
        <div class="bin-fill"></div>
        <span class="bin-count"></span>
        <span class="bin-reject">REJECTED</span>
      </div>
      <div class="bin-tape">${beanSwatch(b.key)}<b class="bin-sym"></b><span>${esc(COLORS[b.key].name)}</span></div>`;
    wrap.appendChild(el);
    this.bins.set(b.key, { el, fill: el.querySelector('.bin-fill'), count: el.querySelector('.bin-count'), sym: el.querySelector('.bin-sym'), total: b.total, sorted: b.sorted || 0 });
    if (!this.binOrder.includes(b.key)) this.binOrder.push(b.key);
    wrap.style.setProperty('--n', this.bins.size);
    this.setBinCount(b.key, b.sorted || 0);
    this.applySymbols();
    this.rectCache = null;
  }

  setSymbols(map) { this.symbols = map; this.applySymbols(); }
  applySymbols() {
    for (const [k, b] of this.bins) b.sym.textContent = this.symbols && this.symbols[k] ? this.symbols[k] : '';
  }

  setBinCount(key, n) {
    const b = this.bins.get(key);
    if (!b) return;
    b.sorted = n;
    b.count.textContent = b.total ? `${n}/${b.total}` : `${n}`;
    const frac = b.total ? n / b.total : Math.min(1, n / 60);
    b.fill.style.transform = `scaleY(${frac.toFixed(3)})`;
    b.el.classList.toggle('is-full', !!b.total && n >= b.total);
  }

  /** Screen rects of each container, cached until layout changes. */
  rects() {
    if (!this.rectCache) {
      this.rectCache = [];
      for (const [key, b] of this.bins) this.rectCache.push({ key, r: b.el.getBoundingClientRect() });
    }
    return this.rectCache;
  }
  invalidateRects() { this.rectCache = null; }

  binAt(x, y, pad = 8) {
    for (const { key, r } of this.rects()) {
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad * 2 && y <= r.bottom + pad) return key;
    }
    return null;
  }

  /** Is (x, y) over the tray at all? (used to avoid unfair slips) */
  overTray(x, y) {
    if ($('tray').hidden) return false;
    const r = $('tray').getBoundingClientRect();
    return x >= r.left - 10 && y >= r.top - 10;
  }

  binCenter(key) {
    const hit = this.rects().find((o) => o.key === key);
    if (!hit) return { x: window.innerWidth / 2, y: window.innerHeight - 40 };
    const r = hit.r;
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.35 };
  }

  binHover(key) {
    if (key === this.hoverKey) return;
    if (this.hoverKey && this.bins.get(this.hoverKey)) this.bins.get(this.hoverKey).el.classList.remove('is-hover');
    this.hoverKey = key;
    if (key && this.bins.get(key)) this.bins.get(key).el.classList.add('is-hover');
  }

  binFeedback(key, ok) {
    const b = this.bins.get(key);
    if (!b) return;
    const cls = ok ? 'is-ok' : 'is-bad';
    b.el.classList.remove('is-ok', 'is-bad');
    void b.el.offsetWidth;
    b.el.classList.add(cls);
    clearTimeout(b.t);
    b.t = setTimeout(() => b.el.classList.remove(cls), ok ? 320 : 650);
  }

  /** Swap two containers with a FLIP animation ("containers slowly move"). */
  swapBins(a, b) {
    const ia = this.binOrder.indexOf(a), ib = this.binOrder.indexOf(b);
    if (ia < 0 || ib < 0) return;
    const els = [...this.bins.values()].map((o) => o.el);
    const first = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
    this.binOrder[ia] = b; this.binOrder[ib] = a;
    this.binOrder.forEach((k, i) => { this.bins.get(k).el.style.order = i; });
    for (const el of els) {
      const f = first.get(el), l = el.getBoundingClientRect();
      const dx = f.left - l.left, dy = f.top - l.top;
      if (!dx && !dy) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 1400, easing: 'cubic-bezier(.6,0,.3,1)' });
    }
    this.rectCache = null;
    setTimeout(() => { this.rectCache = null; }, 1450);
  }

  celebrateBins() {
    let i = 0;
    for (const k of this.binOrder) {
      const el = this.bins.get(k).el;
      setTimeout(() => { el.classList.remove('is-party'); void el.offsetWidth; el.classList.add('is-party'); }, i++ * 90);
    }
  }

  // --- Pop-ups ----------------------------------------------------------
  /** Combo milestone banner. Tier 0…8 controls size, colour and drama. */
  combo(text, n, tier = 0) {
    const box = $('combo');
    box.innerHTML = '';
    const el = document.createElement('div');
    el.className = `combo-pop tier-${Math.min(8, tier)}`;
    el.innerHTML = `<b>${esc(text)}</b><span>${fmtInt(n)} in a row</span>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), tier >= 6 ? 2600 : 2000);
  }

  clearNotices() {
    $('memos').innerHTML = '';
    $('combo').innerHTML = '';
    $('banner').hidden = true;
  }

  memo(text, kind = 'memo') {
    const box = $('memos');
    const el = document.createElement('div');
    el.className = `memo memo-${kind}`;
    const label = { alert: 'Notice', hint: 'Tip', dex: 'Beandex' }[kind] || 'Memo';
    el.innerHTML = `<span class="memo-k">${label}</span><span class="memo-v">${esc(text)}</span>`;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'hint' ? 7000 : kind === 'dex' ? 3200 : 4800);
  }

  toast(html, cls = '') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.innerHTML = html;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4000);
  }

  achievement(a) {
    this.toast(`<span class="toast-k">Achievement unlocked</span><b>${esc(a.name)}</b><span class="toast-d">${esc(a.desc)}</span>`);
  }

  promotion(name) {
    this.toast(`<span class="toast-k">Promotion</span><b>${esc(name)}</b><span class="toast-d">Your new title is effective immediately.</span>`, 'toast-promo');
  }

  rareFound(v, rarity, first, img) {
    const label = v.rarity === 'legendary' ? 'Legendary bean found' : v.rarity === 'rare' ? 'Rare bean found' : 'Uncommon bean';
    this.toast(`<span class="toast-row">${img ? `<img src="${img}" alt="">` : ''}<span><span class="toast-k" style="color:${rarity.color}">${label}${first ? ' · New' : ''}</span><b>${esc(v.name)}</b><span class="toast-d">Added to the Beandex.</span></span></span>`, `toast-rare toast-${v.rarity}`);
  }

  /** A stamp-like banner across the top ("QUALITY CONTROL INSPECTION"). */
  banner(text) {
    const el = $('banner');
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => { el.hidden = true; }, 2600);
  }

  hint(text) {
    const el = $('hint');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
  }

  inspect(info, x, y) {
    const el = $('inspect');
    const r = info.rarityInfo;
    el.className = `inspect rarity-${info.rarity}`;
    el.innerHTML = `
      <div class="insp-head"><span>Bean</span><b>#${String(info.id).padStart(4, '0')}</b></div>
      <dl>
        <dt>Type</dt><dd>${esc(info.type)}</dd>
        <dt>Color</dt><dd>${beanSwatch(info.key)} ${esc(info.color)}</dd>
        <dt>RGB</dt><dd class="mono">RGB(${info.rgb.join(', ')})</dd>
        <dt>Rarity</dt><dd><span class="rar" style="--rc:${r.color}">${esc(r.name)}</span></dd>
        <dt>Weight</dt><dd class="mono">${info.weight.toFixed(2)} bean units</dd>
        <dt>Size</dt><dd>${esc(info.size)}</dd>
        <dt>Status</dt><dd>${esc(info.status)}</dd>
        <dt>${esc(info.stat[0])}</dt><dd class="mono">${esc(info.stat[1])}</dd>
      </dl>
      <p class="insp-note">${esc(info.note)}</p>`;
    el.hidden = false;
    const rect = el.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    let left = x + 18, top = y - rect.height - 14;
    if (left + rect.width > W - 12) left = x - rect.width - 18;
    if (left < 12) left = 12;
    if (top < this.hudHeight() + 8) top = y + 18;
    if (top + rect.height > H - 12) top = H - rect.height - 12;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    clearTimeout(this.inspT);
    this.inspT = setTimeout(() => this.hideInspect(), 7000);
  }

  hideInspect() { $('inspect').hidden = true; }

  flash() {
    const el = $('flash');
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  }

  // --- Level intro ------------------------------------------------------
  /** Cinematic intro: letterbox bars, lines appear at their `at` times. */
  intro(lines, o) {
    const el = $('intro');
    const line = (l) => {
      const style = `style="animation-delay:${l.at.toFixed(2)}s"`;
      if (l.t === 'warn') return `<div class="in-line in-warn" ${style}><span>${esc(l.k)}</span><b>${esc(l.text)}</b></div>`;
      if (l.t === 'mission') return `<div class="in-line in-mission" ${style}><span>${esc(l.k)}</span><b>${esc(l.text)}</b></div>`;
      return `<div class="in-line in-${l.t}" ${style}>${esc(l.text)}</div>`;
    };
    const last = lines.length ? lines[lines.length - 1].at : 0;
    el.className = `intro${o.boss ? ' is-boss' : ''}`;
    el.innerHTML = `
      <div class="in-bar in-top"></div><div class="in-bar in-bottom"></div>
      <div class="in-body">
        ${lines.map(line).join('')}
        ${o.briefing ? `<p class="in-brief" style="animation-delay:${(last + 0.35).toFixed(2)}s">${esc(o.briefing)}</p>` : ''}
        ${o.hint ? `<p class="in-hint" style="animation-delay:${(last + 0.5).toFixed(2)}s">${esc(o.hint)}</p>` : ''}
      </div>
      <button class="in-skip" data-action="skip-intro">Start now</button>`;
    el.hidden = false;
  }

  hideIntro() {
    const el = $('intro');
    if (el.hidden) return;
    el.classList.add('out');
    setTimeout(() => { el.hidden = true; el.innerHTML = ''; el.classList.remove('out'); }, 260);
  }

  // --- Final bean -------------------------------------------------------
  finaleStart() {
    const el = $('finale');
    el.className = 'finale stage-hit';
    el.innerHTML = `<div class="fin-vignette"></div><div class="fin-line fin-1">Final bean sorted</div>`;
    el.hidden = false;
  }

  finaleReveal(o) {
    const el = $('finale');
    el.className = `finale stage-reveal${o.boss ? ' is-boss' : ''}`;
    el.innerHTML = `
      <div class="fin-vignette"></div>
      <div class="fin-line fin-1 is-in">Final bean sorted</div>
      <div class="fin-count" data-count="${o.total}">0 <small>/</small> ${fmtInt(o.total)}</div>
      ${o.subtitle ? `<div class="fin-line fin-2">${esc(o.subtitle)}</div>` : ''}
      <div class="fin-line fin-3">${esc(o.title)} · Shift complete</div>
      <button class="fin-skip" data-action="skip-finale" aria-label="Continue to shift report"></button>`;
    el.hidden = false;
    // Counter rolls up to the total.
    const cnt = el.querySelector('.fin-count');
    const t0 = performance.now(), dur = o.boss ? 1400 : 800;
    const step = (now) => {
      if (!cnt.isConnected) return;
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      cnt.innerHTML = `${fmtInt(Math.round(o.total * e))} <small>/</small> ${fmtInt(o.total)}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  hideFinale() { $('finale').hidden = true; $('finale').innerHTML = ''; }

  // --- Screens ----------------------------------------------------------
  closeScreen() {
    $('screens').innerHTML = '';
    $('screens').hidden = true;
    this.current = null;
  }

  screen(name, data = {}) {
    const fn = this[`s_${name}`];
    if (!fn) return;
    $('screens').innerHTML = fn.call(this, data);
    $('screens').hidden = false;
    $('screens').dataset.screen = name;
    $('screens').scrollTop = 0;
    this.current = name;
    const after = this[`after_${name}`];
    if (after) after.call(this, data);
    const first = $('screens').querySelector('[data-autofocus]');
    if (first) first.focus({ preventScroll: true });
  }

  s_menu(d) {
    const r = d.rank;
    const primary = d.run
      ? `<button class="btn btn-primary btn-big" data-action="continue" data-autofocus>Continue<small>Level ${d.run.levelId} · ${fmtInt(d.run.sorted)} / ${fmtInt(d.run.total)} sorted</small></button>`
      : `<button class="btn btn-primary btn-big" data-action="start" data-autofocus>Continue<small>${esc(d.startLabel)}</small></button>`;
    const endless = d.endless
      ? `<button class="btn" data-action="endless">Endless</button>`
      : `<button class="btn is-locked" data-action="locked" aria-disabled="true" title="Complete Level 5 to unlock">${ICONS.lock}Endless</button>`;
    return `
    <section class="screen screen-menu">
      <div class="nameplate">
        <span class="screw tl"></span><span class="screw tr"></span><span class="screw bl"></span><span class="screw br"></span>
        <h1 class="title">Bean Sorter <span>1000</span></h1>
        <p class="np-sub">Professional Bean Organization Software</p>
        <p class="np-serial" data-action="serial">Model BS-1000 · Version 2.0 · Serial No. 000483</p>
        <div class="menu">
          ${primary}
          <div class="menu-grid">
            <button class="btn" data-action="levels">Level select</button>
            ${endless}
            <button class="btn" data-action="beandex">Beandex</button>
            <button class="btn" data-action="achievements">Achievements</button>
            <button class="btn" data-action="stats">Statistics</button>
            <button class="btn" data-action="settings">Settings</button>
          </div>
        </div>
        <div class="np-career">
          <div><span class="k">Beans sorted</span><span class="v">${fmtInt(d.lifeSorted)}</span></div>
          <div><span class="k">Current rank</span><span class="v">${esc(r.name)}</span></div>
          <div class="career-bar" title="${r.next ? `${fmtInt(r.next - r.xp)} XP to ${esc(r.nextName)}` : 'Maximum rank'}"><i style="transform:scaleX(${r.progress.toFixed(3)})"></i></div>
        </div>
      </div>
    </section>`;
  }

  s_levels(d) {
    const card = (L) => {
      const locked = L.id > d.unlocked;
      const best = d.best[L.id];
      const hz = hazardsOf(L);
      return `
      <button class="lvl ${locked ? 'is-locked' : ''} ${L.boss ? 'is-boss' : ''}" data-action="${locked ? 'locked' : 'play'}" data-level="${L.id}" ${locked ? 'aria-disabled="true"' : ''}>
        <span class="lvl-n">${L.id}</span>
        <span class="lvl-body">
          <span class="lvl-title">${esc(L.title)}</span>
          <span class="lvl-meta">${fmtInt(L.count)} beans · ${L.colors.length} colors${d.challenge ? ` · ${fmtTime(challengeLimit(L.count))}` : ''}</span>
          <span class="lvl-sw">${L.colors.map(beanSwatch).join('')}</span>
          <span class="chips">${hz.length ? hz.map((h) => `<span class="chip">${esc(h)}</span>`).join('') : '<span class="chip chip-calm">No hazards</span>'}</span>
        </span>
        <span class="lvl-best">${locked ? `${ICONS.lock}<small>Locked</small>` : best ? `<b>${esc(best.rank)}</b><small>${fmtTime(best.time)} · ${fmtPct(best.accuracy)}</small>` : '<small>Not attempted</small>'}</span>
      </button>`;
    };
    const main = LEVELS.filter((L) => L.id <= MAIN_LEVELS).map(card).join('');
    const extra = LEVELS.filter((L) => L.id > MAIN_LEVELS).map(card).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head">
          <h2>Level select</h2>
          <label class="switch"><input type="checkbox" id="challenge" data-setting="challenge" ${d.challenge ? 'checked' : ''}><span></span>Challenge mode <small>(time limit)</small></label>
        </header>
        <h3 class="sub">Main shifts</h3>
        <div class="lvl-list">${main}</div>
        <h3 class="sub">Challenge levels ${d.mainDone ? '' : '<small>Complete Level 5 to begin</small>'}</h3>
        <div class="lvl-list">${extra}</div>
        <footer class="panel-foot"><button class="btn btn-small" data-action="menu" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }

  s_pause(d) {
    return `
    <section class="screen">
      <div class="panel panel-narrow">
        <p class="kicker">Shift paused</p>
        <h2 class="big">Break time</h2>
        <p class="lede">${esc(d.line)}</p>
        <div class="menu">
          <button class="btn btn-primary" data-action="resume" data-autofocus>Resume</button>
          ${d.mode === 'level' ? '<button class="btn" data-action="restart">Restart level</button>' : ''}
          <button class="btn" data-action="settings" data-from="pause">Settings</button>
          <button class="btn" data-action="quit">${d.mode === 'level' ? 'Save and quit to menu' : 'End shift'}</button>
        </div>
      </div>
    </section>`;
  }

  s_results(d) {
    const s = d.summary;
    const num = (v, fmt) => `<td data-to="${v}" data-fmt="${fmt}">${fmt === 'time' ? '00:00' : '0'}</td>`;
    const rows = d.mode === 'endless'
      ? [['Beans sorted', num(s.sorted, 'int')], ['Accuracy', num(s.accuracy, 'pct')], ['Longest combo', num(s.longest, 'int')], ['Time survived', num(s.time, 'time')], ['Average BPM', num(s.bpm, 'dec')], ['Peak BPM', num(s.peakBpm, 'dec')]]
      : [['Beans sorted', `<td>${fmtInt(s.sorted)} / ${fmtInt(s.total)}</td>`], ['Mistakes', num(s.mistakes, 'int')], ['Accuracy', num(s.accuracy, 'pct')], ['Longest combo', num(s.longest, 'int')], ['Completion time', s.complete ? num(s.time, 'time') : '<td>—</td>'], ['Average BPM', num(s.bpm, 'dec')], ['Peak BPM', num(s.peakBpm, 'dec')]];
    const comment = COMMENTS[s.rank.index][d.commentPick % 2];
    const title = d.mode === 'endless' ? 'Table overflow' : s.complete ? 'Shift complete' : 'Shift incomplete';
    const next = d.hasNext ? '<button class="btn btn-primary" data-action="next" data-autofocus>Next level</button>' : '';
    const again = d.mode === 'endless' ? '<button class="btn btn-primary" data-action="endless" data-autofocus>New shift</button>' : `<button class="btn ${next ? '' : 'btn-primary'}" data-action="retry" ${next ? '' : 'data-autofocus'}>Retry</button>`;
    const c = d.career;
    return `
    <section class="screen screen-report">
      <div class="report ${d.boss && s.complete ? 'is-boss' : ''}">
        <header class="report-head">
          <span>Form LB-1000</span><span>Shift report</span><span>No. ${String(d.reportNo).padStart(6, '0')}</span>
        </header>
        <p class="kicker">${d.mode === 'endless' ? 'Endless mode' : `Level ${s.levelId} · ${esc(d.levelTitle)}`}${d.challenge ? ' · Challenge' : ''}</p>
        <h2 class="big">${title}</h2>
        <table class="report-rows"><tbody>
          ${rows.map(([k, v], i) => `<tr style="animation-delay:${(0.1 + i * 0.12).toFixed(2)}s"><th>${k}</th>${v}</tr>`).join('')}
        </tbody></table>
        ${d.record ? `<p class="record">${esc(d.record)}</p>` : ''}
        <div class="report-rank" style="--delay:${(0.2 + rows.length * 0.12 + 0.4).toFixed(2)}s">
          <span class="k">Classification</span>
          <div class="stamp" style="--rot:${d.stampRot}deg"><small>Grade ${s.rank.index + 1} of ${RANKS.length}</small>${esc(s.rank.name)}</div>
        </div>
        <p class="comment"><span>Supervisor's comment:</span> ${esc(comment)}</p>
        <div class="report-career">
          <span class="k">Career</span>
          <span class="v">${esc(c.name)}${d.xpGained ? ` <small>+${fmtInt(d.xpGained)} XP</small>` : ''}</span>
          <div class="career-bar"><i style="transform:scaleX(${c.progress.toFixed(3)})"></i></div>
        </div>
        ${d.newAch.length ? `<div class="report-ach"><span class="k">Achievements unlocked</span>${d.newAch.map((a) => `<span class="chip chip-gold">${esc(a.name)}</span>`).join('')}</div>` : ''}
        ${d.unlockedEndless ? '<p class="record">Endless mode and challenge levels unlocked. The beans never stop now.</p>' : ''}
        <footer class="panel-foot">
          <button class="btn btn-small" data-action="menu">Menu</button>
          ${again}
          ${next}
        </footer>
      </div>
    </section>`;
  }

  /** Count the report's numbers up from zero, row by row, with ticks. */
  after_results(d) {
    const cells = [...$('screens').querySelectorAll('td[data-to]')];
    const reduced = document.documentElement.classList.contains('reduced-motion');
    const fmt = (v, f) => (f === 'int' ? fmtInt(v) : f === 'pct' ? `${v.toFixed(1)}%` : f === 'time' ? fmtTime(v) : v.toFixed(1));
    const t0 = performance.now();
    const sfx = this.game.sfx;
    let lastTick = 0;
    const step = (now) => {
      if (!cells.length || !cells[0].isConnected) return;
      let busy = false;
      cells.forEach((td, i) => {
        const to = +td.dataset.to;
        const start = (0.1 + i * 0.12) * 1000 + 150, dur = 650;
        const k = reduced ? 1 : Math.max(0, Math.min(1, (now - t0 - start) / dur));
        if (k < 1) busy = true;
        td.textContent = fmt(to * (1 - Math.pow(1 - k, 3)), td.dataset.fmt);
      });
      if (busy && now - lastTick > 70) { lastTick = now; sfx.tick(); }
      if (busy) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    const stampDelay = reduced ? 50 : (0.2 + cells.length * 0.12 + 0.9) * 1000;
    setTimeout(() => { sfx.stamp(); this.game.haptics.play('milestone'); }, stampDelay);
  }

  s_stats(d) {
    const L = d.life;
    const acc = L.sorted + L.mistakes ? (L.sorted / (L.sorted + L.mistakes)) * 100 : 100;
    const r = d.rank;
    const rows = [
      ['Total mistakes', fmtInt(L.mistakes)], ['Lifetime accuracy', fmtPct(acc)],
      ['Best streak', fmtInt(L.bestStreak)], ['Beans per minute record', `${L.peakBpm.toFixed(1)}`],
      ['Best average BPM', `${L.bestBpm.toFixed(1)}`], ['Fastest sort', L.fastestSort ? `${(L.fastestSort * 1000).toFixed(0)} ms` : '—'],
      ['Total playtime', fmtTime(L.playTime)], ['Longest session', fmtTime(L.longestSession)],
      ['Levels completed', `${L.levelsDone.length} / ${LEVELS.length}`], ['Perfect levels', fmtInt(L.perfectLevels)],
      ['Rare beans discovered', fmtInt(L.raresFound)], ['Beandex entries', `${d.dexCount}`],
      ['Containers used', fmtInt(L.attempts)], ['Beans dropped on table', fmtInt(L.drops)],
      ['Beans inspected', fmtInt(L.inspected)], ['Beans escaped', fmtInt(L.escapes)],
      ['Best endless shift', `${fmtInt(L.endlessBest)} beans`], ['Final beans sorted', fmtInt(L.finalBeans)],
      ['Beans contemplated', fmtInt(Math.floor(L.contemplated))],
    ];
    const bests = LEVELS.map((lv) => {
      const b = d.best[lv.id];
      return `<tr><th>${lv.id}. ${esc(lv.title)}</th><td>${b ? esc(b.rank) : '—'}</td><td>${b ? fmtTime(b.time) : '—'}</td><td>${b ? fmtPct(b.accuracy) : '—'}</td><td>${b && b.peakBpm ? b.peakBpm.toFixed(1) : '—'}</td></tr>`;
    }).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head"><h2>Career statistics</h2><span class="kicker">Lifetime · this device</span></header>
        <div class="giant">
          <span class="k">Lifetime beans sorted</span>
          <span class="giant-v">${fmtInt(L.sorted)}</span>
        </div>
        <div class="career-card">
          <div><span class="k">Career rank</span><b>${esc(r.name)}</b><small>Rank ${r.index + 1} of ${CAREER.length}</small></div>
          <div class="career-bar"><i style="transform:scaleX(${r.progress.toFixed(3)})"></i></div>
          <small>${r.next ? `${fmtInt(r.next - r.xp)} XP to ${esc(r.nextName)} · XP = beans sorted + 100 per achievement` : 'There is nothing above this. There is only bean.'}</small>
        </div>
        <div class="stats-grid">${rows.map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
        <h3 class="sub">Best results</h3>
        <div class="table-wrap"><table class="best-table"><thead><tr><th>Level</th><th>Grade</th><th>Time</th><th>Accuracy</th><th>Peak BPM</th></tr></thead><tbody>${bests}</tbody></table></div>
        <footer class="panel-foot"><button class="btn btn-small" data-action="menu" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }

  s_achievements(d) {
    const got = d.list.filter((a) => d.unlocked[a.id]).length;
    const items = d.list.map((a) => {
      const on = !!d.unlocked[a.id];
      if (a.secret && !on) return '<li class="ach is-secret"><b>Classified</b><span>This achievement is classified.</span></li>';
      const [cur, goal] = a.progress(d.life);
      const pct = Math.max(0, Math.min(1, cur / goal));
      return `
      <li class="ach ${on ? 'is-on' : ''}">
        <b>${on ? ICONS.check : ''}${esc(a.name)}</b><span>${esc(a.desc)}</span>
        ${on ? `<small>Unlocked ${fmtDate(d.unlocked[a.id])}</small>` : goal > 1 ? `<div class="ach-bar"><i style="transform:scaleX(${pct.toFixed(3)})"></i></div><small>${fmtInt(Math.floor(cur))} / ${fmtInt(goal)}</small>` : ''}
      </li>`;
    }).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head"><h2>Achievements</h2><span class="kicker">${got} / ${d.list.length} unlocked</span></header>
        <ul class="ach-grid">${items}</ul>
        <footer class="panel-foot"><button class="btn btn-small" data-action="menu" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }

  s_beandex(d) {
    const found = d.entries.filter((e) => d.dex[e.id]).length;
    const cards = d.entries.map((e) => {
      const rec = d.dex[e.id];
      const rar = RARITIES[e.rarity];
      const key = e.kind === 'common' ? e.key : rec ? rec.key : 'brown';
      const look = e.kind === 'common' ? 'plain' : VARIETY[e.variety].look;
      const img = d.sprites.portrait(key, look, !rec);
      if (!rec) {
        return `
        <li class="dex is-unknown">
          <div class="dex-img">${img ? `<img src="${img}" alt="">` : ''}</div>
          <b>${e.secret ? '?????' : '???'}</b>
          <span class="rar" style="--rc:${rar.color}">${rar.name}</span>
          <small>${e.kind === 'common' ? 'Sort one to record it' : 'Not yet discovered'}</small>
        </li>`;
      }
      return `
      <li class="dex rarity-${e.rarity}">
        <div class="dex-img">${img ? `<img src="${img}" alt="">` : ''}</div>
        <b>${esc(e.name)}</b>
        <span class="rar" style="--rc:${rar.color}">${rar.name}</span>
        <dl>
          <dt>Color</dt><dd>${esc(e.kind === 'common' ? COLORS[e.key].name : 'Varies')}</dd>
          <dt>Recorded</dt><dd>${fmtInt(rec.n)}</dd>
          <dt>First found</dt><dd>${fmtDate(rec.first)}</dd>
        </dl>
        ${e.desc ? `<small>${esc(e.desc)}</small>` : ''}
      </li>`;
    }).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head"><h2>Beandex</h2><span class="kicker">${found} / ${d.entries.length} recorded</span></header>
        <p class="lede">Every bean variety this workstation has encountered. Rare varieties are cosmetic and appear on their own. They still go in the container of their colour.</p>
        <ul class="dex-grid">${cards}</ul>
        <footer class="panel-foot"><button class="btn btn-small" data-action="menu" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }

  s_settings(d) {
    const s = d.settings;
    const sw = (key, label, note) => `
      <label class="switch row"><input type="checkbox" id="set-${key}" data-setting="${key}" ${s[key] ? 'checked' : ''}><span></span><em>${label}${note ? `<small>${note}</small>` : ''}</em></label>`;
    const range = (key, label, min, max, step, fmt) => `
      <label class="slider row" for="set-${key}"><em>${label}</em><input type="range" id="set-${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-setting="${key}" data-fmt="${fmt}"><output for="set-${key}">${fmt === 'pct' ? `${Math.round(s[key] * 100)}%` : s[key]}</output></label>`;
    const seg = (key, label, opts) => `
      <div class="row seg-row"><em>${label}</em><div class="seg" role="radiogroup" aria-label="${label}">
        ${opts.map(([v, t]) => `<label><input type="radio" name="set-${key}" value="${v}" data-setting="${key}" ${s[key] === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div></div>`;
    const envs = d.envs.map((e) => `
      <button class="env ${e.open ? '' : 'is-locked'} ${s.environment === e.id ? 'is-on' : ''}" data-action="${e.open ? 'env' : 'locked'}" data-env="${e.id}" ${e.open ? '' : 'aria-disabled="true"'}>
        <i class="env-sw env-${e.id}"></i><b>${esc(e.name)}</b><small>${e.open ? (s.environment === e.id ? 'In use' : 'Available') : esc(e.req)}</small>
      </button>`).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head"><h2>Settings</h2><span class="kicker">Saved on this device</span></header>
        <div class="settings-cols">
          <div class="settings">
            <h3 class="sub">Audio</h3>
            ${sw('sound', 'Sound')}
            ${range('masterVolume', 'Master volume', 0, 1, 0.05, 'pct')}
            ${range('sfxVolume', 'Effects volume', 0, 1, 0.05, 'pct')}
            <h3 class="sub">Feel</h3>
            ${d.haptics ? sw('haptics', 'Haptics', 'Vibration on pick-up, sorting and combos') : '<p class="note">Haptics are not available on this device.</p>'}
            ${sw('screenShake', 'Screen shake', 'Earthquakes and big moments')}
            ${sw('reducedMotion', 'Reduced motion', 'Shorter celebrations, no camera shake')}
            <h3 class="sub">Accessibility</h3>
            ${sw('colorAssist', 'Color symbols', 'Beans and containers get a matching symbol')}
            ${range('uiScale', 'Interface size', 0.8, 1.3, 0.05, 'pct')}
            ${sw('hints', 'Tips and memos')}
          </div>
          <div class="settings">
            <h3 class="sub">Graphics</h3>
            ${seg('particles', 'Particles', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
            ${sw('shadows', 'Bean shadows')}
            ${sw('performance', 'Performance mode', 'Lower resolution, no shadows, fewer particles')}
            ${sw('showFps', 'Show FPS counter', 'Also F2')}
            ${d.fullscreen ? '<button class="btn btn-small" data-action="fullscreen">Toggle fullscreen</button>' : ''}
            <h3 class="sub">Workstation</h3>
            <div class="env-grid">${envs}</div>
          </div>
        </div>
        <div class="danger">
          ${d.confirmReset
            ? `<p>Erase all progress, statistics, achievements and the Beandex on this device? This cannot be undone.</p><div class="menu-row"><button class="btn btn-small" data-action="settings">Keep everything</button><button class="btn btn-small btn-danger" data-action="reset-confirm">Erase save data</button></div>`
            : '<button class="btn btn-small btn-ghost" data-action="reset">Reset save data…</button>'}
        </div>
        <footer class="panel-foot"><button class="btn btn-small" data-action="${d.from === 'pause' ? 'pause-back' : 'menu'}" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }
}
