// Arcade: Simon Says — watch the pattern, repeat it back. Grows each round.
(function () {
  const PADS = [
    { name: "green", color: "#16a34a", lit: "#4ade80" },
    { name: "red", color: "#dc2626", lit: "#f87171" },
    { name: "yellow", color: "#ca8a04", lit: "#facc15" },
    { name: "blue", color: "#2563eb", lit: "#60a5fa" },
  ];

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#7c3aed");
    container.innerHTML = `
      <p class="arcade-game-hint">Watch the sequence light up, then tap it back in order.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Round</span><span class="value" id="simRound">0</span></div>
        <div class="arcade-score-pill"><span class="label">Best</span><span class="value" id="simBest">${Number(localStorage.getItem("arcade_simon_best") || 0)}</span></div>
      </div>
      <div id="simPadGrid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-width:280px; margin:0 auto;"></div>
      <p id="simStatus" style="margin-top:14px; font-size:13px; color:var(--arcade-text-dim);">Tap Start to begin</p>
      <button type="button" class="arcade-btn-primary" id="simStartBtn">Start</button>
    `;

    const padGrid = container.querySelector("#simPadGrid");
    const roundEl = container.querySelector("#simRound");
    const bestEl = container.querySelector("#simBest");
    const statusEl = container.querySelector("#simStatus");
    const startBtn = container.querySelector("#simStartBtn");

    const padEls = PADS.map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.style.cssText = `aspect-ratio:1; border-radius:14px; border:none; background:${p.color}; cursor:pointer; transition:filter .1s, transform .1s;`;
      padGrid.appendChild(el);
      return el;
    });

    let sequence, playerStep, round, accepting, overlayEl;

    function flash(idx, duration) {
      return new Promise((resolve) => {
        padEls[idx].style.filter = "brightness(1.8)";
        padEls[idx].style.transform = "scale(0.96)";
        setTimeout(() => {
          padEls[idx].style.filter = "";
          padEls[idx].style.transform = "";
          setTimeout(resolve, 120);
        }, duration);
      });
    }

    async function playSequence() {
      accepting = false;
      statusEl.textContent = "Watch…";
      await new Promise((r) => setTimeout(r, 400));
      for (const idx of sequence) {
        await flash(idx, Math.max(280, 520 - round * 15));
      }
      playerStep = 0;
      accepting = true;
      statusEl.textContent = "Your turn — repeat it back";
    }

    function nextRound() {
      round++;
      roundEl.textContent = String(round);
      sequence.push(Math.floor(Math.random() * PADS.length));
      playSequence();
    }

    function onPad(idx) {
      if (!accepting) return;
      flash(idx, 180);
      ArcadeEngine.vibrate(10);
      if (sequence[playerStep] !== idx) {
        fail();
        return;
      }
      playerStep++;
      if (playerStep === sequence.length) {
        accepting = false;
        setTimeout(nextRound, 500);
      }
    }

    padEls.forEach((el, idx) => el.addEventListener("click", () => onPad(idx)));

    function fail() {
      accepting = false;
      const best = Math.max(round - 1, Number(localStorage.getItem("arcade_simon_best") || 0));
      localStorage.setItem("arcade_simon_best", String(best));
      bestEl.textContent = String(best);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "🔴", title: "Sequence broken!", subtitle: `You reached round ${round - 1 < 0 ? 0 : round - 1}.`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      sequence = []; playerStep = 0; round = 0; accepting = false;
      roundEl.textContent = "0";
      statusEl.textContent = "Tap Start to begin";
      startBtn.style.display = "inline-block";
    }

    startBtn.addEventListener("click", () => {
      startBtn.style.display = "none";
      nextRound();
    });

    container._cleanup = () => {};
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["simon-says"] = { start, stop };
})();
