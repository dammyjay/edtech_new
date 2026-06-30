// ======================================================
// Admin Announcements
// Part 1
// ======================================================

// ------------------------------
// Global Variables
// ------------------------------

let announcements = [];
let editingAnnouncementId = null;
let announcementEditor = null;
let allAnnouncements = [];

// ------------------------------
// DOM Elements
// ------------------------------

const tableBody = document.querySelector("#announcementTable tbody");

const searchInput = document.getElementById("announcementSearch");

const statusFilter = document.getElementById("statusFilter");

const newAnnouncementBtn = document.getElementById("newAnnouncementBtn");

const announcementModal =
    document.getElementById("announcementModal");

const announcementForm =
    document.getElementById("announcementForm");

const modalTitle =
    document.getElementById("modalTitle");

const imageInput =
    document.getElementById("image");

const imagePreview =
    document.getElementById("imagePreview");

const saveBtn =
    document.getElementById("saveAnnouncementBtn");

const loadingSpinner =
    document.getElementById("announcementLoading");



// ======================================================
// INITIALIZATION
// ======================================================


document.addEventListener("DOMContentLoaded", () => {

    initializeCKEditor();

    loadAnnouncements();

    bindEvents();

    announcementForm.addEventListener("submit", async function(e){

        e.preventDefault();

        // Sync CKEditor back to textarea
        if (CKEDITOR.instances.message) {
            CKEDITOR.instances.message.updateElement();
        }

        const formData = new FormData(this);

        console.log("Title:", formData.get("title"));
        console.log("Message:", formData.get("message"));

        for (const [key, value] of formData.entries()) {
            console.log(key, value);
        }

        const url = editingAnnouncementId
            ? `/admin/announcements/${editingAnnouncementId}`
            : "/admin/announcements/create";

        const method = editingAnnouncementId
            ? "PUT"
            : "POST";

        const response = await fetch(url,{
            method,
            body:formData
        });

        const data = await response.json();
        if (data.success) {
    document.getElementById("announcementModal").classList.remove("show");
    // or however you close your modal
        closeModal()
        location.reload();
    }

        alert(data.message);

        closeModal();

        loadAnnouncements();

    });

});



// ======================================================
// CKEDITOR
// ======================================================

function initializeCKEditor() {

    if (CKEDITOR.instances.message) {

        CKEDITOR.instances.message.destroy(true);

    }

    announcementEditor = CKEDITOR.replace(
        "message",
        {
            height: 250
        }
    );

}



// ======================================================
// LOAD ANNOUNCEMENTS
// ======================================================

async function loadAnnouncements() {

    showLoading(true);

    try {

        const response = await fetch(
            "/admin/announcements/all"
        );

        if (!response.ok)
            throw new Error("Failed to load announcements");

        announcements = await response.json();

        renderAnnouncements(announcements);

    }

    catch (err) {

        console.error(err);

        showToast(
            "Unable to load announcements",
            "error"
        );

    }

    finally {

        showLoading(false);

    }

}

// ======================================================
// VIEW ANNOUNCEMENTS
// ======================================================
async function viewAnnouncement(id){

    try{

        const res = await fetch(`/admin/announcements/${id}`);

        const data = await res.json();

        if(!data.success){
            return alert(data.message);
        }

        const a = data.announcement;

        alert(
            `Title: ${a.title}\n\n${a.message.replace(/<[^>]+>/g,"")}`
        );

    }catch(err){

        console.error(err);

    }

}

// ======================================================
// EDIT ANNOUNCEMENTS
// ======================================================

async function editAnnouncement(id){

    try{

        const res = await fetch(`/admin/announcements/${id}`);

        const data = await res.json();

        if(!data.success){
            return alert(data.message);
        }

        const a = data.announcement;

        editingAnnouncementId = id;

        modalTitle.innerText = "Edit Announcement";

        document.getElementById("title").value = a.title;

        CKEDITOR.instances.message.setData(a.message);

        document.getElementById("type").value = a.type;

        document.getElementById("priority").value = a.priority;

        if(a.image_url){

            imagePreview.src = a.image_url;

            imagePreview.style.display = "block";

        }

        openModal();

    }catch(err){

        console.error(err);

    }

}

// ======================================================
// RENDER TABLE
// ======================================================

