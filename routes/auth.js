const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const router = express.Router();
const roles = new Set(['learner', 'tutor']);

function publicUser(row) {
  return {
    id: row.id,
    role: row.role,
    name: row.full_name,
    email: row.email,
    studentNo: row.student_no,
  };
}

function setSessionUser(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.user = user;
      return resolve();
    });
  });
}

function registrationError(res, status, field, message) {
  return res.status(status).json({ ok: false, field, message });
}

class RegistrationValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

router.get('/session', (req, res) => {
  return res.json({
    loggedIn: Boolean(req.session.user),
    user: req.session.user || null,
  });
});

router.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Please log in to view your profile' });
  }
  return res.json({ user: req.session.user });
});

router.post('/register', async (req, res) => {
  const { role, student_no, full_name, email, password, program, year_level } = req.body;
  const selectedRole = role || 'learner';

  if (!roles.has(selectedRole)) {
    return registrationError(res, 400, 'role', 'Account type must be learner or tutor');
  }

  const normalizedStudentNo = typeof student_no === 'string' ? student_no.trim() : '';
  if (!normalizedStudentNo) {
    return registrationError(res, 400, 'student_no', 'Student number is required');
  }
  if (normalizedStudentNo.length < 5 || normalizedStudentNo.length > 20
    || !/^[0-9-]+$/.test(normalizedStudentNo)) {
    return registrationError(
      res,
      400,
      'student_no',
      'Student number must be 5 to 20 characters and contain only digits and dashes'
    );
  }

  const normalizedName = typeof full_name === 'string' ? full_name.trim() : '';
  if (normalizedName.length < 2 || normalizedName.length > 100) {
    return registrationError(res, 400, 'full_name', 'Full name is required and must be 2 to 100 characters');
  }

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail) {
    return registrationError(res, 400, 'email', 'Email is required');
  }
  if (normalizedEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return registrationError(res, 400, 'email', 'Email must be a valid email address');
  }

  const normalizedProgram = typeof program === 'string' ? program.trim() : '';
  if (!normalizedProgram) {
    return registrationError(res, 400, 'program', 'Program is required');
  }
  if (normalizedProgram.length > 120) {
    return registrationError(res, 400, 'program', 'Program must be 120 characters or fewer');
  }

  const year = Number(year_level);
  if (!Number.isInteger(year) || year < 1 || year > 6) {
    return registrationError(res, 400, 'year_level', 'Year level must be a whole number from 1 to 6');
  }

  if (typeof password !== 'string' || !password) {
    return registrationError(res, 400, 'password', 'Password is required');
  }
  if (password.length < 8) {
    return registrationError(res, 400, 'password', 'Password must be at least 8 characters');
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return registrationError(res, 400, 'password', 'Password must be no more than 72 UTF-8 bytes');
  }

  let bio = '';
  let subjectIds = [];
  if (selectedRole === 'tutor') {
    if (typeof req.body.bio !== 'undefined' && typeof req.body.bio !== 'string') {
      return registrationError(res, 400, 'bio', 'Tutor bio must be text');
    }
    bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
    if (bio.length > 500) {
      return registrationError(res, 400, 'bio', 'Tutor bio must be 500 characters or fewer');
    }

    if (!Array.isArray(req.body.subject_ids) || !req.body.subject_ids.length) {
      return registrationError(res, 400, 'subject_ids', 'Choose at least one subject you teach');
    }
    subjectIds = [];
    for (const subjectId of req.body.subject_ids) {
      const validId = (typeof subjectId === 'number' && Number.isSafeInteger(subjectId))
        || (typeof subjectId === 'string' && /^\d+$/.test(subjectId));
      const id = Number(subjectId);
      if (!validId || !Number.isSafeInteger(id) || id < 1) {
        return registrationError(res, 400, 'subject_ids', 'Choose valid subjects without duplicates');
      }
      subjectIds.push(id);
    }
    if (new Set(subjectIds).size !== subjectIds.length) {
      return registrationError(res, 400, 'subject_ids', 'Choose valid subjects without duplicates');
    }
  }

  let dailyLimit = 3;
  if (selectedRole === 'tutor' && req.body.max_daily_sessions !== undefined) {
    dailyLimit = Number(req.body.max_daily_sessions);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 6) {
      return registrationError(
        res,
        400,
        'max_daily_sessions',
        'Daily session limit must be a whole number from 1 to 6'
      );
    }
  }

  let connection;
  let transactionStarted = false;
  try {
    const [existing] = await pool.execute(
      `SELECT field FROM (
         SELECT 'student_no' AS field FROM Learner WHERE student_no = ?
         UNION ALL
         SELECT 'email' AS field FROM Learner WHERE email = ?
         UNION ALL
         SELECT 'student_no' AS field FROM Tutor WHERE student_no = ?
         UNION ALL
         SELECT 'email' AS field FROM Tutor WHERE email = ?
       ) AS existing_account
       LIMIT 1`,
      [normalizedStudentNo, normalizedEmail, normalizedStudentNo, normalizedEmail]
    );
    if (existing.length) {
      return registrationError(
        res,
        409,
        existing[0].field,
        'Student number or email is already registered'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const values = [
      normalizedStudentNo,
      normalizedName,
      normalizedEmail,
      passwordHash,
      normalizedProgram,
      year,
    ];
    let insertResult;
    if (selectedRole === 'learner') {
      [insertResult] = await pool.execute(
        `INSERT INTO Learner
          (student_no, full_name, email, password_hash, program, year_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
        values
      );
    } else {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const [availableSubjects] = await connection.execute(
        'SELECT subject_id FROM Subject'
      );
      const availableIds = new Set(availableSubjects.map((subject) => Number(subject.subject_id)));
      if (subjectIds.some((id) => !availableIds.has(id))) {
        throw new RegistrationValidationError(
          'subject_ids',
          'Every selected subject must exist'
        );
      }

      [insertResult] = await connection.execute(
        `INSERT INTO Tutor
          (student_no, full_name, email, password_hash, program, year_level, bio, max_daily_sessions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, bio, dailyLimit]
      );
      for (const subjectId of subjectIds) {
        await connection.execute(
          'INSERT INTO TutorSubject (tutor_id, subject_id) VALUES (?, ?)',
          [insertResult.insertId, subjectId]
        );
      }
      await connection.commit();
      transactionStarted = false;
    }

    const user = publicUser({
      id: insertResult.insertId,
      role: selectedRole,
      full_name: normalizedName,
      email: normalizedEmail,
      student_no: normalizedStudentNo,
    });
    await setSessionUser(req, user);
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
        transactionStarted = false;
      } catch (rollbackError) {
        console.error('Registration rollback failed:', rollbackError);
      }
    }
    if (error instanceof RegistrationValidationError) {
      return registrationError(res, 400, error.field, error.message);
    }
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      const field = /email/i.test(error.message) ? 'email' : 'student_no';
      return registrationError(res, 409, field, 'Student number or email is already registered');
    }
    console.error('Registration failed:', error);
    return registrationError(res, 500, 'registration', 'Could not create your account. Please try again.');
  } finally {
    if (connection) connection.release();
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await pool.execute(
      `SELECT learner_id AS id, student_no, full_name, email, password_hash, status, 'learner' AS role
         FROM Learner WHERE email = ?
       UNION ALL
       SELECT tutor_id AS id, student_no, full_name, email, password_hash, status, 'tutor' AS role
         FROM Tutor WHERE email = ?
       LIMIT 1`,
      [normalizedEmail, normalizedEmail]
    );

    if (!rows.length || rows[0].status !== 'Active') {
      return res.status(401).json({ message: 'Invalid email or password, or this account is inactive' });
    }

    const matches = await bcrypt.compare(password, rows[0].password_hash);
    if (!matches) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = publicUser(rows[0]);
    await setSessionUser(req, user);
    return res.json({ message: 'Login successful', user });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ message: 'Could not log in. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ message: 'Logged out successfully' });
  req.session.destroy((error) => {
    if (error) {
      console.error('Logout failed:', error);
      return res.status(500).json({ message: 'Could not log out. Please try again.' });
    }
    res.clearCookie('connect.sid', { httpOnly: true, secure: true, sameSite: 'none' });
    return res.json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
