================================================================================
                          JKT EDTECH PLATFORM
                    Project Documentation / README
================================================================================

Last updated: 2026-08-08


--------------------------------------------------------------------------------
1. OVERVIEW
--------------------------------------------------------------------------------

This is a multi-tenant EdTech web platform built with Node.js, Express, and
server-rendered EJS views. It serves several distinct user roles from a single
codebase:

    - Admin           (platform owner / super-admin)
    - School Admin    (manages a single school's classrooms, teachers, students)
    - Teacher         (manages classes within a school)
    - Instructor      (freelance/contract instructor, can serve multiple schools)
    - Student         (independent learner OR school-enrolled)
    - Parent          (linked to one or more student accounts)

The platform combines:
    - A course/lesson/quiz/assignment learning management system (LMS)
    - Three in-browser "coding labs" (Web, Blockly, Arduino)
    - School operations tooling (classrooms, attendance, billing/invoicing)
    - AI-assisted analytics/report generation (OpenAI)
    - Messaging/chat, newsletters, email, and push notifications


--------------------------------------------------------------------------------
2. TECH STACK
--------------------------------------------------------------------------------

    Runtime            Node.js (CommonJS)
    Web framework       Express 5
    Views               EJS + express-ejs-layouts
    Database            PostgreSQL (via `pg`)
    Sessions            express-session (connect-pg-simple installed but not
                        currently wired to the session store)
    Auth                bcrypt password hashing + server-side sessions
                        (no Passport.js, no JWT)
    File uploads        multer + multer-storage-cloudinary
    Media storage        Cloudinary
    PDF generation      Puppeteer (HTML -> PDF) and pdfkit
    Spreadsheets/CSV     exceljs, csv-parser, json2csv
    Charts              Chart.js + chartjs-node-canvas (server-side PNG render)
    AI                  OpenAI SDK (model: gpt-4o-mini) for report commentary
    Email               Brevo (@getbrevo/brevo) — also nodemailer/resend deps
                        present but Brevo is the active path
    Push notifications   web-push (VAPID) + a Service Worker (public/sw.js)
    Scheduling          node-cron
    Payments            Paystack (server-side secret key usage in
                        routes/publicRoutes.js)
    Misc NLP            sentiment, stopword, wordcloud2 (used in feedback/
                        analytics text processing)


--------------------------------------------------------------------------------
3. FOLDER STRUCTURE
--------------------------------------------------------------------------------

    app.js                  Application entry point: middleware stack,
                             session config, view engine, route mounting

    controllers/             Route handler logic, one file per feature area
                             (admin, student, teacher, schoolAdmin, instructor,
                             learning, lab, report, newsletter, message, etc.)

    routes/                  Express routers, one per feature area, mounted
                             from app.js

    models/                  Thin data-access helpers + DB bootstrap
        db.js                Postgres connection pool
        initTables.js        Full schema definition (CREATE TABLE statements)
        courseModel.js, lessonModel.js, moduleModel.js, Lab*.js

    middlewares/             ensureAuthenticated, ensureParent,
                             ensureInstructorOrAdmin, canAccessStudent,
                             activity logging

    services/                Higher-level business logic, mainly the report-
                             generation pipeline (AI + analytics + charts +
                             HTML + PDF) — see services/sections/ for the
                             individual report sections (cover page, exec
                             summary, attendance, rankings, interventions,
                             recommendations, per-student pages)

    utils/                   Shared helpers: email senders, PDF/certificate
                             generation, Cloudinary config, AI wrapper,
                             activity logger, allowed-tables whitelist,
                             newsletter senders, web-push config

    cron/                    Scheduled jobs (newsletter dispatch, assignment
                             reminders)

    views/                   EJS templates, organized by role:
                             admin/, instructor/, teacher/, student/,
                             school-admin/, parent/, labs/, partials/

    public/                  Static assets: CSS, client-side JS, images,
                             and the full Labs front-end (Blockly engine +
                             blocks/generators, Web Lab editor, Arduino UI)

    reports/, temp/charts/, uploads/, tmp/
                             Generated/output artifacts (PDFs, chart PNGs,
                             CSV uploads) — not part of source code


--------------------------------------------------------------------------------
4. ROLES & AUTHORIZATION MODEL
--------------------------------------------------------------------------------

Authentication is session-based: on login, `req.session.user` is populated
with `{ id, email, role, profile_pic }`. There is no central role-based
route guard — most authorization is done ad hoc inside individual controller
functions (checking `req.session.user.role`), which is inconsistent across
the codebase (see Section 8, Known Issues).

Role relationships:

    user_school table    Links a user to a school + classroom, with
                          `role_in_school` ('student' | 'teacher'), gated
                          by an `approved` flag from the school admin.

    classroom_teachers / classroom_instructors
                          Many-to-many join tables — a teacher or instructor
                          can be attached to multiple classrooms/schools.

    classroom_courses    Links classrooms to the courses assigned to them.

    parent_children       Links a parent account to one or more student
                          accounts (parent-initiated request, student must
                          approve via `parent_child_requests`).

    course_enrollments    Used directly by independent ("individual_student")
                          learners who are not attached to any school.


--------------------------------------------------------------------------------
5. CORE FEATURE AREAS
--------------------------------------------------------------------------------

5.1 ADMIN
    - Platform dashboards: overview, business, learning, schools, finance,
      engagement, and course analytics (controllers/adminController.js).
    - Generic database admin: list/search/create/update/delete records on
      73 whitelisted tables via information_schema introspection
      (controllers/adminDbController.js, utils/allowedTables.js).
    - User management: create/edit/delete users, assign to schools/
      classrooms, bulk user upload, avatar/PIN login provisioning.
    - School/classroom/term management, attendance sessions, quotes,
      payments, and parent training invoices (a full billing subsystem).
    - Content management: company info, gallery, about page, and site-wide
      announcements (with scheduling and audience targeting).

5.2 LEARNING CONTENT (LMS)
    - Hierarchy: Courses -> Modules -> Lessons, each with optional quizzes
      and assignments; courses can also have standalone projects.
    - Progress is tracked per lesson (user_lesson_progress) and rolled up
      to course-level progress; modules/lessons unlock sequentially as the
      learner completes prerequisites.
    - XP and badge system tied to learning activity.
    - Certificates are auto-issued when a course reaches 100% completion
      and all module assignments are submitted — rendered via Puppeteer
      from an HTML template, uploaded to Cloudinary, and recorded in
      user_certificates (services/issueCertificate.js).

5.3 CODING LABS (public/labs/, views/labs/, controllers/labController.js)
    - Web Lab: a Monaco-editor-based HTML/CSS/JS playground with a live
      iframe preview. Fully functional (save/run/autosave).
    - Blockly Lab: a custom Scratch-style visual programming environment
      built on Google Blockly, with a sprite stage, pen drawing, and
      console output (public/labs/js/blockly/). This is the most fully
      built-out lab.
    - Arduino Lab: currently a drag-and-drop component UI only (Arduino
      Uno/LED/button/buzzer icons on a canvas) — there is no simulation
      engine or code execution behind it yet.
    - Lab submission/grading pipeline is largely unimplemented: the DB
      schema (lab_submissions, lesson_labs) anticipates scored/graded
      submissions, but the corresponding model and controller files are
      currently empty stubs.

5.4 SCHOOL / TEACHER / INSTRUCTOR / STUDENT / PARENT PORTALS
    - Student: dashboard with progress, XP/badges, engagement charts,
      assignment/quiz submission, 1:1 and class chat.
    - Teacher: AJAX-loaded dashboard sections — class stats, top/struggling
      students, pending grading queue, per-student progress drilldowns.
    - School Admin: the richest portal — approvals, rosters, attendance,
      classroom/course assignment, terms, quotes/invoices.
    - Instructor: multi-school context (can switch an "active school"),
      also authors course content, views student progress across schools.
    - Parent: linked-child management, and read-only access to a child's
      progress/quiz/assignment results (routed through userController.js;
      there is no dedicated parent controller).

5.5 MESSAGING
    - 1:1 chat and classroom-wide chat, backed by flat `messages` and
      `class_messages` tables. Real-time updates are done via short-interval
      polling (client polls every 5 seconds) — there is no WebSocket layer.
    - Instructors can mute students and lock a classroom's chat.

5.6 REPORTING & ANALYTICS
    - Class and student report generation pipeline:
      analytics SQL (services/reportAnalyticsService.js) -> Chart.js PNG
      charts (services/chartService.js) -> OpenAI-generated commentary
      (utils/ai.js + services/reportAIService.js) -> HTML assembly
      (services/reportHtmlService.js + services/sections/*.js) ->
      PDF via Puppeteer (services/reportPdfService.js).
    - Report sections include: cover page, executive summary, attendance
      (charts + tables), course/module breakdown, rankings, at-risk
      student interventions, and AI-written recommendations.
    - A separate, simpler "quick export" (classroom summary PDF, no AI/
      charts) exists in controllers/classroomAnalyticsController.js.

5.7 COMMUNICATIONS
    - Email delivery via Brevo (utils/sendEmail.js / sendEmailWithAttachment.js).
    - Newsletters: created in the admin panel, recipients resolved by
      audience type, and either sent immediately or scheduled — a cron job
      (cron/newsletterCron.js) polls every minute for due newsletters.
    - Assignment reminder emails to parents run on a cron schedule.
    - Web push notifications (VAPID keys, public/sw.js service worker) for
      new content/article alerts.

5.8 PAYMENTS
    - Paystack integration for event/course payments (routes/publicRoutes.js).
    - School-facing billing (quotes, invoices, payment adjustments) is
      handled separately through the admin/school-admin panels and is not
      tied to Paystack.


--------------------------------------------------------------------------------
6. ENVIRONMENT VARIABLES
--------------------------------------------------------------------------------

The application reads the following variables from the environment
(typically via a local .env file loaded with dotenv):

    DATABASE_URL                  PostgreSQL connection string
    SESSION_SECRET                express-session signing secret
    PORT                          HTTP port to listen on

    CLOUDINARY_CLOUD_NAME         Cloudinary account
    CLOUDINARY_API_KEY
    CLOUDINARY_API_SECRET

    BREVO_API_KEY                 Transactional email (Brevo)
    BREVO_FROM

    OPENAI_API_KEY                AI-generated report commentary / tutor chat

    VAPID_PUBLIC_KEY              Web push notifications
    VAPID_PRIVATE_KEY

    PAYSTACK_SECRET_KEY           Payment processing

    PUPPETEER_EXECUTABLE_PATH     Optional — custom Chromium path for
                                  environments where Puppeteer's bundled
                                  Chromium isn't usable (e.g. some hosts)

A .env.example file does not currently exist in the repo — consider adding
one so the required variables are discoverable without reading source code.


--------------------------------------------------------------------------------
7. RUNNING THE PROJECT
--------------------------------------------------------------------------------

    1. Install dependencies:
           npm install

    2. Create a .env file in the project root with the variables listed
       in Section 6.

    3. Ensure a PostgreSQL database is reachable at DATABASE_URL. The
       schema is defined in models/initTables.js.

    4. Start the server:
           npm start
       (runs `node app.js`)

    Note: no test suite currently exists (package.json's "test" script is
    a placeholder that exits with an error).


--------------------------------------------------------------------------------
8. KNOWN ISSUES / INCOMPLETE AREAS
--------------------------------------------------------------------------------

These were identified from reading the current codebase and are recorded
here so they aren't lost — not all are fixed yet:

    - No centralized admin route guard: routes/adminRoutes.js and
      routes/classroomAnalyticsRoutes.js import an `ensureAdmin` middleware
      that does not exist in middlewares/auth.js. Authorization instead
      relies on inconsistent per-function checks inside controllers.

    - middlewares/canAccessStudent.js references `pool` without importing
      it — this middleware throws at runtime when invoked.

    - Several write endpoints have no authorization check at all, including
      adminDbController's create/update/delete, and multiple gallery/about/
      announcement mutation endpoints.

    - controllers/userController.js: the teacher-signup branch references
      variables (`classroomName`, `emailGenerated`) that are only defined
      in the student-signup branch — teacher signup currently throws.

    - controllers/instructorController.js `viewStudentProgress` references
      an unjoined table alias in a SQL query — this handler is broken.

    - routes/userRoutes.js: `/parent/quiz/:id` and `/parent/assignment/:id`
      have no ownership/authorization check — a parent could view another
      family's result by guessing/incrementing an ID.

    - Duplicate cron jobs: cron/assignmentReminderJobs.js and
      cron/parentAssignmentReminder.js both send the same reminder email
      on an overlapping schedule, causing duplicate emails.

    - controllers/articleController.js queries a `subscriptions` table for
      push notifications, but the actual table (per models/initTables.js)
      is `push_subscriptions` — push on new articles currently fails.

    - Bulk school student upload assigns every new student the same
      hardcoded default password.

    - Lab grading pipeline (models/LabSubmission.js, LabTemplate.js, Lab.js,
      LabProject.js, controllers/gradingController.js, lessonLabController.js,
      projectController.js, public/labs/js/grading.js) are all empty stub
      files — no scoring/grading logic exists yet for lab submissions.

    - The Arduino Lab UI has no backing simulation engine — "Run
      Simulation"/"Stop" controls are not wired to any logic.

    - Messaging logic is duplicated across student/teacher/instructor
      controllers plus a separate, likely-unused controllers/messageController.js.

    - Chat is polling-based (every 5 seconds), not WebSocket-based.

    - Several debug artifacts are written on every report generation
      (student-test.html, debug.png) and should be removed or gated
      behind a debug flag.


--------------------------------------------------------------------------------
9. WHERE TO LOOK FOR THINGS
--------------------------------------------------------------------------------

    Add a new admin dashboard metric  -> controllers/adminController.js
    Add/modify a DB table              -> models/initTables.js
    Change a role's dashboard          -> controllers/{role}Controller.js
                                           + views/{role}/
    Modify report content/layout      -> services/sections/*.js
    Change AI prompt/behavior         -> utils/ai.js, services/reportAIService.js
    Add a new lab type                 -> controllers/labController.js,
                                           views/labs/, public/labs/
    Change email templates             -> utils/emailTemplates.js,
                                           utils/newsletterTemplate.js
    Adjust scheduled jobs              -> cron/

================================================================================
                                END OF README
================================================================================
