const newsletterService = require("../utils/newsletterService");
const sendNewsletter = require("../utils/newsletterSender");
console.log("admin-newsletters.js loaded");

const pool = require("../models/db");

exports.getNewslettersPage = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1",
    );
    const info = infoResult.rows[0];

    const newsletters = await pool.query(`
            SELECT
                n.*,
                u.fullname AS created_by_name
            FROM newsletters n
            LEFT JOIN users2 u
                ON u.id = n.created_by
            ORDER BY n.created_at DESC
        `);

    const stats = await pool.query(`
            SELECT
                COUNT(*) total,

                COUNT(*) FILTER (WHERE status='draft') drafts,

                COUNT(*) FILTER (WHERE status='scheduled') scheduled,

                COUNT(*) FILTER (WHERE status='sending') sending,

                COUNT(*) FILTER (WHERE status='sent') sent,

                COALESCE(SUM(delivered_count),0) delivered,

                COALESCE(SUM(opened_count),0) opened,

                COALESCE(SUM(failed_count),0) failed

                FROM newsletters;
        `);

    res.render("admin/newsletters", {
      newsletters: newsletters.rows,
      stats: stats.rows[0],
      info,
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
};

exports.createNewsletter = async (req, res) => {
  try {
    const {
      subject,

      preview_text,

      message,

      recipient_type,

      status,

      scheduled_at,
    } = req.body;

    const image_url = req.file ? req.file.path : null;

      // await pool.query(
      
      const result = await pool.query(
        `
            INSERT INTO newsletters
            (
                subject,
                preview_text,
                message,
                image_url,
                recipient_type,
                status,
                scheduled_at,
                created_by
            )

            VALUES($1,$2,$3,$4,$5,$6,$7,$8)

            RETURNING id
        `,
        [
            subject,
            preview_text,
            message,
            image_url,
            recipient_type,
            status,
            scheduled_at || null,
            req.session.user.id,
        ]
        );

        const newsletterId = result.rows[0].id;

        const recipientIds = req.body.recipient_ids || [];

        const recipients =
        await newsletterService.getRecipients(
            recipient_type,
            Array.isArray(recipientIds)
            ? recipientIds
            : [recipientIds]
        );

        await newsletterService.saveRecipients(
            newsletterId,
            recipients
        );
      
      if (status === "sending") {

            sendNewsletter(newsletterId)
                .catch(console.error);

        }

    res.redirect("/admin/newsletters");
  } catch (err) {
    console.log(err);

    res.status(500).send(err.message);
  }
};

exports.getClassrooms = async (req, res) => {
  const result = await pool.query(
    `
SELECT id,name
FROM classrooms
WHERE school_id=$1
ORDER BY name
`,
    [req.params.schoolId],
  );

  res.json(result.rows);
};

exports.getSchools = async (req, res) => {
  try {
    const schools = await pool.query(`
            SELECT id,name
            FROM schools
            ORDER BY name
        `);

    res.json(schools.rows);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Unable to load schools",
    });
  }
};

exports.getCourses = async (req, res) => {
  const result = await pool.query(`
        SELECT id,title
        FROM courses
        ORDER BY title
    `);

  res.json(result.rows);
};

exports.searchUsers = async (req, res) => {
  try {
    const search = req.query.search || "";

    const users = await pool.query(
      `

            SELECT
                id,
                fullname,
                email

            FROM users2

            WHERE
                fullname ILIKE $1
                OR email ILIKE $1

            ORDER BY fullname

            LIMIT 20

            `,

      [`%${search}%`],
    );

    res.json(users.rows);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Unable to search users",
    });
  }
};

exports.getAudienceSummary = async (req, res) => {
  const type = req.params.type;

  let query = "";
  let title = "";

  switch (type) {
    case "all":
      query = `SELECT COUNT(*) FROM users2`;
      title = "Everyone";
      break;

    case "users":
      query = `SELECT COUNT(*) FROM users2`;
      title = "All Users";
      break;

    case "parents":
      query = `
                SELECT COUNT(*)
                FROM users2
                WHERE role='parent'
            `;
      title = "Parents";
      break;

    case "teachers":
      query = `
                SELECT COUNT(*)
                FROM users2
                WHERE role='teacher'
            `;
      title = "Teachers";
      break;

    case "students":
      query = `
                SELECT COUNT(*)
                FROM users2
                WHERE role='student'
            `;
      title = "Students";
      break;

    case "school_admins":
      query = `
                SELECT COUNT(*)
                FROM users2
                WHERE role='school_admin'
            `;
      title = "School Admins";
      break;

    case "admins":
      query = `
                SELECT COUNT(*)
                FROM users2
                WHERE role='admin'
            `;
      title = "Platform Admins";
      break;

    default:
      return res.json({
        title: "Unknown",
        count: 0,
      });
  }

  const result = await pool.query(query);

  res.json({
    title,
    count: Number(result.rows[0].count),
  });
};