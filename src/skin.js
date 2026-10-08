/* =============================================================================
 * 合成大菲比 · 贴图 / 外观
 * -----------------------------------------------------------------------------
 * 贴图从 assets/skins/<皮肤>/ 里按 config.js 的 tiers[i].img 读。
 * 读不到就画一个「代码占位球」，所以你现在没有任何素材也能直接玩。
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  var CFG = SKD.CONFIG;

  function Skin() {
    this.images = [];
    this.ready = [];
    this.failed = [];
    this.dir = CFG.skin.dir;
    this.load();
  }

  Skin.prototype.load = function () {
    var self = this;
    var tiers = CFG.tiers;
    for (var i = 0; i < tiers.length; i++) {
      (function (idx) {
        var img = new Image();
        img.onload = function () { self.ready[idx] = true; };
        img.onerror = function () {
          self.failed[idx] = true;
          if (window.console) console.warn('[皮肤] 贴图加载失败，使用占位绘制：' + self.dir + CFG.tiers[idx].img);
        };
        img.src = self.dir + tiers[idx].img;
        self.images[idx] = img;
      })(i);
    }
  };

  Skin.prototype.image = function (tier) {
    return this.ready[tier] ? this.images[tier] : null;
  };

  Skin.prototype.color = function (tier) {
    var t = CFG.tiers[tier];
    return t ? t.color : '#cccccc';
  };

  Skin.prototype.name = function (tier) {
    var t = CFG.tiers[tier];
    return t ? t.name : '';
  };

  /* ----------------------------- 代码占位球 ------------------------------ */
  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r + amount)));
    g = Math.max(0, Math.min(255, Math.round(g + amount)));
    b = Math.max(0, Math.min(255, Math.round(b + amount)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  Skin.prototype.drawPlaceholder = function (ctx, tier, r) {
    var t = CFG.tiers[tier] || { color: '#cccccc', short: '?' };

    var g = ctx.createRadialGradient(-r * 0.32, -r * 0.38, r * 0.15, 0, 0, r * 1.12);
    g.addColorStop(0, shade(t.color, 46));
    g.addColorStop(0.62, t.color);
    g.addColorStop(1, shade(t.color, -34));

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    /* 描边 */
    ctx.lineWidth = Math.max(1.2, r * 0.055);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();

    /* 高光 */
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -r * 0.4, r * 0.3, r * 0.19, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fill();

    /* 脸 */
    if (r > 12) {
      var eyeR = Math.max(1.6, r * 0.115);
      var eyeY = -r * 0.06;
      var eyeX = r * 0.30;

      ctx.fillStyle = 'rgba(48,44,66,0.92)';
      ctx.beginPath(); ctx.arc(-eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(-eyeX - eyeR * 0.28, eyeY - eyeR * 0.34, eyeR * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(eyeX - eyeR * 0.28, eyeY - eyeR * 0.34, eyeR * 0.36, 0, Math.PI * 2); ctx.fill();

      /* 腮红 */
      ctx.fillStyle = 'rgba(255,140,160,0.42)';
      ctx.beginPath(); ctx.ellipse(-r * 0.55, r * 0.16, r * 0.16, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.55, r * 0.16, r * 0.16, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();

      /* 嘴 */
      ctx.strokeStyle = 'rgba(70,60,86,0.85)';
      ctx.lineWidth = Math.max(1, r * 0.045);
      ctx.beginPath();
      ctx.arc(0, r * 0.14, r * 0.16, 0.22 * Math.PI, 0.78 * Math.PI);
      ctx.stroke();
    }

    /* 等级数字 */
    if (r > 20) {
      ctx.font = 'bold ' + Math.round(r * 0.34) + 'px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'rgba(90,80,110,0.35)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      var label = String(tier + 1);
      ctx.strokeText(label, 0, r * 0.6);
      ctx.fillText(label, 0, r * 0.6);
    }
  };

  /* ------------------------------ 画一颗球 --------------------------------
   * opts: { alpha, glow, scale, noRotate }
   * ---------------------------------------------------------------------- */
  Skin.prototype.drawBall = function (ctx, tier, r, angle, opts) {
    opts = opts || {};
    var alpha = opts.alpha == null ? 1 : opts.alpha;
    var scale = opts.scale == null ? 1 : opts.scale;
    var img = this.image(tier);

    ctx.save();
    ctx.globalAlpha = alpha;

    /* 合成高光 */
    if (opts.glow) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.16, 0, Math.PI * 2);
      var gg = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 1.3);
      gg.addColorStop(0, 'rgba(255,255,255,' + (0.55 * opts.glow) + ')');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      ctx.fill();
    }

    ctx.scale(scale, scale);
    if (!opts.noRotate) ctx.rotate(angle || 0);

    if (img) {
      var size = r * 2;
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      this.drawPlaceholder(ctx, tier, r);
    }

    ctx.restore();
  };

  SKD.Skin = Skin;
})(window.SKD);
