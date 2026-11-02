// Audio sintetizado con WebAudio (sin ficheros): motores de hélice, reactor,
// rotor de helicóptero, viento, lluvia, truenos, tren, toma de contacto y avisos.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
    this.engine = null;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.volume;
    this.cabin = c.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 18000;
    this.cabin.connect(this.master); this.master.connect(c.destination);
    // buffer de ruido
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // ruido marrón para rumble
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // viento y lluvia
    this.wind = this.noiseChain('bandpass', 500, 0.6);
    this.rain = this.noiseChain('highpass', 2500, 0.3);
    this.roll = this.noiseChain('lowpass', 180, 1, this.brown);
    // alarmas
    this.beepOsc = c.createOscillator(); this.beepOsc.type = 'square'; this.beepOsc.frequency.value = 880;
    this.beepGain = c.createGain(); this.beepGain.gain.value = 0;
    this.beepOsc.connect(this.beepGain); this.beepGain.connect(this.master); this.beepOsc.start();
  }

  noiseChain(type, freq, q, buf) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = buf || this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.cabin);
    src.start();
    return { src, f, g };
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }

  setAircraft(spec) {
    if (!this.ctx) return;
    this.stopEngine();
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0; out.connect(this.cabin);
    const nodes = [];
    const eng = { type: spec.engine, out, nodes, spec };
    if (spec.engine === 'prop') {
      const o1 = c.createOscillator(); o1.type = 'sawtooth';
      const o2 = c.createOscillator(); o2.type = 'square';
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2;
      const g1 = c.createGain(); g1.gain.value = 0.35; const g2 = c.createGain(); g2.gain.value = 0.2;
      o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp);
      // pulso de cilindros
      const am = c.createGain(); am.gain.value = 0.6;
      const lfo = c.createOscillator(); lfo.type = 'square';
      const lfoG = c.createGain(); lfoG.gain.value = 0.4;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      lp.connect(am); am.connect(out);
      const n = this.noiseChain('bandpass', 900, 1.2); n.g.disconnect(); n.g.connect(out);
      o1.start(); o2.start(); lfo.start();
      Object.assign(eng, { o1, o2, lp, lfo, n });
      nodes.push(o1, o2, lfo, n.src);
    } else if (spec.engine === 'jet') {
      const n = this.noiseChain('bandpass', 900, 0.8); n.g.disconnect(); n.g.connect(out);
      const r = this.noiseChain('lowpass', 160, 0.7, this.brown); r.g.disconnect(); r.g.connect(out);
      const ab = this.noiseChain('lowpass', 420, 0.5); ab.g.disconnect(); ab.g.connect(out);
      const wh = c.createOscillator(); wh.type = 'sine';
      const whg = c.createGain(); whg.gain.value = 0;
      wh.connect(whg); whg.connect(out); wh.start();
      const wh2 = c.createOscillator(); wh2.type = 'triangle';
      const wh2g = c.createGain(); wh2g.gain.value = 0;
      wh2.connect(wh2g); wh2g.connect(out); wh2.start();
      Object.assign(eng, { n, r, ab, wh, whg, wh2, wh2g });
      nodes.push(n.src, r.src, ab.src, wh, wh2);
    } else {
      // rotor: ruido grave modulado por la frecuencia de paso de pala
      const n = this.noiseChain('lowpass', 260, 1.5, this.brown); n.g.disconnect();
      const am = c.createGain(); am.gain.value = 0.3;
      const lfo = c.createOscillator(); lfo.type = 'sawtooth';
      const lfoG = c.createGain(); lfoG.gain.value = 0.7;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      n.g.connect(am); am.connect(out);
      const sl = this.noiseChain('bandpass', 1200, 2); sl.g.disconnect();
      const am2 = c.createGain(); am2.gain.value = 0.0; lfoG.connect(am2.gain);
      sl.g.connect(am2); am2.connect(out);
      const tb = c.createOscillator(); tb.type = 'sine'; tb.frequency.value = 3400;
      const tbg = c.createGain(); tbg.gain.value = 0.015;
      tb.connect(tbg); tbg.connect(out); tb.start();
      lfo.start();
      Object.assign(eng, { n, lfo, sl, tb, tbg });
      nodes.push(n.src, lfo, sl.src, tb);
    }
    this.engine = eng;
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { for (const n of e.nodes) { try { n.stop(); } catch (_) { } } e.out.disconnect(); }, 400);
    this.engine = null;
  }

  update(st) {
    if (!this.ctx || !this.engine) return;
    const c = this.ctx, t = c.currentTime, e = this.engine, k = 0.08;
    const rpm = st.rpm;
    this.cabin.frequency.setTargetAtTime(st.cockpit ? 2200 : 16000, t, 0.1);
    const extAtt = st.cockpit ? 1 : Math.max(0.35, 1 - st.camDist / 300);
    if (st.crashed) { e.out.gain.setTargetAtTime(0, t, 0.2); }
    else if (e.type === 'prop') {
      const f = 25 + rpm * 85;
      e.o1.frequency.setTargetAtTime(f, t, k); e.o2.frequency.setTargetAtTime(f * 0.5, t, k);
      e.lfo.frequency.setTargetAtTime(f * 0.5, t, k);
      e.lp.frequency.setTargetAtTime(300 + rpm * 1400, t, k);
      e.n.f.frequency.setTargetAtTime(500 + rpm * 1500, t, k);
      e.n.g.gain.setTargetAtTime(0.05 + rpm * 0.15, t, k);
      e.out.gain.setTargetAtTime((0.12 + rpm * 0.35) * extAtt, t, k);
    } else if (e.type === 'jet') {
      e.n.f.frequency.setTargetAtTime(600 + rpm * 2600, t, k);
      e.n.g.gain.setTargetAtTime(0.15 + rpm * 0.5, t, k);
      e.r.g.gain.setTargetAtTime(0.2 + rpm * 0.8, t, k);
      e.ab.g.gain.setTargetAtTime(st.ab ? 1.4 : 0, t, 0.15);
      e.wh.frequency.setTargetAtTime(1800 + rpm * 4200, t, k);
      e.whg.gain.setTargetAtTime(0.03 + rpm * 0.03, t, k);
      e.wh2.frequency.setTargetAtTime(900 + rpm * 2100, t, k);
      e.wh2g.gain.setTargetAtTime(0.02, t, k);
      e.out.gain.setTargetAtTime((0.2 + rpm * 0.4) * extAtt, t, k);
    } else {
      const bpf = (e.spec.blades || 4) * 4.6 * rpm;
      e.lfo.frequency.setTargetAtTime(bpf, t, k);
      e.n.g.gain.setTargetAtTime(0.6 + st.throttle * 0.8, t, k);
      e.sl.g.gain.setTargetAtTime(0.1 + st.throttle * 0.35, t, k);
      e.tb.frequency.setTargetAtTime(3000 + rpm * 800 + st.throttle * 300, t, k);
      e.out.gain.setTargetAtTime((0.35 + st.throttle * 0.3) * extAtt, t, k);
    }
    // viento por velocidad
    const v = st.airspeed;
    this.wind.g.gain.setTargetAtTime(Math.min(0.6, (v / 220) ** 2 * 0.6) * (st.cockpit ? 0.6 : 1) + st.windStrength * 0.01, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(300 + v * 4, t, 0.2);
    this.rain.g.gain.setTargetAtTime(st.rain * (st.cockpit ? 0.35 : 0.2), t, 0.3);
    this.roll.g.gain.setTargetAtTime(st.onGround ? Math.min(0.5, st.groundSpeed / 60) : 0, t, 0.1);
    // alarma (pérdida / tren)
    const beep = st.warn && (Math.floor(t * 4) % 2 === 0);
    this.beepOsc.frequency.setTargetAtTime(st.warnType === 'stall' ? 620 : 980, t, 0.01);
    this.beepGain.gain.setTargetAtTime(beep ? 0.06 : 0, t, 0.01);
  }

  burst({ dur = 0.3, freq = 800, type = 'bandpass', q = 1, gain = 0.5, buf, attack = 0.005, decay, rate = 1 }) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = buf || this.noise; src.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + (decay || dur) + 0.1);
    return f;
  }

  tone(freq, dur, gain = 0.1, type = 'sine', slide) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  thunder() {
    this.burst({ dur: 4, freq: 120, type: 'lowpass', q: 0.7, gain: 1.6, buf: this.brown, attack: 0.08, decay: 3.5 + Math.random() * 2 });
    this.burst({ dur: 0.4, freq: 1500, type: 'bandpass', q: 0.5, gain: 0.25, attack: 0.01, decay: 0.4 });
  }
  touchdown(strength = 1) {
    this.burst({ dur: 0.4, freq: 2400, type: 'bandpass', q: 3, gain: 0.25 * strength, decay: 0.45 });
    this.burst({ dur: 0.3, freq: 120, type: 'lowpass', q: 1, gain: 0.6 * strength, buf: this.brown, decay: 0.3 });
  }
  gearMotor() {
    this.tone(180, 1.5, 0.05, 'sawtooth', 140);
    this.burst({ dur: 0.2, freq: 600, q: 4, gain: 0.15, decay: 0.2 });
    setTimeout(() => this.burst({ dur: 0.15, freq: 400, q: 3, gain: 0.25, decay: 0.15 }), 3800);
  }
  click() { this.burst({ dur: 0.05, freq: 3000, q: 2, gain: 0.15, decay: 0.05 }); }
  explosion() {
    this.burst({ dur: 3, freq: 200, type: 'lowpass', q: 0.5, gain: 2.5, buf: this.brown, attack: 0.01, decay: 3 });
    this.burst({ dur: 1, freq: 900, type: 'bandpass', q: 0.4, gain: 0.8, attack: 0.005, decay: 1.2 });
  }
  gun() { if (this.ctx) this.burst({ dur: 0.07, freq: 420, q: 0.7, gain: 0.28, decay: 0.07 }); }
  rocket() { if (this.ctx) this.burst({ dur: 0.8, freq: 900, q: 0.5, gain: 0.3, decay: 0.75 }); }
  hit() { if (this.ctx) this.burst({ dur: 0.12, freq: 1800, q: 1.5, gain: 0.3, decay: 0.1 }); }
  ring(i = 0) { if (this.ctx) this.tone(620 + i * 28, 0.28, 0.09, 'triangle', 980 + i * 28); }
  chime() { this.tone(880, 0.6, 0.08); setTimeout(() => this.tone(1320, 0.9, 0.08), 180); }
}
