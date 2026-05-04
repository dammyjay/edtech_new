const pool = require("../models/db");
const allowedTables = require("../utils/allowedTables");


exports.showTables = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0];

  // 🔥 Get count for each table
  const tableData = [];

  for (let table of allowedTables) {
    const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
    tableData.push({
      name: table,
      count: result.rows[0].count
    });
  }

  res.render("admin/dbTables", {
    tables: tableData,   // 👈 changed
    info,
    role: "admin",
    user: req.session.user,
  });
};

// Show table records
exports.viewTable = async (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  const foreignKeyMap = {
    user_id: {
      table: "users2",
      nameColumn: "fullname"
    },
    student_id: {
      table: "users2",
      nameColumn: "fullname"
    },
    child_id: {
      table: "users2",
      nameColumn: "fullname"
    },
    parent_id: {
      table: "users2",
      nameColumn: "fullname"
    },
    school_id: {
      table: "schools",
      nameColumn: "name"
    },
    course_id: {
      table: "courses",
      nameColumn: "title"
    },
    module_id: {
      table: "modules",
      nameColumn: "title"
    },
    lesson_id: {
      table: "lessons",
      nameColumn: "title"
    },
    classroom_id: {
      table: "classrooms",
      nameColumn: "name"
    },
    term_id: {
      table: "academic_terms",
      nameColumn: "name"
    } 
  };

  const infoResult = await pool.query(
        "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
      );
      const info = infoResult.rows[0];
  const table = req.params.table;
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";

  if (!allowedTables.includes(table)) {
    return res.status(403).send("Unauthorized table");
  }

  try {
    // Get column metadata
    const columnResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1
    `, [table]);

    const columns = columnResult.rows;

    // Build search condition dynamically
    let searchQuery = "";
    let searchValues = [];

    if (search) {
      const searchableColumns = columns
        .filter(col =>
          col.data_type.includes("text") ||
          col.data_type.includes("character") ||
          col.data_type.includes("integer")
        )
        .map(col => col.column_name);

      if (search) {
        const conditions = searchableColumns.map((col, i) => {
          return `CAST(${col} AS TEXT) ILIKE $${i + 1}`;
        });

        searchQuery = `WHERE ${conditions.join(" OR ")}`;
        searchValues = searchableColumns.map(() => `%${search}%`);
      }
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM ${table} ${searchQuery}`,
      searchValues
    );

    const totalRows = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / limit);

    // Check if table has id column
    const hasId = columns.some(col => col.column_name === "id");

    let orderClause = "";
    if (hasId) {
      orderClause = "ORDER BY id DESC";
    }

    const result = await pool.query(
      `SELECT * FROM ${table} ${searchQuery} ${orderClause} LIMIT ${limit} OFFSET ${offset}`,
      searchValues
    );

    let rows = result.rows;

    // for (const col of Object.keys(foreignKeyMap)) {

    //   if (columns.some(c => c.column_name === col)) {

    //     const ids = rows.map(r => r[col]).filter(Boolean);

    //     if (ids.length === 0) continue;

    //     const fk = foreignKeyMap[col];

    //     const nameResult = await pool.query(
    //       `SELECT id, ${fk.nameColumn} FROM ${fk.table} WHERE id = ANY($1)`,
    //       [ids]
    //     );

    //     const map = {};
    //     nameResult.rows.forEach(r => {
    //       map[r.id] = r[fk.nameColumn];
    //     });

    //     rows.forEach(r => {
    //       if (r[col]) {
    //         r[col + "_name"] = map[r[col]] || null;
    //       }
    //     });

    //   }

    // }

    for (const col of Object.keys(foreignKeyMap)) {

      const columnMeta = columns.find(c => c.column_name === col);

      if (!columnMeta) continue;

      // 🚨 ONLY process INTEGER foreign keys
      if (!columnMeta.data_type.includes("integer")) continue;

      const ids = rows.map(r => r[col]).filter(id => typeof id === "number");

      if (ids.length === 0) continue;

      const fk = foreignKeyMap[col];

      const nameResult = await pool.query(
        `SELECT id, ${fk.nameColumn} FROM ${fk.table} WHERE id = ANY($1)`,
        [ids]
      );

      const map = {};
      nameResult.rows.forEach(r => {
        map[r.id] = r[fk.nameColumn];
      });

      rows.forEach(r => {
        if (r[col]) {
          r[col + "_name"] = map[r[col]] || null;
        }
      });
    }

    res.render("admin/viewTable", {
      table,
      rows,
      columns,
      currentPage: page,
      totalPages,
      search,
      info,
      role: "admin",
      user: req.session.user
    });

  } catch (err) {
    res.status(500).send(err.message);
  }
};

// Create record
exports.createRecord = async (req, res) => {
  try {
    const { table } = req.params;

    if (!allowedTables.includes(table)) {
      return res.status(403).send("Unauthorized table");
    }

    const data = req.body;

    if (!data || Object.keys(data).length === 0) {
      return res.status(400).send("No data received");
    }

    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const query = `
      INSERT INTO ${table} (${columns.join(",")})
      VALUES (${placeholders.join(",")})
    `;

    await pool.query(query, values);

    res.status(200).send("Created");

  } catch (err) {
    console.error("CREATE ERROR:", err);
    res.status(500).send(err.message);
  }
};

