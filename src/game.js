/* =============================================================================
 * 合成大菲比 · 玩法逻辑
 * -----------------------------------------------------------------------------
 * 投放 / 合成 / 连击 / 警戒线判负 / 特效数据。
 * 渲染和输入都不在这里，方便单独调参。
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  var CFG = SKD.CONFIG;
  var R = CFG.rules;

  function Game(world, skin, sound) {
    this.world = world;
    this.skin = skin;
    this.sound = sound;

    this.state = 'ready';        // ready | playing | over | paused
    this.prevState = 'ready';
    this.score = 0;
    this.overTimer = 0;
    this.best = SKD.Store.get('best', 0);
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.cooldown = 0;
    this.dangerTimer = 0;
    this.dangerLevel = 0;        // 0~1，给渲染做红光用
    this.dropX = CFG.board.width / 2;
    this.heldTier = 0;
    this.nextTier = 0;
    this.heldBob = 0;
    this.particles = [];
    this.popups = [];
    this.rings = [];
    this.shake = 0;
    this.elapsed = 0;
    this.unlocked = this.loadUnlocked();
    this.mergeCount = 0;
    this.maxTierReached = 0;

    /* 外部事件钩子（main.js 里挂 DOM 更新） */
    this.on = {
      score: null, combo: null, state: null, unlock: null, merge: null
    };
  }

  Game.prototype.emit = function (name, payload) {
    var fn = this.on[name];
    if (fn) fn(payload);
  };

  /* ------------------------------- 随机球 -------------------------------- */
  /* 能直接投出来的等级，一开始就在图鉴里亮着 */
  Game.prototype.defaultUnlocked = function () {
    var arr = [];
    for (var i = 0; i < CFG.tiers.length; i++) arr.push(R.dropPool.indexOf(i) >= 0);
    return arr;
  };

  /* 等级数量变了（比如新增 tier-00）时旧存档会长度不符，必须重建而不是直接用 */
  Game.prototype.loadUnlocked = function () {
    var saved = SKD.Store.get('unlocked', null);
    if (!saved || !saved.length || saved.length !== CFG.tiers.length) {
      saved = this.defaultUnlocked();
      SKD.Store.set('unlocked', saved);
    }
    return saved;
  };

  Game.prototype.randomTier = function () {
    var pool = R.dropPool;
    var weights = R.dropWeights;
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += weights[i];
    var x = Math.random() * total;
    for (i = 0; i < pool.length; i++) {
      x -= weights[i];
      if (x <= 0) return pool[i];
    }
    return pool[0];
  };

  /* -------------------------------- 开局 --------------------------------- */
  Game.prototype.reset = function () {
    this.world.clear();
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.cooldown = 0;
    this.dangerTimer = 0;
    this.dangerLevel = 0;
    this.elapsed = 0;
    this.overTimer = 0;
    this.mergeCount = 0;
    this.maxTierReached = 0;
    this.particles.length = 0;
    this.popups.length = 0;
    this.rings.length = 0;
    this.shake = 0;
    this.heldTier = this.randomTier();
    this.nextTier = this.randomTier();
    this.dropX = CFG.board.width / 2;
    this.unlocked = this.loadUnlocked();
    this.clampDropX();
    this.emit('score', this.score);
    this.emit('combo', 0);
  };

  Game.prototype.start = function () {
    this.reset();
    this.state = 'playing';
    this.emit('state', this.state);
  };

  Game.prototype.restart = function () {
    this.start();
  };

  Game.prototype.togglePause = function () {
    if (this.state === 'playing') {
      this.prevState = 'playing';
      this.state = 'paused';
    } else if (this.state === 'paused') {
      this.state = this.prevState || 'playing';
    }
    this.emit('state', this.state);
    return this.state;
  };

  /* ------------------------------ 投放控制 -------------------------------- */
  Game.prototype.heldRadius = function () {
    return CFG.tiers[this.heldTier].r;
  };

  Game.prototype.clampDropX = function () {
    var r = this.heldRadius();
    var min = this.world.left + r;
    var max = this.world.right - r;
    if (this.dropX < min) this.dropX = min;
    if (this.dropX > max) this.dropX = max;
  };

  Game.prototype.setDropX = function (x) {
    this.dropX = x;
    this.clampDropX();
  };

  Game.prototype.moveDrop = function (dx) {
    this.setDropX(this.dropX + dx);
  };

  Game.prototype.canDrop = function () {
    return this.state === 'playing' && this.cooldown <= 0;
  };

  Game.prototype.drop = function () {
    if (!this.canDrop()) return false;
    var tier = this.heldTier;
    var r = CFG.tiers[tier].r;
    var x = this.dropX;
    var y = CFG.board.dropY;

    /* 下坠初速度：让球一出手就有重量感 */
    var v = 140; // 单位/秒
    var ball = new SKD.Ball(x, y, r, tier);
    ball.py = y - v * CFG.physics.fixedDt;

    this.world.add(ball);
    this.wakeNear(x, y, r + 60);

    this.heldTier = this.nextTier;
    this.nextTier = this.randomTier();
    this.cooldown = R.dropCooldownMs;
    this.clampDropX();

    if (this.sound) {
      this.sound.play('drop');
      /* 可选：投放某些等级时也念台词（00 / 01 永远不会被合成出来，只能投放） */
      var onDrop = CFG.audio.voiceOnDrop;
      if (onDrop && onDrop.indexOf(tier) >= 0 && this.sound.playVoice) {
        this.sound.playVoice(tier);
      }
    }
    this.emit('combo', 0);
    return true;
  };

  /* ------------------------------ 唤醒附近 -------------------------------- */
  Game.prototype.wakeNear = function (x, y, radius) {
    var balls = this.world.balls;
    var r2 = radius * radius;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      var dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < r2) this.world.wake(b);
    }
  };

  /* -------------------------------- 主更新 -------------------------------- */
  Game.prototype.update = function (dtSec, dtMs) {
    /* 物理：进行中继续跑；结束后再跑一小会儿让球堆落定，然后冻结画面 */
    if (this.state === 'playing') {
      this.world.advance(dtSec);
    } else if (this.state === 'over') {
      this.overTimer += dtSec;
      if (this.overTimer * 1000 < R.overFreezeMs) this.world.advance(dtSec);
    }

    this.heldBob += dtSec;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtSec * 60);

    this.updateEffects(dtSec);

    if (this.state !== 'playing') return;

    this.elapsed += dtSec;
    if (this.cooldown > 0) this.cooldown -= dtMs;

    if (this.comboTimer > 0) {
      this.comboTimer -= dtMs;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.combo = 0;
        this.emit('combo', 0);
      }
    }

    this.checkMerges();
    this.updateDanger(dtMs);
  };

  /* ------------------------------- 合成规则 -------------------------------
   * 返回值：
   *   数字 >= 0 : 合成后产生的新等级
   *   -1        : 两颗一起消失（两个最大号对撞）
   *   null      : 这两颗不能合成
   * 规则来自 config.rules.mergeRules，改配置就能改玩法。
   * ---------------------------------------------------------------------- */
  Game.prototype.mergeResult = function (ta, tb) {
    var mr = R.mergeRules;
    var sp = mr.special;
    var i;

    /* 特例组合优先（a / b 顺序无关） */
    for (i = 0; i < sp.length; i++) {
      var s = sp[i];
      if ((ta === s.a && tb === s.b) || (ta === s.b && tb === s.a)) return s.result;
    }

    /* 同号合成：只有 >= sameMinTier 的等级才行 */
    if (ta === tb && ta >= mr.sameMinTier) {
      var next = ta + mr.sameOffset;
      return next < CFG.tiers.length ? next : -1;
    }

    return null;
  };

  /* ------------------------------- 合成检测 ------------------------------- */
  Game.prototype.checkMerges = function () {
    var balls = this.world.balls;
    var n = balls.length;
    if (n < 2) return;

    var used = new Array(n);
    var jobs = [];
    var limit = R.mergeTouch;

    for (var i = 0; i < n; i++) {
      if (used[i]) continue;
      var a = balls[i];
      for (var j = i + 1; j < n; j++) {
        if (used[j]) continue;
        var b = balls[j];
        var result = this.mergeResult(a.tier, b.tier);
        if (result === null) continue;
        var dx = b.x - a.x, dy = b.y - a.y;
        var lim = a.r + b.r + limit;
        if (dx * dx + dy * dy <= lim * lim) {
          used[i] = true;
          used[j] = true;
          jobs.push({ a: a, b: b, result: result });
          break;
        }
      }
    }

    for (i = 0; i < jobs.length; i++) this.merge(jobs[i].a, jobs[i].b, jobs[i].result);
  };

  Game.prototype.merge = function (a, b, result) {
    var world = this.world;
    var tier = a.tier;
    var x = (a.x + b.x) / 2;
    var y = (a.y + b.y) / 2;

    /* 保留一点动量，合成后不会突然「钉」在原地 */
    var vx = ((a.x - a.px) + (b.x - b.px)) / 2;
    var vy = ((a.y - a.py) + (b.y - b.py)) / 2;

    world.remove(a);
    world.remove(b);

    /* 连击 */
    if (this.comboTimer > 0) this.combo += 1; else this.combo = 1;
    this.comboTimer = R.comboWindowMs;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;

    var disappear = (result < 0);          // 两个最大号对撞
    var nextTier = disappear ? -1 : result;
    var baseScore = disappear ? R.maxTierBonus : CFG.tiers[nextTier].score;
    var mult = 1 + (this.combo - 1) * R.comboBonus;
    var gained = Math.round(baseScore * mult);

    this.addScore(gained, x, y);
    this.mergeCount++;
    this.emit('combo', this.combo);

    if (!disappear) {
      var nr = CFG.tiers[nextTier].r;
      var ball = new SKD.Ball(x, y, nr, nextTier);
      ball.px = x - vx;
      ball.py = y - vy;
      ball.pop = 1;
      ball.glow = 1;
      world.add(ball);
      this.wakeNear(x, y, nr + 50);

      if (!this.unlocked[nextTier]) {
        this.unlocked[nextTier] = true;
        SKD.Store.set('unlocked', this.unlocked);
        this.emit('unlock', nextTier);
      }
      if (nextTier > this.maxTierReached) this.maxTierReached = nextTier;
    } else {
      this.wakeNear(x, y, 200);
    }

    /* 特效 */
    var colorTier = disappear ? tier : nextTier;
    var isMax = disappear;
    this.burst(x, y, CFG.tiers[colorTier].r, CFG.tiers[colorTier].color, isMax ? 26 : 14);
    this.rings.push({ x: x, y: y, r: CFG.tiers[colorTier].r * 0.6, max: CFG.tiers[colorTier].r * 2.4, life: 1 });
    this.pushPopup(x, y - CFG.tiers[colorTier].r * 0.4, '+' + gained, this.combo > 1 ? '#ff8fa3' : '#5a6b88', this.combo > 1 ? 26 : 22);
    if (this.combo > 1) {
      this.pushPopup(x, y - CFG.tiers[colorTier].r * 0.4 - 26, '连击 ×' + this.combo, '#f2a3b8', 20);
    }

    /* 音效：合成出新团子时播「出场音效」+ 这个角色的「出场台词」
       （两者都可以在 config.audio 里换成自己的音频），
       等级高的再叠一层彩头；两个最大号对撞没有新团子，只放彩头。 */
    var big = isMax || tier >= 6;
    this.shake = Math.min(16, this.shake + (isMax ? 12 : tier >= 4 ? 6 : 2.5));
    if (this.sound) {
      if (disappear) {
        this.sound.play('big');
      } else {
        this.sound.play('spawn', { tier: nextTier });
        if (this.sound.playVoice) this.sound.playVoice(nextTier);
        if (big) this.sound.play('big');
      }
    }

    if (navigator.vibrate && (isMax || tier >= 7)) {
      try { navigator.vibrate(isMax ? 60 : 25); } catch (e) {}
    }
  };

  Game.prototype.addScore = function (v, x, y) {
    this.score += v;
    if (this.score > this.best) {
      this.best = this.score;
      SKD.Store.set('best', this.best);
    }
    this.emit('score', this.score);
  };

  /* -------------------------------- 判负 --------------------------------- */
  Game.prototype.updateDanger = function (dtMs) {
    var line = CFG.board.dangerLineY;
    var grace = CFG.board.newBallGraceMs;
    var balls = this.world.balls;
    var danger = false;

    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.age * 1000 < grace) continue;                  // 刚投下的球不算
      if (b.y - b.r >= line) continue;                     // 没越过警戒线
      /* 已经顶到天花板：没救了，直接结束 */
      if (b.y - b.r <= this.world.top + 2) { this.gameOver(); return; }
      /* 只看「挨着别人或墙」的球：还在空中飞的球没有任何接触，不算堆住。
         不用速度判断——球堆堆满之后内部一直在翻动，速度永远降不下来，
         那样该结束的时候反而结束不了。 */
      if (!b.contact) continue;
      danger = true;
      break;
    }

    if (danger) this.dangerTimer += dtMs;
    else this.dangerTimer = Math.max(0, this.dangerTimer - dtMs * 2.5);

    this.dangerLevel = Math.min(1, this.dangerTimer / CFG.board.dangerGraceMs);

    if (danger && this.sound && this.dangerTimer > 200) {
      var now = this.elapsed * 1000;
      if (!this._lastWarn || now - this._lastWarn > 420) {
        this._lastWarn = now;
        this.sound.play('warn');
      }
    }

    if (this.dangerTimer >= CFG.board.dangerGraceMs) this.gameOver();
  };

  Game.prototype.gameOver = function () {
    if (this.state === 'over') return;
    this.state = 'over';
    this.dangerTimer = CFG.board.dangerGraceMs;
    this.shake = 14;
    if (this.sound) {
      if (this.sound.stopVoice) this.sound.stopVoice();
      this.sound.play('over');
    }
    SKD.Store.set('best', this.best);
    this.emit('state', this.state);
  };

  /* -------------------------------- 特效 --------------------------------- */
  Game.prototype.burst = function (x, y, r, color, count) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 120 + Math.random() * 340;
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        r: Math.max(2, r * (0.10 + Math.random() * 0.16)),
        color: color,
        life: 1, decay: 1.6 + Math.random() * 1.4
      });
    }
  };

  Game.prototype.pushPopup = function (x, y, text, color, size) {
    this.popups.push({ x: x, y: y, text: text, color: color, size: size || 22, life: 1, decay: 0.85 });
  };

  Game.prototype.updateEffects = function (dt) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.vy += 1200 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (i = this.popups.length - 1; i >= 0; i--) {
      p = this.popups[i];
      p.y -= 42 * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    for (i = this.rings.length - 1; i >= 0; i--) {
      p = this.rings[i];
      p.life -= dt * 2.4;
      p.r += (p.max - p.r) * Math.min(1, dt * 9);
      if (p.life <= 0) this.rings.splice(i, 1);
    }
  };

  SKD.Game = Game;
})(window.SKD);
