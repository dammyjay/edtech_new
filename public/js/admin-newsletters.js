// const recipientType = document.getElementById("recipientType");
// const recipientArea = document.getElementById("recipientSelectionArea");

// recipientType.addEventListener("change", async () => {
//   recipientArea.innerHTML = "";

//   switch (recipientType.value) {
//     case "schools":
//       loadSchools();
//       break;

//     case "classrooms":
//       loadSchoolSelector();
//       break;

//     case "courses":
//       loadCourses();
//       break;

//     case "custom":
//       loadUserSearch();
//       break;
//   }
// });

let recipientType;
let recipientArea;

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded");

  recipientType = document.getElementById("recipientType");
  recipientArea = document.getElementById("recipientSelectionArea");

  console.log(recipientType);
  console.log(recipientArea);

  //   recipientType.addEventListener("change", () => {
  //     console.log("Selected:", recipientType.value);

  //     recipientArea.innerHTML = "";

  //     switch (recipientType.value) {
  //       case "schools":
  //         loadSchools();
  //         break;

  //       case "classrooms":
  //         loadSchoolSelector();
  //         break;

  //       case "courses":
  //         loadCourses();
  //         break;

  //       case "custom":
  //         loadUserSearch();
  //         break;
  //     }
  //   });

  recipientType.addEventListener("change", () => {
    console.log("Selected:", recipientType.value);

    recipientArea.innerHTML = "";

    switch (recipientType.value) {
      case "all":
        loadAudienceSummary("all");
        break;

      case "users":
        loadAudienceSummary("users");
        break;

      case "parents":
        loadAudienceSummary("parents");
        break;

      case "teachers":
        loadAudienceSummary("teachers");
        break;

      case "students":
        loadAudienceSummary("students");
        break;

      case "school_admins":
        loadAudienceSummary("school_admins");
        break;

      case "admins":
        loadAudienceSummary("admins");
        break;

      case "schools":
        loadSchools();
        break;

      case "classrooms":
        loadSchoolSelector();
        break;

      case "courses":
        loadCourses();
        break;

      case "custom":
        loadUserSearch();
        break;
    }
  });
});

async function loadSchools() {
  const res = await fetch("/admin/newsletters/schools");

  const schools = await res.json();

  let html = `
        <label>Select Schools</label>
    `;

  schools.forEach((s) => {
    html += `

            <label class="checkbox-item">

                <input
                    type="checkbox"
                    name="recipient_ids"
                    value="${s.id}">

                ${s.name}

            </label>

        `;
  });

  recipientArea.innerHTML = html;
}

async function loadSchoolSelector() {
  const res = await fetch("/admin/newsletters/schools");

  const schools = await res.json();

  let html = `

        <label>Select School</label>

        <select id="schoolSelector">

            <option value="">Choose School</option>

    `;

  schools.forEach((s) => {
    html += `
            <option value="${s.id}">
                ${s.name}
            </option>
        `;
  });

  html += `</select>

    <div id="classroomContainer"></div>`;

  recipientArea.innerHTML = html;

  document
    .getElementById("schoolSelector")
    .addEventListener("change", loadClassrooms);
}

async function loadClassrooms() {
  const schoolId = this.value;

  if (!schoolId) return;

  const res = await fetch(`/admin/newsletters/classrooms/${schoolId}`);

  const classrooms = await res.json();

  let html = `
        <label>Select Classroom(s)</label>
    `;

  classrooms.forEach((c) => {
    html += `

            <label class="checkbox-item">

                <input
                    type="checkbox"
                    name="recipient_ids"
                    value="${c.id}">

                ${c.name}

            </label>

        `;
  });

  document.getElementById("classroomContainer").innerHTML = html;
}

async function loadCourses() {
  const res = await fetch("/admin/newsletters/courses");

  const courses = await res.json();

  let html = `
        <label>Select Course(s)</label>
    `;

  courses.forEach((c) => {
    html += `

            <label class="checkbox-item">

                <input
                    type="checkbox"
                    name="recipient_ids"
                    value="${c.id}">

                ${c.title}

            </label>

        `;
  });

  recipientArea.innerHTML = html;
}

function loadUserSearch() {
  recipientArea.innerHTML = `

        <label>Search Users</label>

        <input
            type="text"
            id="userSearch"
            placeholder="Search by name or email">

        <div id="userResults"></div>

    `;

  document.getElementById("userSearch").addEventListener("keyup", searchUsers);
}

async function searchUsers() {
  const keyword = this.value.trim();

  if (keyword.length < 2) {
    document.getElementById("userResults").innerHTML = "";

    return;
  }

  const res = await fetch(
    `/admin/newsletters/users/search?search=${encodeURIComponent(keyword)}`,
  );

  const users = await res.json();

  let html = "";

  users.forEach((user) => {
    html += `

            <label class="checkbox-item">

                <input
                    type="checkbox"
                    name="recipient_ids"
                    value="${user.id}">

                ${user.fullname}
                (${user.email})

            </label>

        `;
  });

  document.getElementById("userResults").innerHTML = html;
}

async function loadAudienceSummary(type) {
  const res = await fetch(`/admin/newsletters/audience/${type}`);

  const data = await res.json();

  recipientArea.innerHTML = `

        <div class="audience-summary">

            <h4>${data.title}</h4>

            <p>

                <strong>${data.count}</strong>

                recipients will receive this newsletter.

            </p>

        </div>

    `;
}