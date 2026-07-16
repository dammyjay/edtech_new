const fs = require("fs");
const path = require("path");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const width = 900;
const height = 500;

const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width,
  height,
  backgroundColour: "white",
});

const chartFolder = path.join(__dirname, "../temp/charts");

if (!fs.existsSync(chartFolder)) {
  fs.mkdirSync(chartFolder, { recursive: true });
}

async function saveChart(filename, configuration) {
  const image = await chartJSNodeCanvas.renderToBuffer(configuration);

  const filePath = path.join(chartFolder, filename);

  fs.writeFileSync(filePath, image);

  return filePath;
}

async function generateAttendanceChart(attendance) {
  return saveChart("attendance.png", {
    type: "pie",

    data: {
      labels: ["Present", "Absent", "Late"],

      datasets: [
        {
          data: [attendance.present, attendance.absent, attendance.late],
        },
      ],
    },

    options: {
      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

async function generateWeeklyAttendanceChart(attendance) {
  return saveChart("attendanceTrend.png", {
    type: "line",

    data: {
      labels: attendance.weeklyTrend.map((w) => `Week ${w.week_number}`),

      datasets: [
        {
          label: "Present",

          data: attendance.weeklyTrend.map((w) => Number(w.present)),

          fill: false,
        },
      ],
    },

    options: {
      responsive: false,

      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

async function generateCourseChart(courses) {
  return saveChart("courseCompletion.png", {
    type: "bar",

    data: {
      labels: courses.courses.map((c) => c.title),

      datasets: [
        {
          label: "Average Completion %",

          data: courses.courses.map((c) => c.averageCompletion),
        },
      ],
    },

    options: {
      indexAxis: "y",

      responsive: false,
    },
  });
}

async function generateXPChart(xp) {
  return saveChart("xpRanking.png", {
    type: "bar",

    data: {
      labels: xp.rankings.map((s) => s.fullname),

      datasets: [
        {
          label: "XP",

          data: xp.rankings.map((s) => s.xp),
        },
      ],
    },

    options: {
      responsive: false,
    },
  });
}

async function generateBadgeChart(badges) {
  return saveChart("badgeDistribution.png", {
    type: "doughnut",

    data: {
      labels: Object.keys(badges.badgeCounts),

      datasets: [
        {
          data: Object.values(badges.badgeCounts),
        },
      ],
    },

    options: {
      responsive: false,

      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

async function generateCharts(reportData) {
  const attendanceChart = await generateAttendanceChart(reportData.attendance);

  const attendanceTrend = await generateWeeklyAttendanceChart(
    reportData.attendance,
  );

  const courseChart = await generateCourseChart(reportData.courses);

  const xpChart = await generateXPChart(reportData.xp);

  const badgeChart = await generateBadgeChart(reportData.badges);

  return {
    attendanceChart,

    attendanceTrend,

    courseChart,

    xpChart,

    badgeChart,
  };
}

module.exports = {
  generateCharts,
};