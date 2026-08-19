const fs = require("fs");
const {
  generateClassReport,
  generateStudentReport,
} = require("../services/reportGeneratorService");
const {
  findExistingReport,
  saveReport,
} = require("../services/classTermReportStore");

async function checkClassReportExists(req, res) {
  const { schoolId, classroomId, termId } = req.params;
  try {
    const existing = await findExistingReport({ schoolId, classroomId, termId, studentId: null });
    res.json({ exists: !!existing, generatedAt: existing ? existing.generated_at : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ exists: false });
  }
}

async function checkStudentReportExists(req, res) {
  const { schoolId, classroomId, termId, studentId } = req.params;
  try {
    const existing = await findExistingReport({ schoolId, classroomId, termId, studentId });
    res.json({ exists: !!existing, generatedAt: existing ? existing.generated_at : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ exists: false });
  }
}

async function downloadClassReport(req, res) {
  const { schoolId, classroomId, termId } = req.params;

  try {
    const report = await generateClassReport(schoolId, classroomId, termId);

    // Persist so the school admin can view this same generated copy later
    // without regenerating it — generating again for the same
    // school+classroom+term updates the stored row (see
    // services/classTermReportStore.js's ON CONFLICT).
    try {
      const pdfBuffer = fs.readFileSync(report.pdf);
      await saveReport({
        schoolId,
        classroomId,
        termId,
        studentId: null,
        pdfBuffer,
        filename: require("path").basename(report.pdf),
        generatedByUserId: req.session?.user?.id,
      });
    } catch (persistErr) {
      // A failure to persist shouldn't block the admin from getting the
      // PDF they just asked for — log it and continue.
      console.error("Failed to persist class report:", persistErr);
    }

    return res.download(report.pdf);
  } catch (err) {
    console.error(err);

    return res.status(500).send(err.stack);
  }
}

async function downloadStudentReport(req, res) {
  const { schoolId, classroomId, termId, studentId } = req.params;

  try {
    const report = await generateStudentReport(
      schoolId,
      classroomId,
      termId,
      studentId,
    );

    try {
      const pdfBuffer = fs.readFileSync(report.pdf);
      await saveReport({
        schoolId,
        classroomId,
        termId,
        studentId,
        pdfBuffer,
        filename: require("path").basename(report.pdf),
        generatedByUserId: req.session?.user?.id,
      });
    } catch (persistErr) {
      console.error("Failed to persist student report:", persistErr);
    }

    return res.download(report.pdf);
  } catch (err) {
    console.error(err);
    return res.status(500).send(err.stack);
  }
}

module.exports = {
  downloadClassReport,
  downloadStudentReport,
  checkClassReportExists,
  checkStudentReportExists,
};
