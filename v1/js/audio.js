// LiDAR Point Cloud 001: sound (real recordings, HRTF positions, wall occlusion, loops driven by fear) and the microphone meter.

const ONE = ['charge', 'shock', 'thump', 'spark', 'm_click1', 'm_click2', 'm_click3', 'm_click4', 'm_throat1', 'm_throat2', 'm_groan',
  'm_growl1', 'm_growl2', 'm_growl3', 'm_shriek', 'scare', 'scare2', 'bang1', 'bang2', 'pipe', 'door', 'drip', 'whisper', 'gong',
  'step_a1', 'step_a2', 'step_a3', 'step_a4', 'step_b1', 'step_b2', 'step_b3', 'step_b4', 'step_b5', 'step_b6',
  'm_step1', 'm_step2', 'm_step3', 'm_step4', 'm_step5', 'm_step6', 'bone1', 'bone2', 'bone3', 'bone4', 'bone5', 'bone6'];
const LOOPS = ['amb_station', 'amb_deep', 'amb_drip', 'geiger', 'heart', 'breath', 'static'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.loops = {};
    this.voices = 0;
    this.micOn = false;
    this.micLevel = 0;
    this.micFloor = -60;
    this.loaded = 0;
    this.total = ONE.length + LOOPS.length;
  }

  init() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.verb.connect(this.wet).connect(this.master);
  }

  async load(base) {
    if (!this.ctx) return;
    await Promise.all([...ONE, ...LOOPS].map(async (n) => {
      try {
        const a = await (await fetch(`${base}/${n}.mp3`)).arrayBuffer();
        this.buf[n] = await this.ctx.decodeAudioData(a);
      } catch (e) { console.warn('sound missing', n); }
      this.loaded++;
    }));
    for (const n of LOOPS) {
      if (!this.buf[n]) continue;
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = this.buf[n];
      src.loop = true;
      g.gain.value = 0;
      src.connect(g).connect(this.master);
      src.start();
      this.loops[n] = { src, g };
    }
  }

  resume() { return this.ctx && this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve(); }

  setLoop(name, gain, rate, tau = 0.25) {
    const L = this.loops[name];
    if (!L) return;
    L.g.gain.setTargetAtTime(gain, this.ctx.currentTime, tau);
    if (rate) L.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, tau);
  }

  source(name, rate, offset, dur) {
    const b = this.buf[name];
    if (!b || !this.ctx || this.voices > 22) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    this.voices++;
    src.onended = () => { this.voices--; };
    src.go = () => (dur ? src.start(0, offset || 0, dur) : src.start(0, offset || 0));
    return src;
  }

  play(name, gain = 1, rate = 1, pan = 0, verb = 0) {
    const src = this.source(name, rate);
    if (!src) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(this.master);
    if (verb) { const s = this.ctx.createGain(); s.gain.value = verb; node.connect(s).connect(this.verb); }
    src.go();
    return { src, g };
  }

  at(name, x, y, z, gain = 1, rate = 1, walls = 0, ref = 2.2, offset = 0, dur = 0) {
    const src = this.source(name, rate, offset, dur);
    if (!src) return null;
    const ctx = this.ctx, g = ctx.createGain(), lp = ctx.createBiquadFilter(), p = ctx.createPanner();
    g.gain.value = gain * Math.pow(0.72, walls);
    lp.type = 'lowpass';
    lp.frequency.value = 15000 / (1 + walls * 2.6);
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.5;
    p.maxDistance = 90;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    src.connect(g).connect(lp).connect(p);
    p.connect(this.master);
    const s = ctx.createGain();
    s.gain.value = 0.45;
    p.connect(s).connect(this.verb);
    src.go();
    return { src, g };
  }

  listener(x, y, z, fx, fy, fz) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  async mic() {
    if (!this.ctx || !navigator.mediaDevices) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const node = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      node.connect(this.analyser);
      this.micData = new Float32Array(1024);
      this.micOn = true;
      return true;
    } catch (e) { return false; }
  }

  micTick(dt) {
    if (!this.micOn) return 0;
    this.analyser.getFloatTimeDomainData(this.micData);
    let s = 0;
    for (let i = 0; i < 1024; i++) s += this.micData[i] * this.micData[i];
    const db = 10 * Math.log10(s / 1024 + 1e-10);
    this.micFloor += (db - this.micFloor) * (db < this.micFloor ? Math.min(1, dt * 6) : Math.min(1, dt * 0.05));
    this.micFloor = Math.max(-75, Math.min(-32, this.micFloor));
    const level = Math.max(0, Math.min(1, (db - this.micFloor - 9) / 28));
    this.micLevel += (level - this.micLevel) * Math.min(1, dt * (level > this.micLevel ? 30 : 5));
    return this.micLevel;
  }
}
