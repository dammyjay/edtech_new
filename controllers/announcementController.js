const pool = require("../models/db");

exports.getAnnouncementsPage = async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.redirect("/admin/login");
    }

    try {

        // Company Information
        const infoResult = await pool.query(`
            SELECT *
            FROM company_info
            ORDER BY id DESC
            LIMIT 1
        `);

        const info = infoResult.rows[0];

        // Announcements
        const announcements = await pool.query(`
            SELECT
                a.*,
                u.fullname AS created_by_name
            FROM announcements a
            LEFT JOIN users2 u
                ON a.created_by = u.id
            ORDER BY
                a.created_at DESC
        `);

        // Dashboard Statistics
        const stats = await pool.query(`
            SELECT

                COUNT(*) AS total,

                COUNT(*) FILTER (
                    WHERE status='draft'
                ) AS drafts,

                COUNT(*) FILTER (
                    WHERE status='published'
                ) AS published,

                COUNT(*) FILTER (
                    WHERE status='scheduled'
                ) AS scheduled,

                COUNT(*) FILTER (
                    WHERE status='expired'
                ) AS expired,

                COUNT(*) FILTER (
                    WHERE status='archived'
                ) AS archived

            FROM announcements
        `);

        res.render("admin/announcements", {

            announcements: announcements.rows,

            stats: stats.rows[0],

            info,

            role: "admin"

        });

    } catch (err) {

        console.error(err);

        res.status(500).send("Server Error");

    }

};

exports.createAnnouncement = async (req, res) => {
  try {

    const {
      title,
      message,
      type,
      priority,

      audience_type,
      audience_ids,

      display_locations,

      button_text,
      button_link,

      background_color,
      text_color,
      button_color,

      popup_delay,
      dismissible,
      allow_close,
      show_once,

      start_date,
      end_date,

      status
    } = req.body;

    // ----------------------------
    // Validation
    // ----------------------------

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required."
      });
    }

    // ----------------------------
    // Image
    // ----------------------------

    const image_url = req.file ? req.file.path : null;

    // ----------------------------
    // Audience IDs
    // ----------------------------

    let audienceIds = [];

    if (audience_ids) {

      if (Array.isArray(audience_ids)) {

        audienceIds = audience_ids.map(Number);

      } else {

        audienceIds = audience_ids
          .split(",")
          .map(id => Number(id.trim()))
          .filter(id => !isNaN(id));

      }

    }

    // ----------------------------
    // Display Locations
    // ----------------------------

    let displayLocations = [];

    if (display_locations) {

      if (Array.isArray(display_locations)) {

        displayLocations = display_locations;

      } else {

        displayLocations = [display_locations];

      }

    }

    // ----------------------------
    // Determine Status
    // ----------------------------

    let announcementStatus = status || "draft";

    if (
      announcementStatus === "published" &&
      start_date &&
      new Date(start_date) > new Date()
    ) {

      announcementStatus = "scheduled";

    }

    // ----------------------------
    // Insert
    // ----------------------------

    await pool.query(
      `
      INSERT INTO announcements
      (
        title,
        message,
        image_url,

        type,
        priority,

        display_locations,

        audience_type,
        audience_ids,

        button_text,
        button_link,

        background_color,
        text_color,
        button_color,

        popup_delay,

        dismissible,
        allow_close,
        show_once,

        start_date,
        end_date,

        status,

        created_by
      )

      VALUES
      (
        $1,$2,$3,
        $4,$5,
        $6,
        $7,$8,
        $9,$10,
        $11,$12,$13,
        $14,
        $15,$16,$17,
        $18,$19,
        $20,
        $21
      )
      `,
      [
        title,
        message,
        image_url,

        type || "information",
        priority || "normal",

        displayLocations,

        audience_type || "all",
        audienceIds,

        button_text || null,
        button_link || null,

        background_color || "#ffffff",
        text_color || "#000000",
        button_color || "#0d6efd",

        popup_delay || 0,

        dismissible === "true" || dismissible === true,
        allow_close === "true" || allow_close === true,
        show_once === "true" || show_once === true,

        start_date || null,
        end_date || null,

        announcementStatus,

        req.session.user.id
      ]
    );

    res.redirect("/admin/announcements");

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to create announcement."
    });

  }
};

exports.getAnnouncement = async (req, res) => {
  try {

    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
          a.*,
          u.fullname AS created_by_name
      FROM announcements a
      LEFT JOIN users2 u
          ON u.id = a.created_by
      WHERE a.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found."
      });
    }

    const announcement = result.rows[0];

    // Ensure arrays are always returned
    announcement.display_locations =
      announcement.display_locations || [];

    announcement.audience_ids =
      announcement.audience_ids || [];

    res.json({
      success: true,
      announcement
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to load announcement."
    });

  }
};

// Publish Announcement
exports.publishAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if announcement exists
    const existing = await pool.query(
      `SELECT id, status
       FROM announcements
       WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found."
      });
    }

    await pool.query(
      `
      UPDATE announcements
      SET
          status = 'published',
          start_date = COALESCE(start_date, NOW()),
          updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    res.json({
      success: true,
      message: "Announcement published successfully."
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to publish announcement."
    });
  }
};

