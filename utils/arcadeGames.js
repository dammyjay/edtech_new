// Hardcoded catalog of Arcade mini-games — coins are a pure sink here (pay
// a small amount to play), no coin-earning loop, so there's no anti-farming
// logic to worry about for v1. Each game's client code lives at
// public/games/<id>.js and is loaded directly by views/student/arcade.ejs.
//
// `tag` powers the genre filter chips on the arcade page (Classic/Reflex/
// Memory/Strategy/Math/Typing/Word). `accent`/`accentDark` set each card's
// gradient (--card-accent/--card-accent-dark, see public/css/arcade.css) —
// picked per game rather than forcing every card into the platform's gold
// brand color, since a colorful, varied arcade shelf reads better than a
// wall of identical tiles; the page chrome around the cards still uses the
// brand palette.
const ARCADE_GAMES = [
  {
    id: "snake",
    name: "Snake",
    description: "Classic grid snake — eat, grow, don't hit yourself.",
    playCost: 5,
    icon: "🐍",
    tag: "Classic",
    accent: "#16a34a",
    accentDark: "#14532d",
  },
  {
    id: "2048",
    name: "2048",
    description: "Slide and merge tiles to reach 2048.",
    playCost: 5,
    icon: "🔢",
    tag: "Classic",
    accent: "#f59e0b",
    accentDark: "#92400e",
  },
  {
    id: "memory-match",
    name: "Memory Match: Code Concepts",
    description: "Match a code snippet to what it prints.",
    playCost: 5,
    icon: "🧠",
    tag: "Memory",
    accent: "#4f46e5",
    accentDark: "#312e81",
  },
  {
    id: "brick-breaker",
    name: "Brick Breaker",
    description: "Bounce the ball, smash every brick. Drag the paddle.",
    playCost: 5,
    icon: "🧱",
    tag: "Classic",
    accent: "#dc2626",
    accentDark: "#7f1d1d",
  },
  {
    id: "flappy-block",
    name: "Flappy Block",
    description: "Tap to flap. Thread the gaps without crashing.",
    playCost: 5,
    icon: "🟨",
    tag: "Classic",
    accent: "#0ea5e9",
    accentDark: "#0c4a6e",
  },
  {
    id: "bubble-pop",
    name: "Bubble Pop",
    description: "Pop rising bubbles before they float off screen.",
    playCost: 5,
    icon: "🫧",
    tag: "Reflex",
    accent: "#06b6d4",
    accentDark: "#164e63",
  },
  {
    id: "whack-a-mole",
    name: "Whack-a-Mole",
    description: "Tap the moles the instant they pop up.",
    playCost: 5,
    icon: "🔨",
    tag: "Reflex",
    accent: "#a16207",
    accentDark: "#422006",
  },
  {
    id: "reaction-test",
    name: "Reaction Test",
    description: "Tap the instant the screen turns green. How fast are you?",
    playCost: 3,
    icon: "⚡",
    tag: "Reflex",
    accent: "#eab308",
    accentDark: "#713f12",
  },
  {
    id: "color-match",
    name: "Color Match",
    description: "Tap the color the WORD is printed in — not what it says.",
    playCost: 5,
    icon: "🎨",
    tag: "Reflex",
    accent: "#ec4899",
    accentDark: "#831843",
  },
  {
    id: "simon-says",
    name: "Simon Says",
    description: "Watch the pattern, repeat it back. Grows every round.",
    playCost: 5,
    icon: "🔴",
    tag: "Memory",
    accent: "#7c3aed",
    accentDark: "#3b0764",
  },
  {
    id: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    description: "Classic 3x3 — outsmart the computer.",
    playCost: 3,
    icon: "❌",
    tag: "Strategy",
    accent: "#0891b2",
    accentDark: "#164e63",
  },
  {
    id: "connect-four",
    name: "Connect Four",
    description: "Drop discs, line up four before the computer does.",
    playCost: 5,
    icon: "🔵",
    tag: "Strategy",
    accent: "#2563eb",
    accentDark: "#1e3a8a",
  },
  {
    id: "math-blitz",
    name: "Math Blitz",
    description: "Rapid-fire arithmetic — how many can you solve in 60s?",
    playCost: 5,
    icon: "➗",
    tag: "Math",
    accent: "#059669",
    accentDark: "#064e3b",
  },
  {
    id: "typing-rush",
    name: "Typing Rush",
    description: "Type falling words before they hit the ground.",
    playCost: 5,
    icon: "⌨️",
    tag: "Typing",
    accent: "#475569",
    accentDark: "#1e293b",
  },
  {
    id: "word-scramble",
    name: "Word Scramble",
    description: "Unscramble the letters to spell the word before time runs out.",
    playCost: 5,
    icon: "🔤",
    tag: "Word",
    accent: "#d97706",
    accentDark: "#78350f",
  },
];

function getArcadeGameById(id) {
  return ARCADE_GAMES.find((g) => g.id === id) || null;
}

module.exports = { ARCADE_GAMES, getArcadeGameById };
