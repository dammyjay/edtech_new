// Arcade: Word Scramble — tap scrambled letter tiles in order to spell
// the word before time runs out.
(function () {
  const WORDS = [
    "PYTHON", "BRANCH", "MEMORY", "SIGNAL", "PUZZLE", "ROCKET", "GALAXY", "FOREST",
    "CASTLE", "WISDOM", "COURAGE", "MELODY", "JUSTICE", "HARMONY", "MYSTERY", "VICTORY",
    "COMPASS", "DIAMOND", "JOURNEY", "FLAVOR", "BRIDGE", "GARDEN", "LANTERN", "CRYSTAL",
  ];

  function shuffleLetters(word) {
    const letters = word.split("");
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    // Guarantee it's actually scrambled (not identical to the original order).
    if (letters.join("") === word && word.length > 1) return shuffleLetters(word);
    return letters;
  }

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#d97706");
    container.innerHTML = `
      <p class="arcade-game-hint">Tap the letters in order to spell the word. 5 words, 20 seconds each.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Word</span><span class="value" id="wsIndex">1 / 5</span></div>
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="wsScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="wsTime">20</span></div>
      </div>
      <div id="wsAnswer" style="min-height:46px; display:flex; justify-content:center; gap:6px; margin-bottom:18px; flex-wrap:wrap;"></div>
      <div id="wsTiles" style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap; max-width:420px; margin:0 auto;"></div>
      <div style="margin-top:16px;">
        <button type="button" class="arcade-btn-secondary" id="wsClear">Clear</button>
      </div>
    `;

    const answerEl = container.querySelector("#wsAnswer");
    const tilesEl = container.querySelector("#wsTiles");
    const indexEl = container.querySelector("#wsIndex");
    const scoreEl = container.querySelector("#wsScore");
    const timeEl = container.querySelector("#wsTime");
    const clearBtn = container.querySelector("#wsClear");

    const TOTAL = 5;
    let wordIndex, score, word, letters, picked, timeLeft, timerId, running, overlayEl, usedWords;

    function pickWord() {
      let w;
      do { w = WORDS[Math.floor(Math.random() * WORDS.length)]; } while (usedWords.has(w));
      usedWords.add(w);
      return w;
    }

    function renderTiles() {
      tilesEl.innerHTML = "";
      letters.forEach((ch, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = ch;
        const used = picked.includes(i);
        btn.disabled = used;
        btn.style.cssText = `width:42px; height:42px; border-radius:8px; border:none; font-weight:800; font-size:17px; cursor:pointer; color:#fff; background:${used ? "rgba(255,255,255,0.05)" : "#d97706"}; opacity:${used ? "0.35" : "1"};`;
        btn.addEventListener("click", () => onTile(i));
        tilesEl.appendChild(btn);
      });
    }

    function renderAnswer() {
      answerEl.innerHTML = "";
      for (let i = 0; i < word.length; i++) {
        const slot = document.createElement("div");
        const filled = i < picked.length;
        slot.textContent = filled ? letters[picked[i]] : "";
        slot.style.cssText = `width:34px; height:40px; border-bottom:3px solid ${filled ? "#22c55e" : "rgba(255,255,255,0.3)"}; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:18px;`;
        answerEl.appendChild(slot);
      }
    }

    function onTile(i) {
      if (!running || picked.includes(i)) return;
      picked.push(i);
      ArcadeEngine.vibrate(8);
      renderTiles();
      renderAnswer();
      if (picked.length === word.length) {
        const attempt = picked.map((idx) => letters[idx]).join("");
        if (attempt === word) {
          score += 20 + timeLeft;
          scoreEl.textContent = String(score);
          ArcadeEngine.vibrate(15);
          setTimeout(nextWord, 500);
        } else {
          setTimeout(() => { picked = []; renderTiles(); renderAnswer(); }, 500);
        }
      }
    }

    clearBtn.addEventListener("click", () => { picked = []; renderTiles(); renderAnswer(); });

    function nextWord() {
      wordIndex++;
      if (wordIndex > TOTAL) { finish(); return; }
      indexEl.textContent = `${wordIndex} / ${TOTAL}`;
      word = pickWord();
      letters = shuffleLetters(word);
      picked = [];
      timeLeft = 20;
      timeEl.textContent = "20";
      renderTiles();
      renderAnswer();
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      wordIndex = 0; score = 0; running = true; usedWords = new Set();
      scoreEl.textContent = "0";
      nextWord();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (!running) return;
        timeLeft--;
        timeEl.textContent = String(Math.max(0, timeLeft));
        if (timeLeft <= 0) {
          picked = [];
          renderTiles();
          renderAnswer();
          setTimeout(nextWord, 300);
        }
      }, 1000);
    }

    function finish() {
      running = false;
      clearInterval(timerId);
      if (score > 0) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "🔤", title: "Nice work!", subtitle: `Final score: ${score}`,
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
  window.ArcadeGames["word-scramble"] = { start, stop };
})();
