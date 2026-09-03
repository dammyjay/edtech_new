// services/quoteDocumentService.js
//
// One shared place for the branded invoice/receipt PDF a school gets for
// its coding-programme quote — used by BOTH controllers/adminController.js
// (unrestricted) and controllers/schoolAdminController.js (scoped to the
// caller's own school via `schoolId`). The HTML below was moved verbatim
// out of adminController.js's downloadQuotePDF/generateSchoolReceipt (the
// only place this design used to live) — not rewritten — so admin's own
// output is unchanged by this refactor, and school-admin now gets the
// exact same design instead of the separate, plainer one it used to
// generate itself.
//
// Also fixes a real bug that came along with duplicating the query
// instead of sharing it: the old school-admin implementation read
// total_students/total_amount directly off the `quotes` table's stored
// columns, which aren't kept in sync with live enrollment — the query
// below computes them the same way admin's always has, via COUNT/JOIN
// against student_term_enrollments.

const pool = require("../models/db");
const generatePdf = require("../utils/generatePdf");
const sendEmailWithAttachment = require("../utils/sendEmailWithAttachment");
const numberToWords = require("number-to-words");

function buildInvoiceHtml({ q, students, company, total, totalPaid, balance, words, today, firstPayment, secondPayment, midTermDate, examDate }) {
  return `
    <html>
    <head>
    <style>
      body{
          font-family:Calibri;
          margin:0;
          padding:0;
          background:#fff;
      }

      .container{
          width:80%;
          max-width:800px;
          margin:30px auto;
          background:#fff;
          padding:30px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
      }

      .header img {
        width: 70px;
      }

      .header-text {
        text-align: center;
      }

      .title {
        font-weight: bold;
        font-size: 18px;
      }

      .sub {
        font-size: 12px;
      }

      .top {
        display: flex;
        justify-content: space-between;
        margin-top: 30px;
        font-size: 13px;
      }

      .bank {
        text-align: right;
        font-weight: bold;
      }

      .date {
        text-align: right;
        margin-top: 10px;
        font-size: 12px;
      }

      .section-title {
        text-align: right;
        margin-top: 15px;
        color: #b89b5e;
        font-weight: bold;
        font-size: 13px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }

      th {
        background: #b89b5e;
        color: white;
        font-size: 11px;
        padding: 6px;
      }

      td {
        border: 1px solid #000;
        text-align: center;
        padding: 6px;
        font-size: 11px;
      }

      .total-row {
        background: #000;
        color: #fff;
        font-weight: bold;
      }

      .amount-words {
        margin-top: 10px;
        font-size: 12px;
      }

      .payments {
        margin-top: 10px;
        font-size: 12px;
      }

      .payments p {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .highlight {
        background: #b89b5e;
        padding: 5px 15px;
        font-weight: bold;
        width: 40px
      }

      .highlight2 {
        background: #000;
        color: #fff;
        padding: 5px 15px;
        width: 40px
      }

      .signatures {
        margin-top: 60px;
        display: flex;
        justify-content: space-between;
      }

      .sign {
        text-align: center;
        width: 45%;
      }

      .signature-box {
        position: relative;
        height: 0px; /* space for signature */
      }

      .signature-img {
        position: absolute;
        bottom: 10px;   /* sits just above the line */
        left: 20%;
        transform: translateX(-50%);
        height: 40px;   /* adjust size */
        z-index: 2;
      }

      .line {
        border-top: 1px solid #000;
        margin-top: 40px;
        position: relative;
        z-index: 1;
      }

      .sign-date {
        font-size: 11px;
        position: absolute;
        bottom: 10px;   /* sits just above the line */
        right: 20%;
      }

      .page-break{
          page-break-before:always;
          break-before:page;
      }

      .student-table{
          width:100%;
          border-collapse:collapse;
          margin-top:20px;
      }

      .student-table th{
          background:#b89b5e;
          color:#fff;
          padding:10px;
          border:1px solid #000;
          font-size:12px;
      }

      .student-table td{
          border:1px solid #000;
          padding:8px;
          font-size:11px;
      }

      .student-heading{
          text-align:center;
          margin-top:20px;
          font-size:22px;
          font-weight:bold;
      }

      .student-sub{
          text-align:center;
          margin-bottom:20px;
          color:#666;
      }

    </style>
    </head>

    <body>

    <div class="container">

      <div class="header">
        <img src="${company.logo_url || ""}" />
        <div class="header-text">
          <div class="title">${(company.company_name || "").toUpperCase()}</div>
          <div class="sub">18, Moshood Bakare Street, Gbagada Phase 1</div>
          <div class="sub">Tel: 09166767242, 07087522295</div>
        </div>
      </div>

      <div class="top">
        <div>
          <b>Invoice to:</b><br/>
          <p style="margin: 0; font-weight: bold; font-size: 25px;">${q.school_name}</p>
          <p style="margin: 5px 0; font-size: 12px;">${q.address || ""}</p>
          <br/><br/>
          <b>Payment for:</b><br/>
          ${q.term_name}
        </div>

        <div class="bank">
          <p style="font-size: 30px; color: #b89b5e; margin: 0;">Jaykirch Tech Hub</p>
          <p style="font-size: 18px;">Access Bank</p>
          <p style="font-size: 30px;">1582579748</p>
        </div>
      </div>

      <div class="date">Date: ${today}</div>

      <div class="section-title">CODING</div>
      <div class="section-title">CLASS INVOICE</div>

      <table>
        <tr>
          <th>S/N</th>
          <th>COURSE</th>
          <th>NO. OF STUDENTS</th>
          <th>AMOUNT PER STUDENT</th>
          <th>TOTAL (₦)</th>
        </tr>

        <tr>
          <td>1</td>
          <td>CODING</td>
          <td>${q.total_students}</td>
          <td>₦${Number(q.price_per_student).toLocaleString()}</td>
          <td>₦${total.toLocaleString()}</td>
        </tr>

        <tr class="total-row">
          <td colspan="4">TOTAL</td>
          <td>₦${total.toLocaleString()}</td>
        </tr>
      </table>

      <div class="amount-words">
        <b>AMOUNT IN WORDS:</b> ${words} NAIRA ONLY
      </div>

      <div class="payments">
        <p>
          <span>1st payment 60% (after midterm - ${midTermDate.toDateString()})</span>
          <span class="highlight">${firstPayment.toLocaleString()}</span>
        </p>

        <p>
          <span>Balance 40% (before exam - ${examDate.toDateString()})</span>
          <span class="highlight2">${secondPayment.toLocaleString()}</span>
        </p>
      </div>

      <p><b>Total Paid:</b> ₦${totalPaid}</p>
      <p><b>Balance:</b> ₦${balance}</p>

      <div class="signatures">

        <div class="sign">
          <div class="signature-box">
            <div class="line"></div>
          </div>
          School Director<br/>
          Signature & Date
        </div>

        <div class="sign">
          <div class="signature-box">
            <img src="https://acad.jkthub.com/images/Signature.jpg" class="signature-img" />
            <div class="sign-date">${today}</div>
            <div class="line"></div>
          </div>
          CEO<br/>
          Signature & Date
        </div>

      </div>

</div>

<!-- SECOND PAGE -->
<div class="page-break"></div>

<div class="container">

    <div class="student-heading">
        STUDENT LIST
    </div>

    <div class="student-sub">
        ${q.school_name}<br>
        ${q.term_name}
    </div>

    <table class="student-table">

        <tr>
            <th>S/N</th>
            <th>Student Name</th>
            <th>Class</th>
        </tr>

        ${students
          .map(
            (student, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${student.full_name}</td>
                <td>${student.class_name || "-"}</td>
            </tr>
        `,
          )
          .join("")}

    </table>

