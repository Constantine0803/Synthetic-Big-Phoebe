/* =============================================================================
 * 合成大菲比 · 主程序（装配 + DOM 界面 + 主循环）
 * ========================================================================== */
(function (SKD) {
  'use strict';

  var CFG = SKD.CONFIG;

  function $(id) { return document.getElementById(id); }

  /* ------------------------------- 初始化 -------------------------------- */
  var canvas = $('game');
  var sound = new SKD.Sound();
  var skin = new SKD.Skin();
  var world = new SKD.World();
  var game = new SKD.Game(world, skin, sound);
  var renderer = new SKD.Renderer(canvas, game, skin);

  sound.setEnabled(SKD.Store.get('sound', CFG.audio.enabled));

  var bestBeforeRun = game.best;

  var input = new SKD.Input(canvas, renderer, game, {
    onFirstInteract: function () { sound.init(); },
    onRestart: function () { doRestart(); },
    onToggleSound: function () { toggleSound(); },
    onPause: function () { togglePause(); }
  });

  /* ------------------------------ DOM 元素 ------------------------------- */
  var elScore = $('score');
  var elBest = $('best');
  var elCombo = $('combo');
  var elChain = $('chain');
  var elPreview = $('next-preview');
  var previewCtx = elPreview ? elPreview.getContext('2d') : null;
  var ovStart = $('overlay-start');
  var ovOver = $('overlay-over');
  var ovHelp = $('overlay-help');
  var ovPause = $('overlay-pause');
  var elMute = $('btn-sound');

  if (elPreview) {
    var pdpr = Math.min(window.devicePixelRatio || 1, 2);
    elPreview.width = 104 * pdpr;
    elPreview.height = 104 * pdpr;
    previewCtx.setTransform(pdpr, 0, 0, pdpr, 0, 0);
  }

  /* 标题和副标题以 config.js 为准，避免 HTML 和配置两处写法不一致 */
  (function applyTitle() {
    if (CFG.title) {
      document.title = CFG.title;
      var t = $('game-title');
      if (t) t.textContent = CFG.title;
    }
    var s = $('game-sub');
    if (s && CFG.subtitle) s.textContent = CFG.subtitle;
  })();

  /* ------------------------------ 合成链图鉴 ------------------------------ */
  (function buildChain() {
    if (!elChain) return;
    var html = '';
    for (var i = 0; i < CFG.tiers.length; i++) {
      var t = CFG.tiers[i];
      html += '<div class="chain-item" data-tier="' + i + '">' +
        '<span class="chain-idx">' + ((i < 10 ? '0' : '') + i) + '</span>' +
        '<img class="chain-img" src="' + CFG.skin.dir + t.img + '" alt="' + t.name + '" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';">' +
        '<span class="chain-dot" style="display:none;background:' + t.color + '">' + t.short + '</span>' +
        '<span class="chain-name">' + t.name + '</span>' +
        '<span class="chain-score">' + (t.score > 0 ? '+' + t.score : '起点') + '</span>' +
        '</div>';
      if (i < CFG.tiers.length - 1) html += '<div class="chain-arrow">↓</div>';
    }
    elChain.innerHTML = html;
  })();

  function refreshChain() {
    if (!elChain) return;
    var items = elChain.querySelectorAll('.chain-item');
    for (var i = 0; i < items.length; i++) {
      var t = parseInt(items[i].getAttribute('data-tier'), 10);
      if (game.unlocked[t]) items[i].classList.remove('locked');
      else items[i].classList.add('locked');
    }
  }

  /* ------------------------------- UI 同步 ------------------------------- */
  function syncScore() {
    if (elScore) elScore.textContent = game.score;
    if (elBest) elBest.textContent = game.best;
  }

  game.on.score = function () { syncScore(); };
  game.on.combo = function (c) {
    if (!elCombo) return;
    elCombo.textContent = c > 1 ? ('×' + c) : '—';
    elCombo.classList.toggle('hot', c > 1);
  };
  game.on.unlock = function () { refreshChain(); };
  game.on.state = function (s) {
    if (s === 'playing') {
      show(ovStart, false); show(ovOver, false); show(ovPause, false); show(ovHelp, false);
    } else if (s === 'over') {
      setTimeout(showOver, 620);
    } else if (s === 'paused') {
      if (sound.stopVoice) sound.stopVoice();   // 暂停时把正在念的台词掐掉
      show(ovPause, true);
    }
  };

  function show(el, on) {
    if (!el) return;
    el.classList.toggle('hidden', !on);
  }

  function showOver() {
    if (game.state !== 'over') return;
    var isNew = game.score > bestBeforeRun && game.score > 0;
    $('final-score').textContent = game.score;
    $('final-best').textContent = game.best;
    $('final-combo').textContent = '×' + game.bestCombo;
    $('final-tier').textContent = CFG.tiers[game.maxTierReached].name;
    $('final-time').textContent = Math.floor(game.elapsed) + 's';
    $('final-new').classList.toggle('hidden', !isNew);
    show(ovOver, true);
  }

  /* -------------------------------- 操作 --------------------------------- */
  function startGame() {
    bestBeforeRun = game.best;
    sound.init();
    game.start();
    refreshChain();
    syncScore();
  }
  function doRestart() {
    sound.init();
    bestBeforeRun = game.best;
    game.restart();
    refreshChain();
    syncScore();
  }
  function togglePause() {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    var s = game.togglePause();
    if (s === 'paused') sound.play('ui');
  }
  function toggleSound() {
    var on = sound.toggle();
    SKD.Store.set('sound', on);
    if (elMute) {
      elMute.textContent = on ? '🔊 音效开' : '🔇 音效关';
      elMute.classList.toggle('off', !on);
    }
    return on;
  }

  /* 预演一下按钮状态 */
  if (elMute) {
    elMute.textContent = sound.enabled ? '🔊 音效开' : '🔇 音效关';
    elMute.classList.toggle('off', !sound.enabled);
  }

  var bind = function (id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', function (e) { e.preventDefault(); sound.init(); fn(); });
  };
  bind('btn-start', startGame);
  bind('btn-again', startGame);
  bind('btn-restart', doRestart);
  bind('btn-restart-pause', doRestart);
  bind('btn-help', function () { show(ovHelp, true); });
  bind('btn-help-close', function () { show(ovHelp, false); });
  bind('btn-pause', togglePause);
  bind('btn-resume', togglePause);
  bind('btn-sound', toggleSound);
  bind('btn-title', function () {
    game.state = 'ready';
    game.reset();
    syncScore(); refreshChain();
    show(ovOver, false); show(ovStart, true);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === 'playing') togglePause();
  });

  window.addEventListener('resize', function () { renderer.resize(); });

  /* ------------------------------- 预览绘制 ------------------------------ */
  function drawPreview() {
    if (!previewCtx) return;
    previewCtx.clearRect(0, 0, 104, 104);
    previewCtx.save();
    previewCtx.translate(52, 54);
    var t = game.nextTier;
    var r = Math.min(38, CFG.tiers[t].r);
    skin.drawBall(previewCtx, t, r, 0, { noRotate: true });
    previewCtx.restore();
  }

  /* -------------------------------- 主循环 ------------------------------- */
  var last = performance.now();
  function frame(now) {
    var dtMs = Math.min(50, now - last);
    last = now;
    var dt = dtMs / 1000;

    if (game.state === 'playing') {
      var ax = input.axis();
      if (ax) game.moveDrop(ax * 560 * dt);
    }

    game.update(dt, dtMs);
    renderer.draw(now);
    drawPreview();

    /* combo 倒计时条（顺手用文字表现） */
    if (elCombo && game.combo > 1 && game.comboTimer > 0) {
      elCombo.style.setProperty('--p', (game.comboTimer / CFG.rules.comboWindowMs * 100) + '%');
    }

    requestAnimationFrame(frame);
  }

  game.reset();
  refreshChain();
  syncScore();
  show(ovStart, true);
  requestAnimationFrame(frame);

  /* 调试用：控制台可以直接玩 */
  window.HCFB = { game: game, world: world, skin: skin, sound: sound, renderer: renderer, config: CFG };
})(window.SKD);
