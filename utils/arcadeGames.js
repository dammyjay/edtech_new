// Hardcoded catalog of Arcade mini-games — coins are a pure sink here (pay
// a small amount to play), no coin-earning loop, so there's no anti-farming
// logic to worry about for v1. Each game's client code lives at
// public/games/<id>.js and is loaded directly by views/student/arcade.ejs.
const ARCADE_GAMES = [
  {
    id: "snake",
    name: "Snake",
    description: "Classic grid snake — eat, grow, don't hit yourself.",
    playCost: 5,
    icon: "🐍",
  },
  {
    id: "2048",
    name: "2048",
    description: "Slide and merge tiles to reach 2048.",
    playCost: 5,
    icon: "🔢",
  },
  {
    id: "memory-match",
    name: "Memory Match: Code Concepts",
    description: "Match a code snippet to what it prints.",
    playCost: 5,
    icon: "🧠",
  },
];

function getArcadeGameById(id) {
  return ARCADE_GAMES.find((g) => g.id === id) || null;
}

module.exports = { ARCADE_GAMES, getArcadeGameById };
