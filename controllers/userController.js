const bcrypt = require("bcrypt");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const PDFDocument = require("pdfkit");
// const puppeteer = require("puppeteer");
const generatePdf = require("../utils/generatePdf");
const crypto = require("crypto");
const { logActivityForUser } = require("../utils/activityLogger");
const getAnnouncements = require("../utils/getAnnouncements");
const { renderQuizReportHtml, renderCourseReportHtml } = require("../utils/reportTemplate");
const axios = require("axios");
const { getStudentStreak } = require("../services/streakService");
const { getLevelForXp } = require("../utils/xpLevels");
const {
  getLockedEndedTermsForStudent,
  computeReactivationPrice,
  reactivateTerm,
} = require("../services/termReactivationService");
const { notifyUser } = require("../utils/notify");

exports.showSignup = (req, res) => {
  // res.sendFile(path.join(__dirname, 'signup.html'));
  res.render("signup", { error: null , role: req.query.role || 'user'});
};

exports.showLogin = (req, res) => {
  res.render("admin/login", { error: null });
};

exports.signup = async (req, res) => {
  const {
    email,
    username,
    phone,
    gender,
    password,
    dob,
    role,
    schoolName,
    schoolAddress,
    schoolId,
  } = req.body;
  const file = req.file;

  try {
    const exists = await pool.query("SELECT * FROM users2 WHERE email = $1", [
      email,
    ]);
    if (exists.rows.length > 0) {
      return res.status(400).send("Email already registered.");
    }

    await pool.query("DELETE FROM pending_users WHERE email = $1", [email]);

    const defaultImage = "/profile.webp";
    const profile_picture = file ? file.path : defaultImage;
    const hashed = await bcrypt.hash(password, 10);
    const created_at = new Date();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    // ====== CASE 1: OTP roles (admin, parent, user) ======
   if (["school_admin", "parent", "user"].includes(role)) {
     await pool.query(
       `INSERT INTO pending_users 
      (fullname, email, phone, gender, password, otp_code, otp_expires, profile_picture, role, created_at, dob) 
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
       [
         username,
         email,
         phone,
         gender,
         hashed,
         otp,
         expires,
         profile_picture,
         role,
         created_at,
         dob,
       ]
     );

     if (role === "school_admin") {
       await pool.query(
         `UPDATE pending_users SET otp_code = $1 WHERE email = $2`,
         [otp + "|" + JSON.stringify({ schoolName, schoolAddress }), email]
       );
     }

     await sendEmail(
       email,
       "Your OTP Code",
       `Your code is: ${otp}`
     );

     // <-- Return JSON instead of plain text
     return res.status(200).json({
       message: "OTP sent to your email.",
       needsOtp: true, // <-- this triggers the modal
     });
   }


    // ====== CASE 2: Teacher / School Student ======
    if (role === "teacher") {
      if (!schoolId) {
        return res
          .status(400)
          .send("School ID is required for teachers/students");
      }

      // check school exists
      const schoolCheck = await pool.query(
        "SELECT * FROM schools WHERE school_id = $1",
        [schoolId]
      );
      if (schoolCheck.rowCount === 0) {
        return res.status(400).send("Invalid School ID");
      }
      const school = schoolCheck.rows[0];

      // insert directly into users2 with "pending_admin_approval"
      // const newUser = await pool.query(
      //   `INSERT INTO users2 (fullname, email, phone, gender, password, profile_picture, role, created_at, dob) 
      //    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      //   [
      //     username,
      //     email,
      //     phone,
      //     gender,
      //     hashed,
      //     profile_picture,
      //     role,
      //     created_at,
      //     dob,
      //   ]
      // );
      
      const avatarSeed = username + Date.now();

      const avatarUrl = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(avatarSeed)}`;

      const pin = Math.floor(1000 + Math.random() * 9000).toString();

      const isLowerPrimary =
        classroomName?.toLowerCase().includes("pry 1") ||
        classroomName?.toLowerCase().includes("pry 2") ||
        classroomName?.toLowerCase().includes("pry 3");

      const newUser = await pool.query(
        `
          INSERT INTO users2 (
            fullname,
            email,
            phone,
            gender,
            password,
            profile_picture,
            role,
            created_at,
            dob,
            avatar_url,
            avatar_seed,
            pin,
            login_type,
            is_lower_primary,
            classroom_login_enabled
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,
            $10,$11,$12,$13,$14,$15
          )
          RETURNING *
          `,
        [
          username,
          emailGenerated,
          phone,
          gender,
          hashed,
          profile_picture,
          role,
          created_at,
          dob,
          avatarUrl,
          avatarSeed,
          pin,
          "avatar_pin",
          isLowerPrimary,
          true,
        ],
      );

      // link user to school
      await pool.query(
        `INSERT INTO user_school (user_id, school_id, role_in_school) VALUES ($1,$2,$3)`,
        [newUser.rows[0].id, school.id, role]
      );

      // return res
      //   .status(200)
      //   .send("Signup successful, pending school admin approval.");

      return res.status(200).json({
        message: "Signup successful, pending school admin approval.",
        needsOtp: false,
      });
    }

    if (role === "student") {
      if (!schoolId) {
        return res.status(400).send("School ID is required for students");
      }
      
      // check school exists
      const schoolCheck = await pool.query(
        "SELECT * FROM schools WHERE school_id = $1",
        [schoolId]
      );
      if (schoolCheck.rowCount === 0) {
        return res.status(400).send("Invalid School ID");
      }
      const school = schoolCheck.rows[0];
    
      // ✅ auto-generate email for students
      const fullNameClean = username.replace(/\s+/g, ""); // remove spaces
      const schoolFirstWord = school.name.split(" ")[0].toLowerCase(); // take first word of school name
      const emailGenerated = `${fullNameClean.toLowerCase()}@${schoolFirstWord}school.com`;

      const newUser = await pool.query(
        `INSERT INTO users2 (fullname, email, phone, gender, password, profile_picture, role, created_at, dob) 
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          username,
          emailGenerated, // 👈 auto-generated
          phone,
          gender,
          hashed,
          profile_picture,
          role,
          created_at,
          dob,
        ]
      );

      // link user to school
      await pool.query(
        `INSERT INTO user_school (user_id, school_id, role_in_school) VALUES ($1,$2,$3)`,
        [newUser.rows[0].id, school.id, role]
      );

      return res.status(200).json({
        message: "Signup successful, pending school admin approval.",
        needsOtp: false,
      });
    }


    res.status(400).send("Invalid role.");
  } catch (err) {
    console.error("❌ Signup error:", err.message);
    res.status(500).send("Internal server error");
  }
};


exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  const created_at = new Date();

  try {
    const result = await pool.query(
      "SELECT * FROM pending_users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0)
      return res.status(400).send("Invalid request");

    const user = result.rows[0];

    //handle otp check
    let cleanOtp = user.otp_code;
    let extraData = {};
    if (user.otp_code.includes("|")) {
      const [pureOtp, jsonString] = user.otp_code.split("|");
      cleanOtp = pureOtp;
      console.log("Extracted pure OTP:", pureOtp);
      try {
        extraData = JSON.parse(jsonString);
      } catch {}
    }

    // if (cleanOtp !== otp) return res.status(400).send("Invalid OTP");
    // if (new Date(user.otp_expires) < new Date())
    //   return res.status(400).send("OTP expired");

    if (cleanOtp !== otp) return res.status(400).json({ success: false, message: "Invalid OTP" });
    if (new Date(user.otp_expires) < new Date()) return res.status(400).json({ success: false, message: "OTP expired" });


    // insert into users2
    const newUserResult = await pool.query(
      `INSERT INTO users2 (fullname, email, phone, gender, password, profile_picture, role, created_at, dob) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        user.fullname,
        user.email,
        user.phone,
        user.gender,
        user.password,
        user.profile_picture,
        user.role,
        created_at,
        user.dob,
      ]
    );
    const newUser = newUserResult.rows[0];

    // if admin, create school
    if (user.role === "school_admin") {
      const schoolId =
        "SCH-" + crypto.randomBytes(3).toString("hex").toUpperCase();

      const schoolLogoFile = req.files?.schoolLogo?.[0]; // multer stores file info
      const logo_url = schoolLogoFile
        ? schoolLogoFile.path
        : "/images/default-school.png";

      await pool.query(
        `INSERT INTO schools 
          (school_id, name, address, email, phone, created_by, logo_url) 
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          schoolId,
          extraData.schoolName,
          extraData.schoolAddress,
          newUser.email,
          newUser.phone,
          newUser.id,
          logo_url,
        ]
      );


      await sendEmail(
        email,
        "For your teacher and student to register ",
        `Your SchoolID is: ${schoolId}`
      );
      // return res.status(200).send("School ID sent to your email.");
      return res.status(200).json({
        message: `School ID sent to your email: ${schoolId}`,
        success: true,
      });


      
    }

    await pool.query("DELETE FROM pending_users WHERE email = $1", [email]);
    res.status(200).json({
      message: "Verification success",
      success: true,
    });
  } catch (err) {
    console.error("❌ Verify OTP error:", err.message);
    res.status(500).send("Internal server error");
  }
};

