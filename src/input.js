/* =============================================================================
 * 合成大菲比 · 输入（鼠标 / 触摸 / 键盘）
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  function Input(canvas, renderer, game, hooks) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.game = game;
    this.hooks = hooks || {};
    this.keys = {};
    this.pointerDown = false;
    this.pointerType = 'mouse';
    this.bind();
  }

  Input.prototype.bind = function () {
    var self = this;
    var canvas = this.canvas;

    function logical(e) {
      return self.renderer.toLogical(e.clientX, e.clientY);
    }

    canvas.addEventListener('pointermove', function (e) {
      if (self.game.state !== 'playing') return;
      var p = logical(e);
      self.game.setDropX(p.x);
    }, { passive: true });

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (self.hooks.onFirstInteract) self.hooks.onFirstInteract();
      self.pointerDown = true;
      self.pointerType = e.pointerType || 'mouse';
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (self.game.state !== 'playing') return;
      var p = logical(e);
      self.game.setDropX(p.x);
      /* 鼠标：按下就投；触摸：松手再投，方便拖动选位置 */
      if (self.pointerType !== 'touch') self.game.drop();
    }, { passive: false });

    canvas.addEventListener('pointerup', function (e) {
      if (!self.pointerDown) return;
      self.pointerDown = false;
      if (self.pointerType === 'touch' && self.game.state === 'playing') {
        self.game.drop();
      }
    }, { passive: true });

    canvas.addEventListener('pointercancel', function () { self.pointerDown = false; }, { passive: true });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* 键盘 */
    window.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === ' ' || k === 'Spacebar' || k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
        if (e.target === document.body || e.target === canvas) e.preventDefault();
      }
      self.keys[k] = true;

      if (k === ' ' || k === 'Enter' || k === 'ArrowDown') {
        if (self.hooks.onFirstInteract) self.hooks.onFirstInteract();
        if (self.game.state === 'playing') self.game.drop();
      } else if (k === 'r' || k === 'R') {
        if (self.hooks.onRestart) self.hooks.onRestart();
      } else if (k === 'm' || k === 'M') {
        if (self.hooks.onToggleSound) self.hooks.onToggleSound();
      } else if (k === 'p' || k === 'P' || k === 'Escape') {
        if (self.hooks.onPause) self.hooks.onPause();
      }
    });

    window.addEventListener('keyup', function (e) { self.keys[e.key] = false; });
    window.addEventListener('blur', function () { self.keys = {}; self.pointerDown = false; });
  };

  /* 每帧读取方向键，返回 -1 / 0 / 1 */
  Input.prototype.axis = function () {
    var l = this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A'];
    var r = this.keys['ArrowRight'] || this.keys['d'] || this.keys['D'];
    return (r ? 1 : 0) - (l ? 1 : 0);
  };

  SKD.Input = Input;
})(window.SKD);
