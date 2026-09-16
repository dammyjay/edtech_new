// Arcade: Memory Match: Code Concepts — responsive grid, tap/click cards.
// Mounted by views/student/arcade.ejs through
// window.ArcadeGames['memory-match'].start(container).
(function () {
  // Each pair: a short snippet card + the card describing what it does.
  // Kept intentionally simple/language-agnostic-ish so it reads fine for
  // any student regardless of which language track they're on.
  const PAIRS = [
    { snippet: "for (let i=0;i<5;i++)", concept: "Runs a loop 5 times" },
    { snippet: "if (x > 10)", concept: "Checks a condition" },
    { snippet: "function add(a,b)", concept: "Defines a reusable block" },
    { snippet: "let x = 5;", concept: "Stores a value in a variable" },
    { snippet: "arr.push(1)", concept: "Adds an item to a list" },
    { snippet: "// comment", concept: "A note the computer ignores" },
  ];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#4f46e5");
    container.innerHTML = `
      <p class="arcade-game-hint">Match each code snippet to what it does.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Moves</span><span class="value" id="memMoves">0</span></div>
      </div>
      <div id="memGrid" style="display:grid; grid-template-columns:repeat(4, minmax(70px, 1fr)); gap:10px; margin:0 auto; max-width:460px;"></div>
    `;

    const grid = container.querySelector("#memGrid");
    const movesEl = container.querySelector("#memMoves");

    let cards, flipped, matched, moves, lock, overlayEl;

    function buildDeck() {
      const deck = [];
      PAIRS.forEach((p, i) => {
        deck.push({ pairId: i, text: p.snippet, kind: "snippet" });
        deck.push({ pairId: i, text: p.concept, kind: "concept" });
      });
      return shuffle(deck);
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      cards = buildDeck();
      flipped = [];
      matched = new Set();
      moves = 0;
      lock = false;
      movesEl.textContent = "0";
      render();
    }

    function render() {
      grid.innerHTML = "";
      cards.forEach((card, idx) => {
        const isUp = matched.has(idx) || flipped.includes(idx);
        const el = document.createElement("div");
        el.style.cssText = `aspect-ratio:0.85; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center; padding:6px; font-size:clamp(10px,2.6vw,12px); font-weight:${card.kind === "snippet" ? "bold" : "normal"}; font-family:${card.kind === "snippet" ? "monospace" : "inherit"}; cursor:pointer; color:#fff; background:${matched.has(idx) ? "#16a34a" : isUp ? "#4f46e5" : "rgba(255,255,255,0.08)"}; border:1px solid rgba(255,255,255,0.12); transition:transform .15s, background .15s; transform:${isUp ? "scale(1)" : "scale(1)"};`;
        el.textContent = isUp ? card.text : "❓";
        el.addEventListener("click", () => onFlip(idx));
        grid.appendChild(el);
      });
    }

    function onFlip(idx) {
      if (lock || matched.has(idx) || flipped.includes(idx) || flipped.length >= 2) return;
      ArcadeEngine.vibrate(10);
      flipped.push(idx);
      render();
      if (flipped.length === 2) {
        moves++;
        movesEl.textContent = String(moves);
        const [a, b] = flipped;
        if (cards[a].pairId === cards[b].pairId) {
          matched.add(a);
          matched.add(b);
          flipped = [];
          render();
          if (matched.size === cards.length) {
            ArcadeEngine.confetti(container);
            overlayEl = ArcadeEngine.overlay(container, {
              emoji: "🎉", title: "Solved!", subtitle: `Finished in ${moves} moves.`,
              buttonLabel: "Play Again", onRestart: reset,
            });
          }
        } else {
          lock = true;
          setTimeout(() => {
            flipped = [];
            lock = false;
            render();
          }, 700);
        }
      }
    }

    container._cleanup = () => {};
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["memory-match"] = { start, stop };
})();
