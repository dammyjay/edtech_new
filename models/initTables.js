const pool = require("./db");

async function createTables() {
  try {

    // table for push notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT NOT NULL,
        keys TEXT NOT NULL
      );
    `);
    // Nullable: existing/anonymous subscriptions stay valid for
    // broadcast-only sends (e.g. new-article alerts). Only subscriptions
    // captured while a student is logged in get a user_id, which is what
    // makes a PERSONALIZED reminder (e.g. "come back and finish your
    // lesson") possible at all — without this there's no way to know
    // which subscription belongs to which student.
    await pool.query(`
      ALTER TABLE push_subscriptions
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE;
    `);

    // table for push notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE,
        keys JSONB,
        created_at TIMESTAMP
      );
    `);

    // table for company info
    await pool.query(
      `CREATE TABLE IF NOT EXISTS company_info(
            id SERIAL PRIMARY KEY,
            logo_url TEXT NOT NULL,
            vision TEXT,
            mission TEXT,
            history TEXT,
            hero_image_url TEXT ,
            company_name TEXT NOT NULL,
            marquee_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP  
        );`
    );

    // table for pending users
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pending_users(
        id SERIAL PRIMARY KEY,
        fullname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        gender TEXT,
        password TEXT NOT NULL,
        otp_code TEXT,
        otp_expires TIMESTAMP,
        profile_picture TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        dob DATE
        
        )`
    );

    // table for users
    await pool.query(
      `CREATE TABLE IF NOT EXISTS users2(
        id SERIAL PRIMARY KEY,
        fullname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        gender TEXT,
        password TEXT NOT NULL,
        profile_picture TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reset_token TEXT,
        reset_token_expires TIMESTAMP,
        dob DATE,
        wallet_balance2 NUMERIC DEFAULT 0,
        xp INTEGER DEFAULT 0,
        child_code TEXT UNIQUE
      )`
    );

  await pool.query(`
    ALTER TABLE users2
    ADD COLUMN IF NOT EXISTS login_type TEXT DEFAULT 'email',
    ADD COLUMN IF NOT EXISTS pin VARCHAR(10),
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS avatar_seed TEXT,
    ADD COLUMN IF NOT EXISTS is_lower_primary BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS qr_code TEXT,
    ADD COLUMN IF NOT EXISTS classroom_login_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS school_level TEXT,
    ADD COLUMN IF NOT EXISTS login_method TEXT DEFAULT 'email';
  `);


    // table for career pathways
    await pool.query(
      `CREATE TABLE IF NOT EXISTS career_pathways(
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        target_audience TEXT,
        expected_outcomes TEXT,
        duration_estimate TEXT,
        video_intro_url TEXT,
        show_on_homepage BOOLEAN DEFAULT false
      )`
    );

    // table for courses
    await pool.query(
      `CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        level TEXT CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
        career_pathway_id INTEGER REFERENCES career_pathways(id) ON DELETE SET NULL,
        thumbnail_url TEXT,
        sort_order INTEGER DEFAULT 0,
        amount INTEGER DEFAULT 0,
        created_by TEXT DEFAULT 'admin',
        instructor_id INT REFERENCES users2(id),
        created_at TIMESTAMP DEFAULT NOW(),
        curriculum_url TEXT
      );

      `
    );

    // thumbnail_source distinguishes an auto-generated thumbnail
    // (adminController.createCourse/editCourse generates one via
    // utils/generateThumbnail.js whenever no thumbnail is uploaded) from a
    // content creator's own upload — same idea as modules.badge_source.
    await pool.query(`
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail_source TEXT;
    `);

    // table for transactions
    await pool.query(
      `CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        fullname TEXT,
        email TEXT,
        amount NUMERIC,
        reference TEXT UNIQUE,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // Per-user wallet ledger — `transactions` above only records raw
    // Paystack charges (no user_id, no purpose), so it can't answer "what
    // happened to this specific user's wallet." This is the audit trail
    // used by the parent dashboard's wallet/spending history, populated by
    // every existing wallet credit/debit path (self-funding, course
    // enrollment, term reactivation) plus the new parent-funds-child and
    // parent-pays-reactivation flows.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('fund', 'parent_fund', 'course_enrollment', 'term_reactivation', 'parent_term_reactivation')),
        direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
        amount NUMERIC NOT NULL,
        description TEXT,
        reference TEXT,
        related_user_id INTEGER REFERENCES users2(id),
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);`
    );

    //table for benefits
    await pool.query(
      `CREATE TABLE IF NOT EXISTS benefits (
        id SERIAL PRIMARY KEY,
        title TEXT,
        description TEXT,
        icon TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // table for events
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        event_date DATE NOT NULL,
        time TEXT,
        location TEXT,
        is_paid BOOLEAN DEFAULT FALSE,
        amount NUMERIC DEFAULT 0,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        show_on_homepage BOOLEAN DEFAULT false,
        discount_amount NUMERIC DEFAULT 0,
        discount_deadline DATE,
        allow_split_payment BOOLEAN DEFAULT false
      );
    `);

    // table for event registrations
    await pool.query(
      `CREATE TABLE IF NOT EXISTS event_registrations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    registrant_name TEXT NOT NULL,
    registrant_email TEXT NOT NULL,
    registrant_phone TEXT,
    amount_paid NUMERIC(10,2) DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    balance_due NUMERIC DEFAULT 0,
    total_amount NUMERIC,
    num_people INTEGER DEFAULT 1,
    child_names JSONB DEFAULT '[]',
    payment_option TEXT DEFAULT 'full'
);
`
    );

    // table for about sections
    await pool.query(
      `CREATE TABLE IF NOT EXISTS about_sections (
        id SERIAL PRIMARY KEY,
        section_title TEXT NOT NULL,
        section_key TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        section_image TEXT,
        section_order INT
      );`
    );

    // tables for testimonies 
    await pool.query(`
      CREATE TABLE IF NOT EXISTS testimonies (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        message TEXT,
        is_published BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_type TEXT NOT NULL,   -- parent, teacher, organization, etc
        name TEXT NOT NULL,
        email TEXT,
        school_name TEXT,           -- only for school owners / teachers
        student_class TEXT,         -- only for parents/students
        organization_name TEXT,     -- only for organization
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        category TEXT,
        message TEXT NOT NULL,
        extra JSONB,                -- flexible for future custom questions
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      ALTER TABLE feedback ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;

     `);
    
    // table for faqs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS faqs (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT,
        email TEXT,
        is_published BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // table for gallery categories
    await pool.query(
      `CREATE TABLE IF NOT EXISTS gallery_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for gallery images
    await pool.query(
      `CREATE TABLE IF NOT EXISTS gallery_images (
        id SERIAL PRIMARY KEY,
        title TEXT,
        image_url TEXT NOT NULL,
        category_id INT REFERENCES gallery_categories(id),
        uploaded_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for modules
    await pool.query(
      `CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        objectives TEXT,
        learning_outcomes TEXT,
        thumbnail TEXT,
        order_number INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // badge_image itself already existed in live databases (added directly,
    // outside this file, before this comment was written) — declared here
    // too so a fresh database gets it. badge_source distinguishes an
    // auto-generated badge (learningController.createModule/editModule
    // generates one via utils/generateModuleBadge.js whenever no badge is
    // uploaded) from a content creator's own upload, so the admin UI can
    // label which one is currently in use and offer "regenerate".
    await pool.query(`
      ALTER TABLE modules ADD COLUMN IF NOT EXISTS badge_image TEXT;
      ALTER TABLE modules ADD COLUMN IF NOT EXISTS badge_source TEXT;
      ALTER TABLE modules ADD COLUMN IF NOT EXISTS thumbnail_source TEXT;
    `);

    // table for lessons
    await pool.query(
      `CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT,
        video_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        order_number INTEGER,
        lesson_file_url TEXT
      );
      ALTER TABLE lessons
      ADD COLUMN IF NOT EXISTS lesson_plan TEXT;
      `
    );

    // table for lesson assignments
    await pool.query(
      `CREATE TABLE IF NOT EXISTS lesson_assignments (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        title TEXT,
        instructions TEXT,
        resource_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    // table for module assignments
    await pool.query(
      `CREATE TABLE IF NOT EXISTS module_assignments (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT,
        instructions TEXT,
        resource_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS assignment_submission_guides (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          video_url TEXT,
          sample_document_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS learning_guides (
          id SERIAL PRIMARY KEY,
          guide_type VARCHAR(50) UNIQUE NOT NULL,
          title TEXT,
          description TEXT,
          video_url TEXT,
          sample_document_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Remove the old column
      ALTER TABLE learning_guides
      DROP COLUMN IF EXISTS sample_document_url;

      -- Add the new columns
      ALTER TABLE learning_guides
      ADD COLUMN IF NOT EXISTS sample_question TEXT,
      ADD COLUMN IF NOT EXISTS sample_submission TEXT;
        
      `)

    // table for course projects
    await pool.query(
      `CREATE TABLE IF NOT EXISTS course_projects (
        id SERIAL PRIMARY KEY,
          course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          resource_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for quizzes
    await pool.query(
      `CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // table for quiz questions
    await pool.query(
      `CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        options TEXT[], -- e.g. ARRAY['A', 'B', 'C', 'D']
        correct_option TEXT NOT NULL,
        question_type VARCHAR(50) DEFAULT 'multiple_choice'
      );
      `
    );

      // table for course enrollments
    await pool.query(
      `CREATE TABLE IF NOT EXISTS course_enrollments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        enrolled_at TIMESTAMP DEFAULT NOW(),
        progress INTEGER DEFAULT 0
      );
      `
    );

    // table for tracking student XP
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_xp (
        user_id INTEGER PRIMARY KEY REFERENCES users2(id) ON DELETE CASCADE,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1
      );
      `
    );

    // table for tracking student badges
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        title TEXT,
        awarded_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for tracking user XP history
    await pool.query(
      `CREATE TABLE IF NOT EXISTS xp_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        xp INTEGER NOT NULL,
        activity TEXT, -- e.g., "Completed lesson", "Quiz passed"
        earned_at TIMESTAMP DEFAULT NOW()
      );
      `
    );

    // table for tracking user badges
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        badge_name TEXT NOT NULL,
        awarded_at TIMESTAMP DEFAULT NOW(),
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        badge_image TEXT
      );
      `
    );

    // table for tracking lesson completion
    await pool.query(
      `CREATE TABLE IF NOT EXISTS user_lesson_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, lesson_id)
      );
      `
    );

    // table for AI tutor logs
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ai_tutor_logs (
        id SERIAL PRIMARY KEY,
        user_id INT NULL REFERENCES users2(id),
        lesson_id INT NULL REFERENCES lessons(id),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      `
    );

    // table for assignment submissions
    await pool.query(
      `CREATE TABLE IF NOT EXISTS assignment_submissions (
          id SERIAL PRIMARY KEY,
          assignment_id INT NOT NULL, 
          student_id INT NOT NULL, 
          description TEXT NOT NULL,
          score INT,
          ai_feedback TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          file_url TEXT,
          grade TEXT,
          criteria JSON,
          total INT
      );
      `
    );

    // Grading is otherwise 100% AI-only (studentController's assignment
    // submit handler grades synchronously right after insert) — these
    // columns let a teacher review/override that grade, and distinguish
    // "never graded" (AI call failed) from "AI-graded, not yet reviewed"
    // from "a human has actually looked at this."
    await pool.query(`
      ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS graded_by INTEGER REFERENCES users2(id);
      ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS teacher_feedback TEXT;
      ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS manually_graded_at TIMESTAMP;
    `);

    // Classroom-scoped announcements — deliberately separate from the
    // platform-wide `announcements` table, which has no per-classroom
    // targeting concept. A teacher posts here for just their own
    // classroom(s); students read them via a small panel in class chat.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_announcements (
        id SERIAL PRIMARY KEY,
        classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users2(id),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Quiz Submissions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_submissions (
      id SERIAL PRIMARY KEY,
      quiz_id INT NOT NULL,
      student_id INT NOT NULL,
      score INT,
      passed BOOLEAN,
      review_data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `);

    // junction table for unlocked lessons
    await pool.query(
      `CREATE TABLE IF NOT EXISTS unlocked_lessons (
        student_id INT NOT NULL,
        lesson_id INT NOT NULL,
        PRIMARY KEY(student_id, lesson_id)
      );
      `
    );

    // junction table for unlocked modules
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS unlocked_modules (
        student_id INT NOT NULL,
        module_id INT NOT NULL,
        PRIMARY KEY(student_id, module_id)
      );
      `
    );

  // junction table for unlocked assignments
    await pool.query(
      `
      CREATE TABLE IF NOT EXISTS unlocked_assignments (
        student_id INT NOT NULL,
        assignment_id INT NOT NULL,
        PRIMARY KEY(student_id, assignment_id)
      );
      `
    );

    // table for user certificates
    await pool.query(
      `CREATE TABLE IF NOT EXISTS user_certificates (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users2(id) ON DELETE CASCADE,
        course_id INT REFERENCES courses(id) ON DELETE CASCADE,
        issued_at TIMESTAMP DEFAULT NOW(),
        certificate_url TEXT
      );

      ALTER TABLE user_certificates
      ADD COLUMN IF NOT EXISTS certificate_code TEXT UNIQUE;
      
      `
    );

    // table for parents
    await pool.query(
      `CREATE TABLE IF NOT EXISTS parent_children (
        id SERIAL PRIMARY KEY,
        parent_id INT REFERENCES users2(id) ON DELETE CASCADE,
        child_id INT REFERENCES users2(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(parent_id, child_id)
      );
      `
    );

    // table for parent-child requests
    await pool.query(
      `CREATE TABLE IF NOT EXISTS parent_child_requests (
        id SERIAL PRIMARY KEY,
        parent_id INT NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        child_id INT NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (parent_id, child_id)
      );

      `
    );

    // tables for schools
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        school_id VARCHAR(20) UNIQUE NOT NULL, -- generated e.g. SCH-123456
        name TEXT NOT NULL,
        address TEXT,
        email TEXT,
        phone TEXT,
        created_by INT REFERENCES users2(id) ON DELETE CASCADE, -- school_admin
        created_at TIMESTAMP DEFAULT NOW(),
        logo_url TEXT
      );
    `);
    
      // User school
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_school (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users2(id) ON DELETE CASCADE,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          classroom_id INT,
          joined_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, school_id),
          approved BOOLEAN DEFAULT false
        );

        ALTER TABLE user_school
        ADD COLUMN IF NOT EXISTS role_in_school TEXT DEFAULT 'student';

        ALTER TABLE user_school
        DROP CONSTRAINT IF EXISTS user_school_role_in_school_check;

        ALTER TABLE user_school
        ADD CONSTRAINT user_school_role_in_school_check
        CHECK (
            role_in_school IN
            (
                'school_admin',
                'teacher',
                'student',
                'parent'
            )
        );
      `);

      // table for classrooms
      await pool.query(`
        CREATE TABLE IF NOT EXISTS classrooms (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          name TEXT NOT NULL, -- e.g. "JSS1A"
          created_at TIMESTAMP DEFAULT NOW()
        );

        ALTER TABLE classrooms
        ADD COLUMN IF NOT EXISTS chat_locked BOOLEAN DEFAULT false;
        ALTER TABLE classrooms
        ADD COLUMN IF NOT EXISTS login_mode TEXT DEFAULT 'standard';
      `);

      // junction table for quotes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id SERIAL PRIMARY KEY,
        school_id INT REFERENCES schools(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, negotiated
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE quotes
      ADD COLUMN IF NOT EXISTS term_id INT,
      ADD COLUMN IF NOT EXISTS price_per_student NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_students INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_amount NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unpaid';
      ALTER TABLE quotes
      ADD COLUMN IF NOT EXISTS total_paid NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0;
    `);

    // table for school payments
      await pool.query(`
        CREATE TABLE IF NOT EXISTS school_payments (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          quote_id INT REFERENCES quotes(id) ON DELETE SET NULL,
          student_limit INT NOT NULL, -- max students covered by this payment
          amount NUMERIC(12,2) NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          status VARCHAR(20) DEFAULT 'pending', -- pending, paid, overdue
          created_at TIMESTAMP DEFAULT NOW()
        );

        ALTER TABLE school_payments
        DROP COLUMN IF EXISTS student_limit,
        DROP COLUMN IF EXISTS start_date,
        DROP COLUMN IF EXISTS end_date,
        DROP COLUMN IF EXISTS status;

        ALTER TABLE school_payments
        ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP DEFAULT NOW();

      `);
    
    // table for school payment adjustments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_payment_adjustments (
        id SERIAL PRIMARY KEY,
        school_payment_id INT REFERENCES school_payments(id) ON DELETE CASCADE,
        extra_students INT NOT NULL,
        extra_amount NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'pending' -- pending, paid
      );
    `);
    
    // junction table for school courses
        await pool.query(`
          CREATE TABLE IF NOT EXISTS school_courses (
            id SERIAL PRIMARY KEY,
            school_id INT REFERENCES schools(id) ON DELETE CASCADE,
            course_id INT REFERENCES courses(id) ON DELETE CASCADE,
            assigned_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(school_id, course_id)
          );
        `);

      // junction table for classroom teachers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_teachers (
        id SERIAL PRIMARY KEY,
        classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
        teacher_id INT REFERENCES users2(id) ON DELETE CASCADE,
        UNIQUE (classroom_id, teacher_id)
      );

      `);

    // junction table for classroom courses
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_courses (
        id SERIAL PRIMARY KEY,
        classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
        course_id INT REFERENCES courses(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(classroom_id, course_id)
      );

      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS academic_terms (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,
          name TEXT NOT NULL, -- e.g. "2024/2025 - Term 1"
          start_date DATE,
          end_date DATE,
          is_active BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW()
        );

        `)

    // "Ending" a term is a distinct admin action from is_active above
    // (is_active reflects the calendar; ended reflects "reports are
    // finalized") — marking a term ended triggers bulk-generating every
    // classroom + student report for it (see adminController.js's
    // markTermEnded), and is what gates whether a school admin can see
    // those reports at all (see schoolAdminController.js's loadSection
    // "terms" branch).
    await pool.query(`
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS is_ended BOOLEAN DEFAULT false;
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP;
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS ended_by INTEGER REFERENCES users2(id);
    `)

    // Bulk report generation (adminController.js's endTerm) runs as a
    // detached background job, not inside the triggering HTTP request —
    // generating a report per classroom + per student can take minutes
    // for a school with many of either. These columns are the job's
    // progress, polled by the admin UI instead of the request just
    // hanging until everything finishes.
    await pool.query(`
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS report_generation_status TEXT DEFAULT 'idle';
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS report_generation_total INTEGER DEFAULT 0;
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS report_generation_completed INTEGER DEFAULT 0;
      ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS report_generation_errors TEXT[] DEFAULT '{}';
    `)

        await pool.query(`
          CREATE TABLE IF NOT EXISTS student_term_enrollments (
            id SERIAL PRIMARY KEY,
            student_id INT REFERENCES users2(id) ON DELETE CASCADE,
            school_id INT REFERENCES schools(id) ON DELETE CASCADE,
            term_id INT REFERENCES academic_terms(id) ON DELETE CASCADE,
            classroom_id INT REFERENCES classrooms(id),
            enrolled_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(student_id, term_id)
          );

          `)

    // Attendance sessions
    await pool.query(`
     CREATE TABLE IF NOT EXISTS attendance_sessions (
        id SERIAL PRIMARY KEY,

        school_id INT REFERENCES schools(id) ON DELETE CASCADE,
        term_id INT REFERENCES academic_terms(id) ON DELETE CASCADE,
        classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,

        taken_by INT REFERENCES users2(id), -- admin or instructor

        -- ✅ FIXED COLUMN (this caused your error)
        session_status TEXT DEFAULT 'held'
          CHECK (session_status IN ('held', 'holiday', 'no_class', 'cancelled')),

        note TEXT,

        date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),

        -- prevents duplicate attendance per class per day
        UNIQUE(term_id, classroom_id, date)
      );

      
      ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS week_number INT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
    `);

    // Attendance records
    await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id SERIAL PRIMARY KEY,

      session_id INT REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id INT REFERENCES users2(id) ON DELETE CASCADE,

      status TEXT DEFAULT 'present'
        CHECK (status IN ('present', 'absent', 'late')),

      marked_at TIMESTAMP DEFAULT NOW(),

      -- prevents duplicate marking per student per session
      UNIQUE(session_id, student_id)
    );

    `);

    // Activities
    await pool.query(`
        CREATE TABLE IF NOT EXISTS activities (
          id SERIAL PRIMARY KEY,
          school_id INT REFERENCES schools(id) ON DELETE CASCADE,  -- nullable if not school-specific
          user_id INT REFERENCES users2(id) ON DELETE SET NULL,    -- who triggered the action
          role TEXT,                                               -- e.g. 'parent', 'school_admin', 'teacher', 'student'
          action TEXT NOT NULL,                                    -- short description: "New student joined"
          details TEXT,                                            -- optional: "John Doe (email)"
          scope TEXT DEFAULT 'global',                             -- 'global', 'school', 'classroom'
          created_at TIMESTAMP DEFAULT NOW()
        );

        ALTER TABLE activities ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 0;
        ALTER TABLE activities 
        ADD COLUMN IF NOT EXISTS start_time TIMESTAMP,
        ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;

        ALTER TABLE activities ADD COLUMN IF NOT EXISTS lesson_id INTEGER;

        ALTER TABLE activities DROP CONSTRAINT IF EXISTS unique_user_lesson_action;
        ALTER TABLE activities ADD COLUMN IF NOT EXISTS session_id UUID DEFAULT gen_random_uuid();

      `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_instructors (
        id SERIAL PRIMARY KEY,
        classroom_id INT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        instructor_id INT NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
        UNIQUE(classroom_id, instructor_id) -- prevent duplicates
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INT REFERENCES users2(id) ON DELETE CASCADE,
        receiver_id INT REFERENCES users2(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        is_read BOOLEAN DEFAULT FALSE,
        is_delivered BOOLEAN DEFAULT FALSE
      );

      `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_messages (
        id SERIAL PRIMARY KEY,
        classroom_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS muted_students (
        id SERIAL PRIMARY KEY,
        classroom_id INT,
        student_id INT,
        muted_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
      `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_submissions (
        id SERIAL PRIMARY KEY,
        student_id INT REFERENCES students(id),
        course_id INT REFERENCES courses(id),
        file_url TEXT NOT NULL,
        notes TEXT,
        submitted_at TIMESTAMP NOT NULL,
        UNIQUE(student_id, course_id)
      );

    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_labs (
          id SERIAL PRIMARY KEY,
          lesson_id INTEGER NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          lab_type VARCHAR(50),
          instructions TEXT,
          starter_code JSONB,
          grading_type VARCHAR(20),
          passing_score INTEGER DEFAULT 70,
          points INTEGER DEFAULT 10,
          created_by INTEGER,
          created_at TIMESTAMP DEFAULT NOW()
      );
      
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lab_projects (
          id SERIAL PRIMARY KEY,
          lab_id INTEGER REFERENCES lesson_labs(id),
          student_id INTEGER REFERENCES users(id),
          project_name VARCHAR(255),
          project_data JSONB,
          status VARCHAR(30) DEFAULT 'draft',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE lab_projects 
      ADD COLUMN IF NOT EXISTS lab_type VARCHAR(50);
      ALTER TABLE lab_projects
      DROP CONSTRAINT IF EXISTS lab_projects_student_id_fkey;
      ALTER TABLE lab_projects
      ADD CONSTRAINT lab_projects_student_id_fkey
      FOREIGN KEY (student_id)
      REFERENCES users2(id)
      ON DELETE CASCADE;
    `);

    
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lab_submissions (
          id SERIAL PRIMARY KEY,
          project_id INTEGER REFERENCES lab_projects(id),
          submitted_by INTEGER,
          score INTEGER,
          feedback TEXT,
          graded_by INTEGER,
          submitted_at TIMESTAMP DEFAULT NOW()
      );
      
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS playground_projects (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          lab_type VARCHAR(50),
          project_name VARCHAR(255),
          project_data JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
      );
      
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS parent_training_invoices (
          id SERIAL PRIMARY KEY,
          parent_id INT NOT NULL REFERENCES users2(id),
          invoice_number VARCHAR(50) UNIQUE,
          training_title VARCHAR(255) DEFAULT 'Training Fee',
          agreed_amount NUMERIC(12,2) NOT NULL,
          discount NUMERIC(12,2) DEFAULT 0,
          total_paid NUMERIC(12,2) DEFAULT 0,
          balance NUMERIC(12,2) DEFAULT 0,
          payment_plan VARCHAR(30) DEFAULT 'One Time',
          due_date DATE,
          notes TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          created_by INT REFERENCES users2(id),
          created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE parent_training_invoices
      ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_sent_by INT REFERENCES users2(id),
      ADD COLUMN IF NOT EXISTS excess_payment NUMERIC(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS final_payment_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS grace_days INT DEFAULT 5;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_payments (
        id SERIAL PRIMARY KEY,
        invoice_id INT NOT NULL
            REFERENCES parent_training_invoices(id)
            ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL,
        payment_method VARCHAR(50),
        transaction_reference VARCHAR(100),
        payment_note TEXT,
        receipt_number VARCHAR(50),
        recorded_by INT
            REFERENCES users2(id),
        payment_date TIMESTAMP DEFAULT NOW()
    );
      
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_students (
          id SERIAL PRIMARY KEY,
          invoice_id INT NOT NULL
              REFERENCES parent_training_invoices(id)
              ON DELETE CASCADE,
          student_id INT NOT NULL
              REFERENCES users2(id)
              ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(invoice_id, student_id)
      );
      
    `);

    await pool.query(`
CREATE TABLE IF NOT EXISTS newsletters (
    id SERIAL PRIMARY KEY,

    subject VARCHAR(255) NOT NULL,
    preview_text TEXT,
    message TEXT NOT NULL,
    image_url TEXT,

    sender_name VARCHAR(100),
    sender_email VARCHAR(255),

    email_template VARCHAR(50) DEFAULT 'default',

    recipient_type VARCHAR(50) NOT NULL,

    recipient_ids INTEGER[],

    send_immediately BOOLEAN DEFAULT FALSE,

    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,

    status VARCHAR(20) DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'scheduled',
                'sending',
                'sent',
                'cancelled',
                'failed'
            )
        ),

    total_recipients INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,

    created_by INTEGER REFERENCES users2(id),

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

  ALTER TABLE newsletters
  ADD COLUMN IF NOT EXISTS total_recipients INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opened_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
`);
    
    await pool.query(`
CREATE TABLE IF NOT EXISTS newsletter_recipients (

    id SERIAL PRIMARY KEY,

    newsletter_id INTEGER
        REFERENCES newsletters(id)
        ON DELETE CASCADE,

    user_id INTEGER
        REFERENCES users2(id)
        ON DELETE CASCADE,

    email VARCHAR(255) NOT NULL,

    status VARCHAR(20)
        DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'sent',
                'failed'
            )
        ),

    delivered BOOLEAN DEFAULT FALSE,

    opened BOOLEAN DEFAULT FALSE,

    clicked BOOLEAN DEFAULT FALSE,

    failure_reason TEXT,

    sent_at TIMESTAMP,

    opened_at TIMESTAMP,

    clicked_at TIMESTAMP
);

  ALTER TABLE newsletter_recipients
  ADD COLUMN IF NOT EXISTS fullname VARCHAR(255);
  ALTER TABLE newsletter_recipients
  DROP CONSTRAINT newsletter_recipients_status_check;
  ALTER TABLE newsletter_recipients
  ADD CONSTRAINT newsletter_recipients_status_check
  CHECK(
    status IN
      (
        'pending',
        'sending',
        'sent',
        'failed'
      )
  );