</div>

</body>
</html>
    `;
}

function buildInvoiceEmailHtml({ q, company, total, totalPaid, balance }) {
  return `
        <div style="
        background:#f4f4f4;
        padding:40px;
        font-family:Calibri,Arial;
        ">

        <div style="
        max-width:700px;
        margin:auto;
        background:white;
        border-radius:10px;
        overflow:hidden;
        ">

        <div style="
        background:#b89b5e;
        padding:35px;
        text-align:center;
        color:white;
        ">

        <img
        src="${company.logo_url || ""}"
        width="80">

        <h2 style="margin:15px 0 5px;">
        ${company.company_name || ""}
        </h2>

        <p style="margin:0;">
        Coding Class Invoice
        </p>

        </div>

        <div style="padding:35px;">

        <p>

        Dear <b>${q.school_name}</b>,

        </p>

        <p>

        Please find attached the invoice for the
        <b>${q.term_name}</b>
        coding programme.

        </p>

        <table
        style="
        width:100%;
        border-collapse:collapse;
        margin:25px 0;
        ">

        <tr>
        <td style="padding:10px;"><b>School</b></td>
        <td>${q.school_name}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Term</b></td>
        <td>${q.term_name}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>No. of Students</b></td>
        <td>${q.total_students}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Amount</b></td>
        <td>₦${total.toLocaleString()}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Paid</b></td>
        <td>₦${totalPaid.toLocaleString()}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Balance</b></td>
        <td>₦${balance.toLocaleString()}</td>
        </tr>

        </table>

        <p>

        Kindly make payment according to the agreed payment schedule.

        </p>

        <div style="
        background:#faf8f1;
        padding:20px;
        border-left:5px solid #b89b5e;
        ">

        <b>Payment Details</b>

        <br><br>

        Access Bank

        <br>

        Account Name:
        <b>Jaykirch Tech Hub</b>

        <br>

        Account Number:
        <b>1582579748</b>

        </div>

        <br>

        For enquiries, kindly contact us.

        <br><br>

        Regards,

        <br>

        <b>${company.company_name || ""}</b>

        </div>

        <div style="
        background:#222;
        color:white;
        padding:20px;
        text-align:center;
        font-size:12px;
        ">

        © ${new Date().getFullYear()} ${company.company_name || ""}

        </div>

        </div>

        </div>
        `;
}

function buildReceiptHtml({ quote, students, company, totalAmount, totalPaid, balance, paymentDate, paymentMethod, receiptNumber, invoiceNumber, amountWords }) {
  const studentRows = students.length
    ? students
        .map(
          (student, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${student.full_name}</td>
                <td>${student.class_name || "-"}</td>
            </tr>
            `,
        )
        .join("")
    : `
            <tr>
                <td colspan="3">
                No students attached
                </td>
            </tr>
            `;

  return `
<!DOCTYPE html>
<html>
<head>
<style>
body{
    font-family:Calibri;
    margin:0;
    padding:0;
    background:#ffffff;
}
.container{
    width:80%;
    max-width:850px;
    margin:30px auto;
    padding:30px;
}
.header{
    display:flex;
    justify-content:center;
    align-items:center;
    gap:20px;
}
.header img{
    width:70px;
}
.header-text{
    text-align:center;
}
.title{
    font-size:20px;
    font-weight:bold;
}
.sub{
    font-size:12px;
}
.receipt-title{
    margin-top:25px;
    text-align:center;
    color:#198754;
    border:2px solid #198754;
    padding:12px;
    font-size:24px;
    font-weight:bold;
}
.top{
    display:flex;
    justify-content:space-between;
    margin-top:30px;
}
.bank{
    text-align:right;
}
.bank p{
    margin:4px;
}
.section{
    margin-top:25px;
}
table{
    width:100%;
    border-collapse:collapse;
    margin-top:10px;
}
th{
    background:#198754;
    color:white;
    padding:8px;
    font-size:12px;
}
td{
    border:1px solid #000;
    padding:8px;
    text-align:center;
    font-size:12px;
}
.total{
    background:#198754;
    color:#fff;
    font-weight:bold;
}
.words{
    margin-top:25px;
    font-size:13px;
}
.notice{
    margin-top:25px;
    background:#f8fff8;
    border-left:5px solid #198754;
    padding:20px;
    line-height:24px;
}
.signatures{
    margin-top:70px;
    display:flex;
    justify-content:space-between;
}
.sign{
    width:40%;
    text-align:center;
}
.line{
    margin-top:50px;
    border-top:1px solid black;
}
.signature-box{
    position:relative;
}
.signature-img{
    position:absolute;
    left:20%;
    bottom:10px;
    height:40px;
}
.sign-date{
    position:absolute;
    right:15%;
    bottom:10px;
    font-size:11px;
}
.footer{
    margin-top:40px;
    text-align:center;
    font-size:11px;
    color:#666;
}
.page-break{
    page-break-before:always;
}
.student-heading{
    text-align:center;
    font-size:22px;
    font-weight:bold;
}
.student-sub{
    text-align:center;
    margin-bottom:20px;
    color:#666;
}
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="${company.logo_url || ""}">
<div class="header-text">
<div class="title">
${(company.company_name || "").toUpperCase()}
</div>
<div class="sub">
18 Moshood Bakare Street, Gbagada Phase 1
</div>
<div class="sub">
09166767242 | 07087522295
</div>
</div>
</div>
<div class="receipt-title">
OFFICIAL SCHOOL PAYMENT RECEIPT
</div>
<div class="top">
<div>
<b>Received From</b>
<br><br>
<div style="font-size:24px;font-weight:bold;">
${quote.school_name}
</div>
<div>
${quote.school_email || ""}
</div>
<div>
${quote.phone || ""}
</div>
<div>
${quote.address || ""}
</div>
</div>
<div class="bank">
<p><b>Receipt No</b></p>
<p>${receiptNumber}</p>
<br>
<p><b>Invoice No</b></p>
<p>${invoiceNumber}</p>
<br>
<p><b>Payment Date</b></p>
<p>${paymentDate}</p>
</div>
</div>
<div class="section">
<h3>Receipt Summary</h3>
<table>
<tr>
<th>Description</th>
<th>Details</th>
</tr>
<tr>
<td>Programme</td>
<td>Coding Classes</td>
</tr>
<tr>
<td>Academic Term</td>
<td>${quote.term_name}</td>
</tr>
<tr>
<td>Number of Students</td>
<td>${quote.total_students}</td>
</tr>
<tr>
<td>Total Invoice</td>
<td>₦${totalAmount.toLocaleString()}</td>
</tr>
<tr class="total">
<td>Total Paid</td>
<td>₦${totalPaid.toLocaleString()}</td>
</tr>
<tr>
<td>Outstanding Balance</td>
<td>₦${balance.toLocaleString()}</td>
</tr>
<tr>
<td>Payment Method</td>
<td>${paymentMethod}</td>
</tr>
<tr>
<td>Payment Status</td>
<td style="font-weight:bold;color:${balance <= 0 ? "green" : "#f39c12"};">
${balance <= 0 ? "PAID IN FULL" : "PARTIAL PAYMENT"}
</td>
</tr>
</table>
</div>
<div class="words">
<b>AMOUNT RECEIVED IN WORDS</b>
<br><br>
${amountWords} NAIRA ONLY
</div>
<div class="notice">
<h3 style="margin-top:0;color:#198754;">
Payment Confirmation
</h3>
<p>
This receipt confirms that
<b>${quote.school_name}</b>
has made a payment of
<b>₦${totalPaid.toLocaleString()}</b>
towards the
<b>${quote.term_name}</b>
Coding Programme.
</p>
<p>
Remaining Balance:
<b>₦${balance.toLocaleString()}</b>
</p>
<p>
Thank you for your partnership with
<b>${company.company_name || ""}.</b>
</p>
</div>
<div class="signatures">
<div class="sign">
<div class="line"></div>
School Director
</div>
<div class="sign">
<div class="signature-box">
<img
src="https://acad.jkthub.com/images/Signature.jpg"
class="signature-img"
/>
<div class="sign-date">
${paymentDate}
</div>
<div class="line"></div>
</div>
Authorized Signature
</div>
</div>
<div class="footer">
This receipt serves as an official acknowledgement of payment made to
<b>${company.company_name || ""}</b>.
</div>
</div>
<div class="page-break"></div>
<div class="container">
<div class="student-heading">
STUDENT LIST
</div>
<div class="student-sub">
${quote.school_name}<br>
${quote.term_name}
</div>
<table>
<tr>
<th>S/N</th>
<th>Student Name</th>
<th>Class</th>
</tr>
${studentRows}
</table>
</div>
</body>
</html>
`;
}

