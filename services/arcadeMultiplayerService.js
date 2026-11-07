// services/arcadeMultiplayerService.js
//
// Networked 1v1 mode for the two board games that already have real
// turn-based rules (Tic-Tac-Toe, Connect Four) — their public/games/*.js
// client files only know how to play against a local minimax AI, so this
// is an entirely separate, server-authoritative path: a human opponent
// can't be trusted to self-report a score the way the solo games are
// (see the arcade_plays comment in models/initTables.js), so every move
// is validated here, not on the client.
//
// Matches are free to play (no coin cost) — unlike the solo games, a
// challenge can be declined or left pending, and charging either player
// before a match is actually accepted would need refund-on-decline
// bookkeeping for very little product value.
const pool = require("../models/db");
const { awardXp } = require("./lessonCompletionService");

const PENDING_EXPIRY_MINUTES = 3;
const ONLINE_WINDOW_SECONDS = 30;
const MP_XP = { win: 12, draw: 8, loss: 5 };
const MP_SCORE = { win: 100, draw: 50, loss: 10 };

const MULTIPLAYER_GAMES = ["tic-tac-toe", "connect-four"];

// ---------------------------------------------------------------
// Presence
// ---------------------------------------------------------------
async function pingPresence(userId) {
  await pool.query(
    `INSERT INTO arcade_presence (user_id, last_seen_at, status) VALUES ($1, NOW(), 'idle')
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = NOW(),
       status = CASE WHEN arcade_presence.status = 'in_game' THEN arcade_presence.status ELSE 'idle' END`,
    [userId]
  );
}

async function setPresenceStatus(userId, status) {
  await pool.query(
    `INSERT INTO arcade_presence (user_id, last_seen_at, status) VALUES ($1, NOW(), $2)
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = NOW(), status = $2`,
    [userId, status]
  );
}

async function listOnlineStudents(excludeUserId) {
  const res = await pool.query(
    `SELECT u.id, u.fullname
     FROM arcade_presence p JOIN users2 u ON u.id = p.user_id
     WHERE p.last_seen_at > NOW() - INTERVAL '${ONLINE_WINDOW_SECONDS} seconds'
       AND p.status = 'idle' AND u.role = 'student' AND u.id != $1
     ORDER BY u.fullname ASC LIMIT 50`,
    [excludeUserId]
  );
  return res.rows;
}

// ---------------------------------------------------------------
// Game rules — tic-tac-toe
// ---------------------------------------------------------------
const TTT_WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function tttWinner(board) {
  for (const [a, b, c] of TTT_WINS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every((c) => c) ? "draw" : null;
}

function applyTttMove(board, symbol, move) {
  const index = Number(move?.index);
  if (!Number.isInteger(index) || index < 0 || index > 8) return { error: "Invalid move." };
  if (board[index]) return { error: "That square is already taken." };
  const next = board.slice();
  next[index] = symbol;
  return { board: next, outcome: tttWinner(next) };
}

// ---------------------------------------------------------------
// Game rules — connect four
// ---------------------------------------------------------------
const C4_COLS = 7, C4_ROWS = 6;

function c4EmptyBoard() {
  return Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null));
}

function c4DropRow(board, col) {
  for (let r = C4_ROWS - 1; r >= 0; r--) if (!board[r][col]) return r;
  return -1;
}

function c4Winner(board) {
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const lines = [];
      if (c + 3 < C4_COLS) lines.push([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]]);
      if (r + 3 < C4_ROWS) lines.push([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]]);
      if (r + 3 < C4_ROWS && c + 3 < C4_COLS) lines.push([[r, c], [r + 1, c + 1], [r + 2, c + 2], [r + 3, c + 3]]);
      if (r - 3 >= 0 && c + 3 < C4_COLS) lines.push([[r, c], [r - 1, c + 1], [r - 2, c + 2], [r - 3, c + 3]]);
      for (const line of lines) {
        const vals = line.map(([lr, lc]) => board[lr][lc]);
        if (vals[0] && vals.every((v) => v === vals[0])) return vals[0];
      }
    }
  }
  return board[0].every((c) => c) ? "draw" : null;
}

function applyC4Move(board, symbol, move) {
  const col = Number(move?.col);
  if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) return { error: "Invalid move." };
  const row = c4DropRow(board, col);
  if (row === -1) return { error: "That column is full." };
  const next = board.map((r) => r.slice());
  next[row][col] = symbol;
  return { board: next, outcome: c4Winner(next) };
}

function initialBoardFor(gameId) {
  return gameId === "tic-tac-toe" ? Array(9).fill(null) : c4EmptyBoard();
}

// ---------------------------------------------------------------
// Challenge / match lifecycle
// ---------------------------------------------------------------
async function expireStalePending() {
  await pool.query(
    `UPDATE arcade_matches SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '${PENDING_EXPIRY_MINUTES} minutes'`
  );
}

