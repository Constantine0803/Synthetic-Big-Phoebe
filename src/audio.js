/* =============================================================================
 * 合成大菲比 · 音效
 * -----------------------------------------------------------------------------
 * 两层机制：
 *   1) 音频文件：config.js 里填了路径就用文件（出场音效还支持按等级分别指定）
 *   2) 内置合成音：没填 / 文件加载失败时，用 WebAudio 现场合成，不需要任何素材
 *
 * ★ 换「团子出场音效」只要覆盖 assets/audio/spawn.wav，
 *   或者改 config.js 里的 audio.spawn / audio.spawnByTier（注释里写了例子）。
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  var CFG = SKD.CONFIG;

  function Sound() {
    this.ctx = null;
    this.master = null;
    this.enabled = CFG.audio.enabled;
    this.volume = CFG.audio.volume;
    this.files = {};        // drop / big / over / warn / ui
    this.spawnFiles = {};   // 'default' + 按等级覆盖
    this.voiceFiles = {};   // 各等级的角色出场台词
    this.voiceMissing = []; // 缺文件的等级，加载完统一提示一次
    this.currentVoice = null;
    this.currentVoiceTier = null;
    this.lastVoiceAt = 0;
    this.lastWarn = 0;
    this.loadFiles();
  }

  /* --------------------------- 加载可替换的音频 --------------------------- */
  function prep(src, store, key, onError) {
    var el;
    try {
      el = new Audio(src);
      el.preload = 'auto';
      if (el.addEventListener) {
        el.addEventListener('error', function () {
          /* 文件不存在 / 格式不支持 -> 删掉这条记录，自动回落 */
          delete store[key];
          if (onError) onError();
          else if (window.console && console.warn) {
            console.warn('[音效] 加载失败，改用内置合成音：' + src);
          }
        });
      }
      store[key] = el;
    } catch (e) {
      /* 环境不支持就算了 */
    }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  Sound.prototype.loadFiles = function () {
    var k, i;
    var f = CFG.audio.files || {};
    for (k in f) {
      if (f[k]) prep(f[k], this.files, k);
    }

    /* 出场音效：一个通用 + 可选的分等级覆盖 */
    if (CFG.audio.spawn) prep(CFG.audio.spawn, this.spawnFiles, 'default');
    var byTier = CFG.audio.spawnByTier || {};
    for (k in byTier) {
      if (byTier[k]) prep(byTier[k], this.spawnFiles, k);
    }

    this.loadVoices();
  };

  /* --------------------------- 角色出场台词 ------------------------------- */
  Sound.prototype.loadVoices = function () {
    var a = CFG.audio;
    if (!a.voiceDir && !a.voiceByTier) return;

    var self = this;
    var overrides = a.voiceByTier || {};

    /* voiceExt 可以是一个字符串，也可以是数组：按顺序试，第一个能加载的算数。
       这样 mp3 / m4a / wav 混着放也不用改配置（坏处是缺文件时请求数会多一点）。 */
    var exts = a.voiceExt || '.mp3';
    if (typeof exts === 'string') exts = [exts];
    exts = exts.map(function (e) { return e.charAt(0) === '.' ? e : '.' + e; });

    function attempt(tier, idx) {
      if (idx >= exts.length) {
        self.voiceMissing.push(tier);
        return;
      }
      var url = a.voiceDir + pad2(tier) + exts[idx];
      var el;
      try {
        el = new Audio(url);
        el.preload = 'auto';
      } catch (e) {
        self.voiceMissing.push(tier);
        return;
      }
      /* 先占位再挂监听：万一 error 是同步触发的（部分环境会这样），
         回调里也删得掉、能正确走到下一个扩展名 */
      self.voiceFiles[tier] = el;
      if (el.addEventListener) {
        el.addEventListener('error', function () {
          delete self.voiceFiles[tier];      // 这个格式没有 -> 试下一个
          attempt(tier, idx + 1);
        });
      }
    }

    for (var i = 0; i < CFG.tiers.length; i++) {
      if (overrides[i]) {
        (function (tier, url) {
          prep(url, self.voiceFiles, tier, function () { self.voiceMissing.push(tier); });
        })(i, overrides[i]);
      } else if (a.voiceDir) {
        attempt(i, 0);
      }
    }

    /* 加载是异步的，等一会儿再统一提示缺了哪些（避免控制台刷屏） */
    if (window.setTimeout) {
      window.setTimeout(function () {
        if (!self.voiceMissing.length) return;
        self.voiceMissing.sort(function (x, y) { return x - y; });
        var names = self.voiceMissing.map(function (t) {
          return pad2(t) + ' ' + (CFG.tiers[t] ? CFG.tiers[t].name : '');
        });
        if (window.console && console.info) {
          console.info('[台词] 还缺这 ' + names.length + " 句（放到 " +
            (CFG.audio.voiceDir || 'assets/audio/voice/') + " 下即可）：\n  " + names.join('\n  '));
        }
      }, 1500);
    }
  };

  Sound.prototype.hasVoice = function (tier) {
    return !!this.voiceFiles[tier];
  };

  Sound.prototype.stopVoice = function () {
    if (!this.currentVoice) return;
    try {
      this.currentVoice.pause();
      this.currentVoice.currentTime = 0;
    } catch (e) { /* 忽略 */ }
    this.currentVoice = null;
    this.currentVoiceTier = null;
  };

  /* 播一句台词。返回 true 表示真的播了 */
  Sound.prototype.playVoice = function (tier) {
    var a = CFG.audio;
    if (!this.enabled || tier == null) return false;
    var el = this.voiceFiles[tier];
    if (!el || el.readyState === 0) return false;

    var now = Date.now();
    var gap = a.voiceGapMs || 0;
    /* 更高等级可以插队：好不容易合出来的大团子，别被间隔掐掉 */
    if (this.currentVoiceTier != null && tier > this.currentVoiceTier) gap = 0;
    if (now - this.lastVoiceAt < gap) return false;

    if (a.voiceExclusive) this.stopVoice();

    var node;
    try {
      node = el.cloneNode ? el.cloneNode() : el;
      node.volume = Math.max(0, Math.min(1, this.volume * (a.voiceVolume == null ? 1 : a.voiceVolume)));
      var pr = node.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {
      return false;
    }
    this.currentVoice = node;
    this.currentVoiceTier = tier;
    this.lastVoiceAt = now;
    return true;
  };

  /* 浏览器要求用户交互后才能出声，第一次点击时初始化 */
  Sound.prototype.init = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
  };

  Sound.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (on) this.init();
    else this.stopVoice();      // 静音时把正在念的台词掐掉
  };

  Sound.prototype.toggle = function () {
    this.setEnabled(!this.enabled);
    if (this.enabled) this.play('ui');
    return this.enabled;
  };

  /* ------------------------------ 播放文件 -------------------------------- */
  Sound.prototype.playElement = function (el, opts) {
    if (!el) return false;
    if (el.readyState === 0) return false;      // 还没加载好 -> 交给合成音兜底
    try {
      var node = el.cloneNode ? el.cloneNode() : el;
      var gain = (opts && opts.gain != null) ? opts.gain : 1;
      node.volume = Math.max(0, Math.min(1, this.volume * gain));
      if (opts && opts.rate && node.playbackRate) node.playbackRate.value = opts.rate;
      var pr = node.play();
      if (pr && pr.catch) pr.catch(function () {});
      return true;
    } catch (e) {
      return false;
    }
  };

  Sound.prototype.playFile = function (name, opts) {
    return this.playElement(this.files[name], opts);
  };

  /* ------------------------------ 合成音工具 ------------------------------ */
  Sound.prototype.tone = function (o) {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var t0 = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + o.dur);
    var peak = (o.gain == null ? 0.3 : o.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, o.dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  };

  Sound.prototype.noise = function (o) {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var dur = o.dur || 0.12;
    var t0 = ctx.currentTime + (o.delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.cutoff || 900;
    var gain = ctx.createGain();
    gain.gain.value = o.gain == null ? 0.25 : o.gain;
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(t0);
  };

  /* -------------------------------- 播放 ---------------------------------- */
  Sound.prototype.play = function (name, opts) {
    opts = opts || {};
    if (!this.enabled) return;

    if (name === 'spawn') {
      /* 团子出场音效：按等级的文件 > 通用文件 > 内置合成音 */
      var tier = opts.tier;
      var el = (tier != null && this.spawnFiles[tier]) || this.spawnFiles['default'];
      if (el && this.playElement(el, opts)) return;
    } else if (this.playFile(name, opts)) {
      return;
    }

    this.init();
    if (!this.ctx) return;

    switch (name) {
      case 'ui':
        this.tone({ freq: 620, to: 880, dur: 0.08, type: 'triangle', gain: 0.18 });
        break;

      case 'drop':
        this.tone({ freq: 260, to: 120, dur: 0.14, type: 'sine', gain: 0.22 * (opts.gain || 1) });
        this.noise({ dur: 0.09, cutoff: 700, gain: 0.14 });
        break;

      /* 团子出场（内置合成音）：等级越高音越亮，配一声轻「噗」 */
      case 'spawn': {
        var t = opts.tier == null ? 0 : opts.tier;
        var base = 420 * Math.pow(1.09, t);
        this.noise({ dur: 0.06, cutoff: 1600, gain: 0.10 });
        this.tone({ freq: base, to: base * 1.55, dur: 0.13, type: 'triangle', gain: 0.20 });
        this.tone({ freq: base * 1.5, to: base * 2.1, dur: 0.17, type: 'sine', gain: 0.12, delay: 0.045 });
        break;
      }

      /* 大合成 / 最大号对撞的彩头（叠在出场音之上） */
      case 'big': {
        var root = 520;
        var steps = [1, 1.26, 1.5, 2, 2.52];
        for (var i = 0; i < steps.length; i++) {
          this.tone({ freq: root * steps[i], dur: 0.22, type: 'triangle', gain: 0.16, delay: i * 0.07 });
        }
        this.noise({ dur: 0.35, cutoff: 2200, gain: 0.12 });
        break;
      }

      case 'warn':
        this.tone({ freq: 880, to: 700, dur: 0.12, type: 'square', gain: 0.1 });
        break;

      case 'over':
        this.tone({ freq: 520, to: 480, dur: 0.28, type: 'sine', gain: 0.22 });
        this.tone({ freq: 392, to: 360, dur: 0.34, type: 'sine', gain: 0.22, delay: 0.18 });
        this.tone({ freq: 262, to: 180, dur: 0.7, type: 'sine', gain: 0.24, delay: 0.38 });
        break;
    }
  };

  SKD.Sound = Sound;
})(window.SKD);
