const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'tutorlink_uc',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,
});

// Every connection uses the campus time zone, so NOW() and CURDATE() inside the
// stored procedures, the function and the triggers match the times users enter.
const dbTimeZone = process.env.DB_TIMEZONE || '+08:00';
if (!/^[+-]\d{2}:\d{2}$/.test(dbTimeZone)) {
  throw new Error('DB_TIMEZONE must look like +08:00');
}
pool.pool.on('connection', (connection) => {
  connection.query('SET time_zone = ?', [dbTimeZone]);
});

module.exports = pool;