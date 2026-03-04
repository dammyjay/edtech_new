const pool = require("../models/db");
const allowedTables = require("../utils/allowedTables");

// Show list of tables
// exports.showTables = async (req, res) => {
//     if (!req.session.user || req.session.user.role !== "admin") {
//     return res.redirect("/admin/login");
//   }
//     const infoResult = await pool.query(
//           "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//         );
//         const info = infoResult.rows[0];
//   res.render("admin/dbTables", 
//     { tables: allowedTables, 
//         info, role: "admin", // ✅ important
//       user: req.session.user, });

// };

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
      const textColumns = columns
        .filter(col => col.data_type.includes("text") || col.data_type.includes("character"))
        .map(col => col.column_name);

      if (textColumns.length > 0) {
        const conditions = textColumns.map((col, i) => `${col} ILIKE $${i + 1}`);
        searchQuery = `WHERE ${conditions.join(" OR ")}`;
        searchValues = textColumns.map(() => `%${search}%`);
      }
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM ${table} ${searchQuery}`,
      searchValues
    );

    const totalRows = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / limit);

    const result = await pool.query(
      `SELECT * FROM ${table} ${searchQuery} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
      searchValues
    );

    res.render("admin/viewTable", {
      table,
      rows: result.rows,
      columns,
      currentPage: page,
      totalPages,
      search,
      info,
        role: "admin", // ✅ important
      user: req.session.user,
    });

  } catch (err) {
    res.status(500).send(err.message);
  }
};

// Create record
// exports.createRecord = async (req, res) => {
//   const table = req.params.table;
//   const data = req.body;

//   if (!allowedTables.includes(table)) {
//     return res.status(403).send("Unauthorized table");
//   }

//   try {
//     const columns = Object.keys(data);
//     const values = Object.values(data);

//     const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");

//     await pool.query(
//       `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`,
//       values
//     );

//     res.redirect(`/admin/db/${table}`);
//   } catch (err) {
//     res.status(500).send(err.message);
//   }
// };

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
  const data = req.body;

  if (!allowedTables.includes(table)) {
    return res.status(403).send("Unauthorized table");
  }

  try {

    Object.keys(data).forEach(key => {
        if (data[key] === "true") data[key] = true;
        if (data[key] === "false") data[key] = false;
    });
    const columns = Object.keys(data);
    const values = Object.values(data);

    const setQuery = columns
      .map((col, i) => `${col} = $${i + 1}`)
      .join(",");

    await pool.query(
      `UPDATE ${table} SET ${setQuery} WHERE id = $${columns.length + 1}`,
      [...values, id]
    );

    res.redirect(`/admin/db/${table}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
};

exports.getTableData = async (req, res) => {
  const table = req.params.table;
  const search = req.query.search || "";

  if (!allowedTables.includes(table)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const columnResult = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = $1
  `, [table]);

  const columns = columnResult.rows;

  let searchQuery = "";
  let searchValues = [];

  if (search) {
    const textColumns = columns
      .filter(col => col.data_type.includes("text") || col.data_type.includes("character"))
      .map(col => col.column_name);

    if (textColumns.length > 0) {
      const conditions = textColumns.map((col, i) => `${col} ILIKE $${i + 1}`);
      searchQuery = `WHERE ${conditions.join(" OR ")}`;
      searchValues = textColumns.map(() => `%${search}%`);
    }
  }

  const result = await pool.query(
    `SELECT * FROM ${table} ${searchQuery} ORDER BY id DESC LIMIT 10`,
    searchValues
  );

  res.json(result.rows);
};