function renderAnnouncements(data) {

    tableBody.innerHTML = "";

    if (data.length === 0) {

        tableBody.innerHTML = `
            <tr>

                <td colspan="8" class="text-center">

                    No announcements found

                </td>

            </tr>
        `;

        return;

    }

    data.forEach(item => {

        tableBody.innerHTML += `

<tr>

<td>

${
item.image_url
?

`<img
src="${item.image_url}"
class="announcement-thumb">`

:

`<span class="text-muted">No Image</span>`

}

</td>

<td>

<strong>${item.title}</strong>

</td>

<td>

${item.type}

</td>

<td>

<span class="priority ${item.priority}">

${item.priority}

</span>

</td>

<td>

<span class="status ${item.status}">

${item.status}

</span>

</td>

<td>

${item.audience_type || "Everyone"}

</td>

<td>

${item.views || 0}

</td>

<td>

<div class="action-buttons">

<button
class="btn-view"
onclick="viewAnnouncement(${item.id})">

<i class="fas fa-eye"></i>

</button>

<button
class="btn-edit"
onclick="editAnnouncement(${item.id})">

<i class="fas fa-edit"></i>

</button>

<button
class="btn-success"
onclick="publishAnnouncement(${item.id})">

<i class="fas fa-upload"></i>

</button>

<button
class="btn-warning"
onclick="archiveAnnouncement(${item.id})">

<i class="fas fa-archive"></i>

</button>

<button
class="btn-danger"
onclick="deleteAnnouncement(${item.id})">

<i class="fas fa-trash"></i>

</button>

</div>

</td>

</tr>

`;

    });

}



// ======================================================
// SEARCH
// ======================================================

searchInput.addEventListener("keyup", function () {

    const keyword =
        this.value.toLowerCase();

    const filtered =
        announcements.filter(item =>

            item.title
                .toLowerCase()
                .includes(keyword)

            ||

            item.message
                .toLowerCase()
                .includes(keyword)

        );

    renderAnnouncements(filtered);

});



// ======================================================
// STATUS FILTER
// ======================================================

statusFilter.addEventListener("change", function () {

    const value = this.value;

    if (!value) {

        renderAnnouncements(announcements);

        return;

    }

    const filtered =
        announcements.filter(a =>

            a.status === value

        );

    renderAnnouncements(filtered);

});



// ======================================================
// NEW ANNOUNCEMENT
// ======================================================

newAnnouncementBtn.addEventListener("click", () => {

    console.log("Button clicked");

    editingAnnouncementId = null;

    resetForm();

    modalTitle.innerText = "Create Announcement";

    openModal();

});



// ======================================================
// IMAGE PREVIEW
// ======================================================

imageInput.addEventListener("change", function () {

    if (!this.files.length)
        return;

    const reader =
        new FileReader();

    reader.onload = e => {

        imagePreview.src =
            e.target.result;

        imagePreview.style.display =
            "block";

    };

    reader.readAsDataURL(this.files[0]);

});



// ======================================================
// RESET FORM
// ======================================================

function resetForm() {

    announcementForm.reset();

    imagePreview.src = "";

    imagePreview.style.display =
        "none";

    if (announcementEditor) {

        announcementEditor.setData("");

    }

}



// ======================================================
// MODAL
// ======================================================

function openModal() {

    announcementModal.style.display =
        "flex";

}

function closeModal() {

    announcementModal.style.display =
        "none";

}



// ======================================================
// EVENTS
// ======================================================

function bindEvents() {

    document
        .querySelectorAll(".closeModal")
        .forEach(btn => {

            btn.addEventListener(
                "click",
                closeModal
            );

        });

}



// ======================================================
// LOADING
// ======================================================

function showLoading(show) {

    if (!loadingSpinner)
        return;

    loadingSpinner.style.display =
        show
            ? "flex"
            : "none";

}



// ======================================================
// TOAST PLACEHOLDER
// ======================================================

function showToast(message, type = "success") {

    console.log(type, message);

}

// ==========================================
// LOAD ANNOUNCEMENTS
// ==========================================

// async function loadAnnouncements() {
//     try {

//         const res = await fetch("/admin/announcements/all");

//         const announcements = await res.json();

//         allAnnouncements = announcements;

//         renderAnnouncements();

//     } catch (err) {

//         console.error(err);

//         alert("Failed to load announcements");

//     }
// }

// ==========================================
// RENDER TABLE
// ==========================================

// function renderAnnouncements() {

//     const tbody = document.querySelector("#announcementTable tbody");

//     tbody.innerHTML = "";

//     const keyword = searchInput.value.toLowerCase();

//     const status = statusFilter.value;

//     const filtered = allAnnouncements.filter(a => {

//         const matchesSearch =
//             a.title.toLowerCase().includes(keyword) ||
//             a.message.toLowerCase().includes(keyword);

