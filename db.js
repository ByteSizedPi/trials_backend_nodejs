const mysql = require("mysql2/promise");

// Configure MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

console.log(
  "\nConnection pool created",
  "\n\thost: ",
  process.env.DB_HOST,
  "\n\tuser: ",
  process.env.DB_USER,
  "\n\tdatabase: ",
  process.env.DB_NAME,
  "\n"
);

// async function executeTransaction(queries = []) {
//   const connection = await pool.getConnection();

//   try {
//     await connection.beginTransaction();

//     for (const [query, params = []] of queries) {
//       await connection.execute(query, params);
//     }

//     await connection.commit();
//   } catch (e) {
//     await connection.rollback();
//     throw e;
//   } finally {
//     connection.release();
//   }
// }

// Function to execute a query
async function executeQuery(query, params = [], jsonformat = true) {
  const connection = await pool.getConnection();
  try {
    const [rows, fields] = await connection.execute(query, params);
    if (jsonformat) {
      return rows;
    } else {
      return { fields, rows };
    }
  } finally {
    connection.release();
  }
}

// Function to execute an insert query
async function insertQuery(query, params = []) {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.execute(query, params);
    return result.insertId;
  } finally {
    connection.release();
  }
}

// Standard Queries
const QUERIES = {
  // Events
  ALL_EVENTS: () =>
    executeQuery(`
      SELECT id, date_created, name, event_date, location, lap_count, section_count
        FROM Events
        WHERE deleted = 0
        ORDER BY event_date ASC;
    `),

  UPCOMING_EVENTS: () =>
    executeQuery(`
      SELECT id, date_created, name, event_date, location, lap_count, section_count
      FROM Events
      WHERE completed = 0 AND deleted = 0
      ORDER BY event_date ASC;
    `),

  COMPLETED_EVENTS: () =>
    executeQuery(`
      SELECT id, date_created, name, event_date, location, lap_count, section_count
      FROM Events
      WHERE completed = 1 AND deleted = 0
      ORDER BY event_date DESC;
    `),

  COMPLETE_EVENT: (event_id) =>
    insertQuery(`UPDATE Events SET completed = 1 WHERE id = ?;`, [event_id]),

  DELETE_EVENT: (event_id) =>
    insertQuery(`UPDATE Events SET deleted = 1 WHERE id = ?;`, [event_id]),

  EVENT: (event_id) =>
    executeQuery(
      `
        SELECT id, name, event_date, location, lap_count
        FROM Events
        WHERE id = ?;
      `,
      [event_id]
    ),
  // Sections
  ALL_SECTIONS: (event_id) =>
    executeQuery(
      `
        SELECT section_number
        FROM Sections
        WHERE event_id = ?;
      `,
      [event_id]
    ),
  // Riders
  ALL_RIDERS: (event_id) =>
    executeQuery(
      `
      SELECT rider_number, rider_name, c.name AS class
      FROM Riders r
      JOIN Classes c ON r.class_id = c.id
      WHERE event_id = ?
      ORDER BY rider_number ASC;
    `,
      [event_id]
    ),
  GET_SCORES: (event_id, section_number, rider_number) =>
    executeQuery(
      `
        SELECT lap_number, score
        FROM Scores
        WHERE event_id = ? AND section_number = ? AND rider_number = ?;
      `,
      [event_id, section_number, rider_number]
    ),
  POST_SCORE: (event_id, section_number, rider_number, lap_number, score) =>
    insertQuery(
      `
        INSERT INTO Scores (event_id, section_number, rider_number, lap_number, score)
        VALUES (?, ?, ?, ?, ?);
    `,
      [event_id, section_number, rider_number, lap_number, score]
    ),
  UPDATE_SCORE: (event_id, section_number, rider_number, lap_number, score) =>
    insertQuery(
      `
    UPDATE Scores
    SET score = ?
    WHERE event_id = ? AND section_number = ? AND rider_number = ? AND lap_number = ?;
  `,
      [score, event_id, section_number, rider_number, lap_number]
    ),
  CREATE_EVENT: (
    event_name,
    event_location,
    event_date,
    section_count,
    lap_count,
    password
  ) =>
    insertQuery(
      `
    INSERT INTO Events (name, location, event_date, section_count, lap_count, password)
    VALUES (?, ?, ?, ?, ?, ?);
  `,
      [
        event_name,
        event_location,
        event_date,
        section_count,
        lap_count,
        password,
      ]
    ),
  CREATE_SECTION: (event_id, section_number) =>
    insertQuery(
      `
    INSERT INTO Sections (event_id, section_number)
    VALUES (?, ?);
  `,
      [event_id, section_number]
    ),
  CREATE_RIDERS: (query) =>
    insertQuery(`
    INSERT INTO Riders (event_id, rider_number, rider_name, class_id)
    VALUES ${query};
  `),
  GET_SCORES_SUMMARY_BY_EVENTID: (event_id) =>
    executeQuery(
      `
        SELECT 
          s.rider_number,
            rider_name,
            c.name as class_name,
            SUM(score) as total_score
        FROM Events e
        JOIN Sections sec ON e.id = sec.event_id
        JOIN Scores s ON e.id = s.event_id AND s.section_number = sec.section_number
        JOIN Riders r ON e.id = r.event_id AND s.rider_number = r.rider_number
        JOIN Classes c ON r.class_id = c.id
        WHERE e.id = 57
        GROUP BY rider_number, rider_name, class_name
        ORDER BY c.id, total_score ASC;
  `,
      [event_id]
    ),
  GET_SECTION_BY_EVENTID: (event_id) =>
    executeQuery(
      `
      SELECT *
      FROM Events
      WHERE id = ?;
      `,
      [event_id]
    ),

  GET_SCORES_SUMMARY_BY_EVENTID_EXCEL: (event_id) =>
    executeQuery(
      `
        WITH score_arrays AS (
          SELECT
                R.rider_number,
                R.rider_name,
                R.class_id,
                C.name AS class_name,
                S.section_number,
                CONCAT("[", GROUP_CONCAT(S.score ORDER BY S.lap_number), "]") AS scores
            FROM Scores S
            JOIN Riders R USING (event_id, rider_number)
            JOIN Classes C ON R.class_id = C.id
            WHERE S.event_id = ?
            GROUP BY R.rider_number, S.section_number, R.rider_name, R.class_id, C.name
            ORDER BY R.rider_number, S.section_number
        )
        SELECT
          rider_number,
          rider_name,
            class_id,
            class_name,
            CONCAT(
                '{ ', GROUP_CONCAT(CONCAT('"', section_number, '":', scores)), ' }'
          ) AS JSON_scores
        FROM score_arrays
        GROUP BY rider_number, rider_name, class_id, class_name;
  `,
      [event_id],
      false
    ),
  EVENT_HAS_PASSWORD: (event_id) =>
    executeQuery(
      `
    SELECT password
    FROM Events
    WHERE id = ?;
  `,
      [event_id]
    ),
  VERIFY_EVENT_PASSWORD: (event_id, password) =>
    executeQuery(
      `
    SELECT id
    FROM Events
    WHERE id = ? AND password = ?;
  `,
      [event_id, password]
    ),
};

module.exports = { QUERIES, executeQuery, insertQuery };
