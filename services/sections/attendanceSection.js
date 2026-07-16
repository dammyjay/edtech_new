function buildAttendanceSection(report) {
  const { attendance, charts } = report;

  return `

<div class="page">

<h1 class="page-title">

Attendance Dashboard

</h1>

<div class="chart">

<h2>Attendance Distribution</h2>

<img
class="chart-image"
src="${charts.attendancePie}"
>

</div>

<div class="chart">

<h2>Weekly Attendance Trend</h2>

<img
class="chart-image"
src="${charts.weeklyAttendance}"
>

</div>

<h2>

Attendance Summary

</h2>

<table class="report-table">

<tr>

<th>Total Sessions</th>

<th>Held</th>

<th>Holiday</th>

<th>Cancelled</th>

<th>No Class</th>

</tr>

<tr>

<td>${attendance.totalSessions}</td>

<td>${attendance.heldSessions}</td>

<td>${attendance.holidaySessions}</td>

<td>${attendance.cancelledSessions}</td>

<td>${attendance.noClassSessions}</td>

</tr>

</table>

<br>

<table class="report-table">

<tr>

<th>Present</th>

<th>Absent</th>

<th>Late</th>

<th>Attendance Rate</th>

</tr>

<tr>

<td>${attendance.present}</td>

<td>${attendance.absent}</td>

<td>${attendance.late}</td>

<td>${attendance.attendanceRate}%</td>

</tr>

</table>

</div>

<div class="page-break"></div>

`;
}

module.exports = {
  buildAttendanceSection,
};
