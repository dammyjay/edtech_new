// Arcade: Memory Match: Code Concepts — self-contained, no dependencies.
// Mounted by views/student/arcade.ejs via
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
    container.innerHTML = `
      <div style="text-align:center;">
        <p style="margin:0 0 8px; font-size:14px; color:#555;">Match each code snippet to what it does.</p>
        <div id="memGrid" style="display:grid; grid-template-columns:repeat(4, 110px); gap:10px; margin:0 auto; width:max-content;"></div>
        <p style="margin-top:8px; font-weight:bold;">Moves: <span id="memMoves">0</span></p>
        <div id="memOverlay" style="display:none; margin-top:8px;">
          <p style="color:#16a34a; font-weight:bold;">🎉 Solved in <span id="memFinalMoves"></span> moves!</p>
          <button id="memRestart" class="btn" style="cursor:pointer;">Play Again</button>
        </div>
      </div>
    `;

    const grid = container.querySelector("#memGrid");
    const movesEl = container.querySelector("#memMoves");
    const overlay = container.querySelector("#memOverlay");
    const finalMoves = container.querySelector("#memFinalMoves");
    const restartBtn = container.querySelector("#memRestart");

    let cards, flipped, matched, moves, lock;

    function buildDeck() {
      const deck = [];
      PAIRS.forEach((p, i) => {
        deck.push({ pairId: i, text: p.snippet, kind: "snippet" });
        deck.push({ pairId: i, text: p.concept, kind: "concept" });
      });
      return shuffle(deck);
    }

    function reset() {
      cards = buildDeck();
      flipped = [];
      matched = new Set();
      moves = 0;
      lock = false;
      movesEl.textContent = "0";
      overlay.style.display = "none";
      render();
    }

    function render() {
      grid.innerHTML = "";
      cards.forEach((card, idx) => {
        const isUp = matched.has(idx) || flipped.includes(idx);
        const el = document.createElement("div");
        el.style.cssText = `width:110px; height:80px; border-radius:8px; display:flex; align-items:center; justify-content:center; text-align:center; padding:6px; font-size:12px; font-weight:${card.kind === "snippet" ? "bold" : "normal"}; font-family:${card.kind === "snippet" ? "monospace" : "inherit"}; cursor:pointer; color:#fff; background:${matched.has(idx) ? "#16a34a" : isUp ? "#4f46e5" : "#64748b"}; transition:background .15s;`;
        el.textContent = isUp ? card.text : "❓";
        el.addEventListener("click", () => onFlip(idx));
        grid.appendChild(el);
      });
    }

    function onFlip(idx) {
      if (lock || matched.has(idx) || flipped.includes(idx) || flipped.length >= 2) return;
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
            finalMoves.textContent = String(moves);
            overlay.style.display = "block";
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

    restartBtn.addEventListener("click", reset);
    container._cleanup = () => {};

    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["memory-match"] = { start, stop };
})();