exports.checkPendingUser = async (req, res) => {
  const { email } = req.query;
  console.log("🔍 checkPendingUser called with:", email);

  if (!email) {
    return res.json({ pending: false });
  }

  const pending = await pool.query(
    "SELECT otp_expires FROM pending_users WHERE email = $1",
    [email]
  );

  if (pending.rowCount === 0) {
    return res.json({ pending: false });
  }

  // Optional: check expiry
  if (new Date(pending.rows[0].otp_expires) < new Date()) {
    return res.json({ pending: false, expired: true });
  }

  return res.json({
    pending: true,
    needsOtp: true,
  });
};

exports.resendOtp = async (req, res) => {
  const { email } = req.body;

  try {
    // 1️⃣ Check if the user exists in pending_users
    const userResult = await pool.query(
      "SELECT * FROM pending_users WHERE email = $1",
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending account found with this email.",
      });
    }

    const user = userResult.rows[0];

    // 2️⃣ Generate new OTP and expiry
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // 3️⃣ Preserve extraData if OTP was for school_admin
    let otpToSave = otp;
    if (user.role === "school_admin" && user.otp_code.includes("|")) {
      const [, jsonString] = user.otp_code.split("|");
      otpToSave = otp + "|" + jsonString;
    }

    // 4️⃣ Update the pending_users table
    await pool.query(
      "UPDATE pending_users SET otp_code = $1, otp_expires = $2 WHERE email = $3",
      [otpToSave, expires, email]
    );

    // 5️⃣ Send OTP via email
    try {
      await sendEmail(email, "Your new OTP", `Your OTP is: ${otp}`);
    } catch (err) {
      console.error("❌ Error sending OTP email:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP email. Please try again later.",
      });
    }

    // 6️⃣ Respond with success JSON
    res.json({
      success: true,
      message: "OTP resent successfully. Check your email.",
    });

  } catch (err) {
    console.error("❌ resendOtp error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUserProfile = async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect("/admin/login");

  const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
    user.id,
  ]);

  if (result.rows.length === 0) return res.status(404).send("User not found");

  const currentUser = result.rows[0];

  if (user.role === "admin") {
    return res.render("admin/adminProfile", {
      user: currentUser,
      title: "Admin Profile",
    });
  } else {
    return res.render("profile", {
      user: currentUser,
      title: "User Profile",
      activePage: "profile", // 👈 Pass active page
    });
  }
};

exports.updateUserProfile = async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect("/admin/login");

  const { fullname, phone, dob } = req.body;
  const dobValue = dob && dob.trim() !== "" ? dob : null;
  const profile_picture = req.file ? req.file.path : user.profile_picture;

  await pool.query(
    "UPDATE users2 SET fullname = $1, phone = $2, profile_picture = $3, dob = $4 WHERE id = $5",
    [fullname, phone, profile_picture, dobValue, user.id]
  );
  // Update session with new profile picture
  req.session.user.profile_picture = profile_picture;

  if (user.role === "admin") {
    return res.redirect("/profile"); // can use same route for both
  } else {
    return res.redirect("/profile");
  }
};

exports.showEvent = async (req, res) => {
  const { id } = req.params;
  // Add this line to pass login status to EJS
  const isLoggedIn = !!req.session.user; // or whatever property you use for login
  const profilePic = req.session.user ? req.session.user.profile_picture : null;

   let walletBalance = 0;
   if (req.session.user) {
     const walletResult = await pool.query(
       "SELECT wallet_balance2 FROM users2 WHERE email = $1",
       [req.session.user.email]
     );
     walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
   }


  try {
    const result = await pool.query("SELECT * FROM events WHERE id = $1", [id]);
    const event = result.rows[0];

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    if (!event) return res.status(404).send("Event not found");

    

    // ✅ Extract paid status from query
    const paid = req.query.paid;

    res.render("showEvent", {
      event,
      info,
      isLoggedIn,
      users: req.session.user,
      subscribed: req.query.subscribed,
      paid,
      walletBalance,
      activePage: "event", // 👈 Pass active page
    });
  } catch (err) {
    console.error("Error loading event:", err);
    res.status(500).send("Server error");
  }
};

