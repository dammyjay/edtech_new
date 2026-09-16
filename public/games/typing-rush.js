// Arcade: Typing Rush — type the falling word before it hits the ground.
// Uses a real <input> so mobile devices get the OS keyboard automatically
// (that IS the touch interaction for a typing game).
(function () {
  const WORDS = [
    "function", "variable", "loop", "array", "object", "string", "number", "boolean",
    "console", "return", "import", "export", "class", "constant", "module", "promise",
    "keyboard", "school", "teacher", "student", "science", "history", "rainbow", "mountain",
    "computer", "internet", "language", "platform", "algorithm", "database", "network", "gadget",
    "puzzle", "victory", "journey", "explore", "curious", "elegant", "diamond", "harvest",
  ];

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#475569");
    container.innerHTML = `
      <p class="arcade-game-hint">Type the falling word exactly, then hit Enter (or just finish typing it) before it lands.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="trScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Lives</span><span class="value" id="trLives">3</span></div>
        <div class="arcade-score-pill"><span class="label">WPM</span><span class="value" id="trWpm">0</span></div>
      </div>
      <div id="trTrack" style="position:relative; height:220px; max-width:420px; margin:0 auto; background:rgba(255,255,255,0.05); border-radius:12px; overflow:hidden;">
        <div id="trWord" style="position:absolute; left:50%; transform:translateX(-50%); top:0; font-size:clamp(20px,5vw,28px); font-weight:800; white-space:nowrap;"></div>
        <div style="position:absolute; bottom:0; left:0; right:0; height:3px; background:#ef4444;"></div>
      </div>
      <input id="trInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Type here…"
        style="margin-top:14px; width:min(100%, 300px); padding:12px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.06); color:#fff; font-size:16px; text-align:center;" />
    `;

    const track = container.querySelector("#trTrack");
    const wordEl = container.querySelector("#trWord");
    const input = container.querySelector("#trInput");
    const scoreEl = container.querySelector("#trScore");
    const livesEl = container.querySelector("#trLives");
    const wpmEl = container.querySelector("#trWpm");

    let score, lives, running, currentWord, top, speed, rafId, startTime, charsTyped, overlayEl, lastTime;

    function trackHeight() { return track.clientHeight; }

    function spawnWord() {
      currentWord = WORDS[Math.floor(Math.random() * WORDS.length)];
      wordEl.textContent = currentWord;
      wordEl.style.color = "#e2e8f0";
      top = 0;
      wordEl.style.top = "0px";
      speed = 22 + Math.min(score, 400) * 0.06; // px/sec, ramps with score
    }

    function loop(ts) {
      if (!running) return;
      if (!lastTime) lastTime = ts;
      const dt = (ts - lastTime) / 1000;
      lastTime = ts;
      top += speed * dt;
      wordEl.style.top = top + "px";

      if (top > trackHeight() - 30) {
        loseLife();
      }
      rafId = requestAnimationFrame(loop);
    }

    function loseLife() {
      lives--;
      livesEl.textContent = String(lives);
      ArcadeEngine.vibrate(30);
      if (lives <= 0) { finish(); return; }
      input.value = "";
      spawnWord();
      lastTime = null;
    }

    function onInput() {
      if (!running) return;
      const val = input.value.trim().toLowerCase();
      charsTyped++;
      updateWpm();
      if (val === currentWord) {
        score += Math.max(5, 15 - Math.floor(top / 20));
        scoreEl.textContent = String(score);
        ArcadeEngine.vibrate(10);
        input.value = "";
        spawnWord();
        lastTime = null;
      } else if (currentWord.startsWith(val)) {
        wordEl.style.color = "#4ade80";
      } else {
        wordEl.style.color = "#f87171";
      }
    }

    function updateWpm() {
      const minutes = (Date.now() - startTime) / 60000;
      if (minutes > 0) wpmEl.textContent = String(Math.round((charsTyped / 5) / minutes));
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; lives = 3; running = true; charsTyped = 0; startTime = Date.now(); lastTime = null;
      scoreEl.textContent = "0"; livesEl.textContent = "3"; wpmEl.textContent = "0";
      input.value = "";
      spawnWord();
      rafId = requestAnimationFrame(loop);
      setTimeout(() => input.focus(), 50);
    }

    function finish() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "⌨️", title: "Out of lives!", subtitle: `Score: ${score} — ${wpmEl.textContent} WPM`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") onInput(); });

    container._cleanup = () => { running = false; if (rafId) cancelAnimationFrame(rafId); };
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["typing-rush"] = { start, stop };
})();