//         const matchesStatus =
//             !status || a.status === status;

//         return matchesSearch && matchesStatus;

//     });

//     if (!filtered.length) {

//         tbody.innerHTML = `
//             <tr>
//                 <td colspan="8" style="text-align:center;padding:30px;">
//                     No announcements found.
//                 </td>
//             </tr>
//         `;

//         return;
//     }

//     filtered.forEach(item => {

//         tbody.innerHTML += `

// <tr>

// <td>

// ${
// item.image_url
// ?
// `<img src="${item.image_url}"
// style="width:60px;height:40px;object-fit:cover;border-radius:6px;">`
// :
// "-"
// }

// </td>

// <td>

// <strong>${item.title}</strong><br>

// <small>${item.created_at || ""}</small>

// </td>

// <td>

// ${item.type}

// </td>

// <td>

// <span class="priority priority-${item.priority}">
// ${item.priority}
// </span>

// </td>

// <td>

// ${statusBadge(item.status)}

// </td>

// <td>

// ${item.audience_type || "Everyone"}

// </td>

// <td>

// ${item.views || 0}

// </td>

// <td>

// <button
// class="editBtn"
// data-id="${item.id}">
// Edit
// </button>

// <button
// class="publishBtn"
// data-id="${item.id}">
// Publish
// </button>

// <button
// class="archiveBtn"
// data-id="${item.id}">
// Archive
// </button>

// <button
// class="deleteBtn"
// data-id="${item.id}">
// Delete
// </button>

// </td>

// </tr>

// `;

//     });

// }

// ==========================================
// STATUS BADGE
// ==========================================

function statusBadge(status) {

    let color = "#888";

    switch (status) {

        case "published":
            color = "#16a34a";
            break;

        case "draft":
            color = "#f59e0b";
            break;

        case "scheduled":
            color = "#2563eb";
            break;

        case "expired":
            color = "#dc2626";
            break;

        case "archived":
            color = "#6b7280";
            break;
    }

    return `
        <span
            style="
                background:${color};
                color:white;
                padding:4px 10px;
                border-radius:20px;
                font-size:12px;
            ">
            ${status}
        </span>
    `;
}


// ==========================================
// PUBLISH
// ==========================================

async function publishAnnouncement(id) {

    if (!confirm("Publish this announcement?")) return;

    try {

        const res = await fetch(
            `/admin/announcements/${id}/publish`,
            {
                method: "POST"
            }
        );

        const data = await res.json();

        alert(data.message);

        loadAnnouncements();

    } catch (err) {

        console.error(err);

        alert("Unable to publish announcement.");

    }

}


// ==========================================
// ARCHIVE
// ==========================================

async function archiveAnnouncement(id) {

    if (!confirm("Archive this announcement?")) return;

    try {

        const res = await fetch(
            `/admin/announcements/${id}/archive`,
            {
                method: "POST"
            }
        );

        const data = await res.json();

        alert(data.message);

        loadAnnouncements();

    } catch (err) {

        console.error(err);

        alert("Unable to archive announcement.");

    }

}


// ==========================================
// DELETE
// ==========================================

async function deleteAnnouncement(id) {

    if (!confirm("Delete this announcement permanently?")) return;

    try {

        const res = await fetch(
            `/admin/announcements/${id}`,
            {
                method: "DELETE"
            }
        );

        const data = await res.json();

        alert(data.message);

        loadAnnouncements();

    } catch (err) {

        console.error(err);

        alert("Unable to delete announcement.");

    }

}


// ==========================================
// TABLE BUTTON EVENTS
// ==========================================

document
.querySelector("#announcementTable")
.addEventListener("click", function(e){

    const id = e.target.dataset.id;

    if(!id) return;

    // Edit

    if(e.target.classList.contains("editBtn")){

        window.location.href =
        `/admin/announcements/edit/${id}`;

    }

    // Publish

    if(e.target.classList.contains("publishBtn")){

        publishAnnouncement(id);

    }

    // Archive

    if(e.target.classList.contains("archiveBtn")){

        archiveAnnouncement(id);

    }

    // Delete

    if(e.target.classList.contains("deleteBtn")){

        deleteAnnouncement(id);

    }

});


// ==========================================
// SEARCH
// ==========================================

searchInput.addEventListener("keyup", function(){

    renderAnnouncements();

});


// ==========================================
// FILTER
// ==========================================

statusFilter.addEventListener("change", function(){

    renderAnnouncements();

});



// ==========================================
// INITIAL LOAD
// ==========================================

loadAnnouncements();