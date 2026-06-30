const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const newsletterTemplate = require("./newsletterTemplate");

async function sendNewsletter(newsletterId) {

  try {
    // Get newsletter
    const newsletterResult = await pool.query(
      `
      SELECT *
      FROM newsletters
      WHERE id=$1
    `,
      [newsletterId],
    );

    if (!newsletterResult.rows.length) return;

      const newsletter = newsletterResult.rows[0];
      console.log("Newsletter:", newsletter.id);
      
          if (newsletter.status === "sent") return;


    // Mark as sending
    await pool.query(`
      UPDATE newsletters
      SET
      status='sending',
      progress=0,
      sent_count=0,
      failed_count=0,
      delivered_count=0
      WHERE id=$1
      `,[newsletterId]
    );

    // Get recipients
    const recipients = await pool.query(
      `
      SELECT *
      FROM newsletter_recipients
      WHERE newsletter_id=$1
      AND status IN ('pending','failed')
    `,
      [newsletterId],
    );

    console.log("Recipients:", recipients.rows.length);

    if (recipients.rows.length === 0) {

    await pool.query(`
        UPDATE newsletters
        SET
            status='failed',
            failed_count=1
        WHERE id=$1
    `,[newsletterId]);

    return; 
    }

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients.rows) {
      try {
        await pool.query(
          `
          UPDATE newsletter_recipients
          SET status='sending'
          WHERE id=$1
        `,
          [recipient.id],
          );

          const html = newsletterTemplate(newsletter);

            console.log("Sending:", recipient.email);
          await sendEmail(recipient.email, newsletter.subject, html);
          console.log("Sent:", recipient.email);

          // Brevo rate limit protection
          await new Promise((resolve) => setTimeout(resolve, 150));
          console.log("Newsletter finished");

        sent++;

        await pool.query(
          `
            UPDATE newsletter_recipients

            SET
                status='sent',
                delivered=true,
                sent_at=NOW()

            WHERE id=$1
        `,
          [recipient.id],
        );
      } catch (err) {
        failed++;

        await pool.query(
          `
            UPDATE newsletter_recipients

            SET
                status='failed',
                failure_reason=$2,
                sent_at=NOW()

            WHERE id=$1
        `,
          [recipient.id, err.message],
        );
      }

      // Update progress after each email
      const progress = Math.round(
        ((sent + failed) / recipients.rows.length) * 100,
      );

      await pool.query(
        `
            UPDATE newsletters
            SET
            sent_count=$1,
            delivered_count=$1,
            failed_count=$2,
            progress=$3
            WHERE id=$4
            `,
        [sent, failed, progress, newsletterId],
      );
    }

    // Finished
    await pool.query(`
      UPDATE newsletters
      SET
      status='sent',
      sent_at=NOW(),
      sent_count=$1,
      failed_count=$2,
      delivered_count=$1,
      progress=100
      WHERE id=$3
      `,[
          sent,
          failed,
          newsletterId
        ]
    );
  } catch(err){

    console.error(err);

    await pool.query(`
    UPDATE newsletters
    SET status='failed'
    WHERE id=$1
    `,[newsletterId]);

  }
}

module.exports = sendNewsletter;