`);
    
await pool.query(`
CREATE TABLE IF NOT EXISTS announcements (

    id SERIAL PRIMARY KEY,

    title VARCHAR(255) NOT NULL,

    message TEXT NOT NULL,

    image_url TEXT,

    type VARCHAR(30)
        DEFAULT 'information'
        CHECK (
            type IN (
                'information',
                'event',
                'success',
                'warning',
                'emergency',
                'promotion',
                'maintenance',
                'course'
            )
        ),

    priority VARCHAR(20)
        DEFAULT 'normal'
        CHECK (
            priority IN (
                'low',
                'normal',
                'high',
                'critical'
            )
        ),

    display_locations TEXT[],

    audience_type VARCHAR(50),

    audience_ids INTEGER[],

    button_text VARCHAR(100),

    button_link TEXT,

    background_color VARCHAR(30),

    text_color VARCHAR(30),

    button_color VARCHAR(30),

    show_once BOOLEAN DEFAULT FALSE,

    popup_delay INTEGER DEFAULT 0,

    dismissible BOOLEAN DEFAULT TRUE,

    allow_close BOOLEAN DEFAULT TRUE,

    start_date TIMESTAMP,

    end_date TIMESTAMP,

    status VARCHAR(20)
        DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'scheduled',
                'published',
                'expired',
                'archived'
            )
        ),

    created_by INTEGER
        REFERENCES users2(id),

    created_at TIMESTAMP DEFAULT NOW(),

    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS icon VARCHAR(100),
