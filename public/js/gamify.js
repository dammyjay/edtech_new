// Shared, dependency-free gamification primitives for the student
// dashboard's quiz experience: confetti, synthesized sound chimes, a
// small swappable mascot character, and a handful of chunky icon SVGs —
// following the same "small hand-rolled module" pattern as
// public/js/arcadeEngine.js rather than pulling in a new library.
(function () {
  "use strict";

  // ---------------------------------------------------------------
  // Confetti — same technique as arcadeEngine.js's confetti(): randomized
  // horizontal drift pieces that fall+spin+fade, auto-removed after their
  // own animation. Kept as its own small copy here (rather than importing
  // arcadeEngine.js into the dashboard) so this pass doesn't touch the
  // already-working arcade code.
  const CONFETTI_COLORS = ["#f59e0b", "#22c55e", "#4f46e5", "#ec4899", "#06b6d4", "#ef4444", "#A17807"];

  function confetti(container, count) {
    if (!container) return;
    count = count || 28;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "gamify-confetti-piece";
      const x = 10 + Math.random() * 80;
      const dx = (Math.random() - 0.5) * 240;
      const dur = 900 + Math.random() * 700;
      piece.style.left = x + "%";
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.setProperty("--dx", dx + "px");
      piece.style.animationDuration = dur + "ms";
      container.appendChild(piece);
      setTimeout(() => piece.remove(), dur + 100);
    }
  }

  // ---------------------------------------------------------------
  // Sound — short synthesized chimes via Web Audio, no audio files to
  // source/host/license. Lazily creates its AudioContext on first use.
  // Browsers only let an AudioContext actually play once it's been
  // resumed inside a genuine user gesture — a quiz-option click already
  // is one, but as a safety net (some browsers are stricter about which
  // gestures count) a one-time listener below also tries to warm it up
  // on the very first tap/click/key anywhere on the page.
  let audioCtx = null;
  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function warmUpAudio() {
    getCtx();
  }
  ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, warmUpAudio, { once: true, capture: true });
  });

  function tone(ctx, freq, startTime, duration, peakGain) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  // Peak gains are deliberately well above "just audible" (0.2-0.3 on
  // the 0-1 scale) — the first pass used 0.05-0.09, which turned out to
  // be too quiet to notice over normal speaker/system volume.
  const CHIME_SEQUENCES = {
    select: [[600, 0, 0.07, 0.18]],
    correct: [[523.25, 0, 0.11, 0.26], [784, 0.09, 0.16, 0.26]],
    wrong: [[392, 0, 0.16, 0.2], [330, 0.1, 0.18, 0.18]],
    streak: [[523.25, 0, 0.1, 0.24], [659.25, 0.08, 0.1, 0.24], [880, 0.16, 0.18, 0.26]],
    levelup: [[523.25, 0, 0.11, 0.24], [659.25, 0.09, 0.11, 0.24], [784, 0.18, 0.11, 0.24], [1046.5, 0.27, 0.22, 0.28]],
    badge: [[659.25, 0, 0.12, 0.24], [880, 0.1, 0.12, 0.24], [1174.66, 0.2, 0.22, 0.28]],
  };

  const MUTE_KEY = "gamifySoundMuted";
  function isMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch (e) {
      return false;
    }
  }
  function setMuted(muted) {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "true" : "false");
    } catch (e) {}
  }

  function playChime(type) {
    if (isMuted()) return;
    const ctx = getCtx();
    if (!ctx) return;
    const seq = CHIME_SEQUENCES[type] || CHIME_SEQUENCES.select;
    const now = ctx.currentTime;
    seq.forEach(([freq, offset, duration, peakGain]) => {
      tone(ctx, freq, now + offset, duration, peakGain);
    });
  }

  // Debug helper — not used by the UI, but useful from a console to
  // confirm the context ever left "suspended" if sound reports missing
  // again (e.g. Gamify.getAudioState() -> "running"/"suspended"/"none").
  function getAudioState() {
    return audioCtx ? audioCtx.state : "none";
  }

  // ---------------------------------------------------------------
  // Mascot — a small friendly "spark" character (round gradient body +
  // sparkle points, in the app's brand gold) with a handful of face
  // states. Kept as inline SVG template strings (not separate image
  // files) so it can be swapped instantly via innerHTML and its wrapper
  // can still get a CSS bounce/shake pulse — one fewer asset request,
  // consistent with how the rest of this codebase inlines small
  // hand-rolled pieces rather than splitting them into many tiny files.
  function mascotSvg(uid, face) {
    return `
      <svg viewBox="0 0 96 96" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="g-${uid}-body" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stop-color="#FFF7E0"/>
            <stop offset="55%" stop-color="#D9A82C"/>
            <stop offset="100%" stop-color="#A17807"/>
          </radialGradient>
        </defs>
        <g opacity="0.9">
          <path d="M48 2 L54 24 L48 30 L42 24 Z" fill="#D9A82C"/>
          <path d="M48 94 L54 72 L48 66 L42 72 Z" fill="#D9A82C"/>
          <path d="M2 48 L24 42 L30 48 L24 54 Z" fill="#D9A82C"/>
          <path d="M94 48 L72 42 L66 48 L72 54 Z" fill="#D9A82C"/>
        </g>
        <circle cx="48" cy="48" r="30" fill="url(#g-${uid}-body)" stroke="#4C3802" stroke-width="1.5"/>
        ${face}
      </svg>
    `;
  }

  const EYE_OPEN = `
    <circle cx="38" cy="46" r="5" fill="#2b1c02"/>
    <circle cx="60" cy="46" r="5" fill="#2b1c02"/>
    <circle cx="40" cy="44" r="1.6" fill="#fff"/>
    <circle cx="62" cy="44" r="1.6" fill="#fff"/>
  `;
  const EYE_HAPPY = `
    <path d="M32 46 Q38 38 44 46" fill="none" stroke="#2b1c02" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M54 46 Q60 38 66 46" fill="none" stroke="#2b1c02" stroke-width="3.2" stroke-linecap="round"/>
  `;
  const EYE_CONCERNED = `
    <path d="M33 43 L43 46" stroke="#2b1c02" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M63 43 L53 46" stroke="#2b1c02" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="38" cy="49" r="4" fill="#2b1c02"/>
    <circle cx="58" cy="49" r="4" fill="#2b1c02"/>
  `;
  const EYE_SIDE = `
    <circle cx="40" cy="46" r="5" fill="#2b1c02"/>
    <circle cx="62" cy="46" r="5" fill="#2b1c02"/>
    <circle cx="42" cy="44" r="1.6" fill="#fff"/>
    <circle cx="64" cy="44" r="1.6" fill="#fff"/>
  `;

  const MASCOT_FACES = {
    idle: (uid) => mascotSvg(uid, `${EYE_OPEN}<path d="M38 60 Q48 68 58 60" fill="none" stroke="#2b1c02" stroke-width="3" stroke-linecap="round"/>`),
    cheer: (uid) => mascotSvg(uid, `${EYE_HAPPY}<path d="M36 58 Q48 72 60 58" fill="#fff" stroke="#2b1c02" stroke-width="2.5"/><circle cx="30" cy="54" r="3.5" fill="#f8b4c4" opacity="0.7"/><circle cx="66" cy="54" r="3.5" fill="#f8b4c4" opacity="0.7"/>`),
    sad: (uid) => mascotSvg(uid, `${EYE_CONCERNED}<path d="M38 63 Q48 58 58 63" fill="none" stroke="#2b1c02" stroke-width="3" stroke-linecap="round"/>`),
    think: (uid) => mascotSvg(uid, `${EYE_SIDE}<path d="M40 61 L56 61" stroke="#2b1c02" stroke-width="3" stroke-linecap="round"/><circle cx="74" cy="20" r="2.2" fill="#4C3802"/><circle cx="80" cy="14" r="1.6" fill="#4C3802"/><circle cx="84" cy="9" r="1.1" fill="#4C3802"/>`),
    streak: (uid) => mascotSvg(uid, `<rect x="30" y="41" width="36" height="9" rx="4.5" fill="#2b1c02"/>${`<path d="M38 60 Q48 70 58 60" fill="#fff" stroke="#2b1c02" stroke-width="2.5"/>`}<path d="M70 26 Q76 32 72 40 Q68 34 62 34 Q68 32 70 26 Z" fill="#f97316"/>`),
  };

  let mascotUidCounter = 0;
  function setMascot(el, state) {
    if (!el) return;
    const face = MASCOT_FACES[state] || MASCOT_FACES.idle;
    let uid = el.getAttribute("data-mascot-uid");
    if (!uid) {
      uid = "m" + Date.now() + "-" + (mascotUidCounter++);
      el.setAttribute("data-mascot-uid", uid);
    }
    el.innerHTML = face(uid);
    el.classList.remove("mascot-bounce", "mascot-shake");
    // Force reflow so re-adding the same animation class replays it.
    void el.offsetWidth;
    el.classList.add(state === "sad" ? "mascot-shake" : "mascot-bounce");
  }

  function setMascotAll(state, selector) {
    document.querySelectorAll(selector || "[data-mascot-slot]").forEach((el) => setMascot(el, state));
  }

  // ---------------------------------------------------------------
  // Icons — small chunky, soft-gradient "3D-style" glyphs replacing bare
  // emoji in the quiz UI. Plain template strings, dropped in with
  // innerHTML like the mascot above.
  const icons = {
    check: `<svg viewBox="0 0 32 32" width="18" height="18"><circle cx="16" cy="16" r="15" fill="#22c55e"/><path d="M9 17l4.5 4.5L23 11" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    x: `<svg viewBox="0 0 32 32" width="18" height="18"><circle cx="16" cy="16" r="15" fill="#ef4444"/><path d="M11 11l10 10M21 11L11 21" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`,
    bulb: `<svg viewBox="0 0 32 32" width="16" height="16"><path d="M16 3a10 10 0 00-6 18v3a2 2 0 002 2h8a2 2 0 002-2v-3a10 10 0 00-6-18z" fill="#fde68a" stroke="#b45309" stroke-width="1.4"/><rect x="12" y="27" width="8" height="2.6" rx="1.3" fill="#b45309"/></svg>`,
    target: `<svg viewBox="0 0 32 32" width="16" height="16"><circle cx="16" cy="16" r="13" fill="#fecaca" stroke="#dc2626" stroke-width="1.4"/><circle cx="16" cy="16" r="8" fill="#fff" stroke="#dc2626" stroke-width="1.4"/><circle cx="16" cy="16" r="3.2" fill="#dc2626"/></svg>`,
    star: `<svg viewBox="0 0 32 32" width="16" height="16"><path d="M16 2l4.2 9.4L30 13l-7.6 6.8L24.6 30 16 24.4 7.4 30l2.2-10.2L2 13l9.8-1.6z" fill="#D9A82C" stroke="#A17807" stroke-width="1"/></svg>`,
    coin: `<svg viewBox="0 0 32 32" width="16" height="16"><circle cx="16" cy="16" r="14" fill="#facc15" stroke="#a16207" stroke-width="1.6"/><circle cx="16" cy="16" r="9" fill="none" stroke="#a16207" stroke-width="1.4"/></svg>`,
  };

  window.Gamify = { confetti, playChime, isMuted, setMuted, setMascot, setMascotAll, icons, getAudioState };
})();
