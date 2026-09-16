// Arcade: Color Match — Stroop test. Tap the button matching the INK
// color the word is printed in, not what the word says.
(function () {
  const COLORS = [
    { name: "RED", hex: "#ef4444" },
    { name: "BLUE", hex: "#3b82f6" },
    { name: "GREEN", hex: "#22c55e" },
    { name: "YELLOW", hex: "#eab308" },
    { name: "PURPLE", hex: "#a855f7" },
  ];

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#ec4899");
    container.innerHTML = `
      <p class="arcade-game-hint">Tap the button matching the COLOR the word is printed in — not what it says!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="cmScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="cmTime">30</span></div>
      </div>
      <div id="cmWord" style="font-size:clamp(32px, 9vw, 48px); font-weight:900; margin:20px 0;"></div>
      <div id="cmOptions" style="display:grid; grid-template-columns:repeat(${COLORS.length > 4 ? 3 : COLORS.length}, 1fr); gap:10px; max-width:420px; margin:0 auto;"></div>
    `;

    const wordEl = container.querySelector("#cmWord");
    const optionsEl = container.querySelector("#cmOptions");
    const scoreEl = container.querySelector("#cmScore");
    const timeEl = container.querySelector("#cmTime");

    let score, timeLeft, running, current, timerId, overlayEl;

    COLORS.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = c.name;
      btn.style.cssText = `padding:14px 6px; border-radius:10px; border:none; font-weight:800; font-size:13px; color:#fff; background:${c.hex}; cursor:pointer;`;
      btn.addEventListener("click", () => answer(c.name));
      optionsEl.appendChild(btn);
    });

    function nextRound() {
      const word = COLORS[Math.floor(Math.random() * COLORS.length)];
      let ink = COLORS[Math.floor(Math.random() * COLORS.length)];
      // Bias against the word matching its own ink color so most rounds
      // are genuinely a Stroop conflict, not a freebie.
      if (Math.random() < 0.85) {
        while (ink.name === word.name) ink = COLORS[Math.floor(Math.random() * COLORS.length)];
      }
      current = { word, ink };
      wordEl.textContent = word.name;
      wordEl.style.color = ink.hex;
    }

    function answer(name) {
      if (!running) return;
      if (name === current.ink.name) {
        score++;
        scoreEl.textContent = String(score);
        ArcadeEngine.vibrate(10);
      } else {
        score = Math.max(0, score - 1);
        scoreEl.textContent = String(score);
      }
      nextRound();
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; timeLeft = 30; running = true;
      scoreEl.textContent = "0"; timeEl.textContent = "30";
      nextRound();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        timeLeft--;
        timeEl.textContent = String(Math.max(0, timeLeft));
        if (timeLeft <= 0) finish();
      }, 1000);
    }

    function finish() {
      running = false;
      clearInterval(timerId);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "🎨", title: "Time's up!", subtitle: `Final score: ${score}`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    container._cleanup = () => { if (timerId) clearInterval(timerId); };
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["color-match"] = { start, stop };
})();
