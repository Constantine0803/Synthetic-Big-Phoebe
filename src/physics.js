/* =============================================================================
 * 合成大菲比 · 物理引擎
 * -----------------------------------------------------------------------------
 * 自己写的「只有圆」的 2D 物理：Verlet 积分 + 位置约束迭代 + 休眠。
 * 不依赖任何第三方库，file:// 双击打开也能跑。
 *
 * 两个关键设计（踩过坑的）：
 *  1) 位置修正采用「纯投影」——修正量同时加到 x 和 px 上，不改变速度。
 *     否则合成时新球和邻居深度重叠，一帧就能被修正量弹到几千单位/秒，
 *     整个球堆会炸开、永远静不下来，判负也就永远不会触发。
 *  2) 弹性/摩擦是显式的速度冲量，和位置修正分开处理（split impulse 思路）。
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  var CFG = SKD.CONFIG;

  /* --------------------------------- 球 ----------------------------------- */
  function Ball(x, y, r, tier) {
    this.id = ++Ball.uid;
    this.tier = tier;
    this.r = r;
    this.x = x; this.y = y;
    this.px = x; this.py = y;      // 上一步位置（Verlet：速度 = x - px）
    this.angle = 0;
    this.age = 0;                  // 存在时间（秒）
    this.speed = 0;                // 速度（单位/秒），postStep 里更新
    this.sleeping = false;
    this.sleepTimer = 0;
    this.pop = 0;                  // 合成放大动画 1 -> 0
    this.glow = 0;                 // 合成高光 1 -> 0
    this.overlap = 0;              // 本帧最深的重叠量（用于禁止「带着穿插睡觉」）
    this.contact = false;          // 本帧有没有碰到别人 / 墙 / 地板
    this.wobble = Math.random() * Math.PI * 2;
  }
  Ball.uid = 0;

  /* -------------------------------- 世界 ---------------------------------- */
  function World() {
    var b = CFG.board;
    this.board = b;
    this.p = CFG.physics;
    this.balls = [];
    this.left = b.wall;
    this.right = b.width - b.wall;
    this.top = b.ceil;
    this.bottom = b.height - b.floor;
    this.accumulator = 0;
  }

  World.prototype.add = function (ball) { this.balls.push(ball); return ball; };

  World.prototype.remove = function (ball) {
    var i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
  };

  World.prototype.clear = function () { this.balls.length = 0; };

  World.prototype.wake = function (b) {
    b.sleeping = false;
    b.sleepTimer = 0;
  };

  World.prototype.wakeAll = function () {
    for (var i = 0; i < this.balls.length; i++) this.wake(this.balls[i]);
  };

  /* 纯投影式位移：同时移动当前位置与上一步位置，速度不变 */
  function project(b, dx, dy) {
    b.x += dx; b.y += dy;
    b.px += dx; b.py += dy;
  }

  /* 单步允许的最大位移（防穿透 + 限速） */
  function stepLimit(b, dt) {
    var p = CFG.physics;
    return Math.min(p.maxSpeed * dt, b.r * p.maxStepRatio);
  }

  /* 撞击速度低于阈值就完全不弹。
     否则球会以「重力加速一点、弹回九成」的方式永远做微小弹跳（实测稳定在 21 单位/秒），
     速度永远降不到休眠阈值以下，球堆就永远无法真正静止。 */
  World.prototype.restitutionFor = function (vPerStep) {
    var p = this.p;
    var speed = Math.abs(vPerStep) / p.fixedDt;
    return speed < p.bounceThreshold ? 0 : p.restitution;
  };

  /* ------------------------------- 单步推进 ------------------------------- */
  World.prototype.step = function (dt) {
    var p = this.p;
    var balls = this.balls;
    var i, b;

    /* 1) Verlet 积分 */
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (b.sleeping) { b.px = b.x; b.py = b.y; continue; }

      var vx = (b.x - b.px) * p.damping;
      var vy = (b.y - b.py) * p.damping;

      var maxStep = stepLimit(b, dt);
      var sp2 = vx * vx + vy * vy;
      if (sp2 > maxStep * maxStep) {
        var s = maxStep / Math.sqrt(sp2);
        vx *= s; vy *= s;
      }

      b.px = b.x; b.py = b.y;
      b.x += vx;
      b.y += vy + p.gravity * dt * dt;

      /* 滚动视觉：横向位移带动自转 */
      b.angle += (b.x - b.px) / Math.max(6, b.r) * p.rollFactor;
    }

    /* 2) 位置约束迭代
       注意：休眠的球不参与积分，位置也不会再被夹取，所以它的 contact 必须保留
       （否则「睡着的球」会被当成悬在空中，判负规则就永远不触发）。 */
    for (i = 0; i < balls.length; i++) {
      balls[i].overlap = 0;
      if (!balls[i].sleeping) balls[i].contact = false;
    }
    for (var it = 0; it < p.iterations; it++) {
      var first = (it === 0);
      for (i = 0; i < balls.length; i++) {
        var a = balls[i];
        for (var j = i + 1; j < balls.length; j++) {
          this.solvePair(a, balls[j], first);
        }
      }
      for (i = 0; i < balls.length; i++) this.solveWalls(balls[i]);
    }

    /* 3) 收敛后统一限速（只改 px，位置不动，因此不会破坏刚解开的穿插） */
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (b.sleeping) { b.px = b.x; b.py = b.y; continue; }
      var dx = b.x - b.px, dy = b.y - b.py;
      var m2 = stepLimit(b, dt);
      var d2 = dx * dx + dy * dy;
      if (d2 > m2 * m2) {
        var k = m2 / Math.sqrt(d2);
        b.px = b.x - dx * k;
        b.py = b.y - dy * k;
      }
    }
  };

  /* ------------------------------ 球与球约束 ------------------------------ */
  World.prototype.solvePair = function (a, b, firstPass) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var minD = a.r + b.r;
    var d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) return;

    var d = Math.sqrt(d2);
    var nx, ny;
    if (d < 1e-6) {
      var ang = Math.random() * Math.PI * 2;
      nx = Math.cos(ang); ny = Math.sin(ang); d = 1e-6;
    } else {
      nx = dx / d; ny = dy / d;
    }

    var p = this.p;

    /* 唤醒：够快的球撞上来，就把睡着的整堆叫醒 */
    if (firstPass) {
      if (a.sleeping && !b.sleeping && b.speed > p.wakeSpeed) this.wake(a);
      if (b.sleeping && !a.sleeping && a.speed > p.wakeSpeed) this.wake(b);
    }

    /* --- 位置修正（纯投影，不产生速度） --- */
    var overlap = minD - d - p.slop;
    if (overlap > 0) {
      if (overlap > a.overlap) a.overlap = overlap;
      if (overlap > b.overlap) b.overlap = overlap;
      a.contact = true;
      b.contact = true;
      var corr = Math.min(overlap * p.stiffness, p.maxSeparation);
      var ia = 1 / (a.r * a.r);      // 用 r² 当质量：大球更沉
      var ib = 1 / (b.r * b.r);

      if (a.sleeping && b.sleeping) {
        /* 都睡着就不用管 */
      } else if (a.sleeping) {
        project(b, nx * corr, ny * corr);
      } else if (b.sleeping) {
        project(a, -nx * corr, -ny * corr);
      } else {
        var sum = ia + ib;
        project(a, -nx * corr * (ia / sum), -ny * corr * (ia / sum));
        project(b, nx * corr * (ib / sum), ny * corr * (ib / sum));
      }
    }

    /* --- 速度冲量：只在第一轮做，避免重复施加 --- */
    if (!firstPass) return;

    var rvx = (b.x - b.px) - (a.x - a.px);
    var rvy = (b.y - b.py) - (a.y - a.py);
    var vn = rvx * nx + rvy * ny;      // < 0 表示正在靠近

    var ia2 = 1 / (a.r * a.r);
    var ib2 = 1 / (b.r * b.r);
    var sum2 = ia2 + ib2;

    if (vn < 0) {
      var rest = this.restitutionFor(vn);
      var jn = vn * (1 + rest);
      var ja = jn * (ia2 / sum2);
      var jb = jn * (ib2 / sum2);
      /* 速度 = x - px，想加 v 就减 px */
      if (!a.sleeping) { a.px -= nx * ja; a.py -= ny * ja; }
      if (!b.sleeping) { b.px += nx * jb; b.py += ny * jb; }
    }

    /* 切向摩擦：削减相对滑动
       注意符号！速度 = x - px，所以「想让速度增加 v」要写 px -= v。
       要让相对切向速度 tv 变成 tv*(1-fr)，即 Δtv = -tv*fr，分摊到两颗球是
       a 的速度 +tv*fr/2、b 的速度 -tv*fr/2，对应 px 分别 -= 和 +=。
       （这里曾经写反，结果每个子步都把切向速度放大 1.22 倍，
         一帧放大 1.8 倍，球会被横向「泵」到 1500 单位/秒飞出去。） */
    var tvx = (b.x - b.px) - (a.x - a.px);
    var tvy = (b.y - b.py) - (a.y - a.py);
    var vn2 = tvx * nx + tvy * ny;
    var tx = tvx - vn2 * nx;
    var ty = tvy - vn2 * ny;
    var fr = p.friction;

    if (!a.sleeping && !b.sleeping) {
      a.px -= tx * fr * 0.5; a.py -= ty * fr * 0.5;
      b.px += tx * fr * 0.5; b.py += ty * fr * 0.5;
    } else if (a.sleeping && !b.sleeping) {
      b.px += tx * fr; b.py += ty * fr;     // 睡着那颗当无限重，全部由醒的承担
    } else if (b.sleeping && !a.sleeping) {
      a.px -= tx * fr; a.py -= ty * fr;
    }

    /* 深重叠的破解推力：
       在「一条竖线」的球堆里，小球会被上下两颗大球夹住——两个法向修正方向相反、
       正好抵消，小球永远出不来（实测能嵌进去 70px）。这里给小球一点固定方向的
       侧向推力把对称性打破，让它自己从缝里挤出来。
       正常堆叠的重叠量 < 1px，所以这条分支平时不会触发。 */
    if (overlap > p.deepOverlap) {
      var small = (a.r <= b.r) ? a : b;
      if (!small.sleeping) {
        var sgn = (small.id % 2 === 0) ? 1 : -1;
        var nudge = Math.min(overlap * 0.05, p.deepNudge);
        project(small, -ny * sgn * nudge, nx * sgn * nudge);
      }
    }
  };

  /* ------------------------------ 球与墙约束 ------------------------------ */
  World.prototype.solveWalls = function (b) {
    var p = this.p;

    /* 左墙 */
    if (b.x - b.r < this.left) {
      b.contact = true;
      project(b, this.left + b.r - b.x, 0);
      var vx = b.x - b.px;
      if (vx < 0) b.px = b.x + this.restitutionFor(vx) * vx;
    }
    /* 右墙 */
    if (b.x + b.r > this.right) {
      b.contact = true;
      project(b, this.right - b.r - b.x, 0);
      var vx2 = b.x - b.px;
      if (vx2 > 0) b.px = b.x + this.restitutionFor(vx2) * vx2;
    }
    /* 天花板（一般碰不到，兜底用） */
    if (b.y - b.r < this.top) {
      b.contact = true;
      project(b, 0, this.top + b.r - b.y);
      var vy = b.y - b.py;
      if (vy < 0) b.py = b.y + this.restitutionFor(vy) * vy;
    }
    /* 地板 */
    if (b.y + b.r > this.bottom) {
      b.contact = true;
      project(b, 0, this.bottom - b.r - b.y);
      var vy2 = b.y - b.py;
      if (vy2 > 0) {
        b.py = b.y + this.restitutionFor(vy2) * vy2;   // 法向吸能
        var fvx = b.x - b.px;                          // 地面摩擦
        b.px += fvx * p.friction * 0.6;
      }
    }
  };

  /* --------------------------- 每帧收尾：休眠/速度 ------------------------- */
  World.prototype.postStep = function (dtFrame, dtStep) {
    var p = this.p;
    var balls = this.balls;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      b.age += dtFrame;
      var dx = b.x - b.px, dy = b.y - b.py;
      b.speed = Math.sqrt(dx * dx + dy * dy) / dtStep;

      if (b.overlap > p.sleepOverlap) {
        /* 还嵌在别人身体里：绝对不许睡，否则穿插会被永久冻结 */
        b.sleeping = false;
        b.sleepTimer = 0;
      } else if (b.sleeping) {
        b.px = b.x; b.py = b.y;
        b.speed = 0;
      } else {
        /* 静态摩擦：已经挨着别人/墙/地板，速度又很低，就直接停住。
           否则球会在斜坡上以几十单位/秒一直微微挪动，永远达不到休眠条件。 */
        if (b.contact && b.speed < p.settleSpeed) {
          b.px = b.x; b.py = b.y;
          b.speed = 0;
        }
        if (b.speed < p.sleepSpeed) {
          b.sleepTimer += dtFrame * 1000;
          if (b.sleepTimer > p.sleepDelayMs) {
            b.sleeping = true;
            b.px = b.x; b.py = b.y;
            b.speed = 0;
          }
        } else {
          b.sleepTimer = 0;
        }
      }

      if (b.pop > 0) b.pop = Math.max(0, b.pop - dtFrame * 3.4);
      if (b.glow > 0) b.glow = Math.max(0, b.glow - dtFrame * 2.2);
      b.wobble += dtFrame * 2.2;
    }
  };

  /* ---------------------------- 固定步长推进 ------------------------------ */
  World.prototype.advance = function (dtFrame) {
    var p = this.p;
    this.accumulator += dtFrame;
    var steps = 0;
    while (this.accumulator >= p.fixedDt && steps < p.maxSubSteps) {
      this.step(p.fixedDt);
      this.accumulator -= p.fixedDt;
      steps++;
    }
    if (this.accumulator > p.fixedDt * 4) this.accumulator = 0;   // 掉帧保护
    if (steps > 0) this.postStep(dtFrame, p.fixedDt);
    return steps;
  };

  /* ------------------------- 查询：预测落点 / 统计 ------------------------ */
  World.prototype.raycastY = function (x, fromY) {
    var y = this.bottom;
    for (var i = 0; i < this.balls.length; i++) {
      var b = this.balls[i];
      var dx = x - b.x;
      var rr = b.r + 6;
      if (Math.abs(dx) >= rr) continue;
      var dy = Math.sqrt(rr * rr - dx * dx);
      var top = b.y - dy;
      if (top > fromY && top < y) y = top;
    }
    return y;
  };

  World.prototype.count = function () { return this.balls.length; };

  SKD.Ball = Ball;
  SKD.World = World;
})(window.SKD);
