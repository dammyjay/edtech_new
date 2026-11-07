// services/arcadeSessionService.js
//
// Instructor-led arcade session — a Kahoot-style class activity, not a
// 1v1 match (services/arcadeMultiplayerService.js handles that instead).
// A teacher picks one of the existing solo score-chasing games
// (utils/arcadeGames.js) and a start time; every student in the
// classroom who joins plays their own round of that game as normal
// (public/games/<id>.js, unchanged), and their best score during the
// session's window feeds a live scoreboard the teacher watches.
const pool = require("../models/db");

async function getActiveSessionForClassroom(classroomId) {
  const res = await pool.query(
    `SELECT * FROM arcade_sessions WHERE classroom_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
    [classroomId]
  );
  return res.rows[0] || null;
}

async function startSession({ classroomId, gameId, createdBy }) {
  const existing = await getActiveSessionForClassroom(classroomId);
  if (existing) throw new Error("This classroom already has a live session running.");

  const res = await pool.query(
    `INSERT INTO arcade_sessions (classroom_id, game_id, created_by, status) VALUES ($1, $2, $3, 'active') RETURNING *`,
    [classroomId, gameId, createdBy]
  );
  return res.rows[0];
}

async function endSession(sessionId) {
  await pool.query(`UPDATE arcade_sessions SET status = 'ended', ended_at = NOW() WHERE id = $1`, [sessionId]);
}

async function joinSession(sessionId, studentId) {
  const sessionRes = await pool.query(`SELECT * FROM arcade_sessions WHERE id = $1 AND status = 'active'`, [sessionId]);
  if (!sessionRes.rows[0]) throw new Error("This session has ended.");

  await pool.query(
    `INSERT INTO arcade_session_participants (session_id, student_id, score) VALUES ($1, $2, 0)
     ON CONFLICT (session_id, student_id) DO NOTHING`,
    [sessionId, studentId]
  );
  return sessionRes.rows[0];
}

// Called from controllers/studentController.js's reportArcadeScore right
// after a solo round is recorded — a no-op unless the student has
// actually joined an active session for that exact game, and only ever
// raises their score (best-of-the-session), never lowers it.
async function reportScoreToActiveSession({ studentId, gameId }) {
  const res = await pool.query(
    `SELECT asp.id, asp.score, asess.id AS session_id
     FROM arcade_session_participants asp
     JOIN arcade_sessions asess ON asess.id = asp.session_id
     WHERE asp.student_id = $1 AND asess.status = 'active' AND asess.game_id = $2
     ORDER BY asess.started_at DESC LIMIT 1`,
    [studentId, gameId]
  );
  return res.rows[0] || null;
}

async function updateParticipantBestScore(participantId, score) {
  await pool.query(`UPDATE arcade_session_participants SET score = GREATEST(score, $2) WHERE id = $1`, [
    participantId,
    score,
  ]);
}

async function getSessionLeaderboard(sessionId) {
  const sessionRes = await pool.query(
    `SELECT s.*, c.name AS classroom_name FROM arcade_sessions s JOIN classrooms c ON c.id = s.classroom_id WHERE s.id = $1`,
    [sessionId]
  );
  const session = sessionRes.rows[0];
  if (!session) return null;

  const leaderboardRes = await pool.query(
    `SELECT u.fullname, asp.score
     FROM arcade_session_participants asp JOIN users2 u ON u.id = asp.student_id
     WHERE asp.session_id = $1 ORDER BY asp.score DESC, asp.joined_at ASC`,
    [sessionId]
  );
  return { session, leaderboard: leaderboardRes.rows };
}

module.exports = {
  getActiveSessionForClassroom,
  startSession,
  endSession,
  joinSession,
  reportScoreToActiveSession,
  updateParticipantBestScore,
  getSessionLeaderboard,
};
