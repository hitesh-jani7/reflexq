/* ReflexQ – original music made live in the browser (Web Audio). No audio files, no copyright.
   Tracks: 'question' (suspense loop), 'leader' (upbeat loop), 'final' (fanfare + upbeat loop)
   Stings: 'timeup' (short end-of-time sound). Plays on the teacher's screen only. */
(() => {
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------------------------------------------------------------- instruments
  function noiseBuffer(ctx) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function tone(env, m, t, dur, o = {}) {
    const { ctx, out } = env;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(mtof(m), t);
    if (o.glideTo != null) osc.frequency.exponentialRampToValueAtTime(mtof(o.glideTo), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack != null ? o.attack : 0.005, r = o.release != null ? o.release : 0.08, peak = o.gain != null ? o.gain : 0.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (o.decay) g.gain.setTargetAtTime(peak * (o.sustain != null ? o.sustain : 0.3), t + a, o.decay);
    g.gain.setTargetAtTime(0, t + Math.max(a, dur), r / 3);
    let node = osc;
    if (o.cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.setValueAtTime(o.cutoff, t); f.Q.value = o.q || 0.7;
      if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + r * 2 + 0.05);
  }
  function kick(env, t, gain = 0.8) {
    const { ctx, out } = env;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + 0.35);
  }
  function noise(env, t, o) {
    const { ctx, out } = env;
    const src = ctx.createBufferSource(); src.buffer = env.noise;
    const f = ctx.createBiquadFilter(); f.type = o.filter || 'highpass'; f.frequency.value = o.freq || 7000; f.Q.value = o.q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + o.decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + o.decay + 0.05);
  }
  const hat = (env, t, gain = 0.06, open = false) => noise(env, t, { gain, decay: open ? 0.22 : 0.045, freq: 7500 });
  function clap(env, t, gain = 0.22) {
    for (let i = 0; i < 3; i++) noise(env, t + i * 0.011, { gain: gain * (i === 2 ? 1 : 0.6), decay: i === 2 ? 0.16 : 0.02, filter: 'bandpass', freq: 1400, q: 1.1 });
  }
  const crash = (env, t, gain = 0.2) => noise(env, t, { gain, decay: 1.4, freq: 5000 });

  // ---------------------------------------------------------------- tracks
  // Suspense: A minor, 112 bpm. Heartbeat kick, ticking hats, pulsing bass, dark pad, arpeggio that joins later.
  const SUS = { bpm: 112, chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], roots: [45, 41, 38, 40] };
  const question = {
    barDur: 4 * 60 / SUS.bpm,
    bar(env, n, tb) {
      const beat = 60 / SUS.bpm, c = n % 4, chord = SUS.chords[c], root = SUS.roots[c];
      for (const m of chord) {
        tone(env, m, tb, this.barDur, { type: 'sawtooth', cutoff: 750, gain: 0.03, attack: 0.35, release: 0.5, detune: -6 });
        tone(env, m, tb, this.barDur, { type: 'sawtooth', cutoff: 750, gain: 0.03, attack: 0.35, release: 0.5, detune: 6 });
      }
      for (let i = 0; i < 8; i++) {
        const t = tb + i * beat / 2;
        tone(env, root, t, beat * 0.38, { type: 'sawtooth', cutoff: 520, gain: 0.2, release: 0.05 });
        hat(env, t, i % 2 ? 0.035 : 0.07);
      }
      for (const b of [0, 2]) { kick(env, tb + b * beat, 0.55); kick(env, tb + b * beat + 0.19, 0.35); }
      if (n >= 2) {
        const pat = [0, 1, 2, 1, 0, 1, 2, 1];
        for (let i = 0; i < 8; i++) tone(env, chord[pat[i]] + 12, tb + i * beat / 2, beat * 0.32, { type: 'triangle', gain: 0.07, release: 0.12 });
      }
      if (c === 3) for (let i = 0; i < 4; i++) noise(env, tb + 3 * beat + i * beat / 4, { gain: 0.05 + i * 0.03, decay: 0.08, filter: 'bandpass', freq: 1800, q: 0.8 });
    }
  };

  // Upbeat: C major, 126 bpm. Four-on-the-floor, claps, bouncing bass, chord stabs, bright lead.
  const UP = {
    bpm: 126, roots: [36, 43, 45, 41],
    chords: [[60, 64, 67], [59, 62, 67], [60, 64, 69], [60, 65, 69]],
    lead: [[76, 79, 84, 79, 81, 79, 76, 74], [74, 79, 83, 79, 81, 83, 86, 83], [84, 83, 81, 76, 81, 84, 88, 84], [81, 84, 89, 84, 88, 86, 84, 79]]
  };
  const leader = {
    barDur: 4 * 60 / UP.bpm,
    bar(env, n, tb) {
      const beat = 60 / UP.bpm, c = n % 4;
      for (let b = 0; b < 4; b++) {
        const t = tb + b * beat;
        kick(env, t, 0.75);
        if (b % 2) clap(env, t, 0.2);
        hat(env, t + beat / 2, 0.07, true);
        hat(env, t + beat / 4, 0.025); hat(env, t + 3 * beat / 4, 0.025);
        tone(env, UP.roots[c] + 12, t + beat / 2, beat * 0.4, { type: 'square', cutoff: 900, gain: 0.11, release: 0.05 });
        tone(env, UP.roots[c], t, beat * 0.35, { type: 'square', cutoff: 700, gain: 0.1, release: 0.05 });
        for (const m of UP.chords[c]) tone(env, m, t + beat / 2, beat * 0.22, { type: 'triangle', gain: 0.045, release: 0.06 });
      }
      UP.lead[c].forEach((m, i) => tone(env, m, tb + i * beat / 2, beat * 0.4, { type: 'square', cutoff: 2600, gain: 0.05, release: 0.07 }));
      if (c === 0) crash(env, tb, n === 0 ? 0.16 : 0.08);
    }
  };

  // One-shots
  function timeup(env, t) {
    [79, 76, 72].forEach((m, i) => tone(env, m, t + i * 0.09, 0.08, { type: 'square', cutoff: 3000, gain: 0.09, release: 0.04 }));
    const t2 = t + 0.28;
    kick(env, t2, 0.9);
    crash(env, t2, 0.18);
    for (const m of [48, 55, 60, 64]) tone(env, m, t2, 0.9, { type: 'sawtooth', cutoff: 2400, sweepTo: 500, gain: 0.07, decay: 0.25, sustain: 0.25, release: 0.5 });
    return 1.6;
  }
  function fanfare(env, t) {
    [72, 76, 79].forEach((m, i) => tone(env, m, t + i * 0.13, 0.12, { type: 'square', cutoff: 3200, gain: 0.09, release: 0.05 }));
    const t2 = t + 0.42;
    kick(env, t2, 0.9); crash(env, t2, 0.22);
    for (const m of [60, 64, 67, 72, 84]) tone(env, m, t2, 1.0, { type: 'sawtooth', cutoff: 3000, sweepTo: 1200, gain: 0.05, attack: 0.02, release: 0.4 });
    tone(env, 36, t2, 1.0, { type: 'square', cutoff: 500, gain: 0.15, release: 0.3 });
    return 1.75;
  }
  function tick(env, t, last) {
    tone(env, last ? 93 : 88, t, last ? 0.12 : 0.06, { type: 'square', cutoff: 4000, gain: last ? 0.12 : 0.09, release: 0.03 });
  }

  const LOOPS = { question, leader, final: leader };
  const INTRO = { final: fanfare };

  // ---------------------------------------------------------------- live engine
  let ctx = null, master = null, env = null, session = null;
  let enabled = store.get('rq_music_on', true), volume = store.get('rq_music_vol', 0.7);
  let current = null; // { name, deadlineMs }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = volume;
      master.connect(comp); comp.connect(ctx.destination);
      env = { ctx, out: master, noise: noiseBuffer(ctx) };
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  function stopSession() {
    if (!session) return;
    const s = session; session = null;
    clearInterval(s.timer);
    try { s.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06); } catch (e) {}
    setTimeout(() => { try { s.gain.disconnect(); } catch (e) {} }, 700);
  }

  function startSession(name, deadlineMs) {
    stopSession();
    if (!enabled || !ensure()) return;
    const g = ctx.createGain(); g.gain.value = 1; g.connect(master);
    const senv = { ctx, out: g, noise: env.noise };
    const loop = LOOPS[name];
    let next = ctx.currentTime + 0.06, n = 0;
    if (INTRO[name]) next += INTRO[name](senv, next);
    if (deadlineMs) {
      const tEnd = ctx.currentTime + (deadlineMs - Date.now()) / 1000;
      for (let i = 5; i >= 1; i--) if (tEnd - i > ctx.currentTime) tick(senv, tEnd - i, i === 1);
    }
    const s = { gain: g, timer: null };
    const sched = () => {
      if (session !== s) return;
      while (next < ctx.currentTime + 0.35) { loop.bar(senv, n++, next); next += loop.barDur; }
    };
    session = s;
    sched();
    s.timer = setInterval(sched, 50);
  }

  const api = {
    play(name, opts = {}) { current = { name, deadlineMs: opts.deadlineMs || 0 }; startSession(name, current.deadlineMs); },
    stop() { current = null; stopSession(); },
    sting(name) {
      if (!enabled || !ensure()) return;
      if (name === 'timeup') timeup(env, ctx.currentTime + 0.03);
    },
    unlock() { if (enabled) ensure(); },
    enabled: () => enabled,
    setEnabled(v) {
      enabled = !!v; store.set('rq_music_on', enabled);
      if (!enabled) stopSession();
      else if (current) {
        if (current.deadlineMs && current.deadlineMs < Date.now()) return;
        startSession(current.name, current.deadlineMs);
      }
    },
    volume: () => volume,
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v)); store.set('rq_music_vol', volume);
      if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
    },
    // Renders a track offline (used to make preview recordings)
    async render(name, seconds) {
      const sr = 44100, oc = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
      const comp = oc.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      const m = oc.createGain(); m.gain.value = 0.8; m.connect(comp); comp.connect(oc.destination);
      const e = { ctx: oc, out: m, noise: noiseBuffer(oc) };
      if (name === 'timeup') timeup(e, 0.05);
      else {
        let t = 0.05, n = 0;
        if (INTRO[name]) t += INTRO[name](e, t);
        if (name === 'question') for (let i = 5; i >= 1; i--) tick(e, seconds - 0.3 - i, i === 1);
        while (t < seconds) { LOOPS[name].bar(e, n++, t); t += LOOPS[name].barDur; }
      }
      return oc.startRendering();
    }
  };
  window.RQMusic = api;
})();
