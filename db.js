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
    SELECT e.*, COUNT(s.section_number) AS section_count
    FROM Events e
    JOIN Sections s on e.id = s.event_id
    GROUP BY e.id, e.date_created, e.name, e.event_date, e.location, e.lap_count, e.completed
    ORDER BY e.event_date ASC;
  `),
  UPCOMING_EVENTS: () =>
    executeQuery(`
    SELECT e.*, COUNT(s.section_number) AS section_count
    FROM Events e
    JOIN Sections s on e.id = s.event_id
    WHERE completed = 0
    GROUP BY e.id, e.date_created, e.name, e.event_date, e.location, e.lap_count, e.completed
    ORDER BY e.event_date ASC;
  `),
  COMPLETED_EVENTS: () =>
    executeQuery(`
    SELECT e.*, COUNT(s.section_number) AS section_count
    FROM Events e
    JOIN Sections s on e.id = s.event_id
    WHERE completed = 1
    GROUP BY e.id, e.date_created, e.name, e.event_date, e.location, e.lap_count, e.completed
    ORDER BY e.event_date DESC;
  `),
  COMPLETE_EVENT: (event_id) =>
    insertQuery(
      `
    UPDATE Events
    SET completed = 1
    WHERE id = ?;
  `,
      [event_id]
    ),
  DELETE_EVENT: (event_id) =>
    insertQuery(
      `
    DELETE FROM Events
    WHERE id = ?;
  `,
      [event_id]
    ),
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
  CREATE_EVENT: (event_name, event_location, event_date, laps, password) =>
    insertQuery(
      `
    INSERT INTO Events (name, location, event_date, lap_count, password)
    VALUES (?, ?, ?, ?, ?);
  `,
      [event_name, event_location, event_date, laps, password]
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
    SELECT s.rider_number, rider_name, c.name as class_name, SUM(score) as total_score
    FROM Events e
    JOIN Sections sec ON e.id = sec.event_id
    JOIN Scores s ON e.id = s.event_id AND s.section_number = sec.section_number
    JOIN Riders r ON e.id = r.event_id AND s.rider_number = r.rider_number
    JOIN Classes c ON r.class_id = c.id
    WHERE e.id = ?
    GROUP BY rider_number, rider_name, class_name
    ORDER BY
    CASE class_name
        WHEN 'M' THEN 1
        WHEN 'E' THEN 2
        WHEN 'I' THEN 3
        WHEN 'C' THEN 4
    END,
    total_score ASC;
  `,
      [event_id]
    ),
  GET_SCORES_SUMMARY_BY_EVENTID_EXCEL: (event_id) =>
    executeQuery(
      `
    SELECT s.rider_number, rider_name, c.name as class_name, SUM(score) as total_score
    FROM Events e
    JOIN Sections sec ON e.id = sec.event_id
    JOIN Scores s ON e.id = s.event_id AND s.section_number = sec.section_number
    JOIN Riders r ON e.id = r.event_id AND s.rider_number = r.rider_number
    JOIN Classes c ON r.class_id = c.id
    WHERE e.id = ?
    GROUP BY rider_number, rider_name, class_name
    ORDER BY
    CASE class_name
        WHEN 'M' THEN 1
        WHEN 'E' THEN 2
        WHEN 'I' THEN 3
        WHEN 'C' THEN 4
    END,
    total_score ASC;
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