ADD COLUMN IF NOT EXISTS expires_after_view BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS max_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS show_on_mobile BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS show_on_desktop BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS animation VARCHAR(50),
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
`); 
    
    await pool.query(`
CREATE TABLE IF NOT EXISTS announcement_views (

    id SERIAL PRIMARY KEY,

    announcement_id INTEGER
        REFERENCES announcements(id)
        ON DELETE CASCADE,

    user_id INTEGER
        REFERENCES users2(id)
        ON DELETE CASCADE,

    viewed_at TIMESTAMP DEFAULT NOW(),

    dismissed BOOLEAN DEFAULT FALSE,

    dismissed_at TIMESTAMP,

    clicked BOOLEAN DEFAULT FALSE,

    clicked_at TIMESTAMP,

    UNIQUE (announcement_id, user_id)
);
`);

    await pool.query(`
CREATE TABLE IF NOT EXISTS report_generation_log (
  id SERIAL PRIMARY KEY,
  report_type TEXT NOT NULL,
  scope TEXT,
  period_label TEXT,
  formats_generated TEXT[],
  audience TEXT,
  triggered_by TEXT NOT NULL,
  triggered_by_user_id INTEGER REFERENCES users2(id),
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
`);

    // Term report cards (whole-class or one student) that the platform
    // admin generates from a classroom + term — persisted here (the PDF
    // bytes themselves, not just a file path, since a generated file on
    // disk isn't guaranteed to survive a redeploy) so the school admin can
    // view/download the same copy later without regenerating it.
    // student_id is NULL for a whole-class report; the partial unique
    // index below treats every NULL as the same "no student" slot per
    // classroom+term, which a plain UNIQUE constraint on a nullable column
    // can't do (Postgres treats every NULL as distinct).
    await pool.query(`
CREATE TABLE IF NOT EXISTS class_term_reports (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
  term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
  pdf BYTEA NOT NULL,
  filename TEXT NOT NULL,
  generated_by INTEGER REFERENCES users2(id),
  generated_at TIMESTAMP DEFAULT NOW()
);
`);

    await pool.query(`
CREATE UNIQUE INDEX IF NOT EXISTS class_term_reports_unique_idx
ON class_term_reports (school_id, classroom_id, term_id, COALESCE(student_id, 0));
`);

    // Which term a course was authorized for a school — nullable so
    // existing rows (assigned before terms had this concept) keep
    // meaning "authorized regardless of term". The old UNIQUE(school_id,
    // course_id) only allowed one row per course ever, which can't
    // represent "authorized again for a later term" as its own record —
    // replaced with a term-aware unique index (COALESCE'd so every
    // legacy NULL-term row still collapses to one slot per course, same
    // as before).
    await pool.query(`
      ALTER TABLE school_courses ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES academic_terms(id) ON DELETE SET NULL;
    `);
    await pool.query(`
      ALTER TABLE school_courses DROP CONSTRAINT IF EXISTS school_courses_school_id_course_id_key;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS school_courses_unique_idx
      ON school_courses (school_id, course_id, COALESCE(term_id, 0));
    `);

    // Confirmed record of "this course was actually worked on, in this
    // classroom, during this term" — backed by real lesson/quiz activity
    // evidence (see services/courseTermLinkService.js), not just a live
    // date-range guess. Populated two ways: a one-time backfill over a
    // school's past terms (using existing activity timestamps), and
    // ongoing real-time inserts as students complete lessons/quizzes
    // today. This is the source of truth classroom analytics and the
    // student past-course lock use for "what course happened in what
    // term", replacing on-the-fly date-windowing for terms that have
    // confirmed links.
    await pool.query(`
CREATE TABLE IF NOT EXISTS course_term_links (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE,
  first_activity_at TIMESTAMP,
  last_activity_at TIMESTAMP,
  source TEXT DEFAULT 'backfill',
  created_at TIMESTAMP DEFAULT NOW()
);
`);
    await pool.query(`
CREATE UNIQUE INDEX IF NOT EXISTS course_term_links_unique_idx
ON course_term_links (classroom_id, course_id, term_id);
`);

    // Records a student paying (from wallet) or a school admin manually
    // reactivating a specific ended term for a specific student, so they
    // regain access to continue any incomplete lessons/quizzes in that
    // term's courses. One row per (student, term) — reactivation is an
    // all-or-nothing state for that term, not per-course.
    await pool.query(`
CREATE TABLE IF NOT EXISTS student_term_reactivations (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
  school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  reactivated_by TEXT NOT NULL CHECK (reactivated_by IN ('student_payment', 'admin')),
  reactivated_by_user_id INTEGER REFERENCES users2(id),
  transaction_reference TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, term_id)
);
`);

    // Allow a parent to be the one who paid for a reactivation too (the
    // parent dashboard's "Pay & Unlock" flow), not just the student
    // themself or an admin. The CHECK above was declared inline at table
    // creation, so Postgres auto-named it
    // `student_term_reactivations_reactivated_by_check` — drop-and-recreate
    // is the idempotent way to widen an inline CHECK's allowed values.
    await pool.query(`
