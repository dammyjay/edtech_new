

let recipientType;
let recipientArea;

let selectedUsers = [];

let loadedAudienceUsers = [];

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded");

  recipientType = document.getElementById("recipientType");
  recipientArea = document.getElementById("recipientSelectionArea");

  console.log(recipientType);
  console.log(recipientArea);

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

// async function loadAudienceSummary(type) {
//   const res = await fetch(`/admin/newsletters/audience/${type}`);

//   const data = await res.json();

//   recipientArea.innerHTML = `

//         <div class="audience-summary">

//             <h4>${data.title}</h4>

//             <p>

//                 <strong>${data.count}</strong>

//                 recipients will receive this newsletter.

//             </p>

//         </div>

//     `;
// }

async function loadAudienceSummary(type) {

    const res = await fetch(`/admin/newsletters/audience/${type}`);

    const data = await res.json();

    recipientArea.innerHTML = `

        <div class="audience-summary">

            <h4>${data.title}</h4>

            <p>

                <strong>${data.count}</strong>

                recipients found.

            </p>

            <button
                type="button"
                class="btn-pri"
                onclick="loadAudienceUsers('${type}')">

                View & Select Recipients

            </button>

        </div>

    `;

}

// async function loadAudienceUsers(type) {

//     try {

//         // Read any selected IDs (schools, classrooms, courses, etc.)
//         let ids = [];

//         document
//             .querySelectorAll('input[name="recipient_ids"]:checked')
//             .forEach(box => ids.push(box.value));

//         // Fetch users
//         const res = await fetch(
//             `/admin/newsletters/audience-users/${type}?ids=${ids.join(",")}`
//         );

//         loadedAudienceUsers = await res.json();

//         // Clear previous selection
//         selectedUsers = [];

//         // Update title
//         document.getElementById("audienceTitle").innerText =
//             `Select ${loadedAudienceUsers.length} Recipient(s)`;

//         // Render list
//         renderAudienceUsers();

//         // Open modal
//         openAudienceModal();

//     } catch (err) {

//         console.error(err);

//         alert("Unable to load recipients.");

//     }

// }

window.loadAudienceUsers = async function(type) {

    try {

        let ids = [];

        document
        .querySelectorAll('input[name="recipient_ids"]:checked')
        .forEach(box => ids.push(box.value));

        // const res = await fetch(
        //     `/admin/newsletters/audience-users/${type}?ids=${ids.join(",")}`
        // );
        const res = await fetch(
            `/admin/newsletters/audience/${type}/users?ids=${ids.join(",")}`
        );

        loadedAudienceUsers = await res.json();

        // selectedUsers = [];
        // Preserve previous selections
        const previous =
          document.getElementById("selectedRecipientIds").value;

        selectedUsers = previous
            ? previous.split(",").map(Number)
            : [];

        document.getElementById("audienceTitle").innerText =
            `Select ${loadedAudienceUsers.length} Recipient(s)`;

        renderAudienceUsers();

        openAudienceModal();

    } catch(err){

        console.error(err);

    }

}

function renderAudienceUsers(search=""){

    const container =
    document.getElementById("audienceUserList");

    container.innerHTML="";

    const keyword = search.toLowerCase();

    loadedAudienceUsers
    .filter(user=>{

        return user.fullname.toLowerCase().includes(keyword)

        || user.email.toLowerCase().includes(keyword);

    })

    .forEach(user=>{

        container.innerHTML +=`

        <label class="audience-user">

            <input
                type="checkbox"
                class="audience-checkbox"
                value="${user.id}"
                ${selectedUsers.includes(user.id) ? "checked":""}>

            <div>

                <strong>

                    ${user.fullname}

                </strong>

                <br>

                <small>

                    ${user.email}

                </small>

            </div>

        </label>

        `;

    });

    updateAudienceCounter();

    registerAudienceEvents();

}

function registerAudienceEvents(){

    document
    .querySelectorAll(".audience-checkbox")
    .forEach(box=>{

        box.onchange=function(){

            const id = Number(this.value);

            if(this.checked){

                if(!selectedUsers.includes(id)){

                    selectedUsers.push(id);

                }

            }else{

                selectedUsers =
                selectedUsers.filter(x=>x!==id);

            }

            updateAudienceCounter();

        };

    });

}

