// Arcade: Reaction Test — tap the instant the panel turns green.
(function () {
  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#eab308");
    container.innerHTML = `
      <p class="arcade-game-hint">Wait for green, then tap as fast as you can. 5 rounds.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Round</span><span class="value" id="rtRound">1 / 5</span></div>
        <div class="arcade-score-pill"><span class="label">Best</span><span class="value" id="rtBest">${localStorage.getItem("arcade_reaction_best") || "–"}</span></div>
      </div>
      <div id="rtPanel" style="max-width:360px; height:260px; margin:0 auto; border-radius:18px; display:flex; align-items:center; justify-content:center; flex-direction:column; cursor:pointer; background:#334155; transition:background .1s; font-weight:800; font-size:18px; color:#fff; user-select:none;">
        Tap to start
      </div>
    `;

    const panel = container.querySelector("#rtPanel");
    const roundEl = container.querySelector("#rtRound");
    const bestEl = container.querySelector("#rtBest");

    const TOTAL_ROUNDS = 5;
    let round, times, state, timeoutId, waitStart, overlayEl;

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      round = 0; times = []; state = "idle";
      roundEl.textContent = `1 / ${TOTAL_ROUNDS}`;
      setPanel("#334155", "Tap to start");
    }

    function setPanel(color, text) {
      panel.style.background = color;
      panel.textContent = text;
    }

    function startRound() {
      round++;
      roundEl.textContent = `${round} / ${TOTAL_ROUNDS}`;
      state = "waiting";
      setPanel("#dc2626", "Wait for green…");
      const delay = 800 + Math.random() * 2200;
      timeoutId = setTimeout(() => {
        state = "go";
        waitStart = performance.now();
        setPanel("#16a34a", "TAP NOW!");
      }, delay);
    }

    function onTap() {
      if (state === "idle") { startRound(); return; }
      if (state === "waiting") {
        clearTimeout(timeoutId);
        setPanel("#334155", "Too soon! Tap to retry this round.");
        state = "tooSoon";
        return;
      }
      if (state === "tooSoon") { state = "waiting"; startRound(); return; }
      if (state === "go") {
        const rt = Math.round(performance.now() - waitStart);
        times.push(rt);
        ArcadeEngine.vibrate(20);
        if (round >= TOTAL_ROUNDS) {
          finish();
        } else {
          state = "betweenRounds";
          setPanel("#334155", `${rt} ms — tap for next round`);
        }
        return;
      }
      if (state === "betweenRounds") { state = "waiting"; startRound(); }
    }

    function finish() {
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const best = Math.min(avg, Number(localStorage.getItem("arcade_reaction_best") || Infinity));
      localStorage.setItem("arcade_reaction_best", String(best));
      bestEl.textContent = String(best);
      state = "done";
      setPanel("#334155", "Done!");
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "⚡", title: "Average reaction", subtitle: `${avg} ms across ${TOTAL_ROUNDS} rounds`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    panel.addEventListener("click", onTap);
    container._cleanup = () => { if (timeoutId) clearTimeout(timeoutId); };

    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["reaction-test"] = { start, stop };
})();
