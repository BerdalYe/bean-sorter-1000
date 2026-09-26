// ---------------------------------------------------------------------------
// game.js — the controller. Owns the state machine and connects
// input → world → session → UI / audio / haptics / effects / saving.
//
// States:  menu → brief (cinematic intro) → play ⇄ pause → celebrate → results
//          (endless: menu → play ⇄ pause → results)
// ---------------------------------------------------------------------------

import { LEVELS, COLORS, ENDLESS, MEMOS, SLIP_LINES, EVENT_LINES, INSPECT_STATS, SYMBOLS, MAIN_LEVELS, challengeLimit, comboEnergy, hazardsOf } from './config.js';
import { SpriteBank } from './beans.js';
import { World } from './world.js';
import { wake } from './physics.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Fx } from './fx.js';
import { Sfx } from './audio.js';
import { Haptics } from './haptics.js';
import { Session } from './session.js';
import { UI } from './ui.js';
import { ACHIEVEMENTS, newlyUnlocked } from './achievements.js';
import { VARIETY, COMMON_NAMES, RARITIES, discover, beandexEntries } from './beandex.js';
import { careerRank, careerXp, ENVIRONMENTS, unlockedEnvironments } from './career.js';
import { load, save, defaults } from './storage.js';
import { clamp, lerp, easeOutCubic, easeInOutCubic, fmtTime, fmtInt, rgbCss, shade, makeRng } from './util.js';

const SAVE_EVERY = 6;
const PARTICLE_SCALE = { low: 0.35, medium: 1, high: 1.6 };
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

export class Game {
  constructor(worldCanvas, fxCanvas) {
    this.data = load();
    this.worldCanvas = worldCanvas;
    this.sprites = new SpriteBank();
    this.world = new World(this.sprites);
    this.camera = new Camera();
    this.fx = new Fx();
    this.sfx = new Sfx();
    this.haptics = new Haptics();
    this.renderer = new Renderer(worldCanvas, fxCanvas, this.sprites);
    this.ui = new UI(this);
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
    this.eventTimer = 80;
    this.timeScale = 1;
    this.time = 0;
    this.appTime = 0;
    this.endless = null;
    this.newAchThisShift = [];
    this.hoverBean = null;
    this.approveNext = false;
    this.konami = [];
    this.serialTaps = 0;
    this.fps = { frames: 0, t: 0 };
    this.reportNo = 1 + Math.floor(Math.random() * 90000);
    // Adaptive quality: 2 = full, 1 = 1× resolution, 0 = also no bean shadows.
    this.quality = 2;
    this.perf = { ema: 1 / 60, slow: 0 };
    this.rank = this.careerNow();

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
    this.applySettings();

    // Debug handle for automated tests. Harmless in normal play.
    window.__beanSorter = this;
  }

  get settings() { return this.data.settings; }
  get life() { return this.data.life; }

  // =====================================================================
  // Settings
  // =====================================================================
  /** Push every setting into the subsystems that use it. */
  applySettings() {
    const s = this.settings;
    this.sfx.enabled = !!s.sound;
    this.sfx.setVolume(s.masterVolume);
    this.sfx.setSfxVolume(s.sfxVolume);
    this.haptics.enabled = !!s.haptics;
    this.fx.scale = s.performance ? 0.35 : PARTICLE_SCALE[s.particles] ?? 1;
    this.renderer.shadows = !!s.shadows && !s.performance && this.quality > 0;
    const env = unlockedEnvironments(this.envCtx()).includes(s.environment) ? s.environment : 'office';
    this.renderer.setTheme(env);
    document.documentElement.classList.toggle('reduced-motion', !!s.reducedMotion);
    document.documentElement.style.setProperty('--ui-scale', String(clamp(+s.uiScale || 1, 0.8, 1.3)));
    this.ui.setMuted(!s.sound);
    this.ui.showFps(!!s.showFps);
    this.updateSymbols();
  }

  /** Colour-assist: one symbol per colour, in the level's colour order. */
  updateSymbols() {
    const keys = this.level ? this.level.colors : this.endless ? this.endless.colors : null;
    if (!this.settings.colorAssist || !keys) {
      this.renderer.symbols = null;
      this.ui.setSymbols(null);
      return;
    }
    const map = {}, text = {};
    keys.forEach((k, i) => { map[k] = this.sprites.glyph(SYMBOLS[i % SYMBOLS.length]); text[k] = SYMBOLS[i % SYMBOLS.length]; });
    this.renderer.symbols = map;
    this.ui.setSymbols(text);
  }