exports.archiveAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE announcements
      SET
          status = 'archived',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *;
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found."
      });
    }

    res.json({
      success: true,
      message: "Announcement archived successfully.",
      announcement: result.rows[0]
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to archive announcement."
    });
  }
};

exports.getHomepageAnnouncements = async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT
        id,
        title,
        message,
        image_url,
        type,
        priority,
        display_locations,
        button_text,
        button_link,
        background_color,
        text_color,
        button_color,
        dismissible,
        allow_close,
        show_once,
        popup_delay,
        start_date,
        end_date,
        created_at
      FROM announcements
      WHERE
        status = 'published'

        AND
        (
          start_date IS NULL
          OR start_date <= NOW()
        )

        AND
        (
          end_date IS NULL
          OR end_date >= NOW()
        )

        AND
        (
          'homepage' = ANY(display_locations)
          OR 'all' = ANY(display_locations)
        )

      ORDER BY

        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,

        created_at DESC
    `);

    res.json({
      success: true,
      announcements: result.rows
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to load homepage announcements."
    });

  }
};

exports.getDashboardAnnouncements = async (req, res) => {
  try {

    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "Please login first."
      });
    }

    const userId = req.session.user.id;

    // Get the user's details
    const userResult = await pool.query(
      `
      SELECT
        id,
        role,
        school_id,
        classroom_id
      FROM users2
      WHERE id = $1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    const user = userResult.rows[0];

    const result = await pool.query(
      `
      SELECT *
      FROM announcements
      WHERE

        status='published'

        AND
        (
          start_date IS NULL
          OR start_date <= NOW()
        )

        AND
        (
          end_date IS NULL
          OR end_date >= NOW()
        )

        AND
        (
          'dashboard' = ANY(display_locations)
          OR 'all' = ANY(display_locations)
        )

        AND
        (
          audience_type='all'

          OR audience_type='users'

          OR audience_type=$1

          OR (
              audience_type='schools'
              AND $2 = ANY(audience_ids)
          )

          OR (
              audience_type='classrooms'
              AND $3 = ANY(audience_ids)
          )
        )

      ORDER BY

        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,

        created_at DESC
      `,
      [
        user.role,
        user.school_id || 0,
        user.classroom_id || 0
      ]
    );

    res.json({
      success: true,
      announcements: result.rows
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to load dashboard announcements."
    });

  }
};

exports.getAllAnnouncements = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                a.*,
                COUNT(av.id) AS views
            FROM announcements a
            LEFT JOIN announcement_views av
                ON av.announcement_id = a.id
            GROUP BY a.id
            ORDER BY a.created_at DESC
        `);

        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Failed to fetch announcements."
        });
    }
};

exports.updateAnnouncement = async (req, res) => {
    try {

        const { id } = req.params;

        const imageUrl = req.file ? req.file.path : req.body.existing_image;

        const {
            title,
            message,
            type,
            priority,
            audience_type,
            display_locations,
            button_text,
            button_link,
            background_color,
            text_color,
            button_color,
            popup_delay,
            dismissible,
            allow_close,
            show_once,
            start_date,
            end_date,
            status
        } = req.body;

        await pool.query(
            `
            UPDATE announcements
            SET
                title=$1,
                message=$2,
                image_url=$3,
                type=$4,
                priority=$5,
                audience_type=$6,
                display_locations=$7,
                button_text=$8,
                button_link=$9,
                background_color=$10,
                text_color=$11,
                button_color=$12,
                popup_delay=$13,
                dismissible=$14,
                allow_close=$15,
                show_once=$16,
                start_date=$17,
                end_date=$18,
                status=$19,
                updated_at=NOW()
            WHERE id=$20
            `,
            [
                title,
                message,
                imageUrl,
                type,
                priority,
                audience_type,
                display_locations,
                button_text,
                button_link,
                background_color,
                text_color,
                button_color,
                popup_delay,
                dismissible,
                allow_close,
                show_once,
                start_date,
                end_date,
                status,
                id
            ]
        );

        res.json({
            success: true,
            message: "Announcement updated successfully."
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Unable to update announcement."
        });

    }
};

exports.deleteAnnouncement = async (req, res) => {

    try {

        const { id } = req.params;

        await pool.query(
            "DELETE FROM announcements WHERE id=$1",
            [id]
        );

        res.json({
            success: true,
            message: "Announcement deleted successfully."
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Unable to delete announcement."
        });

    }

};

exports.recordView = async (req, res) => {

    try {

        if (!req.session.user) {
            return res.json({ success: true });
        }

        await pool.query(
            `
            INSERT INTO announcement_views
            (
                announcement_id,
                user_id
            )
            VALUES($1,$2)
            ON CONFLICT
            (announcement_id,user_id)
            DO NOTHING
            `,
            [
                req.params.id,
                req.session.user.id
            ]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });

    }

};

exports.dismissAnnouncement = async (req, res) => {

    try {

        if (!req.session.user) {
            return res.json({ success: true });
        }

        await pool.query(
            `
            UPDATE announcement_views
            SET
                dismissed = true,
                dismissed_at = NOW()
            WHERE
                announcement_id = $1
            AND
                user_id = $2
            `,
            [
                req.params.id,
                req.session.user.id
            ]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });

    }

};