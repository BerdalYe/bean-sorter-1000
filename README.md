# Bean Sorter 1000

A strangely serious simulator about an incredibly stupid job: sort every bean on the table into the right container.

**Play it:** https://berdalye.github.io/bean-sorter-1000/

## What's in v2.0

- **10 levels**: five main shifts ending with *The Thousand* (1,000 beans), then five challenge levels: Darkness, Earthquake, Conveyor, Color Hell and Beanpocalypse (1,200 beans, every modifier).
- **Cinematic level intros**, a staged final-bean celebration (much bigger on boss levels) and an animated shift report.
- **Combo ladder** from GOOD BEANS (5) to BEAN SORTING HAS BEEN COMPLETED (1,000). The table glows and the HUD heats up during long streaks.
- **Beans per minute**: a smoothed live readout, plus average and peak on the report.
- **Rare beans** (5% uncommon, 0.9% rare, 0.1% legendary). They're purely cosmetic and are recorded in the **Beandex**.
- **Career rank** (Bean Intern → Supreme Bean Authority), 32 achievements (some secret), career statistics.
- **7 workstation environments** unlocked by progress.
- **Settings**: master/effects volume, particles, shadows, performance mode, FPS counter (F2), color symbols, interface size, haptics, reduced motion, screen shake, fullscreen.
- **Haptics** on phones: the Vibration API on Android, and the switch-control haptic on iOS 18+.

## Run it

It's a static site with no build step and no dependencies. Browsers don't load ES modules from `file://`, so serve the folder:

```
python3 -m http.server 8080      # or: npm start
```

Then open http://localhost:8080.

Tests: `npm test` (Node 18+). These cover levels, rank maths, sessions and combos, achievements, save data and geometry helpers.

## Controls

| | Desktop | Touch |
|---|---|---|
| Move a bean | Click and drag | Drag with one finger |
| Zoom | Mouse wheel, `+` / `-` | Pinch |
| Pan | Space + drag, middle-drag, or drag empty table | Two-finger drag, or drag empty table |
| Inspect a bean | Right-click (or `I`) | Long-press |
| Reset view | `0` | ⤢ button |
| Pause / mute | `Esc` / `M` | Buttons in the top bar |

## Architecture

```
index.html        markup for canvases, HUD, tray and overlays
css/style.css     all styling (one committed "lab equipment" look)
js/
  main.js         boot + requestAnimationFrame loop
  game.js         controller / state machine: input → world → session → UI, audio, saving
  world.js        table, beans, conveyor, fan, tilt, shaking, and the chaos schedule
  physics.js      capsule collisions, pile layers, sleeping, uniform-grid broad phase
  beans.js        bean objects + SpriteBank (pre-rendered bean images at 3 resolutions)
  renderer.js     canvas drawing, cached table image, lighting
  camera.js       zoom / pan / screen shake
  input.js        Pointer Events gestures (drag, pan, pinch, long-press, wheel)
  session.js      score, accuracy, streaks, combos (pure)
  config.js       levels, colours, combos, grades, flavour text (pure)
  achievements.js achievement list, progress and checks (pure)
  beandex.js      rarity odds, varieties, Beandex entries (pure)
  career.js       career ranks and environment unlocks (pure)
  themes.js       procedural table textures for each environment
  haptics.js      vibration / iOS switch haptics
  storage.js      localStorage save with safe fallbacks (pure)
  audio.js        every sound synthesised with Web Audio (no audio files)
  fx.js           sparks, confetti, bean rain, fireworks
  ui.js           DOM: HUD, container tray, menus, shift report, pop-ups
tests/            node:test unit tests
tools/            build-artifact.mjs: makes dist/ for hosts that supply their own <html> wrapper
```

### How 1,000 beans stay smooth

- **Sprites, not paths.** Each colour has 12 unique bean shapes (kidney dent, hilum, specks, wrinkles, slight colour jitter). Each shape is drawn once to an offscreen canvas at three resolutions. After that a bean costs two `drawImage` calls per frame: one for the shadow, one for the body. Off-screen beans are skipped.
- **Grid broad phase.** Collision checks only look at beans in the 3×3 grid cells around each bean. The grid lives in typed arrays, so nothing is allocated per frame.
- **Sleeping.** Beans at rest stop being simulated until something disturbs them.
- **Cached table.** The table, its markings and the belt frame are drawn once per zoom level into one image.
- **Adaptive quality.** If frames stay slow for 3 seconds, the game drops to 1× resolution, then turns off bean shadows. Performance mode does both straight away.
- **One object shape per bean.** Every bean field is declared when the bean is created. Adding fields later made the physics loop about 4× slower in profiling.
- **Pooled particles.** Effect particles are recycled instead of allocated.

Measured in headless Chromium with 1,000 beans: game logic takes about 2 ms per frame (about 4 ms with shake, fan and tilt all active). Physics takes about 0.6 ms per step.

### Piles

Beans sit on integer layers. A bean dropped on a heap sits on top of it. A piled bean that isn't resting on anything falls one layer. While it is supported, it slowly slides off. Heaps therefore spread out over time, and beans hidden underneath eventually appear.

## Saving

Everything saves to `localStorage` on this device: settings, unlocked levels, best results, lifetime statistics, achievements, the Beandex, and an unfinished level (every bean's position). Levels resume from **Continue** on the main menu. The save format is versioned: v1 saves are upgraded automatically, and unreadable data falls back to a fresh save. **Settings → Reset save data** erases everything after a confirmation.