  onSetting(key, value, live) {
    if (key === 'challenge') {
      this.challenge = !!value;
      this.ui.screen('levels', this.levelScreenData());
      return;
    }
    this.settings[key] = value;
    this.applySettings();
    if (key === 'sound') { const el = document.getElementById('set-sound'); if (el) el.checked = !!value; }
    if (key === 'uiScale' || key === 'performance') requestAnimationFrame(() => this.resize(true));
    if (key === 'performance') this.quality = value ? 1 : 2;
    if (!live) this.persist();
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
    // Short landscape screens (phones on their side): containers go on the right.
    this.ui.setTraySide(h < 540 && w > h * 1.3);
    const dpr = this.quality >= 2 && !this.settings.performance ? Math.min(2, window.devicePixelRatio || 1) : 1;
    this.renderer.resize(w, h, dpr);
    this.ui.invalidateRects();
    const root = document.documentElement.style;
    root.setProperty('--hud-h', `${Math.round(this.ui.hudHeight())}px`);
    root.setProperty('--tray-h', `${Math.round(this.ui.trayHeight())}px`);
    root.setProperty('--tray-w', `${Math.round(this.ui.trayWidth())}px`);
    this.camera.setViewport(w, h, this.ui.hudHeight(), this.ui.trayHeight(), this.ui.trayWidth());
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
    this.camera.setViewport(window.innerWidth, window.innerHeight, this.ui.hudHeight(), this.ui.trayHeight(), this.ui.trayWidth());
    this.camera.fit(this.fitRect(), this.touch ? 6 : 20);
  }

  // =====================================================================
  // Career, Beandex, environments
  // =====================================================================
  achievementCount() { return Object.keys(this.data.achievements).length; }
  careerNow() { return careerRank(careerXp(this.life, this.achievementCount())); }
  envCtx() { return { life: this.life, dex: this.data.dex, rank: careerRank(careerXp(this.life, Object.keys(this.data.achievements).length)) }; }

  /** Called after anything that earns XP: announces promotions. */
  checkPromotion() {
    const now = this.careerNow();
    if (now.index > this.rank.index) {
      this.ui.promotion(now.name);
      this.sfx.promotion();
      this.haptics.play('achievement');
      const before = unlockedEnvironments({ life: this.life, dex: this.data.dex, rank: this.rank });
      const after = unlockedEnvironments(this.envCtx());
      this.announceEnvironments(before, after);
    }
    this.rank = now;
  }

  announceEnvironments(before, after) {
    for (const id of after) {
      if (before.includes(id)) continue;
      const env = ENVIRONMENTS.find((e) => e.id === id);
      this.ui.memo(`New workstation unlocked: ${env.name}. Choose it in Settings.`, 'hint');
    }
  }

  /** Record a special bean the first time the player touches or inspects it. */
  discoverBean(b, sx, sy) {
    if (!b.variety || b.found) return;
    b.found = true;
    const envBefore = unlockedEnvironments(this.envCtx());
    const v = VARIETY[b.variety];
    const first = discover(this.data.dex, `v:${b.variety}`, b.key);
    if (v.rarity === 'rare' || v.rarity === 'legendary') this.life.raresFound++;
    if (v.rarity === 'legendary') this.life.legendaries++;
    this.life.dexEntries = Object.keys(this.data.dex).length;
    this.sfx.rare(v.rarity);
    this.haptics.play('rare');
    this.ui.rareFound(v, RARITIES[v.rarity], first, this.sprites.portrait(b.key, b.look));
    if (sx !== undefined) {
      this.fx.ring(sx, sy, 'rgba(255,230,140,0.95)', 10, 90, 0.6);
      this.fx.sparks(sx, sy, [255, 220, 120], v.rarity === 'legendary' ? 40 : 18);
    }
    this.announceEnvironments(envBefore, unlockedEnvironments(this.envCtx()));
    this.checkAchievements();
  }

