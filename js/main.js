// main.js — boot the game and run the frame loop.

import { Game } from './game.js';

function boot() {
  const game = new Game(document.getElementById('world'), document.getElementById('fx'));
  game.showMenu();

  let resizeQueued = false;
  const onResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; game.resize(); });
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  // Web fonts change HUD/tray heights once they arrive.
  document.fonts?.ready.then(onResize).catch(() => {});

  let last = performance.now();
  const loop = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    try {
      game.frame(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
