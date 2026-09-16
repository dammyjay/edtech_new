// Arcade: Math Blitz — rapid-fire arithmetic, multiple-choice (touch-
// friendly — no keyboard required). Difficulty ramps with streak.
(function () {
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function genProblem(streak) {
    const ops = streak < 4 ? ["+", "-"] : streak < 9 ? ["+", "-", "×"] : ["+", "-", "×", "÷"];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a, b, answer;
    const maxN = Math.min(12 + streak * 2, 50);

    if (op === "+") { a = randInt(1, maxN); b = randInt(1, maxN); answer = a + b; }
    else if (op === "-") { a = randInt(1, maxN); b = randInt(1, a); answer = a - b; }
    else if (op === "×") { a = randInt(2, Math.min(6 + Math.floor(streak / 2), 12)); b = randInt(2, Math.min(6 + Math.floor(streak / 2), 12)); answer = a * b; }
    else { b = randInt(2, 10); answer = randInt(2, 10); a = b * answer; }

    return { text: `${a} ${op} ${b}`, answer };
  }

  function genChoices(answer) {
    const choices = new Set([answer]);
    while (choices.size < 4) {
      const delta = randInt(-6, 6) || 1;
      const c = answer + delta;
      if (c !== answer && c >= 0) choices.add(c);
    }
    return Array.from(choices).sort(() => Math.random() - 0.5);
  }

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#059669");
    container.innerHTML = `
      <p class="arcade-game-hint">Solve as many as you can in 60 seconds. Gets harder as your streak grows!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="mbScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Streak</span><span class="value" id="mbStreak">0</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="mbTime">60</span></div>
      </div>
      <div id="mbProblem" style="font-size:clamp(34px,9vw,52px); font-weight:900; margin:22px 0;"></div>
      <div id="mbChoices" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:12px; max-width:340px; margin:0 auto;"></div>
    `;

    const problemEl = container.querySelector("#mbProblem");
    const choicesEl = container.querySelector("#mbChoices");
    const scoreEl = container.querySelector("#mbScore");
    const streakEl = container.querySelector("#mbStreak");
    const timeEl = container.querySelector("#mbTime");

    let score, streak, timeLeft, running, current, timerId, overlayEl;

    function nextProblem() {
      current = genProblem(streak);
      const choices = genChoices(current.answer);
      problemEl.textContent = current.text + " = ?";
      choicesEl.innerHTML = "";
      choices.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = String(c);
        btn.style.cssText = "padding:16px 6px; border-radius:12px; border:none; font-weight:800; font-size:20px; color:#fff; background:rgba(255,255,255,0.1); cursor:pointer;";
        btn.addEventListener("click", () => onAnswer(c, btn));
        choicesEl.appendChild(btn);
      });
    }

    function onAnswer(value, btn) {
      if (!running) return;
      if (value === current.answer) {
        btn.style.background = "#16a34a";
        score += 10 + streak;
        streak++;
        ArcadeEngine.vibrate(10);
      } else {
        btn.style.background = "#dc2626";
        streak = 0;
      }
      scoreEl.textContent = String(score);
      streakEl.textContent = String(streak);
      setTimeout(() => { if (running) nextProblem(); }, 220);
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; streak = 0; timeLeft = 60; running = true;
      scoreEl.textContent = "0"; streakEl.textContent = "0"; timeEl.textContent = "60";
      nextProblem();
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
        emoji: "➗", title: "Time's up!", subtitle: `Final score: ${score}`,
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
  window.ArcadeGames["math-blitz"] = { start, stop };
})();
