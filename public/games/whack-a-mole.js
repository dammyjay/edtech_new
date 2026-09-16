// Arcade: Whack-a-Mole — DOM grid, tap moles the instant they pop up.
(function () {
  const SIZE = 3; // 3x3 grid

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#a16207");
    container.innerHTML = `
      <p class="arcade-game-hint">Tap the moles the instant they pop up. 30 seconds!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="wamScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="wamTime">30</span></div>
      </div>
      <div id="wamGrid" style="display:grid; grid-template-columns:repeat(${SIZE}, 1fr); gap:14px; max-width:340px; margin:0 auto;"></div>
    `;

    const grid = container.querySelector("#wamGrid");
    const scoreEl = container.querySelector("#wamScore");
    const timeEl = container.querySelector("#wamTime");
    const holes = [];

    for (let i = 0; i < SIZE * SIZE; i++) {
      const hole = document.createElement("div");
      hole.style.cssText = "aspect-ratio:1; border-radius:50%; background:radial-gradient(circle at 50% 30%, #3f2a12, #1c1305); display:flex; align-items:flex-end; justify-content:center; overflow:hidden; cursor:pointer; position:relative;";
      const mole = document.createElement("div");
      mole.style.cssText = "width:70%; height:0%; background:#92400e; border-radius:50% 50% 45% 45%; transition:height .12s ease-out; display:flex; align-items:center; justify-content:center; font-size:clamp(18px,5vw,26px);";
      mole.textContent = "🐹";
      hole.appendChild(mole);
      grid.appendChild(hole);
      const idx = holes.length;
      holes.push({ hole, mole, up: false, timeoutId: null });
      hole.addEventListener("click", () => whack(idx));
    }

    let score, timeLeft, running, spawnTimer, timerId;

    function whack(idx) {
      const h = holes[idx];
      if (!h.up || !running) return;
      h.up = false;
      h.mole.style.height = "0%";
      score++;
      scoreEl.textContent = String(score);
      ArcadeEngine.vibrate(15);
      if (h.timeoutId) clearTimeout(h.timeoutId);
    }

    function popRandom() {
      if (!running) return;
      const downHoles = holes.map((h, i) => (h.up ? -1 : i)).filter((i) => i >= 0);
      if (!downHoles.length) return;
      const idx = downHoles[Math.floor(Math.random() * downHoles.length)];
      const h = holes[idx];
      h.up = true;
      h.mole.style.height = "80%";
      const upFor = Math.max(450, 950 - score * 15);
      h.timeoutId = setTimeout(() => {
        if (h.up) { h.up = false; h.mole.style.height = "0%"; }
      }, upFor);
    }

    let overlayEl;
    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; timeLeft = 30; running = true;
      scoreEl.textContent = "0"; timeEl.textContent = "30";
      holes.forEach((h) => { h.up = false; h.mole.style.height = "0%"; if (h.timeoutId) clearTimeout(h.timeoutId); });

      if (spawnTimer) clearInterval(spawnTimer);
      spawnTimer = setInterval(popRandom, 700);
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        timeLeft--;
        timeEl.textContent = String(Math.max(0, timeLeft));
        if (timeLeft <= 0) finish();
      }, 1000);
    }

    function finish() {
      running = false;
      clearInterval(spawnTimer);
      clearInterval(timerId);
      holes.forEach((h) => { h.up = false; h.mole.style.height = "0%"; if (h.timeoutId) clearTimeout(h.timeoutId); });
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "🔨", title: "Time's up!", subtitle: `You whacked ${score} moles.`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    container._cleanup = () => {
      running = false;
      clearInterval(spawnTimer);
      clearInterval(timerId);
      holes.forEach((h) => { if (h.timeoutId) clearTimeout(h.timeoutId); });
    };

    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["whack-a-mole"] = { start, stop };
})();