// Delete record
exports.deleteRecord = async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;

  if (!allowedTables.includes(table)) {
    return res.status(403).send("Unauthorized table");
  }

  try {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    res.redirect(`/admin/db/${table}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
};

// Update record
exports.updateRecord = async (req, res) => {
  const table = req.params.table;
  const id = req.params.id;
  let data = { ...req.body };

  if (!allowedTables.includes(table)) {
    return res.status(403).send("Unauthorized table");
  }

  try {
    // 🔹 1. Get column metadata
    const columnResult = await pool.query(
      `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1
      `,
      [table]
    );

    const columnTypes = {};
    columnResult.rows.forEach(col => {
      columnTypes[col.column_name] = col.data_type;
    });

    // 🔹 2. Clean + transform data
    Object.keys(data).forEach(key => {

      // 🚫 Remove frontend-only fields
      if (key.endsWith("_name")) {
        delete data[key];
        return;
      }

      // 🚫 Skip columns that don't exist in DB
      if (!columnTypes[key]) {
        delete data[key];
        return;
      }

      // ✅ Convert booleans
      if (data[key] === "true") data[key] = true;
      if (data[key] === "false") data[key] = false;

      // ✅ Empty string → NULL
      if (data[key] === "") {
        data[key] = null;
      }

      // ✅ Handle JSON / JSONB
      if (columnTypes[key] === "json" || columnTypes[key] === "jsonb") {
        try {
          if (typeof data[key] === "string") {
            data[key] = data[key].trim();

            if (data[key] === "") {
              data[key] = null;
            } else {
              data[key] = JSON.parse(data[key]);
            }
          }
        } catch (err) {
          console.error("❌ BAD JSON VALUE:", data[key]);
          throw new Error(`Invalid JSON format for ${key}`);
        }
      }

      // ✅ Handle INTEGER / NUMERIC
      if (
        columnTypes[key]?.includes("integer") ||
        columnTypes[key]?.includes("numeric")
      ) {
        if (data[key] !== null) {
          const num = Number(data[key]);
          if (isNaN(num)) {
            throw new Error(`Invalid number for ${key}`);
          }
          data[key] = num;
        }
      }

      // ✅ Handle DATE
      if (columnTypes[key] === "date") {
        if (data[key]) {
          const date = new Date(data[key]);
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid date for ${key}`);
          }
          data[key] = date;
        }
      }

      // ✅ Handle TIMESTAMP
      if (columnTypes[key]?.includes("timestamp")) {
        if (data[key]) {
          const date = new Date(data[key]);
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid datetime for ${key}`);
          }
          data[key] = date;
        }
      }
    });

    // 🔹 3. Build query safely
    const columns = Object.keys(data);

    if (columns.length === 0) {
      return res.status(400).send("No valid fields to update");
    }

    const values = columns.map(col => data[col]);

    const setQuery = columns
      .map((col, i) => `${col} = $${i + 1}`)
      .join(", ");

    // 🔹 4. Execute query
    await pool.query(
      `UPDATE ${table} SET ${setQuery} WHERE id = $${columns.length + 1}`,
      [...values, id]
    );

    console.log("✅ Updated record in", table, "ID:", id);
    console.log("📦 Final cleaned data:", data);

    res.redirect(`/admin/db/${table}`);

  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(500).send(err.message);
  }
};

exports.getTableData = async (req, res) => {

  const table = req.params.table;
  const search = req.query.search || "";

  if (!allowedTables.includes(table)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const foreignKeyMap = {
    user_id: { table: "users2", nameColumn: "fullname" },
    student_id: { table: "users2", nameColumn: "fullname" },
    child_id: { table: "users2", nameColumn: "fullname" }, // self-referencing
    parent_id: { table: "users2", nameColumn: "fullname" }, // self-referencing
    school_id: { table: "schools", nameColumn: "name" },
    course_id: { table: "courses", nameColumn: "title" },
    module_id: { table: "modules", nameColumn: "title" },
    lesson_id: { table: "lessons", nameColumn: "title" },
    classroom_id: { table: "classrooms", nameColumn: "name" }
  };

  const columnResult = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = $1
  `, [table]);

  const columns = columnResult.rows;


  let searchQuery = "";
  let searchValues = [];

  if (!search) {
    searchQuery = "";
  }
  const hasId = columns.some(col => col.column_name === "id");

  let orderClause = "";
  if (hasId) {
    orderClause = "ORDER BY id DESC";
  }

  // const result = await pool.query(
  //  `SELECT * FROM ${table} ${searchQuery} ${orderClause} LIMIT 10`,
  //   searchValues
  // ); 

  let query;

  if (search) {
    // search entire table
    query = `SELECT * FROM ${table} ${orderClause}`;
  } else {
    // normal pagination
    query = `SELECT * FROM ${table} ${orderClause} LIMIT 10`;
  }

  const result = await pool.query(query);

  let rows = result.rows;

  // 🔥 Attach foreign key names
  for (const col of Object.keys(foreignKeyMap)) {

    if (columns.some(c => c.column_name === col)) {

      const ids = rows.map(r => r[col]).filter(Boolean);

      if (ids.length === 0) continue;

      const fk = foreignKeyMap[col];

      const nameResult = await pool.query(
        `SELECT id, ${fk.nameColumn} FROM ${fk.table} WHERE id = ANY($1)`,
        [ids]
      );

      const map = {};
      nameResult.rows.forEach(r => {
        map[r.id] = r[fk.nameColumn];
      });

      rows.forEach(r => {
        if (r[col]) {
          r[col + "_name"] = map[r[col]] || null;
        }
      });

    }

  }

  if (search) {
    rows = rows.filter(row => {
      return Object.values(row).some(val =>
        String(val).toLowerCase().includes(search.toLowerCase())
      );
    });
  }

  res.json(rows);

};