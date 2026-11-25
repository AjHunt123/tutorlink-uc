require('dotenv').config();
// The schedule rules compare session times with "now", so the Node process and
// the MySQL session must both use the campus time zone (not the server's).
process.env.TZ = process.env.APP_TZ || 'Asia/Manila';
const fs = require('fs');
const express = require('express');
const path = require('path');
const session = require('express-session');
const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const tutorRoutes = require('./routes/tutors');
const sessionRoutes = require('./routes/sessions');
const reportRoutes = require('./routes/reports');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    req.body = {};
  }
  next();
});

// CSRF protection. The session cookie is SameSite=None so the app also works in
// an embedded preview, therefore every state-changing request must carry a custom
// header. A browser cannot add a custom header to a cross-site form or no-cors
// request, and the API sends no CORS headers, so other sites cannot forge it.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'tutorlink') {
    return res.status(403).json({ message: 'Request blocked: missing security header' });
  }
  return next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: process.env.COOKIE_SAMESITE || 'none',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use('/api', authRoutes);
app.use('/api', tutorRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/reports', reportRoutes);
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ message: 'Request body must be valid JSON' });
  }
  console.error('Unhandled request error:', error);
  return res.status(500).json({ message: 'An unexpected server error occurred' });
});

// Optional first-run helper (INIT_SCHEMA=true): creates the tables only. It needs
// a MySQL user with CREATE rights, which the restricted tutorlink_app user does
// not have; normally run db/schema.sql, db/seed.sql and db/routines.sql as the
// MySQL administrator instead (see README.md).
async function initializeDatabase() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const statements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.execute(statement);
  }

  console.log('Database schema initialized');
}

// Health check: proves Express is running AND can reach MySQL
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT 1 AS ok');
    res.json({ status: 'ok', database: rows[0].ok === 1 ? 'connected' : 'unknown' });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in the environment');
  }

  if (process.env.INIT_SCHEMA === "true") await initializeDatabase();
  app.listen(PORT, () => console.log(`TutorLink UC running on port ${PORT}`));
}

startServer().catch((error) => {
  console.error('TutorLink UC startup failed:', error);
  process.exitCode = 1;
});

module.exports = app;