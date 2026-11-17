// public/js/arcadeSound.js
//
// Shared sound effects for the Arcade — synthesized with the Web Audio
// API (oscillators/noise + envelopes), not audio files, so there's
// nothing to host, license, or download. One shared AudioContext for
// the whole page; games just call ArcadeSound.play("goal") etc.
//
// Mute state is a per-browser preference (not game progress), so it's
// read/written to localStorage directly rather than needing a runtime
// capability — wrapped in try/catch since storage access can throw
// (private browsing, blocked cookies, etc.).
(function () {
  const STORAGE_KEY = "arcadeSoundMuted";
  let ctx = null;
  let muted = false;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) { /* no-op — default unmuted */ }

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function envGain(ac, destination, startGain, attack, decay, startAt) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, startAt);
    g.gain.linearRampToValueAtTime(startGain, startAt + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);
    g.connect(destination);
    return g;
  }

  function tone(ac, { freq, type = "sine", startAt, dur = 0.18, gain = 0.22, attack = 0.01, slideTo = null }) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, startAt + dur);
    const g = envGain(ac, ac.destination, gain, attack, dur, startAt);
    osc.connect(g);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.05);
  }

  function noiseBurst(ac, { startAt, dur = 0.15, gain = 0.25, filterFreq = 1200 }) {
    const bufferSize = Math.ceil(ac.sampleRate * dur);
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = envGain(ac, filter, gain, 0.005, dur, startAt);
    filter.connect(ac.destination);
    src.connect(g);
    src.start(startAt);
    src.stop(startAt + dur + 0.05);
  }

  function chord(ac, freqs, startAt, stagger, opts) {
    freqs.forEach((f, i) => tone(ac, { ...opts, freq: f, startAt: startAt + i * stagger }));
  }

  const PATCHES = {
    click: (ac, t) => tone(ac, { freq: 740, type: "square", startAt: t, dur: 0.05, gain: 0.12 }),
    bounce: (ac, t) => tone(ac, { freq: 180, type: "sine", startAt: t, dur: 0.1, gain: 0.2, slideTo: 90 }),
    swoosh: (ac, t) => noiseBurst(ac, { startAt: t, dur: 0.22, gain: 0.1, filterFreq: 2200 }),
    bump: (ac, t) => noiseBurst(ac, { startAt: t, dur: 0.12, gain: 0.3, filterFreq: 500 }),
    swish: (ac, t) => chord(ac, [660, 880, 1320], t, 0.06, { type: "triangle", dur: 0.22, gain: 0.18 }),
    score: (ac, t) => chord(ac, [523, 659], t, 0.07, { type: "triangle", dur: 0.2, gain: 0.2 }),
    goal: (ac, t) => chord(ac, [523, 659, 784, 1046], t, 0.08, { type: "triangle", dur: 0.3, gain: 0.22 }),
    sink: (ac, t) => tone(ac, { freq: 900, type: "sine", startAt: t, dur: 0.15, gain: 0.2, slideTo: 1400 }),
    save: (ac, t) => tone(ac, { freq: 300, type: "sawtooth", startAt: t, dur: 0.25, gain: 0.2, slideTo: 120 }),
    miss: (ac, t) => tone(ac, { freq: 260, type: "sawtooth", startAt: t, dur: 0.2, gain: 0.15, slideTo: 140 }),
    lap: (ac, t) => chord(ac, [660, 880], t, 0.08, { type: "square", dur: 0.14, gain: 0.16 }),
    win: (ac, t) => chord(ac, [523, 659, 784, 1046, 1318], t, 0.11, { type: "triangle", dur: 0.35, gain: 0.22 }),
    lose: (ac, t) => chord(ac, [400, 320, 240], t, 0.14, { type: "sawtooth", dur: 0.3, gain: 0.18 }),
    dunk: (ac, t) => {
      noiseBurst(ac, { startAt: t, dur: 0.18, gain: 0.28, filterFreq: 450 });
      chord(ac, [196, 294], t + 0.05, 0.06, { type: "sawtooth", dur: 0.22, gain: 0.2 });
    },
  };

  function play(name) {
    if (muted) return;
    const ac = getCtx();
    if (!ac) return;
    const patch = PATCHES[name];
    if (!patch) return;
    try { patch(ac, ac.currentTime); } catch (e) { /* no-op — never break gameplay over sound */ }
  }

  function setMuted(next) {
    muted = !!next;
    try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch (e) { /* no-op */ }
    document.dispatchEvent(new CustomEvent("arcadeSoundMuteChanged", { detail: { muted } }));
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  window.ArcadeSound = { play, toggleMute, setMuted, isMuted: () => muted };
})();