// Lightweight per-child gamification summary for the parent dashboard —
// deliberately NOT the full viewStudentProgress computation (that stays a
// click-through detail page); this only pulls what a dashboard card needs
// so a parent with several children doesn't pay for a heavy page load.
async function getChildSummary(childId) {
  const streak = await getStudentStreak(childId);

  const xpTotalRes = await pool.query(
    `SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1`,
    [childId]
  );
  const levelInfo = getLevelForXp(xpTotalRes.rows[0].total);

  const badgeCountRes = await pool.query(
    `SELECT COUNT(*) FROM user_badges WHERE user_id = $1`,
    [childId]
  );

  const coursesCompletedRes = await pool.query(
    `SELECT COUNT(*) FROM course_enrollments WHERE user_id = $1 AND progress >= 100`,
    [childId]
  );

  const recentBadgeRes = await pool.query(
    `SELECT badge_name, badge_image, awarded_at
     FROM user_badges
     WHERE user_id = $1
     ORDER BY awarded_at DESC
     LIMIT 1`,
    [childId]
  );

  const lockedTerms = await getLockedEndedTermsForStudent(childId);

  return {
    streak,
    levelInfo,
    badgeCount: parseInt(badgeCountRes.rows[0].count, 10) || 0,
    coursesCompleted: parseInt(coursesCompletedRes.rows[0].count, 10) || 0,
    recentBadge: recentBadgeRes.rows[0] || null,
    lockedTerms,
  };
}

