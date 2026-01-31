module.exports = async function canAccessStudent(req, res, next) {
  try {
    const viewer = req.user; // logged-in user
    const { studentId } = req.params;

    // Admin / Instructor can access anyone
    if (["admin", "instructor", "teacher"].includes(viewer.role)) {
      return next();
    }

    // Parent access check
    if (viewer.role === "parent") {
      const result = await pool.query(
        `SELECT 1 FROM parent_children
         WHERE parent_id = $1 AND child_id = $2`,
        [viewer.id, studentId]
      );

      if (result.rowCount === 0) {
        return res.status(403).send("You cannot access this student's report");
      }

      return next();
    }

    // Student can only access own report
    if (viewer.role === "student" && viewer.id == studentId) {
      return next();
    }

    return res.status(403).send("Access denied");
  } catch (err) {
    console.error("Access check error:", err);
    res.status(500).send("Permission check failed");
  }
};
