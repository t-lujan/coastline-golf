// Tiny synthesised soundscape: surf, gulls, club strike, cup rattle, splash. No audio files.
export class Audio {
  constructor() { this.muted = localStorage.getItem('cg-muted') === '1'; this.ctx = null; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(ctx.destination);
    // brown noise buffer
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    this.noise = buf;
    const white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), wd = white.getChannelData(0); for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;
    this.surf();
    this.gullLoop();
  }
  setMuted(m) { this.muted = m; localStorage.setItem('cg-muted', m ? '1' : '0'); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.08); }
  src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  surf() {
    const ctx = this.ctx;
    for (const [f, base, period] of [[480, 0.22, 7.5], [900, 0.08, 5.3]]) {
      const s = this.src(this.noise, true), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = f; g.gain.value = base;
      s.connect(lp).connect(g).connect(this.master); s.start(0, Math.random() * 2);
      const swell = () => { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(base * 1.9, t, period * 0.18); g.gain.setTargetAtTime(base * 0.55, t + period * 0.45, period * 0.22);
        lp.frequency.setTargetAtTime(f * 1.6, t, period * 0.2); lp.frequency.setTargetAtTime(f, t + period * 0.45, period * 0.25); setTimeout(swell, period * 1000 * (0.85 + Math.random() * 0.3)); };
      swell();
    }
  }
  gull() {
    if (!this.ctx) return; const ctx = this.ctx, t0 = ctx.currentTime, calls = 2 + (Math.random() * 3 | 0);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; const out = ctx.createGain(); out.gain.value = 0.05 + Math.random() * 0.04;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan).connect(this.master); } else out.connect(this.master);
    for (let i = 0; i < calls; i++) {
      const t = t0 + i * (0.28 + Math.random() * 0.12), o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 3;
      const f = 1250 + Math.random() * 350; o.frequency.setValueAtTime(f * 0.75, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.06); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.24);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.connect(bp).connect(g).connect(out); o.start(t); o.stop(t + 0.3);
    }
  }
  gullLoop() { setTimeout(() => { this.gull(); this.gullLoop(); }, 6000 + Math.random() * 11000); }
  thwack(club, power) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
    if (club === 'putter') { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 1150; o.type = 'triangle'; g.gain.setValueAtTime(0.35 * (0.4 + power), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.08); return; }
    const n = this.src(this.white), hp = ctx.createBiquadFilter(), g = ctx.createGain(); hp.type = 'bandpass'; hp.frequency.value = club === 'driver' ? 2600 : 3400; hp.Q.value = 0.8;
    g.gain.setValueAtTime(0.9 * (0.4 + power * 0.6), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09); n.connect(hp).connect(g).connect(this.master); n.start(t); n.stop(t + 0.12);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(club === 'driver' ? 190 : 260, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    og.gain.setValueAtTime(0.6 * power, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.18);
    // whoosh of the ball leaving
    const w = this.src(this.white), bp = ctx.createBiquadFilter(), wg = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(3000, t + 0.02); bp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    wg.gain.setValueAtTime(0.0, t); wg.gain.linearRampToValueAtTime(0.12 * power, t + 0.05); wg.gain.exponentialRampToValueAtTime(0.001, t + 0.9); w.connect(bp).connect(wg).connect(this.master); w.start(t); w.stop(t + 1);
  }
  thud(surf, speed) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime, v = Math.min(1, speed / 15);
    const n = this.src(this.white), lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = (surf === 'sand' || surf === 'waste') ? 900 : 500;
    g.gain.setValueAtTime(0.4 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + ((surf === 'sand' || surf === 'waste') ? 0.25 : 0.12)); n.connect(lp).connect(g).connect(this.master); n.start(t); n.stop(t + 0.3);
  }
  splash() {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime;
    const n = this.src(this.white), lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8); n.connect(lp).connect(g).connect(this.master); n.start(t); n.stop(t + 0.9);
  }
  rattle() {
    if (!this.ctx) return; const ctx = this.ctx; let t = ctx.currentTime + 0.05;
    for (let i = 0; i < 6; i++) {
      const n = this.src(this.white), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 1800; bp.Q.value = 6;
      const a = 0.5 * Math.pow(0.72, i); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); n.connect(bp).connect(g).connect(this.master); n.start(t); n.stop(t + 0.06);
      t += 0.05 + Math.random() * 0.06;
    }
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.18); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
    setTimeout(() => this.gull(), 900);
  }
}