  // =====================================================================
  // Screens / menu flow
  // =====================================================================
  showMenu() {
    this.state = 'menu';
    this.level = null;
    this.input.setEnabled(false);
    this.ui.showHud(false);
    this.ui.showTray(false);
    this.ui.hint(null);
    this.ui.hideInspect();
    this.ui.hideFinale();
    this.ui.hideIntro();
    this.ui.setEnergy(0);
    this.setupAttract();
    this.updateSymbols();
    const run = this.data.run;
    const next = Math.min(this.data.progress.unlocked, LEVELS.length);
    this.ui.screen('menu', {
      run: run ? { levelId: run.levelId, sorted: run.session.sorted, total: run.session.total } : null,
      endless: this.data.progress.endless,
      startLabel: `Level ${next} · ${LEVELS[next - 1].title}`,
      lifeSorted: this.life.sorted,
      rank: this.careerNow(),
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
    return { unlocked: this.data.progress.unlocked, best: this.bestMap(), challenge: this.challenge, mainDone: this.life.levelsDone.includes(MAIN_LEVELS) };
  }

  bestMap() {
    const out = {};
    for (const [id, v] of Object.entries(this.data.progress.levels)) if (v.best) out[id] = v.best;
    return out;
  }

  statsData() {
    return {
      life: this.life, achievements: this.data.achievements, best: this.bestMap(),
      rank: this.careerNow(), dexCount: Object.keys(this.data.dex).length,
    };
  }

  dexData() {
    const keys = Object.keys(COMMON_NAMES);
    return { entries: beandexEntries(keys), dex: this.data.dex, sprites: this.sprites };
  }

  achievementsData() {
    return { list: ACHIEVEMENTS, unlocked: this.data.achievements, life: this.life };
  }

  settingsData(extra = {}) {
    const ctx = this.envCtx();
    const open = unlockedEnvironments(ctx);
    return {
      settings: this.settings, from: this.settingsFrom,
      envs: ENVIRONMENTS.map((e) => ({ id: e.id, name: e.name, req: e.req, open: open.includes(e.id) })),
      haptics: this.haptics.supported,
      fullscreen: !!document.fullscreenEnabled,
      ...extra,
    };
  }

  onAction(action, ds) {
    this.sfx.click();
    this.haptics.play('tap');
    switch (action) {
      case 'menu':
        if (this.state === 'play' || this.state === 'pause' || this.state === 'brief') this.saveRun();
        this.showMenu();
        break;
      case 'start': {
        if (this.data.run) { this.resumeRun(); break; }
        const next = Math.min(this.data.progress.unlocked, LEVELS.length);
        this.startLevel(next, { challenge: false });
        break;
      }
      case 'continue': this.resumeRun(); break;
      case 'levels': this.ui.screen('levels', this.levelScreenData()); break;
      case 'play': this.startLevel(+ds.level, { challenge: this.challenge }); break;
      case 'endless': this.startEndless(); break;
      case 'stats': this.ui.screen('stats', this.statsData()); break;
      case 'beandex': this.ui.screen('beandex', this.dexData()); break;
      case 'achievements': this.ui.screen('achievements', this.achievementsData()); break;
      case 'settings':
        this.settingsFrom = ds.from || (this.state === 'pause' ? 'pause' : 'menu');
        this.ui.screen('settings', this.settingsData());
        break;
      case 'env':
        this.onSetting('environment', ds.env);
        this.ui.screen('settings', this.settingsData());
        break;
      case 'fullscreen':
        try {
          if (document.fullscreenElement) document.exitFullscreen?.();
          else document.documentElement.requestFullscreen?.().catch(() => {});
        } catch (_) { /* not available */ }
        break;
      case 'pause-back': this.ui.screen('pause', this.pauseData()); break;
      case 'reset': this.ui.screen('settings', this.settingsData({ confirmReset: true })); break;
      case 'reset-confirm':
        this.data = defaults();
        this.rank = this.careerNow();
        this.persist();
        this.applySettings();
        this.showMenu();
        break;
      case 'begin': case 'skip-intro': if (this.state === 'brief') this.beginShift(); break;
      case 'skip-finale': if (this.state === 'celebrate' && this.celebT > this.boomAt) this.finishLevel(true); break;
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
      case 'serial':
        // Secret: fiddling with the serial plate.
        if (++this.serialTaps === 5) {
          this.ui.memo('Warranty void. Please stop touching the serial plate.', 'alert');
          this.secret('serial');
        }
        break;
      default: break;
    }
  }

  secret(name) {
    if (this.life.secrets[name]) return;
    this.life.secrets[name] = true;
    this.checkAchievements();
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
    this.updateSymbols();
    this.ui.setPlate(`Level ${L.id}`, L.title);
    this.ui.showHud(true);
    this.ui.showTray(true);
    this.ui.hint(null);
    this.ui.closeScreen();
    this.resize();
    this.fitCamera();
    this.updateHud(true);
    this.state = 'brief';
    this.input.setEnabled(false);
    this.playIntro(L, resume);
  }

  /** Cinematic introduction. Auto-starts the shift; tap or key skips it. */
  playIntro(L, resume) {
    const lines = [];
    if (resume) {
      lines.push({ t: 'kicker', text: `Level ${L.id}` }, { t: 'title', text: L.title });
      lines.push({ t: 'meta', text: `Resuming shift · ${fmtInt(this.session.sorted)} / ${fmtInt(L.count)} sorted` });
    } else {
      lines.push({ t: 'kicker', text: `Level ${L.id}${this.session.challenge ? ' · Challenge' : ''}` }, { t: 'title', text: L.title });
      lines.push({ t: 'meta', text: `${fmtInt(L.count)} beans · ${L.colors.length} colors${this.session.challenge ? ` · ${fmtTime(challengeLimit(L.count))} limit` : ''}` });
      const i = L.intro || {};
      if (i.warn) lines.push({ t: 'warn', k: 'Warning', text: i.warn });
      if (i.k) lines.push({ t: 'mission', k: i.k, text: i.v });
      if (i.last) lines.push({ t: 'last', text: i.last });
    }
    const step = L.boss ? 0.62 : 0.42;
    this.introLines = lines.map((l, n) => ({ ...l, at: 0.25 + n * step, played: false }));
    this.introT = 0;
    this.introDur = 0.25 + lines.length * step + (L.boss ? 1.5 : 1.0);
    if (this.settings.reducedMotion) this.introDur = Math.min(this.introDur, 2.2);
    const hint = L.id === 1 && !resume ? (this.touch ? 'Drag beans with one finger · Pinch to zoom · Long-press to inspect' : 'Drag beans with the mouse · Wheel to zoom · Right-click to inspect') : '';
    this.ui.intro(this.introLines, { boss: !!L.boss, briefing: resume ? '' : L.briefing, hint, colors: L.colors, hazards: hazardsOf(L) });
    this.sfx.introSwell();
  }

  updateIntro(dt) {
    this.introT += dt;
    this.introLines.forEach((l, i) => {
      if (!l.played && this.introT >= l.at) {
        l.played = true;
        if (l.t === 'warn') this.sfx.introWarn(); else this.sfx.introLine(i);
      }
    });
    if (this.introT >= this.introDur) this.beginShift();
  }

  resumeRun() {
    const run = this.data.run;
    if (!run) return this.showMenu();
    this.startLevel(run.levelId, { challenge: run.session.challenge, resume: run });
  }

  beginShift() {
    this.ui.hideIntro();
    this.ui.closeScreen();
    this.state = 'play';
    this.input.setEnabled(true);
    this.memoTimer = 40 + Math.random() * 30;
    this.eventTimer = 60 + Math.random() * 60;
    this.newAchThisShift = [];
    this.xpAtStart = careerXp(this.life, this.achievementCount());
    const L = this.level;
    if (this.session.mode === 'level' && this.settings.hints) {
      if (L.id === 1 && this.session.sorted === 0) this.ui.hint('Drag a bean into the container with the matching label.');
      if (L.id === 4) this.ui.memo(this.touch ? 'Long-press a bean to inspect its exact color.' : 'Right-click a bean to inspect its exact color.', 'hint');
      if (L.id === 5 || L.id === 9) this.ui.memo('Zoom in for a closer look. Each container shows a reference bean.', 'hint');
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
    this.updateSymbols();
    this.ui.setPlate('Endless', 'Overtime');
    this.ui.showHud(true);
    this.ui.showTray(true);
    this.ui.hint(null);
    this.ui.closeScreen();
    this.resize();
    this.fitCamera();
    this.updateHud(true);
    this.state = 'play';
    this.input.setEnabled(true);
    this.memoTimer = 40;
    this.eventTimer = 70;
    this.newAchThisShift = [];
    this.xpAtStart = careerXp(this.life, this.achievementCount());
    this.ui.memo(`Keep the table under ${ENDLESS.capacity} beans. The belt speeds up.`, 'hint');
  }

  clearTransient() {
    this.flights = [];
    this.held = null;
    this.fx.clear();
    this.timeScale = 1;
    this.endless = null;
    this.approveNext = false;
    this.worldCanvas.style.filter = '';
    this.ui.hideFinale();
    this.ui.hideIntro();
    this.ui.hideInspect();
    this.ui.clearNotices();
    this.ui.setEnergy(0);
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
    this.haptics.play('pickup');
    if (type !== 'mouse') this.fx.ring(sx, sy, 'rgba(255,255,255,0.7)', 6, 34, 0.3);
    this.discoverBean(b, bx, by);

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
    this.life.drops++;
    this.sfx.drop();
    this.haptics.play('drop');
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
    const K = 620, C = 2 * Math.sqrt(K) * 0.72;
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
    h.lift = Math.min(1, h.lift + dt * 6);

    // Edge-of-screen auto pan while carrying a bean.
    const cam = this.camera, m = 48, sp = 520 * dt;
    const right = cam.w - cam.right;
    let px = 0, py = 0;
    if (h.px < m) px = sp * (1 - h.px / m);
    else if (h.px > right - m && h.px < right) px = -sp * (1 - (right - h.px) / m);
    if (h.py < cam.top + m && h.py > cam.top - 10) py = sp * (1 - (h.py - cam.top) / m);
    if (px || py) cam.pan(px, py);

    // Occasionally a violently flung bean escapes (never over the tray).
    const speed = Math.hypot(h.vx, h.vy);
    if (speed > 2600 && h.age > 0.2 && !this.ui.overTray(h.px, h.py) && this.session.sorted > 10 && Math.random() < 0.012) this.slip();
  }

  /** Pop-up scale of the held bean: quick overshoot, then settles. */
  heldScale(h) {
    const t = Math.min(1, h.age / 0.22);
    const c1 = 1.9, c3 = c1 + 1;
    const back = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    return 1 + 0.16 * back;
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
    this.flights.push({ bean: b, kind: ok ? 'in' : 'bounce', t: 0, dur: ok ? 0.2 : 0.2, fx: h.x, fy: h.y, tx: c.x, ty: c.y, key, lift: h.lift, scale: this.heldScale(h) });
    const s = this.session;
    this.life.attempts++;

    if (ok) {
      const ms = s.correct();
      this.life.sorted++;
      if (s.streak > this.life.bestStreak) this.life.bestStreak = s.streak;
      if (s.fastest && (!this.life.fastestSort || s.fastest < this.life.fastestSort)) this.life.fastestSort = s.fastest;
      const energy = comboEnergy(s.streak);
      this.sfx.correct(s.streak, energy);
      if (ms) {
        this.ui.combo(ms.text, ms.n, ms.tier);
        this.sfx.milestone(ms.tier);
        this.haptics.play(ms.tier >= 5 ? 'big' : 'milestone');
        if (ms.tier >= 3) this.fx.cannons(window.innerWidth, window.innerHeight, 20 + ms.tier * 10, this.levelPalette());
      } else {
        this.haptics.play('correct');
      }
      if (s.streak > 1) this.ui.bumpStreak();
      if (this.level && this.level.id === 1 && s.sorted === 1) this.ui.hint(null);
      const bin = this.ui.bins.get(key);
      this.ui.setBinCount(key, bin.sorted + 1);
      // Beandex: every sorted bean counts toward its colour's entry.
      if (discover(this.data.dex, `c:${b.key}`, b.key)) {
        this.life.dexEntries = Object.keys(this.data.dex).length;
        if (this.settings.hints) this.ui.memo(`Beandex entry recorded: ${COMMON_NAMES[b.key]}.`, 'dex');
      }
      this.discoverBean(b);
      if (this.approveNext) {
        this.approveNext = false;
        this.fx.text(c.x, c.y - 60, 'THIS BEAN HAS BEEN APPROVED', '#bff5c9', 13, 1.8);
      }
      this.checkPromotion();
    } else {
      s.wrong();
      this.life.mistakes++;
      this.sfx.wrong();
      this.haptics.play('wrong');
      this.ui.binFeedback(key, false);
      this.ui.setEnergy(0);
    }
    this.checkAchievements();
  }

  levelPalette() {
    const keys = this.level ? this.level.colors : this.endless ? this.endless.colors : ['red', 'blue', 'yellow'];
    return keys.map((k) => rgbCss(shade(COLORS[k].rgb, 0.1))).concat(['#ffffff', '#f2c230', '#e0531a']);
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
        const s = this.session;
        this.fx.sparks(f.tx, f.ty, this.sprites.rgbOf(f.bean.key, f.bean.variant), this.settings.reducedMotion ? 6 : 12);
        const streak = s ? s.streak : 0;
        this.fx.text(f.tx, f.ty - 30, streak >= 5 ? `×${streak}` : '+1', streak >= 25 ? '#ffd36b' : '#ffffff', streak >= 5 ? 15 + Math.min(10, streak / 20) : 13, 0.7);
        this.ui.binFeedback(f.key, true);
      } else if (f.kind === 'bounce') {
        // Reached the container mouth: rejected. Toss it back onto the table.
        const r = this.world.rect;
        const wx = clamp(cam.toWorldX(Math.min(f.tx, cam.w - cam.right - 20)) + (Math.random() - 0.5) * 80, r.x + 30, r.x + r.w - 30);
        const wy = clamp(cam.toWorldY(Math.min(f.ty, cam.h - cam.bottom - 30)) - 40 - Math.random() * 80, r.y + 30, r.y + r.h - 30);
        this.flights[i] = { bean: f.bean, kind: 'reject', t: 0, dur: 0.55, fx: f.tx, fy: f.ty, wx, wy, lift: 1.4, scale: 1 };
        this.fx.text(f.tx, f.ty - 34, 'REJECTED', '#ffb4a1', 14, 0.9);
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
    const r = makeRng(b.statSeed || b.id);
    const stat = INSPECT_STATS[Math.floor(r.next() * INSPECT_STATS.length)](r);
    const v = b.variety ? VARIETY[b.variety] : null;
    const rarity = v ? v.rarity : 'common';
    this.ui.inspect({
      id: b.id, key: b.key, type: v ? v.name : COMMON_NAMES[b.key], color: COLORS[b.key].name,
      rgb: this.sprites.rgbOf(b.key, b.variant, b.look), rarity, rarityInfo: RARITIES[rarity],
      size: { tiny: 'Tiny', normal: 'Standard', huge: 'Huge' }[b.sizeClass], weight: b.grams, note: b.note, stat,
      status: b.state === 'belt' ? 'On conveyor' : b.z > 0 ? 'Unsorted (piled)' : 'Unsorted',
    }, sx, sy);
    this.sfx.click();
    this.discoverBean(b, sx, sy);
    if (b.id === 404) this.secret('b404');
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
    this.haptics.play('tap');
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
    // Secret: an old, famous code.
    this.konami.push(k.length === 1 ? k.toLowerCase() : k);
    if (this.konami.length > KONAMI.length) this.konami.shift();
    if (this.konami.join() === KONAMI.join()) { this.konami = []; this.discoMode(); }

    if (this.state === 'brief' && (k === 'Enter' || k === ' ' || k === 'Escape')) { this.beginShift(); return; }
    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (this.state === 'play') this.pause();
      else if (this.state === 'pause' && this.ui.current === 'pause') this.resume();
    } else if (k === 'm' || k === 'M') {
      this.onSetting('sound', !this.settings.sound);
    } else if (k === 'F2') {
      this.onSetting('showFps', !this.settings.showFps);
    } else if (this.state === 'play') {
      if (k === '0' || k === 'Home') this.fitCamera();
      else if (k === '+' || k === '=') this.camera.zoomAt(this.camera.cx, this.camera.cy, 1.2);
      else if (k === '-' || k === '_') this.camera.zoomAt(this.camera.cx, this.camera.cy, 1 / 1.2);
      else if ((k === 'i' || k === 'I') && this.input.mouse.inside) this.inspect(this.input.mouse.x, this.input.mouse.y);
    }
  }

  /** Konami code: an eight-second "quality inspection" in every colour. */
  discoMode() {
    this.discoT = 8;
    this.ui.memo('Disco inspection mode engaged. Productivity is not affected.', 'alert');
    this.sfx.milestone(6);
    this.secret('konami');
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
          this.haptics.play('shake');
          if (this.settings.screenShake && !this.settings.reducedMotion) this.camera.shake(e.after ? 4 : 8, e.after ? 0.4 : 0.6);
          if (!e.after) this.notice(`Seismic event: ${(Math.random() * 0.4 + 0.1).toFixed(1)} on the Bean Scale.`);
          break;
        case 'fan':
          this.sfx.fan(e.on);
          if (e.on) this.notice(pick(['Fan activated. Someone was warm.', 'The fan is on. It is a morale initiative.', 'Airflow detected.']));
          break;
        case 'tilt':
          if (e.on) this.notice('The table is no longer level.');
          else this.notice('Table re-levelled. For now.');
          break;
        case 'lights':
          this.notice(e.off ? 'Lighting failure. Facilities has been notified.' : 'Lighting restored. Temporarily.');
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

  /** Rare, harmless office events. Kept rare so they stay funny. */
  randomEvent() {
    const roll = Math.random();
    if (roll < 0.25) {
      this.ui.banner('Quality control inspection');
      this.sfx.notice();
      setTimeout(() => { if (this.state === 'play') this.ui.memo('Inspection complete. The beans passed. So did you, mostly.'); }, 2600);
    } else if (roll < 0.5) {
      if (this.world.rollOne()) this.ui.memo('A bean appears to be leaving.');
    } else if (roll < 0.65) {
      this.approveNext = true;
    } else if (this.settings.hints) {
      this.ui.memo(pick(EVENT_LINES));
    }
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
      this.updateSymbols();
      this.resizeKeepView();
      this.notice(`New bean variety approved: ${COLORS[k].name}.`);
    }

    // Chaos ramps up.
    const stages = [
      [100, () => { w.mods.fan = { interval: [22, 34], duration: [5, 8], strength: 75 }; w.fan = { x: w.rect.x - 70, y: 0, angle: 0, base: 0, on: false, timer: 3, blade: 0, spin: 0, cfg: w.mods.fan }; }],
      [200, () => { w.mods.shake = { interval: [18, 28], strength: 100 }; w.shakeTimer = 6; }],
      [320, () => { w.mods.tilt = { strength: 15 }; w.tilt.timer = 5; }],
      [440, () => { w.mods.shuffle = { interval: [30, 45] }; w.shuffleTimer = 8; }],
      [560, () => { w.darkBase = 0.45; w.darkTarget = 0.45; }],
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
    requestAnimationFrame(() => this.resize(true));
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
    if (sum.peakBpm > this.life.peakBpm) this.life.peakBpm = sum.peakBpm;
    this.state = 'results';
    this.checkAchievements();
    this.persist();
    this.sfx.wrong();
    this.ui.setEnergy(0);
    this.showResults(sum, sum.sorted > prev && prev > 0 ? `New personal best. Previous: ${fmtInt(prev)} beans.` : '');
  }

  // =====================================================================
  // Finishing a level: the final bean
  // =====================================================================
  /**
   * Timeline (normal / boss):
   *   0.0  slow motion, impact, drum roll, screen darkens
   *   0.7  "FINAL BEAN SORTED"
   *   1.6 / 2.2  the reveal: flash, confetti cannons, bean rain, fireworks,
   *        containers celebrate, brass. Boss levels add a counter and a subtitle.
   *   3.8 / 6.4  shift report with animated statistics and rank stamp
   * Everything scales with the level's bean count. Tap skips after the reveal.
   */
  celebrate() {
    this.state = 'celebrate';
    this.session.done = true;
    this.input.setEnabled(false);
    this.held = null;
    this.ui.hint(null);
    this.ui.hideInspect();
    const L = this.level, boss = !!L.boss;
    const reduced = this.settings.reducedMotion;
    this.celebT = 0;
    this.boomAt = reduced ? 0.3 : boss ? 2.2 : 1.6;
    this.celebDur = reduced ? 2.4 : boss ? 6.4 : 3.8;
    this.boomDone = false;
    this.timeScale = reduced ? 1 : 0.15;
    this.sfx.finalHit(this.boomAt - 0.4);
    this.haptics.play('final');
    this.ui.finaleStart(reduced);
    this.life.finalBeans++;
  }

  celebrationBoom() {
    const L = this.level, boss = !!L.boss, reduced = this.settings.reducedMotion;
    const scale = Math.min(1.6, 0.35 + L.count / 800);
    this.boomDone = true;
    this.timeScale = 1;
    this.sfx.finale(boss);
    this.ui.flash();
    this.ui.finaleReveal({ total: this.session.total, title: L.title, boss, subtitle: L.finale || '' });
    this.ui.celebrateBins();
    const W = window.innerWidth, H = window.innerHeight;
    const pal = this.levelPalette();
    this.fx.confetti(W, Math.round((reduced ? 50 : 160) * scale), pal);
    if (!reduced) {
      this.fx.cannons(W, H, Math.round(120 * scale), pal);
      this.fx.beanRain(W, Math.round(90 * scale), L.colors);
      const n = boss ? 10 : Math.round(3 + scale * 3);
      this.fireworkTimes = Array.from({ length: n }, (_, i) => this.boomAt + 0.2 + i * (boss ? 0.36 : 0.32));
      if (this.settings.screenShake) this.camera.shake(boss ? 10 : 5, 0.5);
    } else this.fireworkTimes = [];
  }

  updateCelebration(dt) {
    this.celebT += dt;
    if (!this.boomDone && this.celebT >= this.boomAt) this.celebrationBoom();
    if (this.boomDone) this.timeScale = Math.min(1, this.timeScale + dt);
    while (this.fireworkTimes && this.fireworkTimes.length && this.celebT >= this.fireworkTimes[0]) {
      this.fireworkTimes.shift();
      const k = this.level.colors[Math.floor(Math.random() * this.level.colors.length)];
      this.fx.firework(window.innerWidth * (0.15 + Math.random() * 0.7), window.innerHeight * (0.15 + Math.random() * 0.35), shade(COLORS[k].rgb, 0.25));
    }
    // Slow dramatic zoom-out.
    if (!this.settings.reducedMotion) this.camera.zoom *= Math.pow(0.99, dt * 10);
    if (this.celebT >= this.celebDur) this.finishLevel(true);
  }

  finishLevel(complete) {
    const s = this.session, L = this.level;
    s.done = true;
    this.ui.hideFinale();
    this.input.setEnabled(false);
    this.held = null;
    this.ui.setEnergy(0);
    const sum = s.summary();
    const prog = this.data.progress;
    let record = '';
    let unlockedEndless = false;
    const envBefore = unlockedEnvironments(this.envCtx());
    if (complete) {
      const lv = prog.levels[L.id] || (prog.levels[L.id] = {});
      const prev = lv.best;
      const mine = { rank: sum.rank.name, rankIndex: sum.rank.index, time: sum.time, accuracy: sum.accuracy, bpm: sum.bpm, peakBpm: sum.peakBpm };
      if (!prev || mine.rankIndex > prev.rankIndex || (mine.rankIndex === prev.rankIndex && mine.time < prev.time)) {
        lv.best = mine;
        if (prev) record = `New best result. Previous: ${prev.rank}, ${fmtTime(prev.time)}.`;
      }
      lv.completed = true;
      if (L.id < LEVELS.length) prog.unlocked = Math.max(prog.unlocked, L.id + 1);
      if (L.id === MAIN_LEVELS && !prog.endless) { prog.endless = true; unlockedEndless = true; }
      if (!this.life.levelsDone.includes(L.id)) this.life.levelsDone.push(L.id);
      if (sum.perfect) this.life.perfectLevels++;
      if (sum.bpm > this.life.bestBpm) this.life.bestBpm = sum.bpm;
    }
    if (sum.peakBpm > this.life.peakBpm) this.life.peakBpm = sum.peakBpm;
    this.data.run = null;
    this.state = 'results';
    this.checkAchievements();
    this.checkPromotion();
    this.announceEnvironments(envBefore, unlockedEnvironments(this.envCtx()));
    this.persist();
    this.showResults(sum, record, unlockedEndless);
  }

  showResults(sum, record, unlockedEndless = false) {
    this.reportNo++;
    const hasNext = sum.complete && this.level && this.level.id < LEVELS.length;
    const xp = careerXp(this.life, this.achievementCount());
    this.ui.screen('results', {
      summary: sum, mode: sum.mode, levelTitle: this.level ? this.level.title : '', challenge: this.session.challenge,
      hasNext, record, newAch: this.newAchThisShift, unlockedEndless, boss: !!(this.level && this.level.boss),
      reportNo: this.reportNo, stampRot: (Math.random() * 10 - 8).toFixed(1), commentPick: Math.floor(Math.random() * 2),
      xpGained: Math.max(0, xp - (this.xpAtStart ?? xp)), career: this.careerNow(),
    });
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
      this.haptics.play('achievement');
    }
    if (got.length) { this.checkPromotion(); this.persist(); }
  }

  /** Snapshot an unfinished level so it can be resumed later. */
  saveRun() {
    if (!this.session || this.session.mode !== 'level' || this.session.done || !this.level) return;
    // Opening a level and backing out shouldn't replace an existing save.
    if (this.session.sorted === 0 && this.session.mistakes === 0 && this.session.elapsed < 3) return;
    if (this.held) this.cancelGrab();
    // Beans mid-flight: correct ones count as sorted, rejected ones go back.
    for (const f of this.flights) {
      if (f.kind === 'in') f.bean.state = 'sorted';
      else { f.bean.state = 'table'; f.bean.x = f.wx ?? this.world.rect.x + this.world.rect.w / 2; f.bean.y = f.wy ?? this.world.rect.y + this.world.rect.h - 60; }
    }
    this.flights = [];
    this.data.run = this.runSnapshot();
    this.persist();
  }

  runSnapshot() {
    return { v: 2, levelId: this.level.id, seed: this.seed, session: this.session.toJSON(), beans: this.world.snapshot(), binOrder: this.ui.binOrder.slice(), portrait: window.innerHeight > window.innerWidth * 1.15 };
  }

  persist() {
    if (this.state === 'play' && this.session && this.session.mode === 'level' && !this.session.done && this.level) {
      this.data.run = this.runSnapshot();
    }
    save(this.data);
  }

  // =====================================================================
  // Frame
  // =====================================================================
  updateHud() {
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
      accuracy: `${s.accuracy.toFixed(1)}%`,
      streak: String(s.streak),
      best: `Best ${s.bestStreak}`,
      bpm: s.currentBpm.toFixed(1),
      hotBpm: s.currentBpm >= 40,
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
    this.appTime += dt;
    const st = this.state;

    if (st === 'play') {
      const s = this.session;
      s.tick(dt);
      this.life.playTime += dt;
      this.sessionTime = (this.sessionTime || 0) + dt;
      if (this.sessionTime > this.life.longestSession) this.life.longestSession = this.sessionTime;
      this.updateHeld(dt);
      this.world.update(dt, { holding: !!this.held, feed: true, beltInterval: this.endless ? this.endless.interval : null });
      if (this.endless) this.updateEndless(dt);
      // Level complete once the last correct bean has landed in its container.
      if (s.mode === 'level' && s.sorted >= s.total && !this.flights.some((f) => f.kind === 'in')) { this.celebrate(); this.draw(); return; }
      this.memoTimer -= dt;
      if (this.memoTimer <= 0) {
        this.memoTimer = 60 + Math.random() * 50;
        if (this.settings.hints) this.ui.memo(pick(MEMOS));
      }
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) { this.eventTimer = 70 + Math.random() * 80; this.randomEvent(); }
      if (s.challenge && s.timeLeft <= 0 && this.state === 'play') {
        this.sfx.wrong();
        this.finishLevel(false);
      }
      // Combo hype: embers and UI energy.
      const energy = this.settings.performance ? 0 : comboEnergy(s.streak);
      this.ui.setEnergy(energy);
      if (energy > 0 && !this.settings.reducedMotion && Math.random() < dt * 14 * energy * this.fx.scale) {
        this.fx.embers(window.innerWidth - this.camera.right, window.innerHeight - this.camera.bottom, energy, `rgba(${this.renderer.theme.glow},0.8)`);
      }
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) { this.saveTimer = SAVE_EVERY; this.persist(); }
    } else if (st === 'celebrate') {
      this.world.update(dt * this.timeScale, {});
      this.updateCelebration(dt);
    } else if (st === 'brief') {
      this.world.update(dt, {});
      this.updateIntro(dt);
    } else if (st === 'menu' || st === 'results') {
      this.world.update(dt, {});
      if (st === 'menu') {
        this.life.contemplated += dt / 10;   // one bean contemplated per ten seconds
        // Restless beans in the background.
        if (Math.random() < dt * 0.8) {
          const b = this.world.beans[Math.floor(Math.random() * this.world.beans.length)];
          if (b && b.state === 'table') { wake(b); b.vx += (Math.random() - 0.5) * 160; b.vy += (Math.random() - 0.5) * 160; b.va += (Math.random() - 0.5) * 8; }
        }
      }
    }
    if (this.discoT > 0) {
      this.discoT -= dt;
      this.worldCanvas.style.filter = this.discoT > 0 ? `hue-rotate(${Math.round((this.time * 240) % 360)}deg) saturate(1.4)` : '';
    }
    this.handleWorldEvents();
    this.updateFlights(st === 'celebrate' ? dt * Math.max(0.5, this.timeScale) : dt);
    this.fx.update(dt);
    this.camera.update(dt, this.settings.screenShake && !this.settings.reducedMotion);
    if (this.world.mods.tilt) this.ui.setBubble(true, this.world.tilt.x, this.world.tilt.y);
    else this.ui.setBubble(false);
    if (st === 'play' || st === 'celebrate') this.updateHud();
    this.draw();

    // FPS counter (Settings → Show FPS, or F2).
    const f = this.fps;
    f.frames++; f.t += rawDt;
    if (f.t >= 0.5) {
      if (this.settings.showFps) {
        const beans = this.world.beans.length;
        this.ui.setFps(`${Math.round(f.frames / f.t)} FPS · ${(1000 * f.t / f.frames).toFixed(1)} ms · ${beans} beans · q${this.quality}`);
      }
      f.frames = 0; f.t = 0;
    }
  }