ALTER TABLE student_term_reactivations DROP CONSTRAINT IF EXISTS student_term_reactivations_reactivated_by_check;
ALTER TABLE student_term_reactivations ADD CONSTRAINT student_term_reactivations_reactivated_by_check
  CHECK (reactivated_by IN ('student_payment', 'admin', 'parent_payment'));
`);

    // Cross-role in-app notification feed. One row per notification per
    // recipient (fan-out is done at insert time, not read time) so
    // per-user read state is a plain boolean column, no join table needed.
    await pool.query(`
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users2(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  url TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
`);

    // push_subscriptions never had a uniqueness guarantee on endpoint, so
    // the same browser subscription could accumulate duplicate rows, and
    // POST /subscribe had no way to correct a stale user_id (e.g. a shared
    // device where someone else logs in later) — dedupe existing rows
    // before adding the constraint that makes the upsert in routes/userRoutes.js
    // possible, same drop-then-add idempotent pattern used above for
    // student_term_reactivations' CHECK constraint.
    await pool.query(`
      DELETE FROM push_subscriptions a USING push_subscriptions b
      WHERE a.id > b.id AND a.endpoint = b.endpoint;
    `);
    await pool.query(`
      ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;
      ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE(endpoint);
    `);
    await pool.query(`
      ALTER TABLE school_courses DROP CONSTRAINT IF EXISTS school_courses_school_id_course_id_key;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS school_courses_unique_idx
      ON school_courses (school_id, course_id, COALESCE(term_id, 0));
    `);

    // Confirmed record of "this course was actually worked on, in this
    // classroom, during this term" — backed by real lesson/quiz activity
    // evidence (see services/courseTermLinkService.js), not just a live
    // date-range guess. Populated two ways: a one-time backfill over a
    // school's past terms (using existing activity timestamps), and
    // ongoing real-time inserts as students complete lessons/quizzes
    // today. This is the source of truth classroom analytics and the
    // student past-course lock use for "what course happened in what
    // term", replacing on-the-fly date-windowing for terms that have
    // confirmed links.
    await pool.query(`
CREATE TABLE IF NOT EXISTS course_term_links (
  id SERIAL PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE,
  first_activity_at TIMESTAMP,
  last_activity_at TIMESTAMP,
  source TEXT DEFAULT 'backfill',
  created_at TIMESTAMP DEFAULT NOW()
);
`);
    await pool.query(`
CREATE UNIQUE INDEX IF NOT EXISTS course_term_links_unique_idx
ON course_term_links (classroom_id, course_id, term_id);
`);

    // Records a student paying (from wallet) or a school admin manually
    // reactivating a specific ended term for a specific student, so they
    // regain access to continue any incomplete lessons/quizzes in that
    // term's courses. One row per (student, term) — reactivation is an
    // all-or-nothing state for that term, not per-course.
    await pool.query(`
CREATE TABLE IF NOT EXISTS student_term_reactivations (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,
  school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  reactivated_by TEXT NOT NULL CHECK (reactivated_by IN ('student_payment', 'admin')),
  reactivated_by_user_id INTEGER REFERENCES users2(id),
  transaction_reference TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, term_id)
);
`);

    // Allow a parent to be the one who paid for a reactivation too (the
    // parent dashboard's "Pay & Unlock" flow), not just the student
    // themself or an admin. The CHECK above was declared inline at table
    // creation, so Postgres auto-named it
    // `student_term_reactivations_reactivated_by_check` — drop-and-recreate
    // is the idempotent way to widen an inline CHECK's allowed values.
    await pool.query(`
ALTER TABLE student_term_reactivations DROP CONSTRAINT IF EXISTS student_term_reactivations_reactivated_by_check;
ALTER TABLE student_term_reactivations ADD CONSTRAINT student_term_reactivations_reactivated_by_check
  CHECK (reactivated_by IN ('student_payment', 'admin', 'parent_payment'));
`);

    console.log("✅ All tables are updated and ready.");
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
  }
}

module.exports = createTables;