function updateAudienceCounter(){

    document.getElementById(
        "selectedAudienceCount"
    ).innerText = selectedUsers.length;

}

document
.getElementById("selectAllAudience")
.addEventListener("click",()=>{

    selectedUsers =
    loadedAudienceUsers.map(u=>u.id);

    renderAudienceUsers(
        document.getElementById("audienceSearch").value
    );

});

document
.getElementById("clearAudience")
.addEventListener("click",()=>{

    selectedUsers=[];

    renderAudienceUsers(
        document.getElementById("audienceSearch").value
    );

});

document
.getElementById("audienceSearch")
.addEventListener("keyup",function(){

    renderAudienceUsers(this.value);

});

// document
// .getElementById("saveAudienceSelection")
// .addEventListener("click",()=>{

//     document.getElementById(
//         "selectedRecipientIds"
//     ).value = selectedUsers.join(",");

//     recipientArea.innerHTML = `

//         <div class="audience-summary">

//             <h4>

//                 ${selectedUsers.length}

//                 recipients selected

//             </h4>

//             <button
//                 type="button"
//                 class="btn-pri"
//                 onclick="openAudienceModal()">

//                 Edit Selection

//             </button>

//         </div>

//     `;

//     closeAudienceModal();

// });

document
.getElementById("saveAudienceSelection")
.addEventListener("click", () => {

    // Save selected user ids
    document.getElementById("selectedRecipientIds").value =
        selectedUsers.join(",");

    // IMPORTANT
    document.getElementById("recipientSelectionMode").value =
        selectedUsers.length > 0
            ? "selected"
            : "all";

    recipientArea.innerHTML = `

        <div class="audience-summary">

            <h4>

                ${selectedUsers.length} recipients selected

            </h4>

            <button
                type="button"
                class="btn-pri"
                onclick="openAudienceModal()">

                Edit Selection

            </button>

        </div>

    `;

    closeAudienceModal();

});

async function viewNewsletter(id){

    const res=await fetch(`/admin/newsletters/${id}`);

    const n=await res.json();

    document.getElementById("viewSubject").innerHTML=n.subject;

    document.getElementById("viewBody").innerHTML=`

        ${
            n.image_url
            ?`<img src="${n.image_url}" style="width:100%;max-height:250px;object-fit:cover;">`
            :""
        }

        <p>${n.preview_text||""}</p>

        <hr>

        ${n.message}

    `;

    openModal("viewNewsletterModal");

}

async function deleteNewsletter(id){

    if(!confirm("Delete this newsletter?")) return;

    const res = await fetch(`/admin/newsletters/${id}`,{
        method:"DELETE"
    });

    if(res.ok){

        location.reload();

    }else{

        alert("Unable to delete newsletter.");

    }

}

const imageInput=document.getElementById("newsletterImage");

const preview=document.getElementById("newsletterPreview");

imageInput.addEventListener("change",function(){

const file=this.files[0];

if(!file){

preview.style.display="none";

return;

}

const reader=new FileReader();

reader.onload=function(e){

preview.src=e.target.result;

preview.style.display="block";

}

reader.readAsDataURL(file);

});

window.openAudienceModal = function(){

    document.getElementById("audienceModal").style.display="flex";

}

window.closeAudienceModal = function(){

    document.getElementById("audienceModal").style.display="none";

}

window.editNewsletter = async function(id){

    try{

        const res = await fetch(`/admin/newsletters/${id}`);

        const newsletter = await res.json();

        // Fill your form

        document.querySelector('[name="subject"]').value =
            newsletter.subject;

        document.querySelector('[name="preview_text"]').value =
            newsletter.preview_text;

        document.querySelector('[name="recipient_type"]').value =
            newsletter.recipient_type;

        document.querySelector('[name="scheduled_at"]').value =
            newsletter.scheduled_at || "";

        CKEDITOR.instances.newsletterEditor.setData(
            newsletter.message
        );

        openModal("createNewsletterModal");

    }catch(err){

        console.error(err);

        alert("Unable to load newsletter.");

    }

};
window.openModal = function(id){

    document.getElementById(id).style.display = "flex";

};