  draw() {
    const r = this.renderer, cam = this.camera;
    r.hover = this.state === 'play' && !this.held && !this.touch ? this.hoverBean : null;
    let light = null;
    if (this.held) light = { x: this.held.x, y: this.held.y };
    else if (this.input.mouse.inside) light = { x: this.input.mouse.x, y: this.input.mouse.y };
    else if (this.pointer.x >= 0) light = this.pointer;
    const energy = this.state === 'play' && this.session && !this.settings.performance ? comboEnergy(this.session.streak) : 0;
    r.drawWorld(this.world, cam, { time: this.time, light, energy });

    r.beginFx();
    // Beans in flight
    for (const f of this.flights) {
      const k = Math.min(1, f.t / f.dur);
      let x, y, scale = f.scale || 1, alpha = 1, lift = f.lift;
      if (f.kind === 'in' || f.kind === 'bounce') {
        // Snappy ease-in toward the container, shrinking as it drops in.
        const e = f.kind === 'in' ? k * k * (3 - 2 * k) : easeInOutCubic(k);
        x = lerp(f.fx, f.tx, e);
        y = lerp(f.fy, f.ty, e) - Math.sin(Math.PI * k) * 30;
        if (f.kind === 'in') { scale *= lerp(1, 0.4, e * e); alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1; }
        f.bean.a += 0.14;
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
      r.drawLifted(h.bean, h.x, h.y, Math.max(cam.zoom, 0.95) * this.heldScale(h), 0.4 + h.lift);
    }
    this.fx.draw(r);
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