function buildReceiptEmailHtml({ quote, company, receiptNumber, totalAmount, totalPaid, balance, paymentDate }) {
  return `
<div style="
background:#f4f4f4;
padding:40px;
font-family:Calibri,Arial;
">

<div style="
max-width:700px;
margin:auto;
background:white;
border-radius:10px;
overflow:hidden;
">

<div style="
background:#198754;
padding:35px;
text-align:center;
color:white;
">

<img
src="${company.logo_url || ""}"
width="80">

<h2 style="margin:15px 0 5px;">
${company.company_name || ""}
</h2>

<p style="margin:0;">
Official Payment Receipt
</p>

</div>

<div style="padding:35px;">

<p>
Dear <b>${quote.school_name}</b>,
</p>

<p>

Thank you for your payment.

Please find attached your official payment receipt for the
<b>${quote.term_name}</b> Coding Programme.

</p>

<table
style="
width:100%;
border-collapse:collapse;
margin:25px 0;
">

<tr>
<td style="padding:10px;"><b>Receipt No</b></td>
<td>${receiptNumber}</td>
</tr>

<tr>
<td style="padding:10px;"><b>School</b></td>
<td>${quote.school_name}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Academic Term</b></td>
<td>${quote.term_name}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Students</b></td>
<td>${quote.total_students}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Total Amount</b></td>
<td>₦${totalAmount.toLocaleString()}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Amount Paid</b></td>
<td>₦${totalPaid.toLocaleString()}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Balance</b></td>
<td>₦${balance.toLocaleString()}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Status</b></td>
<td style="
font-weight:bold;
color:${balance <= 0 ? "green" : "#f39c12"};
">
${balance <= 0 ? "FULLY PAID" : "PARTIALLY PAID"}
</td>
</tr>

<tr>
<td style="padding:10px;"><b>Payment Date</b></td>
<td>${paymentDate}</td>
</tr>

</table>

<p>

Thank you for partnering with
<b>${company.company_name || ""}.</b>

</p>

<br>

Regards,

<br>

<b>${company.company_name || ""}</b>

</div>

<div style="
background:#222;
color:white;
padding:20px;
text-align:center;
font-size:12px;
">

© ${new Date().getFullYear()} ${company.company_name || ""}

</div>

</div>

</div>
`;
}

