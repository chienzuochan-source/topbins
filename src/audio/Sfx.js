// Small synthesised sounds: the thud of a kick, the ref's whistle, the net,
// and the crowd. No audio files needed.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Browsers only allow audio after a click or key press.
  unlock() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.startCrowd();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }

  noise(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.5, attack = 0.005 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, to = null } = {}) {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    const t = c.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(speed = 10) {
    const k = Math.min(1, speed / 30);
    this.tone(140, 0.12, { gain: 0.35 + 0.4 * k, to: 60 });
    this.noise(0.06, { freq: 1800, q: 0.8, gain: 0.2 + 0.3 * k });
  }

  touch() {
    this.tone(120, 0.06, { gain: 0.15, to: 70 });
  }

  whistle(short = false) {
    const c = this.ctx;
    if (!c) return;
    const blasts = short ? [0] : [0, 0.28];
    for (const at of blasts) {
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      const t = c.currentTime + at, len = short ? 0.22 : at ? 0.5 : 0.2;
      o.frequency.value = 2900;
      lfo.frequency.value = 38;
      lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.setValueAtTime(0.12, t + len - 0.04);
      g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(g).connect(this.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + len + 0.05);
      lfo.stop(t + len + 0.05);
    }
  }

  woodwork() {
    this.tone(880, 0.5, { type: 'triangle', gain: 0.25 });
    this.tone(1320, 0.35, { type: 'sine', gain: 0.12 });
  }

  // A constant low murmur that swells on big moments.
  startCrowd() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.6;
    this.crowdGain = c.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(f).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  roar(size = 1, len = 3) {
    if (!this.crowdGain) return;
    const g = this.crowdGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.05 + 0.3 * size, t + 0.25);
    g.linearRampToValueAtTime(0.05, t + len);
  }

  groan() {
    this.roar(0.35, 1.4);
  }
}
