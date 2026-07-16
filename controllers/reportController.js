const { generateClassReport } = require("../services/reportGeneratorService");

async function downloadClassReport(req, res) {
  const { schoolId, classroomId, termId } = req.params;

  try {
    const report = await generateClassReport(schoolId, classroomId, termId);

    return res.download(report.pdf);
  } catch (err) {
    console.error(err);

    return res.status(500).send(err.stack);
  }
}

module.exports = {
  downloadClassReport,
};