async function createChallenge({ gameId, challengerId, opponentId }) {
  if (!MULTIPLAYER_GAMES.includes(gameId)) throw new Error("This game doesn't support real-player matches.");
  if (challengerId === opponentId) throw new Error("You can't challenge yourself.");

  await expireStalePending();

  const existing = await pool.query(
    `SELECT id FROM arcade_matches
     WHERE game_id = $1 AND status IN ('pending', 'active')
       AND ((player1_id = $2 AND player2_id = $3) OR (player1_id = $3 AND player2_id = $2))`,
    [gameId, challengerId, opponentId]
  );
  if (existing.rows.length) throw new Error("There's already a challenge or match in progress between you two.");

  const res = await pool.query(
    `INSERT INTO arcade_matches (game_id, player1_id, player2_id, status) VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [gameId, challengerId, opponentId]
  );
  return res.rows[0];
}

async function getIncomingChallenges(userId) {
  await expireStalePending();
  const res = await pool.query(
    `SELECT m.id, m.game_id, m.created_at, u.fullname AS challenger_name
     FROM arcade_matches m JOIN users2 u ON u.id = m.player1_id
     WHERE m.player2_id = $1 AND m.status = 'pending' ORDER BY m.created_at DESC`,
    [userId]
  );
  return res.rows;
}

async function respondToChallenge(matchId, userId, accept) {
  await expireStalePending();
  const matchRes = await pool.query(`SELECT * FROM arcade_matches WHERE id = $1`, [matchId]);
  const match = matchRes.rows[0];
  if (!match || match.player2_id !== userId || match.status !== "pending") {
    throw new Error("This challenge is no longer available.");
  }

  if (!accept) {
    await pool.query(`UPDATE arcade_matches SET status = 'declined', updated_at = NOW() WHERE id = $1`, [matchId]);
    return { status: "declined" };
  }

  const board = initialBoardFor(match.game_id);
  const updated = await pool.query(
    `UPDATE arcade_matches SET status = 'active', board = $2, turn_user_id = player1_id, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [matchId, JSON.stringify(board)]
  );
  await setPresenceStatus(match.player1_id, "in_game");
  await setPresenceStatus(match.player2_id, "in_game");
  return updated.rows[0];
}

async function getMatch(matchId, userId) {
  const res = await pool.query(
    `SELECT m.*, p1.fullname AS player1_name, p2.fullname AS player2_name
     FROM arcade_matches m
     JOIN users2 p1 ON p1.id = m.player1_id
     JOIN users2 p2 ON p2.id = m.player2_id
     WHERE m.id = $1`,
    [matchId]
  );
  const match = res.rows[0];
  if (!match || (match.player1_id !== userId && match.player2_id !== userId)) return null;
  return match;
}

// Records both sides of a finished match into arcade_plays (same table
// the per-game leaderboard already reads from) so a networked win shows
// up there too, tagged is_multiplayer so it's distinguishable from a
// solo round against the computer.
async function finishMatch(match, outcome) {
  const isDraw = outcome === "draw";
  const winnerId = isDraw ? null : outcome === "X" || outcome === "R" ? match.player1_id : match.player2_id;
  const result = isDraw ? "draw" : winnerId === match.player1_id ? "player1_win" : "player2_win";

  await pool.query(
    `UPDATE arcade_matches SET status = 'finished', result = $2, turn_user_id = NULL, updated_at = NOW() WHERE id = $1`,
    [match.id, result]
  );
  await setPresenceStatus(match.player1_id, "idle");
  await setPresenceStatus(match.player2_id, "idle");

  for (const playerId of [match.player1_id, match.player2_id]) {
    const outcomeForPlayer = isDraw ? "draw" : playerId === winnerId ? "win" : "loss";
    try {
      await pool.query(
        `INSERT INTO arcade_plays (student_id, game_id, score, xp_awarded, is_multiplayer)
         VALUES ($1, $2, $3, $4, true)`,
        [playerId, match.game_id, MP_SCORE[outcomeForPlayer], MP_XP[outcomeForPlayer]]
      );
      await awardXp(playerId, MP_XP[outcomeForPlayer], `Multiplayer ${match.game_id}`);
    } catch (err) {
      console.error(`finishMatch arcade_plays/XP failed for player ${playerId}:`, err.message);
    }
  }
}

async function makeMove({ matchId, userId, move }) {
  const matchRes = await pool.query(`SELECT * FROM arcade_matches WHERE id = $1`, [matchId]);
  const match = matchRes.rows[0];
  if (!match || (match.player1_id !== userId && match.player2_id !== userId)) {
    throw new Error("Match not found.");
  }
  if (match.status !== "active") throw new Error("This match isn't active.");
  if (match.turn_user_id !== userId) throw new Error("It's not your turn.");

  const symbol =
    match.game_id === "tic-tac-toe"
      ? userId === match.player1_id ? "X" : "O"
      : userId === match.player1_id ? "R" : "Y";

  const applied =
    match.game_id === "tic-tac-toe" ? applyTttMove(match.board, symbol, move) : applyC4Move(match.board, symbol, move);
  if (applied.error) throw new Error(applied.error);

  if (applied.outcome) {
    await pool.query(`UPDATE arcade_matches SET board = $2, updated_at = NOW() WHERE id = $1`, [
      matchId,
      JSON.stringify(applied.board),
    ]);
    await finishMatch({ ...match, board: applied.board }, applied.outcome);
  } else {
    const nextTurn = userId === match.player1_id ? match.player2_id : match.player1_id;
    await pool.query(
      `UPDATE arcade_matches SET board = $2, turn_user_id = $3, updated_at = NOW() WHERE id = $1`,
      [matchId, JSON.stringify(applied.board), nextTurn]
    );
  }

  return getMatch(matchId, userId);
}

module.exports = {
  MULTIPLAYER_GAMES,
  pingPresence,
  listOnlineStudents,
  createChallenge,
  getIncomingChallenges,
  respondToChallenge,
  getMatch,
  makeMove,
};
