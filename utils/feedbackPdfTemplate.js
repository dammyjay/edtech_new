// module.exports = function buildFeedbackPDF(feedback) {
//   return `
//   <html>
//   <head>
//     <meta charset="utf-8">
//     <style>
//       body {
//         font-family: Arial, sans-serif;
//         padding: 30px;
//         color: #2c3e50;
//       }
//       h1 {
//         text-align: center;
//         color: #34495e;
//       }
//       h3 { color: #2980b9; }

//       table {
//         width: 100%;
//         border-collapse: collapse;
//         margin-top: 20px;
//         font-size: 12px;
//       }

//       th, td {
//         border: 1px solid #ddd;
//         padding: 8px;
//       }

//       th {
//         background: #2c3e50;
//         color: white;
//         text-align: left;
//       }

//       tr:nth-child(even) { background: #f9f9f9; }

//       .summary-boxes {
//         display: flex;
//         flex-wrap: wrap;
//         gap: 15px;
//         margin-top: 20px;
//       }

//       .box {
//         background: #ecf0f1;
//         padding: 15px;
//         border-radius: 8px;
//         width: 160px;
//       }

//       .footer {
//         font-size: 10px;
//         margin-top: 40px;
//         text-align: center;
//         color: gray;
//       }
//     </style>
//   </head>

//   <body>

//     <h1>📄 Feedback Report</h1>
//     <p style="text-align:center;color:gray;">Generated on: ${new Date().toLocaleString()}</p>

//     <h3>Summary Statistics</h3>

//     <div class="summary-boxes">
//       <div class="box"><strong>Total Feedback:</strong> ${feedback.length}</div>
//       <div class="box"><strong>Average Rating:</strong> ${(
//         feedback.reduce((a, x) => a + (x.rating || 0), 0) / feedback.length
//       ).toFixed(1)}</div>
//       <div class="box"><strong>Students:</strong> ${
//         feedback.filter((x) => x.user_type === "student").length
//       }</div>
//       <div class="box"><strong>Teachers:</strong> ${
//         feedback.filter((x) => x.user_type === "teacher").length
//       }</div>
//       <div class="box"><strong>Parents:</strong> ${
//         feedback.filter((x) => x.user_type === "parent").length
//       }</div>
//       <div class="box"><strong>School Owners:</strong> ${
//         feedback.filter((x) => x.user_type === "school_owner").length
//       }</div>
//       <div class="box"><strong>Organizations:</strong> ${
//         feedback.filter((x) => x.user_type === "organization").length
//       }</div>
//     </div>

//     <h3 style="margin-top:35px;">All Feedback Entries</h3>

//     <table>
//       <tr>
//         <th>Type</th>
//         <th>Name</th>
//         <th>Email</th>
//         <th>Rating</th>
//         <th>Sentiment</th>
//         <th>Message</th>
//         <th>Date</th>
//         <th>Published</th>
//       </tr>

//       ${feedback
//         .map(
//           (f) => `
//         <tr>
//           <td>${f.user_type}</td>
//           <td>${f.name}</td>
//           <td>${f.email || ""}</td>
//           <td>${f.rating || "—"}</td>
//           <td>${f.sentiment_label || "—"}</td>
//           <td>${f.message}</td>
//           <td>${new Date(f.created_at).toLocaleDateString()}</td>
//           <td>${f.is_published ? "Yes" : "No"}</td>
//         </tr>
//       `
//         )
//         .join("")}

//     </table>

//     <div class="footer">© ${new Date().getFullYear()} Feedback Report</div>

//   </body>
//   </html>`;
// };


module.exports = function buildFeedbackPDF(feedback) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 25px;
        background: #f4f6f8;
        color: #2c3e50;
      }

      h1 {
        text-align: center;
        margin-bottom: 5px;
      }

      .date {
        text-align: center;
        font-size: 11px;
        color: gray;
        margin-bottom: 20px;
      }

      /* ===== SUMMARY ===== */
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 25px;
      }

      .box {
        background: white;
        border-radius: 10px;
        padding: 12px;
        width: 150px;
        box-shadow: 0 3px 8px rgba(0,0,0,.1);
        font-size: 12px;
      }

      /* ===== GRID ===== */
      .grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 15px;
      }

      .card {
        background: white;
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,.12);
        page-break-inside: avoid;
      }

      /* ===== BADGES ===== */
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 10px;
        color: white;
        margin-bottom: 6px;
      }

      .student { background:#007bff; }
      .teacher { background:#28a745; }
      .parent { background:#17a2b8; }
      .school_owner { background:#6f42c1; }
      .organization { background:#fd7e14; }

      /* ===== STARS ===== */
      .stars {
        color: #f1c40f;
        font-size: 14px;
        margin: 4px 0;
      }

      /* ===== SENTIMENT ===== */
      .positive { color:#28a745; }
      .neutral { color:#6c757d; }
      .negative { color:#dc3545; }

      .message {
        // background:#f3f4f6;
        padding:10px;
        border-radius:6px;
        margin:8px 0;
        font-size:12px;
      }

      .footer {
        text-align:center;
        font-size:10px;
        color:gray;
        margin-top:30px;
      }
    </style>
  </head>

  <body>

    <h1>📄 Feedback Report</h1>
    <div class="date">Generated on ${new Date().toLocaleString()}</div>

    <!-- SUMMARY -->
    <div class="summary">
      <div class="box"><strong>Total:</strong> ${feedback.length}</div>
      <div class="box"><strong>Avg Rating:</strong> ${(
        feedback.reduce((a,f)=>a+(f.rating||0),0) / (feedback.length || 1)
      ).toFixed(1)} ⭐</div>
      <div class="box"><strong>Students:</strong> ${feedback.filter(f=>f.user_type==="student").length}</div>
      <div class="box"><strong>Teachers:</strong> ${feedback.filter(f=>f.user_type==="teacher").length}</div>
      <div class="box"><strong>Parents:</strong> ${feedback.filter(f=>f.user_type==="parent").length}</div>
      <div class="box"><strong>Organizations:</strong> ${feedback.filter(f=>f.user_type==="organization").length}</div>
    </div>

    <!-- FEEDBACK CARDS -->
    <div class="grid">
      ${feedback.map(f => `
        <div class="card">
          <span class="badge ${f.user_type}">
            ${f.user_type.replace("_"," ")}
          </span>

          <div class="stars">
            ${"★".repeat(f.rating || 0)}${"☆".repeat(5 - (f.rating || 0))}
          </div>

          <strong>${f.name}</strong><br/>
          <small>${f.email || ""}</small>

          <div class="message">
            ${f.message}
          </div>

          <small class="${f.sentiment_label}">
            ${f.sentiment_label || "—"} ${f.sentiment_score ? `(${f.sentiment_score})` : ""}
          </small><br/>

          <small>
            ${new Date(f.created_at).toLocaleDateString()} · 
            ${f.is_published ? "Published" : "Unpublished"}
          </small>
        </div>
      `).join("")}
    </div>

    <div class="footer">
      © ${new Date().getFullYear()} Feedback Report
    </div>

  </body>
  </html>
  `;
};

