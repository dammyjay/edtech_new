// const webpush = require("web-push");
const webpush = require("web-push");
// require("dotenv").config(); // Load .env variables
const vapidKeys = webpush.generateVAPIDKeys();
console.log(vapidKeys);

webpush.setVapidDetails(
  "mailto:your-email@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = webpush;
