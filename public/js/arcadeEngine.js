// public/js/arcadeEngine.js
//
// Shared touch/responsive helpers for every game in public/games/*.js —
// built once so 15 games don't each reinvent swipe detection, canvas
// scaling, and on-screen controls. Loaded before any game script (see
// views/student/arcade.ejs). Exposes window.ArcadeEngine.
(function () {
  // ---------------------------------------------------------------
  // Responsive canvas: sizes a canvas's CSS box to fit its container's
  // width (capped at maxWidth) while keeping the given aspect ratio, and
  // backs it with devicePixelRatio-scaled internal resolution so it
  // stays crisp on retina/phone screens. Returns a {width, height} in
  // CSS px the CALLER should treat as the logical drawing surface (pass
  // that same size to ctx-drawing code — the returned scale is already
  // applied to the context transform).
  function fitCanvas(canvas, aspectRatio, maxWidth) {
    maxWidth = maxWidth || 480;
    const parent = canvas.parentElement;
    const cssWidth = Math.min(maxWidth, parent ? parent.clientWidth : maxWidth);
    const cssHeight = cssWidth / aspectRatio;
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: cssWidth, height: cssHeight, ctx };
  }

  // Re-runs `onResize(dims)` whenever the window resizes (debounced) —
  // callers use this to re-fit a canvas and redraw. Returns a cleanup
  // function to remove the listener (call from the game's stop()).
  function onResize(fn) {
    let raf = null;
    const handler = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fn);
    };
    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("orientationchange", handler);
    };
  }

  // ---------------------------------------------------------------
  // Swipe detection on any element (canvas or div) — fires
  // handlers.onSwipe("up"|"down"|"left"|"right") once per gesture, and
  // handlers.onTap() for a short tap with negligible movement. Ignores
  // the browser's own touch scrolling (touch-action:none is set on the
  // element so the page doesn't scroll while swiping inside a game).
  function bindSwipe(el, handlers) {
    handlers = handlers || {};
    el.style.touchAction = "none";
    let startX = 0, startY = 0, startT = 0, active = false;

    function down(x, y) {
      startX = x; startY = y; startT = Date.now(); active = true;
    }
    function up(x, y) {
      if (!active) return;
      active = false;
      const dx = x - startX, dy = y - startY;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const dt = Date.now() - startT;
      if (adx < 12 && ady < 12 && dt < 400) {
        handlers.onTap && handlers.onTap();
        return;
      }
      if (Math.max(adx, ady) < 20) return; // too small to count as a swipe
      if (adx > ady) handlers.onSwipe && handlers.onSwipe(dx > 0 ? "right" : "left");
      else handlers.onSwipe && handlers.onSwipe(dy > 0 ? "down" : "up");
    }

    const onTouchStart = (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); };
    const onTouchEnd = (e) => { const t = e.changedTouches[0]; up(t.clientX, t.clientY); };
    const onMouseDown = (e) => down(e.clientX, e.clientY);
    const onMouseUp = (e) => up(e.clientX, e.clientY);

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mouseup", onMouseUp);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mouseup", onMouseUp);
    };
  }

  // ---------------------------------------------------------------
  // On-screen D-pad — appended into `container`, calls
  // onDir("up"|"down"|"left"|"right") on press (and repeatedly while
  // held, for smooth movement games). Always rendered (not just
  // touch-only) since a lot of tablets also take mouse/pen input, and it
  // doubles as a visible affordance that the game IS controllable.
  function dpad(container, onDir) {
    const wrap = document.createElement("div");
    wrap.className = "arcade-dpad";
    wrap.innerHTML = `
      <button type="button" class="arcade-dpad-btn up" data-dir="up" aria-label="Up">▲</button>
      <button type="button" class="arcade-dpad-btn left" data-dir="left" aria-label="Left">◀</button>
      <button type="button" class="arcade-dpad-btn right" data-dir="right" aria-label="Right">▶</button>
      <button type="button" class="arcade-dpad-btn down" data-dir="down" aria-label="Down">▼</button>
    `;
    container.appendChild(wrap);

    let repeatId = null;
    wrap.querySelectorAll(".arcade-dpad-btn").forEach((btn) => {
      const dir = btn.dataset.dir;
      const press = (e) => {
        e.preventDefault();
        onDir(dir);
        vibrate(10);
        if (repeatId) clearInterval(repeatId);
        repeatId = setInterval(() => onDir(dir), 140);
      };
      const release = () => { if (repeatId) { clearInterval(repeatId); repeatId = null; } };
      btn.addEventListener("touchstart", press, { passive: false });
      btn.addEventListener("touchend", release);
      btn.addEventListener("mousedown", press);
      btn.addEventListener("mouseup", release);
      btn.addEventListener("mouseleave", release);
    });

    return wrap;
  }

  // ---------------------------------------------------------------
  // Tiny haptic nudge on supported devices — silently no-ops elsewhere
  // (desktop browsers, iOS Safari has no vibrate API at all).
  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* no-op */ }
  }

  // ---------------------------------------------------------------
  // Lightweight celebratory confetti burst for a win — a handful of
  // CSS-animated divs, not a canvas particle system, so it's cheap
  // enough to fire from every game without a shared render loop.
  function confetti(container, count) {
    count = count || 24;
    const colors = ["#f59e0b", "#22c55e", "#4f46e5", "#ec4899", "#06b6d4", "#ef4444"];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "arcade-confetti-piece";
      const x = 40 + Math.random() * 20; // start near center, spread outward
      const dx = (Math.random() - 0.5) * 260;
      const dur = 700 + Math.random() * 500;
      piece.style.left = x + "%";
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.setProperty("--dx", dx + "px");
      piece.style.animationDuration = dur + "ms";
      container.appendChild(piece);
      setTimeout(() => piece.remove(), dur + 100);
    }
  }

  // ---------------------------------------------------------------
  // Reports a finished round's score to the server — difficulty/XP/coin
  // persistence layer backing the per-game leaderboard and personal best.
  // gameId/difficulty come from data attributes arcade.ejs sets on the
  // container before calling a game's start(), so individual games never
  // need to know or pass their own id. Self-contained try/catch: a failed
  // report should never break the player's local "Play Again" flow.
  async function reportScore(container, score) {
    const gameId = container && container.dataset && container.dataset.gameId;
    if (!gameId) return null;
    const difficulty = container.dataset.difficulty || null;
    try {
      const res = await fetch(`/student/arcade/${gameId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, difficulty }),
      });
      const data = await res.json();
      return data && data.success ? data : null;
    } catch (e) {
      console.error("Arcade score report failed:", e);
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Standard game-over / win overlay markup+behavior, shared so every
  // game's "Play Again" panel looks and animates the same way. Passing
  // `score` (a number) additionally reports the round to the server and
  // fills in an XP/best-score/rank line once that resolves — every game
  // already calls this exact function at its game-over moment, so adding
  // `score` to that one call is the whole integration a game needs for
  // XP + leaderboard participation.
  function overlay(container, { emoji, title, subtitle, buttonLabel, onRestart, score }) {
    const el = document.createElement("div");
    el.className = "arcade-overlay";
    el.innerHTML = `
      <div class="arcade-overlay-card">
        <div class="arcade-overlay-emoji">${emoji || "🎮"}</div>
        <h3>${title || "Game Over"}</h3>
        ${subtitle ? `<p>${subtitle}</p>` : ""}
        ${typeof score === "number" ? `<p class="arcade-score-result" data-arcade-score-result>Saving your score…</p>` : ""}
        <button type="button" class="arcade-btn-primary">${buttonLabel || "Play Again"}</button>
      </div>
    `;
    el.querySelector("button").addEventListener("click", onRestart);
    container.appendChild(el);

    if (typeof score === "number") {
      const resultEl = el.querySelector("[data-arcade-score-result]");
      reportScore(container, score).then((result) => {
        if (!resultEl || !resultEl.isConnected) return; // overlay already dismissed/replaced
        if (!result) {
          resultEl.remove();
          return;
        }
        const bits = [`+${result.xpGained} XP`];
        if (result.isNewBest) bits.push("🏆 New personal best!");
        else if (typeof result.bestScore === "number") bits.push(`Best: ${result.bestScore}`);
        if (result.rank) bits.push(`Rank #${result.rank}`);
        resultEl.textContent = bits.join(" · ");
        if (result.levelUp) vibrate(30);
      });
    }

    return el;
  }

  window.ArcadeEngine = { fitCanvas, onResize, bindSwipe, dpad, vibrate, confetti, overlay, reportScore };
})();
