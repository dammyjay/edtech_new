const cron = require("node-cron");
const pool = require("../models/db");
const sendNewsletter = require("../utils/newsletterSender");

cron.schedule("* * * * *", async () => {
  try {
    console.log("Checking scheduled newsletters...");

    const result = await pool.query(`
        SELECT id
        FROM newsletters
        WHERE status='scheduled'
        AND scheduled_at <= NOW()
    `);

    for (const newsletter of result.rows) {
      console.log(`Starting scheduled newsletter ${newsletter.id}`);

      sendNewsletter(newsletter.id).catch(console.error);
    }
  } catch (err) {
    console.error(err);
  }
});
