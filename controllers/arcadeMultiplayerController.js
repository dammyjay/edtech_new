// controllers/arcadeMultiplayerController.js
//
// Student-facing endpoints for the networked "play a real player" mode
// (services/arcadeMultiplayerService.js) — separate from the existing
// solo arcade endpoints in controllers/studentController.js.
const arcadeMultiplayerService = require("../services/arcadeMultiplayerService");

function getStudentId(req) {
  return req.session?.student?.id || req.user?.id || null;
}

exports.pingPresence = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  try {
    await arcadeMultiplayerService.pingPresence(studentId);
    res.json({ success: true });
  } catch (err) {
    console.error("pingPresence error:", err.message);
    res.status(500).json({ success: false });
  }
};

exports.listOnline = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  try {
    const students = await arcadeMultiplayerService.listOnlineStudents(studentId);
    res.json({ success: true, students });
  } catch (err) {
    console.error("listOnline error:", err.message);
    res.status(500).json({ success: false });
  }
};

exports.createChallenge = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  try {
    const { gameId, opponentId } = req.body;
    const match = await arcadeMultiplayerService.createChallenge({
      gameId,
      challengerId: studentId,
      opponentId: parseInt(opponentId, 10),
    });
    res.json({ success: true, match });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getIncomingChallenges = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  try {
    const challenges = await arcadeMultiplayerService.getIncomingChallenges(studentId);
    res.json({ success: true, challenges });
  } catch (err) {
    console.error("getIncomingChallenges error:", err.message);
    res.status(500).json({ success: false });
  }
};

exports.respondToChallenge = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  if (req.params.action !== "accept" && req.params.action !== "decline") {
    return res.status(400).json({ success: false, message: "Invalid action." });
  }
  try {
    const accept = req.params.action === "accept";
    const result = await arcadeMultiplayerService.respondToChallenge(req.params.id, studentId, accept);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getMatch = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  try {
    const match = await arcadeMultiplayerService.getMatch(req.params.id, studentId);
    if (!match) return res.status(404).json({ success: false, message: "Match not found." });
    res.json({ success: true, match });
  } catch (err) {
    console.error("getMatch error:", err.message);
    res.status(500).json({ success: false });
  }
};

exports.makeMove = async (req, res) => {
  const studentId = getStudentId(req);
  if (!studentId) return res.status(401).json({ success: false });
  try {
    const match = await arcadeMultiplayerService.makeMove({
      matchId: req.params.id,
      userId: studentId,
      move: req.body,
    });
    res.json({ success: true, match });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
