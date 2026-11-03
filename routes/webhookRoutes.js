// routes/webhookRoutes.js
//
// Mounted directly in app.js (outside adminRoutes/student's CSRF-gated
// routers) — these are called by Meta and Brevo, not by a browser with a
// session, so there's no CSRF token to check and no ensureAuthenticated
// to pass.
const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhookController");

router.get("/whatsapp", webhookController.verifyWhatsApp);
router.post("/whatsapp", webhookController.receiveWhatsApp);
router.post("/email-reply", webhookController.receiveEmailReply);

module.exports = router;
