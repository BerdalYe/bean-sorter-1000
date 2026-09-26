// ---------------------------------------------------------------------------
// game.js — the controller. Owns the state machine and connects
// input → world → session → UI / audio / effects / saving.
//
// States:  menu → brief → play ⇄ pause → celebrate → results
//          (endless: menu → play ⇄ pause → results)
// ---------------------------------------------------------------------------

import { LEVELS, COLORS, ENDLESS, MEMOS, SLIP_LINES, challengeLimit } from './config.js';
import { SpriteBank } from './beans.js';
import { World } from './world.js';
import { wake } from './physics.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Fx } from './fx.js';
import { Sfx } from './audio.js';
import { Session } from './session.js';
import { UI } from './ui.js';
import { newlyUnlocked } from './achievements.js';
import { load, save, defaults } from './storage.js';
import { clamp, lerp, easeOutCubic, easeInOutCubic, fmtTime, fmtInt, fmtPct, rgbCss, shade, TAU } from './util.js';

const SAVE_EVERY = 6;

export class Game {
  constructor(worldCanvas, fxCanvas) {
    this.data = load();
    this.sprites = new SpriteBank();
    this.world = new World(this.sprites);
    this.camera = new Camera();
    this.fx = new Fx();
    this.sfx = new Sfx();
    this.sfx.enabled = this.data.settings.sound;
    this.sfx.volume = this.data.settings.volume;
    this.renderer = new Renderer(worldCanvas, fxCanvas, this.sprites);
    this.ui = new UI(this);
    this.ui.setMuted(!this.data.settings.sound);
    this.touch = matchMedia('(pointer: coarse)').matches;

    this.state = 'menu';
    this.session = null;
    this.level = null;
    this.held = null;
    this.flights = [];
    this.pointer = { x: -1, y: -1 };
    this.challenge = false;
    this.saveTimer = SAVE_EVERY;
    this.memoTimer = 50;
    this.timeScale = 1;
    this.time = 0;
    this.endless = null;
    this.pendingAch = [];
    this.newAchThisShift = [];
    this.hoverBean = null;
    this.reportNo = 1 + Math.floor(Math.random() * 90000);
    // Adaptive quality: 2 = full, 1 = 1× resolution, 0 = also no bean shadows.
    this.quality = 2;
    this.perf = { ema: 1 / 60, slow: 0 };

    this.input = new Input(worldCanvas, {
      userGesture: () => this.sfx.unlock(),
      grab: (x, y, t) => this.grab(x, y, t),
      drag: (x, y) => this.drag(x, y),
      release: (x, y) => this.release(x, y),
      cancelGrab: () => this.cancelGrab(),
      inspect: (x, y) => this.inspect(x, y),
      longPress: (x, y) => this.longPress(x, y),
      pan: (dx, dy) => { this.camera.pan(dx, dy); this.ui.hideInspect(); },
      zoom: (f, x, y) => { this.camera.zoomAt(x, y, f); this.ui.hideInspect(); },
      hover: (x, y) => this.hover(x, y),
      isHovering: () => !!this.hoverBean,
      key: (e) => this.key(e),
      tap: () => this.ui.hideInspect(),
    });
    // Unlock audio on any first interaction with the menus too.
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.sfx.unlock(), { capture: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'play') this.pause();
        this.persist();
      }
    });
    window.addEventListener('pagehide', () => this.persist());
    this.applyMotionPref();

    // Debug handle for automated tests. Harmless in normal play.
    window.__beanSorter = this;
  }

  get settings() { return this.data.settings; }
  get life() { return this.data.life; }

  applyMotionPref() {
    document.documentElement.classList.toggle('reduced-motion', !!this.settings.reducedMotion);
  }

  // =====================================================================
  // Layout
  // =====================================================================
  resize(keepView = false) {
    const w = window.innerWidth, h = window.innerHeight;
    // Small viewport changes mid-shift (mobile URL bar, fonts loading) keep
    // the player's zoom; big ones (rotation, window resize) refit the table.
    const pw = this.lastW || w, ph = this.lastH || h;
    if (this.state === 'play' && Math.abs(w - pw) / pw < 0.2 && Math.abs(h - ph) / ph < 0.2) keepView = true;
    this.lastW = w; this.lastH = h;
    const dpr = this.quality >= 2 ? Math.min(2, window.devicePixelRatio || 1) : 1;
    this.renderer.resize(w, h, dpr);
    this.ui.invalidateRects();
    const root = document.documentElement.style;
    root.setProperty('--hud-h', `${Math.round(this.ui.hudHeight())}px`);
    root.setProperty('--tray-h', `${Math.round(this.ui.trayHeight())}px`);
    this.camera.setViewport(w, h, this.ui.hudHeight(), this.ui.trayHeight());
    if (!keepView) this.fitCamera();
  }

  /** On portrait screens the table is turned sideways so it fills the view. */
  tableFor([w, h]) {
    return window.innerHeight > window.innerWidth * 1.15 ? [h, w] : [w, h];
  }

  fitRect() {
    const r = this.world.rect;
    const top = this.world.belt ? 76 : 18;
    return { x: r.x - 18, y: r.y - top, w: r.w + 36, h: r.h + top + 18 };
  }

  fitCamera() {
    if (!this.world.rect) return;
    this.camera.setViewport(window.innerWidth, window.innerHeight, this.ui.hudHeight(), this.ui.trayHeight());
    this.camera.fit(this.fitRect(), this.touch ? 6 : 20);
  }

  // =====================================================================
  // Screens / menu flow
  // =====================================================================
  showMenu() {
    this.state = 'menu';
    this.input.setEnabled(false);
    this.ui.showHud(false);
    this.ui.showTray(false);
    this.ui.hint(null);
    this.ui.hideInspect();
    this.ui.hideFinale();
    this.setupAttract();
    const run = this.data.run;
    const next = Math.min(this.data.progress.unlocked, LEVELS.length);
    this.ui.screen('menu', {
      run: run ? { levelId: run.levelId, sorted: run.session.sorted, total: run.session.total } : null,
      endless: this.data.progress.endless,
      startLabel: `Level ${next} · ${LEVELS[next - 1].title}`,
      lifeSorted: this.life.sorted,
    });
  }

  /** A calm table of beans behind the main menu. */
  setupAttract() {
    this.world.setup({ seed: 1000 + Math.floor(Math.random() * 1e6), count: 160, colors: ['red', 'blue', 'yellow', 'green', 'purple', 'white'], table: this.tableFor([980, 620]), mods: {} });
    this.session = null;
    this.flights = [];
    this.held = null;
    this.resize();
    this.fitCamera();
  }

  levelScreenData() {
    return { unlocked: this.data.progress.unlocked, best: this.bestMap(), challenge: this.challenge };
  }

  bestMap() {
    const out = {};
    for (const [id, v] of Object.entries(this.data.progress.levels)) if (v.best) out[id] = v.best;
    return out;
  }

  onAction(action, ds) {
    this.sfx.click();
    switch (action) {
      case 'menu':
        if (this.state === 'play' || this.state === 'pause' || this.state === 'brief') this.saveRun();
        this.showMenu();
        break;
      case 'start': {
        const next = Math.min(this.data.progress.unlocked, LEVELS.length);
        this.startLevel(next, { challenge: false });
        break;
      }
      case 'continue': this.resumeRun(); break;
      case 'levels': this.ui.screen('levels', this.levelScreenData()); break;
      case 'play': this.startLevel(+ds.level, { challenge: this.challenge }); break;
      case 'endless': this.startEndless(); break;
      case 'stats':
        this.ui.screen('stats', { life: this.life, achievements: this.data.achievements, best: this.bestMap() });
        break;
      case 'settings':
        this.settingsFrom = ds.from || (this.state === 'pause' ? 'pause' : 'menu');
        this.ui.screen('settings', { settings: this.settings, from: this.settingsFrom });
        break;
      case 'pause-back': this.ui.screen('pause', this.pauseData()); break;
      case 'reset': this.ui.screen('settings', { settings: this.settings, from: this.settingsFrom, confirmReset: true }); break;
      case 'reset-confirm':
        this.data = defaults();
        this.persist();
        this.sfx.setEnabled(true); this.sfx.setVolume(0.7);
        this.ui.setMuted(false);
        this.applyMotionPref();
        this.showMenu();
        break;
      case 'begin': this.beginShift(); break;
      case 'resume': this.resume(); break;
      case 'restart': this.startLevel(this.level.id, { challenge: this.session.challenge }); break;
      case 'quit':
        if (this.session && this.session.mode === 'endless') { this.endEndless(); break; }
        this.saveRun();
        this.showMenu();
        break;
      case 'retry': this.startLevel(this.level.id, { challenge: this.session.challenge }); break;
      case 'next': this.startLevel(Math.min(LEVELS.length, this.level.id + 1), { challenge: this.session.challenge }); break;
      case 'pause': if (this.state === 'play') this.pause(); break;
      case 'mute': this.onSetting('sound', !this.settings.sound); break;
      case 'fit': this.fitCamera(); break;
      case 'locked': break;
      default: break;
    }
  }

  onSetting(key, value, live) {
    if (key === 'challenge') {
      this.challenge = !!value;
      this.ui.screen('levels', this.levelScreenData());
      return;
    }
    this.settings[key] = value;
    if (key === 'sound') { this.sfx.setEnabled(!!value); this.ui.setMuted(!value); const el = document.getElementById('set-sound'); if (el) el.checked = !!value; }
    if (key === 'volume') this.sfx.setVolume(value);
    if (key === 'reducedMotion') this.applyMotionPref();
    if (!live) this.persist();
  }

  // =====================================================================
  // Starting shifts
  // =====================================================================
  startLevel(id, { challenge = false, resume = null } = {}) {
    const L = LEVELS[id - 1];
    this.level = L;
    this.clearTransient();
    const seed = resume ? resume.seed : Math.floor(Math.random() * 2 ** 31);
    this.seed = seed;
    this.world.setup({ seed, count: L.count, colors: L.colors, table: this.tableFor(L.table), mods: L.mods });
    this.session = resume
      ? Session.from(resume.session)
      : new Session({ mode: 'level', levelId: id, total: L.count, challenge, limit: challengeLimit(L.count) });
    if (resume) this.world.restore(resume.beans);

    const perColor = {};
    for (const b of this.world.beans) {
      perColor[b.key] = perColor[b.key] || { total: 0, sorted: 0 };
      perColor[b.key].total++;
      if (b.state === 'sorted') perColor[b.key].sorted++;
    }
    this.ui.buildBins(L.colors.map((k) => ({ key: k, total: perColor[k].total, sorted: perColor[k].sorted })));
    if (resume && resume.binOrder) {
      this.ui.binOrder = resume.binOrder.filter((k) => this.ui.bins.has(k));
      this.ui.binOrder.forEach((k, i) => { this.ui.bins.get(k).el.style.order = i; });
    }
    this.ui.setPlate(`Level ${L.id}`, L.title);
    this.ui.showHud(true);
    this.ui.showTray(true);
    this.ui.hint(null);
    this.resize();
    this.fitCamera();
    this.updateHud(true);
    this.state = 'brief';
    this.input.setEnabled(false);
    this.ui.screen('brief', { level: L, challenge: this.session.challenge, touch: this.touch, resume: !!resume });
  }

  resumeRun() {
    const run = this.data.run;
    if (!run) return this.showMenu();
    this.startLevel(run.levelId, { challenge: run.session.challenge, resume: run });
  }

  beginShift() {
    this.ui.closeScreen();
    this.state = 'play';
    this.input.setEnabled(true);
    this.memoTimer = 40 + Math.random() * 30;
    this.newAchThisShift = [];
    const L = this.level;
    if (this.session.mode === 'level' && this.settings.hints) {
      if (L.id === 1 && this.session.sorted === 0) this.ui.hint('Drag a bean into the container with the matching label.');
      if (L.id === 4) this.ui.memo(this.touch ? 'Long-press a bean to inspect its exact color.' : 'Right-click a bean to inspect its exact color.', 'hint');
      if (L.id === 5) this.ui.memo('Zoom in for a closer look. The containers show a reference bean.', 'hint');
    }
    if (this.world.belt) this.ui.memo('Intake belt running.', 'alert');
  }

  startEndless() {
    this.level = null;
    this.clearTransient();
    const E = ENDLESS;
    const colors = E.colorPool.slice(0, E.startColors);
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.world.setup({ seed: this.seed, count: E.initial, colors, table: this.tableFor(E.table), mods: { sizes: { tiny: 0.08, huge: 0.05 } }, endless: true });
    // All initial beans go on the table; the belt feeds the rest.
    this.world.mods.conveyor = { initial: E.initial, interval: E.startInterval };
    this.world.setupModifiers(true);
    this.session = new Session({ mode: 'endless', total: 0 });
    this.endless = { t: 0, colors: colors.slice(), nextColor: E.addColorEvery, over: 0, stage: 0, interval: E.startInterval };
    this.ui.buildBins(colors.map((k) => ({ key: k, total: null })));
    this.ui.setPlate('Endless', 'Overtime');
    this.ui.showHud(true);
    this.ui.showTray(true);
    this.ui.hint(null);
    this.resize();
    this.fitCamera();
    this.updateHud(true);
    this.ui.closeScreen();
    this.state = 'play';
    this.input.setEnabled(true);
    this.memoTimer = 40;
    this.newAchThisShift = [];
    this.ui.memo(`Keep the table under ${ENDLESS.capacity} beans. The belt speeds up.`, 'hint');
  }

  clearTransient() {
    this.flights = [];
    this.held = null;
    this.fx.p = [];
    this.timeScale = 1;
    this.endless = null;
    this.ui.hideFinale();
    this.ui.hideInspect();
    this.input.reset();
  }

  pauseData() {
    return { mode: this.session ? this.session.mode : 'level', line: MEMOS[Math.floor(Math.random() * MEMOS.length)] };
  }

  pause() {
    if (this.state !== 'play') return;
    if (this.held) this.cancelGrab();
    this.input.reset();
    this.state = 'pause';
    this.input.setEnabled(false);
    this.ui.hideInspect();
    this.saveRun();
    this.ui.screen('pause', this.pauseData());
  }

  resume() {
    this.ui.closeScreen();
    this.state = 'play';
    this.input.setEnabled(true);
  }

  // =====================================================================
  // Hand: grab / drag / release
  // =====================================================================
  grab(sx, sy, type) {
    if (this.state !== 'play' || this.held) return false;
    this.ui.hideInspect();
    const cam = this.camera;
    const slop = Math.min(26, (type === 'mouse' ? 3 : 14) / cam.zoom);
    const b = this.world.pick(cam.toWorldX(sx), cam.toWorldY(sy), slop);
    if (!b) return false;

    const fromBelt = b.state === 'belt';
    if (fromBelt) this.life.beltGrabs++;
    this.life.pickups++;
    const bx = cam.toScreenX(b.x), by = cam.toScreenY(b.y - b.zf * 1.3);
    b.state = 'held';
    b.z = 0; b.zf = 0;
    // Wake anything that was resting on or next to it.
    this.world.physics.near(b.x, b.y, (j) => { const o = this.world.beans[j]; if (o.state === 'table') wake(o); });

    this.held = {
      bean: b, x: bx, y: by, vx: 0, vy: 0,
      px: sx, py: sy,
      // Offset between finger and bean eases toward a small "above the
      // finger" position on touch so your thumb doesn't hide the bean.
      ox: bx - sx, oy: by - sy,
      tox: 0, toy: type === 'mouse' ? 0 : -34,
      a0: b.a, lift: 0, age: 0, type,
      wx0: b.x, wy0: b.y, fromBelt,       // where it was picked up from
    };
    this.pointer.x = sx; this.pointer.y = sy;
    this.sfx.pickup();

    // Rarely, a bean simply refuses to be picked up.
    if (this.session.sorted > 20 && Math.random() < 0.006) {
      this.held.vx = (Math.random() - 0.5) * 900;
      this.held.vy = -300 - Math.random() * 300;
      this.slip();
      return true;
    }
    return true;
  }

  drag(sx, sy) {
    if (!this.held) return;
    this.held.px = sx; this.held.py = sy;
    this.pointer.x = sx; this.pointer.y = sy;
    this.ui.binHover(this.ui.binAt(sx, sy));
  }

  release(sx, sy) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    this.ui.binHover(null);
    const key = this.ui.binAt(sx, sy) || this.ui.binAt(h.x, h.y, 0);
    if (key) { this.sortInto(h, key); return; }

    // Thrown back onto the table, keeping some of the hand's momentum.
    const cam = this.camera, b = h.bean;
    b.x = cam.toWorldX(h.x); b.y = cam.toWorldY(h.y);
    const k = 0.9 / cam.zoom;
    const vx = clamp(h.vx * k, -700, 700), vy = clamp(h.vy * k, -700, 700);
    this.world.place(b, vx, vy);
    b.va += clamp(h.vx * 0.002, -4, 4);
    this.sfx.drop();
  }

  /** Put the bean down right where it is (pinch started, menu opened...). */
  cancelGrab() {
    const h = this.held;
    if (!h) return;
    this.held = null;
    this.ui.binHover(null);
    const cam = this.camera, b = h.bean;
    b.x = cam.toWorldX(h.x); b.y = cam.toWorldY(h.y);
    this.world.place(b, 0, 0);
  }

  /** The bean squirts out of your hand. */
  slip() {
    const h = this.held;
    if (!h) return;
    this.held = null;
    this.input.reset();
    this.ui.binHover(null);
    const cam = this.camera, b = h.bean;
    b.x = cam.toWorldX(h.x); b.y = cam.toWorldY(h.y);
    const k = 0.7 / cam.zoom;
    this.world.place(b, clamp(h.vx * k, -800, 800), clamp(h.vy * k, -800, 800));
    b.va += (Math.random() - 0.5) * 20;
    b.zf = 3;
    this.session.escapes++;
    this.life.escapes++;
    this.sfx.slip();
    this.fx.text(h.x, h.y - 24, SLIP_LINES[Math.floor(Math.random() * SLIP_LINES.length)], '#ffe9a8', 15);
    this.checkAchievements();
  }

  /** Spring the held bean toward the pointer: gives it weight and inertia. */
  updateHeld(dt) {
    const h = this.held;
    if (!h) return;
    h.age += dt;
    const ease = Math.min(1, dt * 10);
    h.ox = lerp(h.ox, h.tox, ease);
    h.oy = lerp(h.oy, h.toy, ease);
    const tx = h.px + h.ox, ty = h.py + h.oy;
    const K = 560, C = 2 * Math.sqrt(K) * 0.7;
    const n = 3, sdt = dt / n;
    for (let i = 0; i < n; i++) {
      const ax = K * (tx - h.x) - C * h.vx;
      const ay = K * (ty - h.y) - C * h.vy;
      h.vx += ax * sdt; h.vy += ay * sdt;
      h.x += h.vx * sdt; h.y += h.vy * sdt;
    }
    // Dangle: tilt a little with horizontal motion.
    const target = h.a0 + clamp(h.vx * 0.0012, -0.55, 0.55);
    h.bean.a += (target - h.bean.a) * Math.min(1, dt * 9);
    h.lift = Math.min(1, h.lift + dt * 7);

    // Edge-of-screen auto pan while carrying a bean.
    const cam = this.camera, m = 48, sp = 520 * dt;
    let px = 0, py = 0;
    if (h.px < m) px = sp * (1 - h.px / m);
    else if (h.px > cam.w - m) px = -sp * (1 - (cam.w - h.px) / m);
    if (h.py < cam.top + m && h.py > cam.top - 10) py = sp * (1 - (h.py - cam.top) / m);
    if (px || py) cam.pan(px, py);

    // Occasionally a violently flung bean escapes (never over the tray).
    const speed = Math.hypot(h.vx, h.vy);
    if (speed > 2600 && h.age > 0.2 && !this.ui.overTray(h.py) && this.session.sorted > 10 && Math.random() < 0.012) this.slip();
  }

  // =====================================================================
  // Sorting
  // =====================================================================
  sortInto(h, key) {
    const b = h.bean;
    const ok = key === b.key;
    const c = this.ui.binCenter(key);
    b.state = 'flying';
    b.flyOk = ok;
    this.flights.push({ bean: b, kind: ok ? 'in' : 'bounce', t: 0, dur: ok ? 0.26 : 0.2, fx: h.x, fy: h.y, tx: c.x, ty: c.y, key, lift: h.lift });
    const s = this.session;

    if (ok) {
      const ms = s.correct();
      this.life.sorted++;
      if (s.streak > this.life.bestStreak) this.life.bestStreak = s.streak;
      this.sfx.correct(s.streak);
      if (s.streak > 1) this.ui.bumpStreak();
      if (ms) { this.ui.combo(ms.text, ms.n); this.sfx.milestone(); }
      if (this.level && this.level.id === 1 && s.sorted === 1) this.ui.hint(null);
      const bin = this.ui.bins.get(key);
      this.ui.setBinCount(key, bin.sorted + 1);
    } else {
      s.wrong();
      this.life.mistakes++;
      this.sfx.wrong();
      this.ui.binFeedback(key, false);
    }
    this.checkAchievements();
  }

  updateFlights(dt) {
    const cam = this.camera;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      if (k < 1) continue;
      if (f.kind === 'in') {
        f.bean.state = 'sorted';
        this.flights.splice(i, 1);
        this.fx.sparks(f.tx, f.ty, this.sprites.rgbOf(f.bean.key, f.bean.variant), this.settings.reducedMotion ? 6 : 14);
        this.ui.binFeedback(f.key, true);
      } else if (f.kind === 'bounce') {
        // Reached the container mouth: rejected. Toss it back onto the table.
        const r = this.world.rect;
        const wx = clamp(cam.toWorldX(f.tx) + (Math.random() - 0.5) * 80, r.x + 30, r.x + r.w - 30);
        const wy = clamp(r.y + r.h - 50 - Math.random() * Math.min(160, r.h * 0.3), r.y + 30, r.y + r.h - 30);
        this.flights[i] = { bean: f.bean, kind: 'reject', t: 0, dur: 0.62, fx: f.tx, fy: f.ty, wx, wy, lift: 1.4 };
        this.fx.text(f.tx, f.ty - 34, 'WRONG CONTAINER', '#ffb4a1', 14);
      } else if (f.kind === 'reject') {
        const b = f.bean;
        b.x = f.wx; b.y = f.wy;
        this.flights.splice(i, 1);
        this.world.place(b, (Math.random() - 0.5) * 50, -40 - Math.random() * 40);
        b.va += (Math.random() - 0.5) * 6;
        b.zf = 2;
        this.sfx.drop();
      }
    }
  }

  // =====================================================================
  // Inspecting and hovering
  // =====================================================================
  inspect(sx, sy) {
    if (this.state !== 'play') return;
    const cam = this.camera;
    const b = this.world.pick(cam.toWorldX(sx), cam.toWorldY(sy), 10 / cam.zoom);
    if (!b) { this.ui.hideInspect(); return; }
    this.showInspect(b, sx, sy);
  }

  showInspect(b, sx, sy) {
    this.session.inspected++;
    this.life.inspected++;
    const sizes = { tiny: 'Tiny', normal: 'Standard', huge: 'Huge' };
    this.ui.inspect({
      id: b.id, key: b.key, name: COLORS[b.key].name, rgb: this.sprites.rgbOf(b.key, b.variant),
      size: sizes[b.sizeClass], grams: b.grams, note: b.note,
      status: b.state === 'belt' ? 'On conveyor' : b.z > 0 ? 'Unsorted (piled)' : 'Unsorted',
    }, sx, sy);
    this.sfx.click();
    this.checkAchievements();
  }

  /** Touch long-press: return the bean to exactly where it was, then inspect it. */
  longPress(x, y) {
    const h = this.held;
    if (!h) { this.inspect(x, y); return; }
    this.held = null;
    this.ui.binHover(null);
    const b = h.bean;
    b.x = h.wx0; b.y = h.wy0; b.a = h.a0;
    if (h.fromBelt) { b.state = 'belt'; b.z = b.zf = 0; } else this.world.place(b, 0, 0);
    this.showInspect(b, x, y);
  }

  hover(x, y) {
    this.pointer.x = x; this.pointer.y = y;
    if (this.state !== 'play') { this.hoverBean = null; return; }
    const cam = this.camera;
    this.hoverBean = this.world.pick(cam.toWorldX(x), cam.toWorldY(y), 3 / cam.zoom);
  }

  key(e) {
    const k = e.key;
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (this.state === 'play') this.pause();
      else if (this.state === 'pause' && this.ui.current === 'pause') this.resume();
    } else if (k === 'm' || k === 'M') {
      this.onSetting('sound', !this.settings.sound);
    } else if (this.state === 'play') {
      if (k === '0' || k === 'Home') this.fitCamera();
      else if (k === '+' || k === '=') this.camera.zoomAt(this.camera.w / 2, this.camera.cy, 1.2);
      else if (k === '-' || k === '_') this.camera.zoomAt(this.camera.w / 2, this.camera.cy, 1 / 1.2);
      else if ((k === 'i' || k === 'I') && this.input.mouse.inside) this.inspect(this.input.mouse.x, this.input.mouse.y);
    }
  }

  // =====================================================================
  // World events → notices and sounds
  // =====================================================================
  handleWorldEvents() {
    const ev = this.world.events;
    if (!ev.length) return;
    const playing = this.state === 'play';
    for (const e of ev) {
      if (!playing) continue;
      switch (e.type) {
        case 'impacts': this.sfx.impact(); break;
        case 'shake':
          this.sfx.shake();
          if (this.settings.screenShake && !this.settings.reducedMotion) this.camera.shake(9, 0.7);
          this.notice(`Seismic event: ${(Math.random() * 0.4 + 0.1).toFixed(1)} on the Bean Scale.`);
          break;
        case 'fan':
          this.sfx.fan(e.on);
          if (e.on) this.notice(pick(['Fan activated. Someone was warm.', 'The fan is on. It is a morale initiative.', 'Airflow detected.']));
          break;
        case 'tilt':
          if (e.on) this.notice('The table is no longer level.');
          else this.notice('Table re-levelled. For now.');
          break;
        case 'shuffle': this.shuffleBins(); break;
        default: break;
      }
    }
    ev.length = 0;
  }

  notice(text) {
    if (this.settings.hints) this.ui.memo(text, 'alert');
    this.sfx.notice();
  }

  shuffleBins() {
    const order = this.ui.binOrder;
    if (order.length < 2) return;
    const i = Math.floor(Math.random() * (order.length - 1));
    this.ui.swapBins(order[i], order[i + 1]);
    this.notice(`Container relocation: ${COLORS[order[i]].name} and ${COLORS[order[i + 1]].name} swapped places.`);
  }

  // =====================================================================
  // Endless mode
  // =====================================================================
  updateEndless(dt) {
    const E = ENDLESS, st = this.endless, w = this.world;
    st.t += dt;
    st.interval = Math.max(E.minInterval, E.startInterval * Math.pow(1 - E.intervalDecay, st.t / 10));

    // Keep a couple of beans queued for the belt.
    let queued = 0;
    for (const b of w.beans) if (b.state === 'queued') queued++;
    while (queued < 3) { w.enqueue(st.colors[Math.floor(Math.random() * st.colors.length)]); queued++; }

    // New bean varieties over time.
    if (st.t >= st.nextColor && st.colors.length < E.colorPool.length) {
      const k = E.colorPool[st.colors.length];
      st.colors.push(k);
      st.nextColor += E.addColorEvery;
      this.sprites.ensure(k);
      this.ui.appendBin({ key: k, total: null });
      this.resizeKeepView();
      this.notice(`New bean variety approved: ${COLORS[k].name}.`);
    }

    // Chaos ramps up.
    const stages = [
      [100, () => { w.mods.fan = { interval: [22, 34], duration: [5, 8], strength: 75 }; w.fan = { x: w.rect.x - 70, y: 0, angle: 0, base: 0, on: false, timer: 3, blade: 0, spin: 0, cfg: w.mods.fan }; }],
      [200, () => { w.mods.shake = { interval: [18, 28], strength: 100 }; w.shakeTimer = 6; }],
      [320, () => { w.mods.tilt = { strength: 15 }; w.tilt.timer = 5; }],
      [440, () => { w.mods.shuffle = { interval: [30, 45] }; w.shuffleTimer = 8; }],
      [560, () => { w.darkness = 0.5; }],
    ];
    if (st.stage < stages.length && st.t >= stages[st.stage][0]) { stages[st.stage][1](); st.stage++; }

    // Overflow check.
    let onTable = 0;
    for (const b of w.beans) if (b.state === 'table') onTable++;
    st.onTable = onTable;
    if (onTable > E.capacity) {
      st.over += dt;
      if (st.over > E.overflowGrace) { this.endEndless(); return; }
    } else st.over = Math.max(0, st.over - dt * 0.5);

    // Drop sorted beans from the array now and then so it stays small.
    if (this.session.sorted - (st.compactedAt || 0) >= 150 && !this.flights.length) { st.compactedAt = this.session.sorted; w.compact(); }
  }

  resizeKeepView() {
    this.ui.invalidateRects();
    requestAnimationFrame(() => {
      this.camera.setViewport(window.innerWidth, window.innerHeight, this.ui.hudHeight(), this.ui.trayHeight());
      this.ui.invalidateRects();
    });
  }

  endEndless() {
    const s = this.session;
    s.done = true;
    this.input.setEnabled(false);
    this.held = null;
    const sum = s.summary();
    this.life.endlessRuns++;
    const prev = this.life.endlessBest;
    if (sum.sorted > prev) this.life.endlessBest = sum.sorted;
    if (s.bestStreak > this.life.bestStreak) this.life.bestStreak = s.bestStreak;
    this.checkAchievements();
    this.persist();
    this.state = 'results';
    this.sfx.wrong();
    this.showResults(sum, sum.sorted > prev && prev > 0 ? `New personal best. Previous: ${fmtInt(prev)} beans.` : '');
  }

  // =====================================================================
  // Finishing a level
  // =====================================================================
  celebrate() {
    this.state = 'celebrate';
    this.session.done = true;
    this.input.setEnabled(false);
    this.held = null;
    this.ui.hint(null);
    const reduced = this.settings.reducedMotion;
    this.celebT = 0;
    this.celebDur = reduced ? 2.2 : 6.2;
    this.timeScale = reduced ? 1 : 0.25;
    this.sfx.finale();
    this.ui.flash();
    this.ui.finale(this.session.total, this.level.title);
    this.ui.celebrateBins();
    this.life.finalBeans++;
    const W = window.innerWidth;
    const pal = this.level.colors.map((k) => rgbCss(shade(COLORS[k].rgb, 0.1))).concat(['#ffffff', '#f2c230', '#e0531a']);
    this.fx.confetti(W, reduced ? 60 : 220, pal);
    if (!reduced) {
      this.fx.beanRain(W, this.level.id === 5 ? 160 : 70, this.level.colors);
      this.fireworkTimes = [1.1, 1.5, 1.9, 2.4, 2.8, 3.3, 3.9, 4.4];
    } else this.fireworkTimes = [];
  }

  updateCelebration(dt) {
    this.celebT += dt;
    this.timeScale = Math.min(1, this.timeScale + dt * 0.6);
    while (this.fireworkTimes.length && this.celebT >= this.fireworkTimes[0]) {
      this.fireworkTimes.shift();
      const k = this.level.colors[Math.floor(Math.random() * this.level.colors.length)];
      this.fx.firework(window.innerWidth * (0.15 + Math.random() * 0.7), window.innerHeight * (0.15 + Math.random() * 0.35), shade(COLORS[k].rgb, 0.25));
    }
    // Slow dramatic zoom-out.
    if (!this.settings.reducedMotion) this.camera.zoom *= Math.pow(0.985, dt * 10);
    if (this.celebT >= this.celebDur) this.finishLevel(true);
  }

  finishLevel(complete) {
    const s = this.session, L = this.level;
    s.done = true;
    this.ui.hideFinale();
    this.input.setEnabled(false);
    this.held = null;
    const sum = s.summary();
    const prog = this.data.progress;
    let record = '';
    let unlockedEndless = false;
    if (complete) {
      const lv = prog.levels[L.id] || (prog.levels[L.id] = {});
      const prev = lv.best;
      const mine = { rank: sum.rank.name, rankIndex: sum.rank.index, time: sum.time, accuracy: sum.accuracy, bpm: sum.bpm };
      if (!prev || mine.rankIndex > prev.rankIndex || (mine.rankIndex === prev.rankIndex && mine.time < prev.time)) {
        lv.best = mine;
        if (prev) record = `New best result. Previous: ${prev.rank}, ${fmtTime(prev.time)}.`;
      }
      lv.completed = true;
      if (L.id < LEVELS.length) prog.unlocked = Math.max(prog.unlocked, L.id + 1);
      if (L.id === LEVELS.length && !prog.endless) { prog.endless = true; unlockedEndless = true; }
      if (!this.life.levelsDone.includes(L.id)) this.life.levelsDone.push(L.id);
      if (sum.perfect) this.life.perfectLevels++;
      if (sum.bpm > this.life.bestBpm) this.life.bestBpm = sum.bpm;
    }
    this.data.run = null;
    this.state = 'results';
    this.checkAchievements();
    this.persist();
    this.showResults(sum, record, unlockedEndless);
  }

  showResults(sum, record, unlockedEndless = false) {
    this.reportNo++;
    const hasNext = sum.complete && this.level && this.level.id < LEVELS.length;
    this.ui.screen('results', {
      summary: sum, mode: sum.mode, levelTitle: this.level ? this.level.title : '', challenge: this.session.challenge,
      hasNext, record, newAch: this.newAchThisShift, unlockedEndless,
      reportNo: this.reportNo, stampRot: (Math.random() * 10 - 8).toFixed(1), commentPick: Math.floor(Math.random() * 2),
    });
    setTimeout(() => this.sfx.stamp(), this.settings.reducedMotion ? 50 : 650);
  }

  // =====================================================================
  // Achievements & saving
  // =====================================================================
  checkAchievements() {
    const got = newlyUnlocked(this.life, this.data.achievements);
    for (const a of got) {
      this.data.achievements[a.id] = Date.now();
      this.newAchThisShift.push(a);
      this.ui.achievement(a);
      this.sfx.achievement();
    }
    if (got.length) this.persist();
  }

  /** Snapshot an unfinished level so it can be resumed later. */
  saveRun() {
    if (!this.session || this.session.mode !== 'level' || this.session.done || !this.level) return;
    // Opening a briefing and backing out shouldn't replace an existing save.
    if (this.session.sorted === 0 && this.session.mistakes === 0 && this.session.elapsed < 3) return;
    if (this.held) this.cancelGrab();
    // Beans mid-flight: correct ones count as sorted, rejected ones go back.
    for (const f of this.flights) {
      if (f.kind === 'in') f.bean.state = 'sorted';
      else { f.bean.state = 'table'; f.bean.x = f.wx ?? this.world.rect.x + this.world.rect.w / 2; f.bean.y = f.wy ?? this.world.rect.y + this.world.rect.h - 60; }
    }
    this.flights = [];
    this.data.run = {
      levelId: this.level.id, seed: this.seed, session: this.session.toJSON(),
      beans: this.world.snapshot(), binOrder: this.ui.binOrder.slice(),
    };
    this.persist();
  }

  persist() {
    if (this.state === 'play' && this.session && this.session.mode === 'level' && !this.session.done && this.level) {
      this.data.run = { levelId: this.level.id, seed: this.seed, session: this.session.toJSON(), beans: this.world.snapshot(), binOrder: this.ui.binOrder.slice() };
    }
    save(this.data);
  }

  // =====================================================================
  // Frame
  // =====================================================================
  updateHud(force) {
    const s = this.session;
    if (!s) return;
    let remaining, remainingLabel, progress, warn = false;
    if (s.mode === 'endless') {
      const on = this.endless ? this.endless.onTable || 0 : 0;
      remainingLabel = 'On table';
      remaining = `${on} / ${ENDLESS.capacity}`;
      progress = Math.min(1, on / ENDLESS.capacity);
      warn = on > ENDLESS.capacity * 0.8;
    } else {
      remainingLabel = 'Beans remaining';
      remaining = `${fmtInt(s.remaining)} / ${fmtInt(s.total)}`;
      progress = s.total ? s.sorted / s.total : 0;
    }
    const timeLeft = s.timeLeft;
    this.ui.updateHud({
      remainingLabel, remaining, progress: progress.toFixed(4), warn,
      accuracy: fmtPct(s.accuracy),
      streak: String(s.streak),
      best: String(s.bestStreak),
      timeLabel: s.challenge ? 'Time left' : 'Time',
      time: fmtTime(s.challenge ? timeLeft : s.elapsed),
      lowTime: s.challenge && timeLeft < 30,
    });
  }

  /**
   * If frames stay slow for a few seconds during play, step quality down
   * (lower canvas resolution first, then bean shadows). Never steps back up
   * mid-session, which avoids flip-flopping.
   */
  watchPerformance(rawDt) {
    if (rawDt <= 0 || rawDt > 0.25) return;       // tab switches, breakpoints
    const p = this.perf;
    p.ema += (rawDt - p.ema) * 0.05;
    if (this.state !== 'play' || this.quality === 0) { p.slow = 0; return; }
    p.slow = p.ema > 1 / 38 ? p.slow + rawDt : Math.max(0, p.slow - rawDt);
    if (p.slow > 3) {
      p.slow = 0;
      this.quality--;
      if (this.quality === 1) this.resize(true);
      else this.renderer.shadows = false;
      p.ema = 1 / 60;
    }
  }

  frame(rawDt) {
    this.watchPerformance(rawDt);
    const dt = Math.min(rawDt, 1 / 20);
    this.time += dt;
    const st = this.state;

    if (st === 'play') {
      this.session.tick(dt);
      this.life.playTime += dt;
      this.updateHeld(dt);
      this.world.update(dt, { holding: !!this.held, feed: true, beltInterval: this.endless ? this.endless.interval : null });
      if (this.endless) this.updateEndless(dt);
      // Level complete once the last correct bean has landed in its container.
      const s = this.session;
      if (s.mode === 'level' && s.sorted >= s.total && !this.flights.some((f) => f.kind === 'in')) { this.celebrate(); this.draw(); return; }
      this.memoTimer -= dt;
      if (this.memoTimer <= 0) {
        this.memoTimer = 55 + Math.random() * 45;
        if (this.settings.hints) this.ui.memo(MEMOS[Math.floor(Math.random() * MEMOS.length)]);
      }
      if (this.session.challenge && this.session.timeLeft <= 0 && this.state === 'play') {
        this.sfx.wrong();
        this.finishLevel(false);
      }
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) { this.saveTimer = SAVE_EVERY; this.persist(); }
    } else if (st === 'celebrate') {
      this.world.update(dt * this.timeScale, {});
      this.updateCelebration(dt);
    } else if (st === 'menu' || st === 'brief' || st === 'results') {
      this.world.update(dt, {});
      // Restless beans in the background.
      if (st === 'menu' && Math.random() < dt * 0.8) {
        const b = this.world.beans[Math.floor(Math.random() * this.world.beans.length)];
        if (b && b.state === 'table') { wake(b); b.vx += (Math.random() - 0.5) * 160; b.vy += (Math.random() - 0.5) * 160; b.va += (Math.random() - 0.5) * 8; }
      }
    }
    this.handleWorldEvents();
    this.updateFlights(st === 'celebrate' ? dt * Math.max(0.5, this.timeScale) : dt);
    this.fx.update(dt);
    this.camera.update(dt, this.settings.screenShake && !this.settings.reducedMotion);
    if (this.world.mods.tilt) this.ui.setBubble(true, this.world.tilt.x, this.world.tilt.y);
    else this.ui.setBubble(false);
    if (st === 'play' || st === 'celebrate') this.updateHud();
    this.draw();
  }

  draw() {
    const r = this.renderer, cam = this.camera;
    r.hover = this.state === 'play' && !this.held && !this.touch ? this.hoverBean : null;
    let light = null;
    if (this.held) light = { x: this.held.x, y: this.held.y };
    else if (this.input.mouse.inside) light = { x: this.input.mouse.x, y: this.input.mouse.y };
    else if (this.pointer.x >= 0) light = this.pointer;
    r.drawWorld(this.world, cam, { time: this.time, light });

    r.beginFx();
    // Beans in flight
    for (const f of this.flights) {
      const k = Math.min(1, f.t / f.dur);
      let x, y, scale = 1, alpha = 1, lift = f.lift;
      if (f.kind === 'in' || f.kind === 'bounce') {
        const e = easeInOutCubic(k);
        x = lerp(f.fx, f.tx, e);
        y = lerp(f.fy, f.ty, e) - Math.sin(Math.PI * k) * 40;
        if (f.kind === 'in') { scale = lerp(1, 0.55, e); alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1; }
        f.bean.a += 0.12;
      } else {
        const e = easeOutCubic(k);
        const ex = cam.toScreenX(f.wx), ey = cam.toScreenY(f.wy);
        x = lerp(f.fx, ex, e);
        y = lerp(f.fy, ey, k) - Math.sin(Math.PI * k) * 150;
        lift = 1.4 * (1 - k);
        f.bean.a += 0.2;
      }
      r.drawLifted(f.bean, x, y, Math.max(cam.zoom, 0.8) * scale, lift, alpha);
    }
    // The bean in your hand
    if (this.held) {
      const h = this.held;
      // Never draw the bean in your hand too small to see (zoomed-out phones).
      r.drawLifted(h.bean, h.x, h.y, Math.max(cam.zoom * (1 + 0.12 * h.lift), 0.95), 1 + h.lift);
    }
    this.fx.draw(r);
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
