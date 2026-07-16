function buildCoverPage(report) {
  const { school, classroom, term } = report;

  return `

<div class="cover-page">

    ${
      school.logo_url
        ? `<img class="school-logo" src="${school.logo_url}" />`
        : ""
    }

    <h1 class="school-name">
        ${school.name}
    </h1>

    <h2 class="report-title">
        TERM PERFORMANCE REPORT
    </h2>

    <table class="cover-table">

        <tr>
            <td><strong>Academic Term</strong></td>
            <td>${term.name}</td>
        </tr>

        <tr>
            <td><strong>Class</strong></td>
            <td>${classroom.name}</td>
        </tr>

        <tr>
            <td><strong>Prepared On</strong></td>
            <td>${new Date().toLocaleDateString()}</td>
        </tr>

    </table>

</div>

<div class="page-break"></div>

`;
}

module.exports = {
  buildCoverPage,
};
