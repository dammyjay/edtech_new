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

    const recipientSelectionMode =
    req.body.recipient_selection_mode || "all";

    console.log("Recipient Type:", recipient_type);

    console.log("Selection Mode:", recipientSelectionMode);

    console.log("Recipient IDs:", recipientIds);

    const image_url = req.file ? req.file.path : null;
    const dbStatus = status === "sending" ? "draft" : status;

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
            dbStatus,
            scheduled_at || null,
            req.session.user.id,
        ]
        );

        const newsletterId = result.rows[0].id;

        // const recipientIds = req.body.recipient_ids || [];

        // const recipients =
        // await newsletterService.getRecipients(
        //     recipient_type,
        //     Array.isArray(recipientIds)
        //     ? recipientIds
        //     : [recipientIds]
        // );

        let recipientIds = [];

        if (req.body.recipient_ids) {

            if (Array.isArray(req.body.recipient_ids)) {

                recipientIds = req.body.recipient_ids.map(Number);

            } else {

                recipientIds = req.body.recipient_ids
                    .split(",")
                    .map(id => Number(id.trim()))
                    .filter(id => !isNaN(id));

            }

        }

        console.log("Recipient Type:", recipient_type);

        console.log("Selection Mode:", recipientSelectionMode);

        console.log("Recipient IDs:", recipientIds);

        // const recipients = await newsletterService.getRecipients(
        //     recipient_type,
        //     recipientIds
        // );

        const recipients =
          await newsletterService.getRecipients(
              recipient_type,
              recipientIds,
              recipientSelectionMode
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

exports.getNewsletter = async(req,res)=>{

    const result = await pool.query(`
        SELECT *
        FROM newsletters
        WHERE id=$1
    `,[req.params.id]);

    if(result.rows.length===0){

        return res.status(404).json({
            error:"Newsletter not found"
        });

    }

    res.json(result.rows[0]);

};

exports.getAudienceUsers = async (req, res) => {
  try {
    const type = req.params.type;
    const ids = req.query.ids
      ? req.query.ids.split(",").map(Number)
      : [];

    let result;

    switch (type) {

      case "all":
      case "users":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE email IS NOT NULL
          ORDER BY fullname
        `);
        break;

      case "parents":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE role='parent'
          AND email IS NOT NULL
          ORDER BY fullname
        `);
        break;

      case "teachers":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE role='teacher'
          AND email IS NOT NULL
          ORDER BY fullname
        `);
        break;

      case "students":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE role='student'
          AND email IS NOT NULL
          ORDER BY fullname
        `);
        break;

      case "school_admins":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE role='school_admin'
          AND email IS NOT NULL
          ORDER BY fullname
        `);
        break;

      case "admins":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE role='admin'
          AND email IS NOT NULL
          ORDER BY fullname
        `);
        break;

      case "schools":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE school_id = ANY($1)
          AND email IS NOT NULL
          ORDER BY fullname
        `, [ids]);
        break;

      case "classrooms":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE classroom_id = ANY($1)
          AND email IS NOT NULL
          ORDER BY fullname
        `, [ids]);
        break;

      case "custom":
        result = await pool.query(`
          SELECT
              id,
              fullname,
              email,
              role
          FROM users2
          WHERE id = ANY($1)
          ORDER BY fullname
        `, [ids]);
        break;

      default:
        return res.json([]);
    }

    res.json(result.rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Unable to load audience users."
    });
  }
};