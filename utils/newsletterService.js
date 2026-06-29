const pool = require("../models/db");

/**
 * Returns all recipients for a newsletter
 */
async function getRecipients(recipientType, recipientIds = []) {
  switch (recipientType) {
    case "all":
    case "users":
      return (
        await pool.query(`
            SELECT id, fullname, email
            FROM users2
            WHERE email IS NOT NULL
        `)
      ).rows;

    case "parents":
      return (
        await pool.query(`
            SELECT id, fullname, email
            FROM users2
            WHERE role='parent'
              AND email IS NOT NULL
        `)
      ).rows;

    case "teachers":
      return (
        await pool.query(`
            SELECT id, fullname, email
            FROM users2
            WHERE role='teacher'
              AND email IS NOT NULL
        `)
      ).rows;

    case "students":
      return (
        await pool.query(`
            SELECT id, fullname, email
            FROM users2
            WHERE role='student'
              AND email IS NOT NULL
        `)
      ).rows;

    case "school_admins":
      return (
        await pool.query(`
            SELECT id, fullname, email
            FROM users2
            WHERE role='school_admin'
              AND email IS NOT NULL
        `)
      ).rows;

    case "admins":
      return (
        await pool.query(`
            SELECT id, fullname, email
            FROM users2
            WHERE role='admin'
              AND email IS NOT NULL
        `)
      ).rows;

    case "schools":
      return (
        await pool.query(
          `
            SELECT DISTINCT
                u.id,
                u.fullname,
                u.email
            FROM users2 u
            WHERE u.school_id = ANY($1)
            AND u.email IS NOT NULL
        `,
          [recipientIds],
        )
      ).rows;

    case "classrooms":
      return (
        await pool.query(
          `
            SELECT
                id,
                fullname,
                email
            FROM users2
            WHERE classroom_id = ANY($1)
            AND email IS NOT NULL
        `,
          [recipientIds],
        )
      ).rows;

    case "custom":
      return (
        await pool.query(
          `
            SELECT
                id,
                fullname,
                email
            FROM users2
            WHERE id = ANY($1)
        `,
          [recipientIds],
        )
      ).rows;

    default:
      return [];
  }
}

/**
 * Save recipients
 */
async function saveRecipients(newsletterId, recipients) {
  for (const user of recipients) {
    await pool.query(
      `
        INSERT INTO newsletter_recipients
        (
            newsletter_id,
            user_id,
            fullname,
            email
        )

        VALUES($1,$2,$3,$4)
      `,
      [newsletterId, user.id, user.fullname, user.email],
    );
  }

  await pool.query(
    `
        UPDATE newsletters

        SET total_recipients=$1

        WHERE id=$2
    `,
    [recipients.length, newsletterId],
  );
}

module.exports = {
  getRecipients,
  saveRecipients,
};
