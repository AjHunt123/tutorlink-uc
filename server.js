require('dotenv').config();
const fs = require('fs');
const express = require('express');
const path = require('path');
const session = require('express-session');
const pool = require('./config/db');
const authRoutes = require('./routes/auth');
const tutorRoutes = require('./routes/tutors');
const sessionRoutes = require('./routes/sessions');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    req.body = {};
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use('/api', authRoutes);
app.use('/api', tutorRoutes);
app.use('/api/sessions', sessionRoutes);
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ message: 'Request body must be valid JSON' });
  }
  console.error('Unhandled request error:', error);
  return res.status(500).json({ message: 'An unexpected server error occurred' });
});

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

  await initializeDatabase();
  app.listen(PORT, () => console.log(`TutorLink UC running on port ${PORT}`));
}

startServer().catch((error) => {
  console.error('TutorLink UC startup failed:', error);
  process.exitCode = 1;
});

module.exports = app;