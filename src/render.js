/* =============================================================================
 * 合成大菲比 · 渲染（Canvas 2D）
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  var CFG = SKD.CONFIG;
  var B = CFG.board;
  var PAL = CFG.palette;

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function lerpColor(a, b, t) {
    function hex(c) {
      var n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var ca = hex(a), cb = hex(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function Renderer(canvas, game, skin) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.skin = skin;
    this.dpr = 1;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(B.width * dpr);
    this.canvas.height = Math.round(B.height * dpr);
  };

  Renderer.prototype.toLogical = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * B.width,
      y: (clientY - rect.top) / rect.height * B.height
    };
  };

  Renderer.prototype.draw = function (nowMs) {
    var ctx = this.ctx;
    var game = this.game;
    var world = game.world;
    var t = nowMs / 1000;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, B.width, B.height);

    /* 震屏 */
    if (game.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }

    /* 底板 */
    ctx.save();
    roundRect(ctx, 0, 0, B.width, B.height, 30);
    ctx.clip();
    var bg = ctx.createLinearGradient(0, 0, 0, B.height);
    bg.addColorStop(0, PAL.boardTop);
    bg.addColorStop(1, PAL.boardBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, B.width, B.height);

    /* 淡淡的格纹装饰 */
    ctx.strokeStyle = 'rgba(160,185,220,0.16)';
    ctx.lineWidth = 1;
    for (var gx = B.wall; gx < B.width; gx += 48) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, B.height); ctx.stroke();
    }
    for (var gy = 0; gy < B.height; gy += 48) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(B.width, gy); ctx.stroke();
    }

    /* 警戒线区域红光 */
    if (game.dangerLevel > 0.01) {
      var dl = game.dangerLevel;
      var warn = ctx.createLinearGradient(0, 0, 0, B.dangerLineY + 60);
      warn.addColorStop(0, 'rgba(255,80,110,' + (0.26 * dl) + ')');
      warn.addColorStop(1, 'rgba(255,80,110,0)');
      ctx.fillStyle = warn;
      ctx.fillRect(0, 0, B.width, B.dangerLineY + 60);
    }

    this.drawDangerLine(ctx, t, game);
    this.drawContainer(ctx);
    ctx.restore();

    /* 掉落辅助线 */
    this.drawGuide(ctx, t, game, world);

    /* 下一个（画在球下面，避免挡住待投放的球） */
    this.drawNextChip(ctx, game);

    /* 球 */
    this.drawBalls(ctx, world);

    /* 待投放的球 */
    if (game.state === 'playing' || game.state === 'paused' || game.state === 'ready') {
      this.drawHeld(ctx, t, game, world);
    }

    /* 特效 */
    this.drawEffects(ctx, game);

    /* 连击提示（画布内，靠上） */
    if (game.combo > 1 && game.comboTimer > 0) {
      var a = Math.min(1, game.comboTimer / 400);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(242,120,150,0.92)';
      ctx.fillText('连击 ×' + game.combo, B.width / 2, B.height * 0.30);
      ctx.restore();
    }
  };

  Renderer.prototype.drawContainer = function (ctx) {
    /* 上不封口的三面墙。路径取「笔画中线」，线宽 = 墙厚，
       这样画出来的内壁正好落在物理边界 left/right/bottom 上，球不会视觉上陷进地板。 */
    var w = B.wall;
    var L = B.wall - w / 2;                 // 左墙中线
    var Rt = B.width - B.wall + w / 2;      // 右墙中线
    var Bt = B.height - B.floor + w / 2;    // 地板中线
    var r = 26;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L, B.ceil);
    ctx.lineTo(L, Bt - r);
    ctx.arcTo(L, Bt, L + r, Bt, r);
    ctx.lineTo(Rt - r, Bt);
    ctx.arcTo(Rt, Bt, Rt, Bt - r, r);
    ctx.lineTo(Rt, B.ceil);

    ctx.lineCap = 'round';
    ctx.lineWidth = w;
    ctx.strokeStyle = PAL.wall;
    ctx.stroke();

    ctx.lineWidth = Math.max(1.5, w * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawDangerLine = function (ctx, t, game) {
    var y = B.dangerLineY;
    var level = game.dangerLevel;
    var blink = level > 0 ? (0.6 + 0.4 * Math.sin(t * (8 + level * 10))) : 1;
    var color = level > 0.01 ? lerpColor(PAL.dangerLineIdle, PAL.dangerLine, Math.min(1, level * 1.6)) : PAL.dangerLineIdle;

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(B.wall, y);
    ctx.lineTo(B.width - B.wall, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 18px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('警戒线', B.wall + 10, y - 8);
    ctx.restore();
  };

  Renderer.prototype.drawGuide = function (ctx, t, game, world) {
    if (game.state !== 'playing') return;
    var r = game.heldRadius();
    var x = game.dropX;
    var fromY = B.dropY;
    var landY = world.raycastY(x, fromY);

    ctx.save();
    ctx.setLineDash([9, 11]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,150,190,0.42)';
    ctx.beginPath();
    ctx.moveTo(x, fromY + r * 0.4);
    ctx.lineTo(x, Math.max(fromY + r, landY - r * 0.2));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.ellipse(x, landY - 2, r * 0.86, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120,150,190,0.16)';
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawBalls = function (ctx, world) {
    var balls = world.balls;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      ctx.save();
      ctx.translate(b.x, b.y);

      /* 落影 */
      ctx.beginPath();
      ctx.ellipse(0, b.r * 0.16, b.r * 0.94, b.r * 0.92, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(96,118,152,0.10)';
      ctx.fill();

      var scale = 1 + (b.pop > 0 ? b.pop * 0.22 : 0);
      this.skin.drawBall(ctx, b.tier, b.r, b.angle, { scale: scale, glow: b.glow });
      ctx.restore();
    }
  };

  Renderer.prototype.drawHeld = function (ctx, t, game, world) {
    var tier = game.heldTier;
    var r = CFG.tiers[tier].r;
    var x = game.dropX;
    var y = B.dropY + Math.sin(t * 3.2) * 3;

    ctx.save();
    ctx.globalAlpha = game.state === 'paused' ? 0.35 : 0.97;
    ctx.translate(x, y);
    this.skin.drawBall(ctx, tier, r, Math.sin(t * 1.6) * 0.05, {});
    ctx.restore();

    /* 轻微的下落箭头 */
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#7d90ad';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    var ay = y + r + 12;
    ctx.beginPath();
    ctx.moveTo(x, ay);
    ctx.lineTo(x, ay + 12);
    ctx.moveTo(x - 6, ay + 6);
    ctx.lineTo(x, ay + 12);
    ctx.lineTo(x + 6, ay + 6);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawNextChip = function (ctx, game) {
    var chip = CFG.board.nextChip;
    var tier = game.nextTier;
    var r = Math.min(chip.radius, CFG.tiers[tier].r);
    var cx = B.width * chip.x;
    var cy = B.height * chip.y;

    ctx.save();
    ctx.globalAlpha = 0.95;
    roundRect(ctx, cx - 34, cy - 34, 68, 68, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,200,225,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 12px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#93a5bd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEXT', cx, cy - 24);

    ctx.translate(cx, cy + 4);
    this.skin.drawBall(ctx, tier, r, 0, { noRotate: true });
    ctx.restore();
  };

  Renderer.prototype.drawEffects = function (ctx, game) {
    var i, p;
    ctx.save();
    for (i = 0; i < game.rings.length; i++) {
      p = game.rings[i];
      ctx.globalAlpha = Math.max(0, p.life) * 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5 * Math.max(0.2, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (i = 0; i < game.particles.length; i++) {
      p = game.particles[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + p.life * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < game.popups.length; i++) {
      p = game.popups[i];
      var a = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.globalAlpha = a;
      ctx.font = 'bold ' + p.size + 'px system-ui, "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  };

  SKD.Renderer = Renderer;
})(window.SKD);
