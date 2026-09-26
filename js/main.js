// main.js — boot the game and run the frame loop.

import { Game } from './game.js';

function boot() {
  const game = new Game(document.getElementById('world'), document.getElementById('fx'));
  // A note for anyone who opens the developer console.
  console.log('%cBEAN SORTER 1000%c\nProfessional Bean Organization Software, v2.0.\nThis console is monitored by the Department of Legume Classification. Please do not sort beans from here.',
    'font: 900 20px sans-serif; color: #dc5a20', 'font: 12px monospace; color: #7c8781');
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
