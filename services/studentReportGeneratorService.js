async function generateStudentReport(schoolId, classroomId, termId, studentId) {
  const analytics = await getStudentTermAnalytics(
    schoolId,
    classroomId,
    termId,
    studentId,
  );

  analytics.aiSummary = await generateStudentAIReport(analytics);

  analytics.charts = await generateStudentCharts(analytics);

  const html = await buildStudentReportHTML(analytics);

  const pdf = await generatePDF(html, `Student-${studentId}.pdf`);

  return {
    analytics,
    html,
    pdf,
  };
}
