const express = require("express");
const router = express.Router();
const messageController = require("../controllers/messageController");
const { ensureAuthenticated } = require("../middlewares/auth");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// Not currently used by any view (the instructor/teacher/student chat
// features all go through their own separately-named routes) — but had
// no auth check at all, and sendMessage let any logged-in user message
// any other user id with zero relationship validation. Locking it down
// here since this is the generic entry point the new parent-to-school-
// admin messaging feature builds on.
router.use(ensureAuthenticated, ensureCsrfToken, verifyCsrfToken);

// Send a message
router.post("/messages/send", messageController.sendMessage);

// Get chat history between two users
router.get("/messages/:userId", messageController.getConversation);

module.exports = router;