exports.getParentDashboard = async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "parent") {
    return res.redirect("/login");
  }

  try {
    const announcements = await getAnnouncements("dashboard");
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const profilePic = req.session.user?.profile_picture || null;

    // req.session.user only ever carries {id, email, role, profile_picture}
    // (set at login, controllers/adminController.js) — never fullname. The
    // view needs it (PARENT_NAME, used as the Paystack "Funded By" label),
    // so fetch it here rather than passing the bare session user through.
    const parentFullnameRes = await pool.query(
      "SELECT fullname FROM users2 WHERE id = $1",
      [user.id]
    );
    const parent = { ...user, fullname: parentFullnameRes.rows[0]?.fullname || "" };

    const childrenRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, u.profile_picture, u.wallet_balance2
       FROM parent_children pc
       JOIN users2 u ON pc.child_id = u.id
       WHERE pc.parent_id = $1
       ORDER BY u.fullname`,
      [user.id]
    );

    const children = await Promise.all(
      childrenRes.rows.map(async (child) => ({
        ...child,
        ...(await getChildSummary(child.id)),
      }))
    );

    // Balance alerts flattened across every child, most-recently-ended term first.
    const balanceAlerts = children
      .flatMap((child) =>
        child.lockedTerms.map((term) => ({
          childId: child.id,
          childName: child.fullname,
          ...term,
        }))
      )
      .sort((a, b) => new Date(b.endDate) - new Date(a.endDate));

    // Activity/milestone alerts — derived entirely from data already
    // fetched above, no new tracking table needed.
    const INACTIVITY_ALERT_DAYS = 5;
    const activityAlerts = [];
    children.forEach((child) => {
      if (child.streak.lastActiveDate) {
        const daysSince = Math.floor(
          (Date.now() - new Date(child.streak.lastActiveDate).getTime()) / 86400000
        );
        if (daysSince >= INACTIVITY_ALERT_DAYS) {
          activityAlerts.push({
            type: "inactive",
            childId: child.id,
            childName: child.fullname,
            daysSince,
          });
        }
      }
      if (child.recentBadge) {
        const daysSinceBadge = Math.floor(
          (Date.now() - new Date(child.recentBadge.awarded_at).getTime()) / 86400000
        );
        if (daysSinceBadge <= 7) {
          activityAlerts.push({
            type: "new_badge",
            childId: child.id,
            childName: child.fullname,
            badgeName: child.recentBadge.badge_name,
            daysSinceBadge,
          });
        }
      }
    });

    // Family leaderboard — only meaningful with 2+ children, positive framing.
    const leaderboard =
      children.length >= 2
        ? [...children]
            .sort((a, b) => b.levelInfo.xp - a.levelInfo.xp)
            .map((child, index) => ({
              rank: index + 1,
              childId: child.id,
              childName: child.fullname,
              profilePicture: child.profile_picture,
              xp: child.levelInfo.xp,
              levelName: child.levelInfo.name,
              streak: child.streak.currentStreak,
            }))
        : [];

    // Parent's own sent child-link requests, so a pending/rejected one is
    // visible instead of disappearing after submission.
    const pendingRequestsRes = await pool.query(
      `SELECT r.id, r.child_id, r.status, r.created_at, u.fullname, u.email
       FROM parent_child_requests r
       JOIN users2 u ON u.id = r.child_id
       WHERE r.parent_id = $1
       ORDER BY r.created_at DESC`,
      [user.id]
    );

    // Combined wallet/spending history across every linked child.
    const childIds = children.map((c) => c.id);
    const walletHistoryRes = childIds.length
      ? await pool.query(
          `SELECT wt.*, u.fullname AS child_name
           FROM wallet_transactions wt
           JOIN users2 u ON u.id = wt.user_id
           WHERE wt.user_id = ANY($1)
           ORDER BY wt.created_at DESC
           LIMIT 50`,
          [childIds]
        )
      : { rows: [] };

    res.render("parent/dashboard", {
      parent,
      children,
      balanceAlerts,
      activityAlerts,
      leaderboard,
      pendingRequests: pendingRequestsRes.rows,
      walletHistory: walletHistoryRes.rows,
      info,
      profilePic,
      title: "Parent Dashboard",
      announcements,
      isLoggedIn: !!req.session.user,
      users: req.session.user,
    });
  } catch (err) {
    console.error("Error loading parent dashboard:", err);
    res.status(500).send("Failed to load dashboard");
  }
};

// POST /parent/fund-child/verify — body: { reference, childId }
// Verifies a Paystack charge and credits the CHILD's wallet directly (the
// "direct pay-to-child" model) — never trusts a client-supplied amount or
// target; both are always re-derived from a verified Paystack response and
// a verified parent_children ownership row.
exports.fundChildWallet = async (req, res) => {
  const parent = req.session.user;
  if (!parent || parent.role !== "parent") {
    return res.status(403).json({ success: false, message: "Only parents can fund a child's wallet" });
  }

  const { reference, childId } = req.body;
  if (!reference || !childId) {
    return res.status(400).json({ success: false, message: "Missing reference or child" });
  }

  try {
    const ownershipCheck = await pool.query(
      `SELECT id, fullname, email FROM users2
       WHERE id = $1 AND id IN (SELECT child_id FROM parent_children WHERE parent_id = $2)`,
      [childId, parent.id]
    );
    const child = ownershipCheck.rows[0];
    if (!child) {
      return res.status(403).json({ success: false, message: "You are not linked to this child" });
    }

    // req.session.user never carries fullname (same gap fixed in
    // getParentDashboard) — fetch it so the wallet_transactions description
    // below doesn't literally say "(undefined)".
    const parentFullnameRes = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [parent.id]);
    const parentName = parentFullnameRes.rows[0]?.fullname || "a parent";

    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const payment = verifyRes.data.data;

    if (payment.status !== "success") {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    const amount = payment.amount / 100; // always trust Paystack's verified amount, never the client's

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      try {
        await client.query(
          `INSERT INTO transactions (fullname, email, amount, reference, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [child.fullname, child.email, amount, reference, "success"]
        );
      } catch (insertErr) {
        if (insertErr.code === "23505") {
          // Duplicate reference — this exact charge was already processed
          // by an earlier request (retry/double-submit). Not an error:
          // just don't credit the wallet twice.
          await client.query("ROLLBACK");
          return res.json({ success: true, message: "Payment already processed" });
        }
        throw insertErr;
      }

      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, direction, amount, description, reference, related_user_id)
         VALUES ($1, 'parent_fund', 'credit', $2, $3, $4, $5)`,
        [childId, amount, `Wallet funded by parent (${parentName})`, reference, parent.id]
      );

      const updated = await client.query(
        "UPDATE users2 SET wallet_balance2 = wallet_balance2 + $1 WHERE id = $2 RETURNING wallet_balance2",
        [amount, childId]
      );

      await client.query("COMMIT");

      await notifyUser(childId, {
        type: "wallet_funded",
        title: "Your wallet was funded",
        message: `${parentName} added ₦${amount.toLocaleString()} to your wallet`,
        url: "/student/dashboard",
      });

      return res.json({
        success: true,
        message: `₦${amount.toLocaleString()} added to ${child.fullname}'s wallet`,
        newBalance: updated.rows[0].wallet_balance2,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error funding child wallet:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: "Server error while funding wallet" });
  }
};

