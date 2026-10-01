// Tiny WebAudio synth: everything is generated, no audio files. Starts on first user gesture.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.windLevel = 0; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // ambient wind bed
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.02;
    src.connect(lp).connect(this.windGain).connect(this.master); src.start();
    this.windLp = lp;
    this.birdTimer = setTimeout(() => this.birdLoop(), 2500);
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); }
  setWind(mph) { this.windLevel = mph; if (this.windGain) { this.windGain.gain.setTargetAtTime(0.015 + Math.min(mph, 30) * 0.004, this.ctx.currentTime, 0.5); this.windLp.frequency.setTargetAtTime(300 + mph * 25, this.ctx.currentTime, 0.5); } }
  get ok() { return this.ctx && !this.muted; }
  t() { return this.ctx.currentTime; }
  env(g, t0, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dcy); }
  noiseBurst({ type = 'bandpass', f0 = 1000, f1 = f0, q = 1, dur = 0.2, gain = 0.3, attack = 0.005, delay = 0 }) {
    if (!this.ok) return; const c = this.ctx, t0 = this.t() + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain(); this.env(g, t0, attack, gain, dur);
    s.connect(f).connect(g).connect(this.master); s.start(t0, Math.random()); s.stop(t0 + dur + attack + 0.05);
  }
  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, gain = 0.2, attack = 0.004, delay = 0 }) {
    if (!this.ok) return; const c = this.ctx, t0 = this.t() + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain(); this.env(g, t0, attack, gain, dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + attack + 0.05);
  }
  // charge hum while holding
  chargeStart() {
    if (!this.ok) return; const c = this.ctx;
    this.chargeOsc = c.createOscillator(); this.chargeOsc.type = 'triangle'; this.chargeOsc.frequency.value = 160;
    this.chargeG = c.createGain(); this.chargeG.gain.value = 0.0001; this.chargeG.gain.setTargetAtTime(0.035, c.currentTime, 0.05);
    this.chargeOsc.connect(this.chargeG).connect(this.master); this.chargeOsc.start();
  }
  chargeSet(m, inZone) { if (this.chargeOsc) { this.chargeOsc.frequency.setTargetAtTime(150 + m * 520, this.ctx.currentTime, 0.02); this.chargeG.gain.setTargetAtTime(inZone ? 0.06 : 0.03, this.ctx.currentTime, 0.02); } }
  chargeStop() { if (this.chargeOsc) { const o = this.chargeOsc, g = this.chargeG; g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03); o.stop(this.ctx.currentTime + 0.2); this.chargeOsc = null; } }
  whoosh(p = 1) { this.noiseBurst({ f0: 350, f1: 2600, q: 0.8, dur: 0.22, gain: 0.18 + 0.25 * p, attack: 0.09 }); }
  strike(quality, wood) {
    this.noiseBurst({ type: 'highpass', f0: 2500, dur: 0.035, gain: 0.5, attack: 0.001, delay: 0.09 });
    if (wood) { this.tone({ type: 'triangle', f0: 2300, f1: 1900, dur: 0.16, gain: 0.22, delay: 0.09 }); this.tone({ type: 'sine', f0: 1150, f1: 900, dur: 0.12, gain: 0.18, delay: 0.09 }); }
    else { this.tone({ type: 'square', f0: 900, f1: 500, dur: 0.05, gain: 0.08, delay: 0.09 }); this.noiseBurst({ type: 'lowpass', f0: 1800, f1: 400, dur: 0.08, gain: 0.35, delay: 0.09 }); }
    if (quality === 3) [0, 1, 2].forEach(i => this.tone({ f0: 1320 * Math.pow(1.26, i), dur: 0.25, gain: 0.07, delay: 0.16 + i * 0.06 }));
  }
  land(surf, impact) {
    const g = Math.min(0.45, 0.08 + impact * 0.012);
    if (surf === 4) this.noiseBurst({ type: 'lowpass', f0: 900, f1: 200, dur: 0.25, gain: g });
    else { this.noiseBurst({ type: 'lowpass', f0: 600, f1: 120, dur: 0.09, gain: g }); this.tone({ f0: 120, f1: 60, dur: 0.1, gain: g * 0.6 }); }
  }
  splash() { this.noiseBurst({ type: 'lowpass', f0: 4200, f1: 250, dur: 0.7, gain: 0.45, attack: 0.01 }); for (let i = 0; i < 4; i++) this.tone({ f0: 500 + Math.random() * 400, f1: 1200, dur: 0.06, gain: 0.05, delay: 0.25 + i * 0.09 }); }
  leaves() { this.noiseBurst({ f0: 3000, f1: 1800, q: 0.7, dur: 0.35, gain: 0.25, attack: 0.02 }); }
  thunk() { this.tone({ type: 'triangle', f0: 260, f1: 120, dur: 0.12, gain: 0.3 }); }
  cup() { this.tone({ type: 'triangle', f0: 700, f1: 300, dur: 0.12, gain: 0.3 }); this.tone({ type: 'triangle', f0: 500, f1: 200, dur: 0.1, gain: 0.25, delay: 0.1 }); }
  cheer(amount = 1) {
    if (!this.ok) return;
    for (let i = 0; i < 3; i++) this.noiseBurst({ f0: 700 + i * 500, f1: 900 + i * 400, q: 0.6, dur: 1.4 + amount, gain: 0.07 * amount, attack: 0.35 });
    for (let i = 0; i < 18 * amount; i++) this.noiseBurst({ type: 'highpass', f0: 1500, dur: 0.02, gain: 0.08, attack: 0.001, delay: 0.2 + Math.random() * 1.6 });
  }
  groan() { if (this.ok) for (let i = 0; i < 2; i++) this.noiseBurst({ f0: 500 + i * 200, f1: 250, q: 1.2, dur: 0.9, gain: 0.06, attack: 0.15 }); }
  click() { this.tone({ type: 'sine', f0: 900, f1: 1300, dur: 0.05, gain: 0.08 }); }
  star(i) { this.tone({ type: 'triangle', f0: 880 * Math.pow(1.335, i), dur: 0.4, gain: 0.16 }); this.tone({ f0: 1760 * Math.pow(1.335, i), dur: 0.3, gain: 0.05, delay: 0.02 }); }
  birdLoop() {
    if (this.ok && Math.random() < 0.8) {
      const base = 2600 + Math.random() * 1800, n = 2 + (Math.random() * 4 | 0);
      for (let i = 0; i < n; i++) this.tone({ f0: base * (1 + Math.random() * 0.1), f1: base * (1.3 + Math.random() * 0.3), dur: 0.07, gain: 0.025, delay: i * 0.12 });
    }
    this.birdTimer = setTimeout(() => this.birdLoop(), 2500 + Math.random() * 6000);
  }
}
