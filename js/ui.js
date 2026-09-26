// ---------------------------------------------------------------------------
// ui.js — everything made of DOM: HUD readouts, the container tray, menus,
// the shift report, pop-ups and toasts. Game logic never touches the DOM
// directly; it calls methods here. Buttons use data-action attributes and a
// single delegated click listener that forwards to game.onAction().
// ---------------------------------------------------------------------------

import { COLORS, LEVELS, RANKS, hazardsOf, challengeLimit } from './config.js';
import { ACHIEVEMENTS } from './achievements.js';
import { rgbCss, shade, fmtTime, fmtInt, fmtPct } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
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

export class UI {
  constructor(game) {
    this.game = game;
    this.hudCache = {};
    this.bins = new Map();
    this.binOrder = [];
    this.hoverKey = null;
    this.rectCache = null;

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      e.preventDefault();
      game.onAction(t.dataset.action, t.dataset, t);
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.setting) game.onSetting(t.dataset.setting, t.type === 'checkbox' ? t.checked : +t.value);
    });
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.setting && t.type === 'range') game.onSetting(t.dataset.setting, +t.value, true);
    });
    $('btn-pause').innerHTML = ICONS.pause;
    $('btn-fit').innerHTML = ICONS.fit;
    this.setMuted(false);
  }

  // --- HUD --------------------------------------------------------------
  showHud(on) { $('hud').hidden = !on; }
  showTray(on) { $('tray').hidden = !on; }
  hudHeight() { return $('hud').hidden ? 0 : $('hud').getBoundingClientRect().bottom; }
  trayHeight() { return $('tray').hidden ? 0 : window.innerHeight - $('tray').getBoundingClientRect().top; }

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

  /** Only touches the DOM when a value actually changed. */
  updateHud(d) {
    const c = this.hudCache;
    const set = (id, v) => { if (c[id] !== v) { c[id] = v; $(id).textContent = v; } };
    set('ro-remaining-k', d.remainingLabel);
    set('ro-remaining', d.remaining);
    set('ro-acc', d.accuracy);
    set('ro-streak', d.streak);
    set('ro-best', d.best);
    set('ro-time-k', d.timeLabel);
    set('ro-time', d.time);
    if (c.progress !== d.progress) {
      c.progress = d.progress;
      $('progress').style.transform = `scaleX(${d.progress})`;
    }
    const warn = !!d.warn;
    if (c.warn !== warn) { c.warn = warn; $('hud').classList.toggle('is-warn', warn); }
    const low = !!d.lowTime;
    if (c.low !== low) { c.low = low; $('ro-time').parentElement.classList.toggle('is-low', low); }
  }

  bumpStreak() {
    const el = $('ro-streak').parentElement;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
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
      <div class="bin-tape">${beanSwatch(b.key)}<span>${esc(COLORS[b.key].name)}</span></div>`;
    wrap.appendChild(el);
    this.bins.set(b.key, { el, fill: el.querySelector('.bin-fill'), count: el.querySelector('.bin-count'), total: b.total, sorted: b.sorted || 0 });
    if (!this.binOrder.includes(b.key)) this.binOrder.push(b.key);
    wrap.style.setProperty('--n', this.bins.size);
    this.setBinCount(b.key, b.sorted || 0);
    this.rectCache = null;
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
  overTray(y) { return !$('tray').hidden && y >= $('tray').getBoundingClientRect().top - 10; }

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
    b.t = setTimeout(() => b.el.classList.remove(cls), ok ? 350 : 700);
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
      setTimeout(() => { el.classList.remove('is-party'); void el.offsetWidth; el.classList.add('is-party'); }, i++ * 110);
    }
  }

  // --- Pop-ups ----------------------------------------------------------
  combo(text, n) {
    const box = $('combo');
    const el = document.createElement('div');
    el.className = 'combo-pop';
    el.innerHTML = `<b>${esc(text)}</b><span>${n} in a row</span>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  memo(text, kind = 'memo') {
    const box = $('memos');
    const el = document.createElement('div');
    el.className = `memo memo-${kind}`;
    const label = kind === 'alert' ? 'Notice' : kind === 'hint' ? 'Tip' : 'Memo';
    el.innerHTML = `<span class="memo-k">${label}</span><span class="memo-v">${esc(text)}</span>`;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'hint' ? 7000 : 4800);
  }

  achievement(a) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-k">Achievement unlocked</span><b>${esc(a.name)}</b><span class="toast-d">${esc(a.desc)}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
  }

  hint(text) {
    const el = $('hint');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
  }

  inspect(info, x, y) {
    const el = $('inspect');
    el.innerHTML = `
      <div class="insp-head"><span>Bean</span><b>#${info.id}</b></div>
      <dl>
        <dt>Color</dt><dd>${beanSwatch(info.key)} ${esc(info.name)}</dd>
        <dt>RGB</dt><dd class="mono">${info.rgb.join(', ')}</dd>
        <dt>Size</dt><dd>${esc(info.size)}</dd>
        <dt>Mass</dt><dd class="mono">${info.grams.toFixed(2)} g</dd>
        <dt>Status</dt><dd>${esc(info.status)}</dd>
        <dt>Notes</dt><dd class="insp-note">${esc(info.note)}</dd>
      </dl>`;
    el.hidden = false;
    const r = el.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    let left = x + 18, top = y - r.height - 14;
    if (left + r.width > W - 12) left = x - r.width - 18;
    if (left < 12) left = 12;
    if (top < this.hudHeight() + 8) top = y + 18;
    if (top + r.height > H - 12) top = H - r.height - 12;
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

  /** The big "final bean" title sequence. */
  finale(total, levelTitle) {
    const el = $('finale');
    el.innerHTML = `
      <div class="fin-line fin-1">The final bean</div>
      <div class="fin-line fin-2">has been sorted</div>
      <div class="fin-count">${fmtInt(total)} <small>/</small> ${fmtInt(total)}</div>
      <div class="fin-line fin-3">${esc(levelTitle)} · Shift complete</div>`;
    el.hidden = false;
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
    this.current = name;
    const first = $('screens').querySelector('[data-autofocus]');
    if (first) first.focus({ preventScroll: true });
  }

  s_menu(d) {
    const cont = d.run ? `<button class="btn btn-primary" data-action="continue" data-autofocus>Continue<small>Level ${d.run.levelId} · ${fmtInt(d.run.sorted)} / ${fmtInt(d.run.total)} sorted</small></button>` : '';
    const endless = d.endless
      ? `<button class="btn" data-action="endless">Endless mode</button>`
      : `<button class="btn is-locked" data-action="locked" aria-disabled="true">${ICONS.lock}Endless mode<small>Complete Level 5 to unlock</small></button>`;
    return `
    <section class="screen screen-menu">
      <div class="nameplate">
        <span class="screw tl"></span><span class="screw tr"></span><span class="screw bl"></span><span class="screw br"></span>
        <p class="np-kicker">Dept. of Legume Classification · Workstation</p>
        <h1 class="title">Bean Sorter <span>1000</span></h1>
        <p class="np-serial">Model BS-1000 · Serial No. 000483 · Rated for 1,000 beans</p>
        <div class="menu">
          ${cont}
          <button class="btn ${d.run ? '' : 'btn-primary'}" data-action="start" ${d.run ? '' : 'data-autofocus'}>Start<small>${d.startLabel}</small></button>
          <button class="btn" data-action="levels">Level select</button>
          ${endless}
          <div class="menu-row">
            <button class="btn btn-small" data-action="stats">Statistics</button>
            <button class="btn btn-small" data-action="settings">Settings</button>
          </div>
        </div>
        <p class="np-foot">${fmtInt(d.lifeSorted)} beans sorted at this station to date.</p>
      </div>
    </section>`;
  }

  s_levels(d) {
    const cards = LEVELS.map((L) => {
      const locked = L.id > d.unlocked;
      const best = d.best[L.id];
      const hz = hazardsOf(L);
      return `
      <button class="lvl ${locked ? 'is-locked' : ''}" data-action="${locked ? 'locked' : 'play'}" data-level="${L.id}" ${locked ? 'aria-disabled="true"' : ''}>
        <span class="lvl-n">${L.id}</span>
        <span class="lvl-body">
          <span class="lvl-title">${esc(L.title)}</span>
          <span class="lvl-meta">${fmtInt(L.count)} beans · ${L.colors.length} colors ${d.challenge ? `· ${fmtTime(challengeLimit(L.count))} limit` : ''}</span>
          <span class="lvl-sw">${L.colors.map(beanSwatch).join('')}</span>
          <span class="chips">${hz.length ? hz.map((h) => `<span class="chip">${esc(h)}</span>`).join('') : '<span class="chip chip-calm">No hazards</span>'}</span>
        </span>
        <span class="lvl-best">${locked ? `${ICONS.lock}<small>Locked</small>` : best ? `<b>${esc(best.rank)}</b><small>${fmtTime(best.time)} · ${fmtPct(best.accuracy)}</small>` : '<small>Not attempted</small>'}</span>
      </button>`;
    }).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head">
          <h2>Level select</h2>
          <label class="switch"><input type="checkbox" id="challenge" data-setting="challenge" ${d.challenge ? 'checked' : ''}><span></span>Challenge mode <small>(time limit)</small></label>
        </header>
        <div class="lvl-list">${cards}</div>
        <footer class="panel-foot"><button class="btn btn-small" data-action="menu" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }

  s_brief(d) {
    const L = d.level;
    const hz = hazardsOf(L);
    return `
    <section class="screen screen-brief">
      <div class="panel">
        <span class="screw tl"></span><span class="screw tr"></span>
        <p class="kicker">Shift briefing · Level ${L.id}${d.challenge ? ' · Challenge' : ''}</p>
        <h2 class="big">${esc(L.title)}</h2>
        <p class="lede">${esc(L.briefing)}</p>
        <div class="brief-grid">
          <div><span class="k">Beans</span><span class="v">${fmtInt(L.count)}</span></div>
          <div><span class="k">Colors</span><span class="v">${L.colors.length}</span></div>
          <div><span class="k">${d.challenge ? 'Time limit' : 'Hazards'}</span><span class="v">${d.challenge ? fmtTime(challengeLimit(L.count)) : hz.length}</span></div>
        </div>
        <div class="brief-colors">${L.colors.map((k) => `<span>${beanSwatch(k)}${esc(COLORS[k].name)}</span>`).join('')}</div>
        ${hz.length ? `<div class="chips">${hz.map((h) => `<span class="chip">${esc(h)}</span>`).join('')}</div>` : ''}
        <p class="controls-hint">${d.touch ? 'Drag beans with one finger. Pinch to zoom, two fingers to move. Long-press to inspect.' : 'Drag beans with the mouse. Wheel zooms, Space or middle-drag pans. Right-click inspects.'}</p>
        <footer class="panel-foot">
          <button class="btn btn-small" data-action="menu">Menu</button>
          <button class="btn btn-primary" data-action="begin" data-autofocus>${d.resume ? 'Resume shift' : 'Begin shift'}</button>
        </footer>
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
    const rows = d.mode === 'endless'
      ? [['Total beans', fmtInt(s.sorted)], ['Mistakes', fmtInt(s.mistakes)], ['Accuracy', fmtPct(s.accuracy)], ['Longest streak', fmtInt(s.longest)], ['Shift length', fmtTime(s.time)], ['Beans per minute', s.bpm.toFixed(1)]]
      : [['Beans sorted', `${fmtInt(s.sorted)} / ${fmtInt(s.total)}`], ['Mistakes', fmtInt(s.mistakes)], ['Accuracy', fmtPct(s.accuracy)], ['Longest combo', fmtInt(s.longest)], ['Completion time', s.complete ? fmtTime(s.time) : '—'], ['Beans per minute', s.bpm.toFixed(1)]];
    const comment = COMMENTS[s.rank.index][d.commentPick % 2];
    const title = d.mode === 'endless' ? 'Table overflow' : s.complete ? 'Shift complete' : 'Shift incomplete';
    const next = d.hasNext ? '<button class="btn btn-primary" data-action="next" data-autofocus>Next level</button>' : '';
    const again = d.mode === 'endless' ? '<button class="btn btn-primary" data-action="endless" data-autofocus>New shift</button>' : `<button class="btn ${next ? '' : 'btn-primary'}" data-action="retry" ${next ? '' : 'data-autofocus'}>Retry</button>`;
    return `
    <section class="screen screen-report">
      <div class="report">
        <header class="report-head">
          <span>Form LB-1000</span><span>Shift report</span><span>No. ${String(d.reportNo).padStart(6, '0')}</span>
        </header>
        <p class="kicker">${d.mode === 'endless' ? 'Endless mode' : `Level ${s.levelId} · ${esc(d.levelTitle)}`}${d.challenge ? ' · Challenge' : ''}</p>
        <h2 class="big">${title}</h2>
        <table class="report-rows"><tbody>
          ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
        </tbody></table>
        ${d.record ? `<p class="record">${esc(d.record)}</p>` : ''}
        <div class="report-rank">
          <span class="k">Classification</span>
          <div class="stamp" style="--rot:${d.stampRot}deg"><small>Rank ${s.rank.index + 1} of ${RANKS.length}</small>${esc(s.rank.name)}</div>
        </div>
        <p class="comment"><span>Supervisor's comment:</span> ${esc(comment)}</p>
        ${d.newAch.length ? `<div class="report-ach"><span class="k">Achievements unlocked</span>${d.newAch.map((a) => `<span class="chip chip-gold">${esc(a.name)}</span>`).join('')}</div>` : ''}
        ${d.unlockedEndless ? '<p class="record">Endless mode unlocked. The beans never stop now.</p>' : ''}
        <footer class="panel-foot">
          <button class="btn btn-small" data-action="menu">Menu</button>
          ${again}
          ${next}
        </footer>
      </div>
    </section>`;
  }

  s_stats(d) {
    const L = d.life;
    const acc = L.sorted + L.mistakes ? (L.sorted / (L.sorted + L.mistakes)) * 100 : 100;
    const rows = [
      ['Beans sorted', fmtInt(L.sorted)], ['Mistakes', fmtInt(L.mistakes)], ['Lifetime accuracy', fmtPct(acc)],
      ['Best streak', fmtInt(L.bestStreak)], ['Best pace', `${L.bestBpm.toFixed(1)} beans/min`], ['Time on shift', fmtTime(L.playTime)],
      ['Levels completed', `${L.levelsDone.length} / ${LEVELS.length}`], ['Perfect levels', fmtInt(L.perfectLevels)],
      ['Best endless shift', `${fmtInt(L.endlessBest)} beans`], ['Beans inspected', fmtInt(L.inspected)],
      ['Beans escaped', fmtInt(L.escapes)], ['Final beans sorted', fmtInt(L.finalBeans)],
    ];
    const got = ACHIEVEMENTS.filter((a) => d.achievements[a.id]).length;
    const ach = ACHIEVEMENTS.map((a) => {
      const on = !!d.achievements[a.id];
      return `<li class="ach ${on ? 'is-on' : ''}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></li>`;
    }).join('');
    const bests = LEVELS.map((lv) => {
      const b = d.best[lv.id];
      return `<tr><th>${lv.id}. ${esc(lv.title)}</th><td>${b ? esc(b.rank) : '—'}</td><td>${b ? fmtTime(b.time) : '—'}</td><td>${b ? fmtPct(b.accuracy) : '—'}</td></tr>`;
    }).join('');
    return `
    <section class="screen">
      <div class="panel panel-wide">
        <header class="panel-head"><h2>Statistics</h2><span class="kicker">Lifetime · this device</span></header>
        <div class="stats-grid">${rows.map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
        <h3 class="sub">Best results</h3>
        <div class="table-wrap"><table class="best-table"><thead><tr><th>Level</th><th>Rank</th><th>Time</th><th>Accuracy</th></tr></thead><tbody>${bests}</tbody></table></div>
        <h3 class="sub">Achievements <small>${got} / ${ACHIEVEMENTS.length}</small></h3>
        <ul class="ach-grid">${ach}</ul>
        <footer class="panel-foot"><button class="btn btn-small" data-action="menu" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }

  s_settings(d) {
    const s = d.settings;
    const sw = (key, label, note) => `
      <label class="switch row"><input type="checkbox" id="set-${key}" data-setting="${key}" ${s[key] ? 'checked' : ''}><span></span><em>${label}${note ? `<small>${note}</small>` : ''}</em></label>`;
    return `
    <section class="screen">
      <div class="panel panel-narrow">
        <header class="panel-head"><h2>Settings</h2></header>
        <div class="settings">
          ${sw('sound', 'Sound effects')}
          <label class="slider row" for="set-volume"><em>Volume</em><input type="range" id="set-volume" min="0" max="1" step="0.05" value="${s.volume}" data-setting="volume"></label>
          ${sw('screenShake', 'Screen shake', 'When the table shakes')}
          ${sw('reducedMotion', 'Reduced motion', 'Shorter celebrations, no camera shake')}
          ${sw('hints', 'Tips and memos')}
        </div>
        <div class="danger">
          ${d.confirmReset
            ? `<p>Erase all progress, statistics and achievements on this device?</p><div class="menu-row"><button class="btn btn-small" data-action="settings">Keep them</button><button class="btn btn-small btn-danger" data-action="reset-confirm">Erase everything</button></div>`
            : '<button class="btn btn-small btn-ghost" data-action="reset">Reset progress…</button>'}
        </div>
        <footer class="panel-foot"><button class="btn btn-small" data-action="${d.from === 'pause' ? 'pause-back' : 'menu'}" data-autofocus>Back</button></footer>
      </div>
    </section>`;
  }
}