// POST /parent/reactivate-term/verify — body: { reference, childId, termId }
// Mirrors studentController.payTermReactivation's shape, but the parent's
// card is charged directly via Paystack instead of deducting a wallet —
// nothing is deducted from the child's wallet_balance2 in this flow.
exports.payTermReactivationAsParent = async (req, res) => {
  const parent = req.session.user;
  if (!parent || parent.role !== "parent") {
    return res.status(403).json({ success: false, message: "Only parents can pay this" });
  }

  const { reference, childId } = req.body;
  const termId = parseInt(req.body.termId, 10);
  if (!childId || !termId) {
    return res.status(400).json({ success: false, message: "Missing child or term" });
  }

  try {
    const ownershipCheck = await pool.query(
      `SELECT id, fullname, email FROM users2
       WHERE id = $1 AND id IN (SELECT child_id FROM parent_children WHERE parent_id = $2)`,
      [childId, parent.id]
    );
    const child = ownershipCheck.rows[0];
    if (!child) {
      return res.status(403).json({ success: false, message: "You are not linked to this child" });
    }

    const steRes = await pool.query(
      `SELECT ste.term_id, ste.school_id, at.is_ended
       FROM student_term_enrollments ste
       JOIN academic_terms at ON at.id = ste.term_id
       WHERE ste.student_id = $1 AND ste.term_id = $2`,
      [childId, termId]
    );
    const enrollment = steRes.rows[0];
    if (!enrollment || !enrollment.is_ended) {
      return res.status(404).json({ success: false, message: "Term not found or not ended" });
    }

    // Recomputed live — never trust a client-submitted amount, including
    // whatever price was shown on the dashboard before this request.
    const priceInfo = await computeReactivationPrice(childId, termId);
    if (priceInfo.alreadyReactivated) {
      return res.json({ success: true, message: "Already reactivated" });
    }

    if (priceInfo.totalPrice === 0) {
      await reactivateTerm(childId, enrollment.school_id, termId, {
        reactivatedBy: "parent_payment",
        reactivatedByUserId: parent.id,
        amountPaid: 0,
      });
      return res.json({ success: true, message: "Term reactivated" });
    }

    if (!reference) {
      return res.status(400).json({ success: false, message: "Missing payment reference" });
    }

    const verifyRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const payment = verifyRes.data.data;

    if (payment.status !== "success") {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    const amountPaid = payment.amount / 100;
    if (amountPaid !== priceInfo.totalPrice) {
      console.error(
        `Term reactivation amount mismatch: paid ${amountPaid}, owed ${priceInfo.totalPrice} (student ${childId}, term ${termId})`
      );
      return res.status(400).json({
        success: false,
        message: "Payment amount didn't match the amount owed — please try again",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      try {
        await client.query(
          `INSERT INTO transactions (fullname, email, amount, reference, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [child.fullname, child.email, amountPaid, reference, "success"]
        );
      } catch (insertErr) {
        if (insertErr.code === "23505") {
          await client.query("ROLLBACK");
          return res.json({ success: true, message: "Payment already processed" });
        }
        throw insertErr;
      }

      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, direction, amount, description, reference, related_user_id)
         VALUES ($1, 'parent_term_reactivation', 'debit', $2, $3, $4, $5)`,
        [parent.id, amountPaid, `Paid to unlock ${child.fullname}'s locked term`, reference, childId]
      );

      const inserted = await client.query(
        `INSERT INTO student_term_reactivations
           (student_id, school_id, term_id, amount_paid, reactivated_by, reactivated_by_user_id, transaction_reference)
         VALUES ($1, $2, $3, $4, 'parent_payment', $5, $6)
         ON CONFLICT (student_id, term_id) DO NOTHING
         RETURNING id`,
        [childId, enrollment.school_id, termId, amountPaid, parent.id, reference]
      );

      // Always commit here regardless of whether the reactivation row was
      // actually inserted — the Paystack charge is real either way, and the
      // transactions/wallet_transactions audit rows above must survive even
      // if a concurrent request already reactivated this exact term first.
      await client.query("COMMIT");

      if (!inserted.rows.length) {
        return res.json({ success: true, message: "Already reactivated (payment recorded)" });
      }
      return res.json({ success: true, message: `Reactivated — ${child.fullname}'s course is unlocked again` });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error reactivating term as parent:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: "Server error while processing payment" });
  }
};


exports.addChild = async (req, res) => {
  const parent = req.session.user;
  if (!parent || parent.role !== "parent") {
    return res.status(403).json({ error: "Only parents can add children" });
  }

  const { childEmail } = req.body;

  try {
    // Look up the child (user or student)
    const childRes = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       WHERE u.email = $1
         AND (
           u.role = 'user'
           OR EXISTS (
             SELECT 1 FROM user_school us
             WHERE us.user_id = u.id AND us.role_in_school = 'student'
           )
         )`,
      [childEmail]
    );

    if (childRes.rowCount === 0) {
      return res.status(404).json({ error: "No child found with that email." });
    }

    const child = childRes.rows[0];

    // req.session.user never carries fullname (see the identical parent/
    // dashboard.ejs bug fixed elsewhere) — fetch it for the notification text.
    const parentFullnameRes = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [parent.id]);
    const parentName = parentFullnameRes.rows[0]?.fullname || "A parent";

    // 🔎 Check if request already exists
    const existingRes = await pool.query(
      `SELECT * FROM parent_child_requests 
       WHERE parent_id = $1 AND child_id = $2`,
      [parent.id, child.id]
    );

    if (existingRes.rowCount > 0) {
      const existing = existingRes.rows[0];

      if (existing.status === "pending") {
        return res.status(409).json({ error: "Request already pending." });
      }
      if (existing.status === "accepted") {
        return res.status(409).json({ error: "Child already linked." });
      }
      if (existing.status === "rejected") {
        // 🔁 Re-request allowed: update to pending
        await pool.query(
          `UPDATE parent_child_requests
           SET status = 'pending', created_at = NOW()
           WHERE id = $1`,
          [existing.id]
        );
        await notifyUser(child.id, {
          type: "parent_link_request",
          title: "Parent link request",
          message: `${parentName} wants to link to your account — approve it from your dashboard.`,
          url: "/student/dashboard",
        });

        return res.status(200).json({
          message: "🔁 Request re-sent! Waiting for the student’s approval.",
          redirect: "/parent/dashboard",
        });
      }
    }

    // ✅ Insert new request
    await pool.query(
      `INSERT INTO parent_child_requests (parent_id, child_id, status)
       VALUES ($1, $2, 'pending')`,
      [parent.id, child.id]
    );
    await notifyUser(child.id, {
      type: "parent_link_request",
      title: "Parent link request",
      message: `${parentName} wants to link to your account — approve it from your dashboard.`,
      url: "/student/dashboard",
    });

    await logActivityForUser(
      req,
      "Parent linked child",
      `Parent ID: ${parent.id}, Child ID: ${child.id}`
    );

    return res.status(200).json({
      message: "✅ Request sent! Waiting for the student’s approval.",
      redirect: "/parent/dashboard",
    });
  } catch (err) {
    console.error("❌ Error linking child:", err);
    return res.status(500).json({ error: "Failed to link child" });
  }
};

exports.downloadQuizReport = async (req, res) => {
  const { studentId, quizId } = req.params;

  try {
    // --- Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    // --- Student + School info
    const studentRes = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       WHERE u.id = $1
       LIMIT 1`,
      [studentId]
    );
    if (!studentRes.rows.length)
      return res.status(404).send("Student not found");

    const student = studentRes.rows[0];

    // --- Quiz info + lesson/module/course
    const quizRes = await pool.query(
      `SELECT q.id, q.title AS quiz_title, l.title AS lesson_title, 
              m.title AS module_title, c.title AS course_title
       FROM quizzes q
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE q.id = $1`,
      [quizId]
    );
    if (!quizRes.rows.length) return res.status(404).send("Quiz not found");
    const quiz = quizRes.rows[0];

    // --- Submission info
    const submissionRes = await pool.query(
      `SELECT id, score, passed, created_at, review_data
       FROM quiz_submissions
       WHERE quiz_id = $1 AND student_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [quizId, studentId]
    );
    const submission = submissionRes.rows[0];

    // Parse review_data
    let reviewData = [];
    if (submission && submission.review_data) {
      try {
        reviewData = JSON.parse(submission.review_data);
      } catch (e) {
        reviewData = [];
      }
    }

    // --- Build HTML (shared gamified report template)
    const html = renderQuizReportHtml({
      info,
      student,
      courseTitle: quiz.course_title,
      moduleTitle: quiz.module_title,
      lessonTitle: quiz.lesson_title,
      quizTitle: quiz.quiz_title,
      score: submission ? submission.score : null,
      passed: submission ? submission.passed : false,
      takenAt: submission ? submission.created_at : null,
      reviewData,
    });

    // --- Generate PDF
    const pdf = await generatePdf(html);

    // --- File name with student + quiz
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${
        quiz.lesson_title
      }_Quiz_Report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    console.error("Quiz PDF Error:", err);
    res.status(500).send("Error generating quiz report");
  }
};

// let browserPromise = puppeteer.launch({
//   headless: true,
//   args: ["--no-sandbox", "--disable-setuid-sandbox"],
// });

exports.downloadCourseSummary = async (req, res) => {
  const { studentId, courseId } = req.params;

  try {
    // --- Student info
    const studentRes = await pool.query(
      `SELECT fullname, email, created_at FROM users2 WHERE id = $1`,
      [studentId]
    );
    const student = studentRes.rows[0];

    // --- Course info
    const courseRes = await pool.query(
      `SELECT id, title FROM courses WHERE id = $1`,
      [courseId]
    );
    const course = courseRes.rows[0];

    // --- Company info
    const infoRes = await pool.query(
      `SELECT company_name, logo_url FROM company_info ORDER BY id DESC LIMIT 1`
    );
    const info = infoRes.rows[0] || { company_name: "" };

    // --- Modules
    const modulesRes = await pool.query(
      `SELECT id, title FROM modules WHERE course_id = $1`,
      [courseId]
    );
    const modules = modulesRes.rows;

    // --- Lessons
    const lessonsRes = await pool.query(
      `SELECT l.id, l.title, l.module_id, ulp.completed_at
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp 
         ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE m.course_id = $2
       ORDER BY l.id`,
      [studentId, courseId]
    );
    const lessons = lessonsRes.rows;

    // --- Quizzes
    const quizzesRes = await pool.query(
      `SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at
       FROM quizzes q
       LEFT JOIN quiz_submissions qs 
         ON qs.quiz_id = q.id AND qs.student_id = $1
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       WHERE m.course_id = $2
       ORDER BY q.id`,
      [studentId, courseId]
    );
    const quizzes = quizzesRes.rows;

    // --- Assignments
    const assignmentsRes = await pool.query(
      `SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
       FROM module_assignments ma
       JOIN modules m ON ma.module_id = m.id
       LEFT JOIN assignment_submissions s 
         ON s.assignment_id = ma.id AND s.student_id = $1
       WHERE m.course_id = $2
       ORDER BY ma.id`,
      [studentId, courseId]
    );
    const assignments = assignmentsRes.rows;

    // --- Badges
    const badgesRes = await pool.query(
      `SELECT ub.badge_name, ub.badge_image, ub.awarded_at, ub.module_id, m.title AS module_title
       FROM user_badges ub
       JOIN modules m ON ub.module_id = m.id
       WHERE ub.user_id = $1 AND m.course_id = $2
       ORDER BY ub.awarded_at`,
      [studentId, courseId]
    );
    const badges = badgesRes.rows;

    // --- Certificate
    const certRes = await pool.query(
      `SELECT certificate_url, issued_at FROM user_certificates WHERE user_id = $1 AND course_id = $2 LIMIT 1`,
      [studentId, courseId]
    );
    const certificate = certRes.rows[0] || null;

    // --- Build HTML (shared gamified report template)
    const html = renderCourseReportHtml({
      info,
      student,
      courseTitle: course.title,
      certificate,
      badges,
      modules: modules.map((m) => ({
        title: m.title,
        lessons: lessons.filter((l) => l.module_id === m.id),
        quizzes: quizzes.filter((q) => q.module_id === m.id),
        assignments: assignments.filter((a) => a.module_id === m.id),
        badges: badges.filter((b) => b.module_id === m.id),
      })),
    });

    // --- Generate PDF
    const pdf = await generatePdf(html, { margin: { top: "40px", bottom: "40px", left: "20px", right: "20px" } });

    // --- Send PDF response
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${course.title.replace(/\s+/g, "_")}_report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).send("Error generating summary PDF");
  }
};

exports.viewQuizResult = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT qs.*, l.title AS lesson_title, u.fullname AS student_name
      FROM quiz_submissions qs
      JOIN quizzes q ON qs.quiz_id = q.id
      JOIN lessons l ON q.lesson_id = l.id
      JOIN users2 u ON qs.student_id = u.id
      WHERE qs.id = $1
    `, [id]);

    if (!result.rows.length) {
      return res.send("Result not found");
    }

    const data = result.rows[0];

    let parsedReview = [];

    try {
      parsedReview = typeof data.review_data === "string"
        ? JSON.parse(data.review_data)
        : data.review_data;
    } catch (err) {
      console.error("JSON parse error:", err.message);
    }

    res.render("parentQuizView", {
      submission: data,
      reviewData: parsedReview
    });

  } catch (err) {
    console.error(err);
    res.send("Error loading result");
  }
};

exports.viewAssignmentResult = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT a.title AS assignment_title,
             s.*,
             u.fullname AS student_name
      FROM assignment_submissions s
      JOIN module_assignments a ON s.assignment_id = a.id
      JOIN users2 u ON s.student_id = u.id
      WHERE s.id = $1
    `,
      [id],
    );

    if (!result.rows.length) {
      return res.send("Assignment not found");
    }

    const data = result.rows[0];

    // parse criteria if needed
    let criteria = {};
    try {
      criteria =
        typeof data.criteria === "string"
          ? JSON.parse(data.criteria)
          : data.criteria;
    } catch {}

    res.render("parentAssignmentView", {
      submission: data,
      criteria,
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading assignment");
  }
};













