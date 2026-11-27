// routes/contentLinkRoutes.js
const express = require("express");
const router = express.Router();
const contentLinkController = require("../controllers/contentLinkController");

// Deliberately no auth middleware here — it must work for a logged-out
// visitor (that's the whole point: login, then land on the content), so
// the login/access checks happen inside the controller itself.
router.get("/go/:type/:id", contentLinkController.openContentLink);

module.exports = router;
