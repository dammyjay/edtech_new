const pool = require("../models/db");
const cloudinary = require("../utils/cloudinary");
const fs = require("fs");

exports.showForm = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const result = await pool.query("SELECT * FROM company_info LIMIT 1");
  res.render("admin/company", {
    info: result.rows[0],
    title: "company info",
    info: infoResult.rows[0] || {},
    role: "admin",
    users: req.session.user,
  });
};


exports.saveInfo = async (req, res) => {
  const {
    vision, mission, history, company, marquee_message,
    certificate_signee_name, certificate_title,
  } = req.body;
  let logo_url = null;
  let hero_image_url = null;
  let certificate_background_url = null;
  let certificate_signature_url = null;

  // Upload logo if provided
  if (req.files && req.files.logo && req.files.logo[0]) {
    const logoPath = req.files.logo[0].path;
    const logoUpload = await cloudinary.uploader.upload(logoPath, {
      folder: "company_logos",
    });
    logo_url = logoUpload.secure_url;
    // fs.unlinkSync(logoPath); // Remove temp file
  }

  // Upload hero image if provided
  if (req.files && req.files.heroImage && req.files.heroImage[0]) {
    const heroPath = req.files.heroImage[0].path;
    const heroUpload = await cloudinary.uploader.upload(heroPath, {
      folder: "hero_images",
    });
    hero_image_url = heroUpload.secure_url;
    // fs.unlinkSync(heroPath); // Remove temp file
  }

  // Upload certificate background/signature if provided — see
  // views/partials/certificate.html + utils/generateCertificate.js, which
  // use these (falling back to the built-in defaults when unset).
  if (req.files && req.files.certificateBackground && req.files.certificateBackground[0]) {
    const bgUpload = await cloudinary.uploader.upload(req.files.certificateBackground[0].path, {
      folder: "certificate_template",
    });
    certificate_background_url = bgUpload.secure_url;
  }
  if (req.files && req.files.certificateSignature && req.files.certificateSignature[0]) {
    const sigUpload = await cloudinary.uploader.upload(req.files.certificateSignature[0].path, {
      folder: "certificate_template",
    });
    certificate_signature_url = sigUpload.secure_url;
  }

  // Get current info
  const result = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  if (result.rows.length === 0) {
    // Insert
    await pool.query(
      `INSERT INTO company_info
        (logo_url, vision, mission, history, hero_image_url, company_name, marquee_message,
         certificate_background_url, certificate_signature_url, certificate_signee_name, certificate_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        logo_url, vision, mission, history, hero_image_url, company, marquee_message,
        certificate_background_url, certificate_signature_url, certificate_signee_name, certificate_title,
      ]
    );
  } else {
    // Update (keep old URLs if new not provided)
    const current = result.rows[0];
    await pool.query(
      `UPDATE company_info
       SET logo_url = $1, vision = $2, mission = $3, history = $4, hero_image_url = $5, company_name = $6, marquee_message = $7,
           certificate_background_url = $8, certificate_signature_url = $9, certificate_signee_name = $10, certificate_title = $11
       WHERE id = $12`,
      [
        logo_url || current.logo_url,
        vision,
        mission,
        history,
        hero_image_url || current.hero_image_url,
        company || current.company_name,
        marquee_message || current.marquee_message || "",
        certificate_background_url || current.certificate_background_url,
        certificate_signature_url || current.certificate_signature_url,
        certificate_signee_name || current.certificate_signee_name,
        certificate_title || current.certificate_title,
        current.id,
      ]
    );
  }

  res.redirect("/admin/company");
};

exports.showForm = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    // Get latest company info
    const result = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = result.rows[0] || {};

    res.render("admin/company", {
      info,
      title: "company info",
      info,
      role: "admin",
      users: req.session.user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};