/**
 * Builds the branded invoice/receipt PDF for a quote — an invoice when
 * nothing has been paid yet, a receipt once any payment is recorded
 * (same rule as before this was shared). Emails a copy to the school
 * when it has an email on file, same as before.
 *
 * @param {number} quoteId
 * @param {number|null} schoolId - when set, scopes the lookup to that
 *   school only (used by school-admin); null/omitted for admin, who can
 *   pull any school's quote.
 * @returns {Promise<{pdf: Buffer, filename: string, quote: object}|null>}
 *   null when no matching quote is found (caller should 404).
 */
async function getQuoteDocumentPdf({ quoteId, schoolId = null }) {
  const params = [quoteId];
  let schoolFilter = "";
  if (schoolId) {
    params.push(schoolId);
    schoolFilter = "AND q.school_id = $2";
  }

  const result = await pool.query(
    `
      SELECT
          q.id,
          q.term_id,
          q.school_id,
          q.price_per_student,
          q.status,
          q.total_paid,
          q.balance,
          s.name AS school_name,
          s.email AS school_email,
          s.phone,
          s.address,
          t.name AS term_name,
          COUNT(ts.student_id) AS total_students,
          (COUNT(ts.student_id) * COALESCE(q.price_per_student,0)) AS total_amount
      FROM quotes q
      JOIN schools s
      ON q.school_id=s.id
      JOIN academic_terms t
      ON q.term_id=t.id
      LEFT JOIN student_term_enrollments ts
      ON ts.term_id=q.term_id
      WHERE q.id=$1 ${schoolFilter}
      GROUP BY
      q.id,
      q.term_id,
      q.school_id,
      q.price_per_student,
      q.status,
      q.total_paid,
      q.balance,
      s.name,
      s.email,
      s.phone,
      s.address,
      t.name;
    `,
    params
  );

  const q = result.rows[0];
  if (!q) return null;

  const totalPaid = Number(q.total_paid || 0);
  const balance = Number(q.balance || 0);

  const studentsResult = await pool.query(
    `
    SELECT
        u.fullname AS full_name,
        c.name AS class_name
    FROM student_term_enrollments ste
    JOIN users2 u
        ON u.id = ste.student_id
    LEFT JOIN classrooms c
        ON c.id = ste.classroom_id
    WHERE ste.term_id = $1
    ORDER BY c.name, u.fullname;
    `,
    [q.term_id]
  );
  const students = studentsResult.rows;

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const company = infoResult.rows[0] || {};

  let html;
  let emailSubject;
  let emailHtml;
  let filename;

  if (totalPaid > 0) {
    // ===== RECEIPT =====
    const paymentResult = await pool.query(
      `SELECT * FROM school_payments WHERE quote_id=$1 ORDER BY id DESC LIMIT 1`,
      [q.id]
    );
    const payment = paymentResult.rows[0];

    const totalAmount = Number(q.total_amount || 0);
    const paymentDate = payment
      ? new Date(payment.payment_date || payment.created_at || Date.now()).toDateString()
      : new Date().toDateString();
    const paymentMethod = payment?.payment_method || "Bank Transfer";
    const receiptNumber = `RCPT-${String(q.id).padStart(6, "0")}`;
    const invoiceNumber = `INV-${String(q.id).padStart(6, "0")}`;

    const safeSchoolName = (q.school_name || "School").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    const safeTermName = (q.term_name || "Term").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    filename = `${safeSchoolName}_${safeTermName}_${receiptNumber}.pdf`;

    const amountWords = numberToWords.toWords(Math.round(totalPaid)).toUpperCase();

    html = buildReceiptHtml({
      quote: q, students, company, totalAmount, totalPaid, balance,
      paymentDate, paymentMethod, receiptNumber, invoiceNumber, amountWords,
    });
    emailSubject = `Payment Receipt - ${receiptNumber}`;
    emailHtml = buildReceiptEmailHtml({ quote: q, company, receiptNumber, totalAmount, totalPaid, balance, paymentDate });
  } else {
    // ===== INVOICE =====
    const total = Number(q.total_amount || 0);
    const firstPayment = Math.round(total * 0.6);
    const secondPayment = total - firstPayment;
    const words = numberToWords.toWords(total).toUpperCase();
    const today = new Date().toDateString();

    const midTermDate = new Date();
    midTermDate.setDate(midTermDate.getDate() + 14);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);

    html = buildInvoiceHtml({
      q, students, company, total, totalPaid, balance, words, today,
      firstPayment, secondPayment, midTermDate, examDate,
    });
    emailSubject = `Coding Class Invoice - ${q.term_name}`;
    emailHtml = buildInvoiceEmailHtml({ q, company, total, totalPaid, balance });
    filename = `${(q.school_name || "School").replace(/\s+/g, "_")}_Invoice.pdf`;
  }

  const pdf = await generatePdf(html);

  if (q.school_email) {
    await sendEmailWithAttachment(
      q.school_email,
      emailSubject,
      emailHtml,
      filename,
      pdf,
      ["jaykirchtechhub@gmail.com"]
    );
  }

  return { pdf, filename, quote: q };
}

module.exports = { getQuoteDocumentPdf };
