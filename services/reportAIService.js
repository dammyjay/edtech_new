// services/reportAIService.js

const { askTutor } = require("../utils/ai");

/* ==========================================================
   OVERALL CLASS AI REPORT
========================================================== */

async function generateAIReport(reportData) {
  const prompt = `
You are an educational data analyst.

Generate a professional term report.

DATA:
${JSON.stringify(reportData, null, 2)}

Provide detailed insights and recommendations based on the data.:

1. Executive Summary
2. Key Insights
3. Risks
4. Recommendations

Return ONLY JSON.

{
  "summary":"",
  "insights":[],
  "risks":[],
  "recommendations":[]
}
`;
  
    const result = await askTutor({
      question: prompt,
    });

    let cleaned = result
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end !== -1) {
      cleaned = cleaned.substring(start, end + 1);
    }

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.error("AI JSON parse failed");
      console.error(cleaned);

      return {
        summary: "Unable to generate AI executive summary.",
        insights: [],
        risks: [],
        recommendations: [],
      };
    }
}

/* ==========================================================
   INDIVIDUAL STUDENT AI COMMENT
========================================================== */

async function generateStudentComment(student) {
  const prompt = `
You are an experienced classroom teacher.

Write a professional and detailed end-of-term report comment.

Student Information

Name:
${student.fullname}

Attendance:
${student.attendance.attendanceRate}%

XP:
${student.xp.totalXP}

Quiz Average:
${
  Object.values(student.quizzes).reduce((a, b) => a + b.score, 0) /
  Math.max(Object.keys(student.quizzes).length, 1)
}

Assignment Average:
${
  Object.values(student.assignments).reduce((a, b) => a + b.percentage, 0) /
  Math.max(Object.keys(student.assignments).length, 1)
}

Course Progress:
${
  Object.values(student.courses).reduce((a, b) => a + b.progress, 0) /
  Math.max(Object.keys(student.courses).length, 1)
}

Badges:
${Object.keys(student.badges).length}

Certificates:
${Object.keys(student.certificates).length}

Return ONLY JSON.

{
  "teacherComment":"",
  "strengths":[],
  "improvements":[],
  "nextTermGoals":[]
}
`;

  const response = await askTutor({
    question: prompt,
  });

  const jsonMatch = response.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return {
    teacherComment: "",
    strengths: [],
    improvements: [],
    nextTermGoals: [],
  };
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
  generateAIReport,
  generateStudentComment,
};
