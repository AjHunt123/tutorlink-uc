const express = require('express');
const pool = require('../config/db');

const router = express.Router();

router.get('/subjects', async (req, res) => {
  try {
    const [subjects] = await pool.execute(
      'SELECT subject_id, subject_code, subject_title FROM Subject ORDER BY subject_title'
    );
    return res.json(subjects);
  } catch (error) {
    console.error('List subjects failed:', error);
    return res.status(500).json({ message: 'Could not load subjects' });
  }
});

// Tutor directory (Phase 1 proposal, Query 1): one row per tutor, all subjects
// in a JSON list, average rating from completed and rated sessions.
// Query string: subject_id (filter), q (name search), sort (rating or name).
const ORDER_BY = {
  rating: 'r.avg_rating IS NULL, r.avg_rating DESC, t.full_name',
  name: 't.full_name',
};

router.get('/tutors', async (req, res) => {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : null;
  if (subjectId !== null && (!Number.isInteger(subjectId) || subjectId < 1)) {
    return res.status(400).json({ message: 'Choose a valid subject' });
  }

  const search = String(req.query.q || '').trim().slice(0, 100);
  const sortKey = Object.prototype.hasOwnProperty.call(ORDER_BY, req.query.sort)
    ? req.query.sort
    : 'rating';

  try {
    const [rows] = await pool.execute(
      `SELECT t.tutor_id, t.full_name, t.program, t.year_level, t.bio, t.max_daily_sessions,
              JSON_ARRAYAGG(JSON_OBJECT(
                'subject_id', sb.subject_id,
                'subject_code', sb.subject_code,
                'subject_title', sb.subject_title
              )) AS subjects,
              r.avg_rating, r.rating_count
         FROM Tutor t
         JOIN TutorSubject ts ON ts.tutor_id = t.tutor_id
         JOIN Subject sb ON sb.subject_id = ts.subject_id
         LEFT JOIN (
               SELECT tutor_id, ROUND(AVG(rating), 1) AS avg_rating, COUNT(rating) AS rating_count
                 FROM TutoringSession
                WHERE rating IS NOT NULL
                GROUP BY tutor_id
              ) r ON r.tutor_id = t.tutor_id
        WHERE t.status = 'Active'
          AND t.full_name LIKE CONCAT('%', ?, '%')
          AND (? IS NULL OR t.tutor_id IN (SELECT tutor_id FROM TutorSubject WHERE subject_id = ?))
        GROUP BY t.tutor_id, t.full_name, t.program, t.year_level, t.bio, t.max_daily_sessions,
                 r.avg_rating, r.rating_count
        ORDER BY ${ORDER_BY[sortKey]}`,
      [search, subjectId, subjectId]
    );

    const tutors = rows.map((row) => {
      const subjects = typeof row.subjects === 'string' ? JSON.parse(row.subjects) : row.subjects;
      subjects.sort((a, b) => a.subject_title.localeCompare(b.subject_title));
      return {
        ...row,
        subjects,
        avg_rating: row.avg_rating === null ? null : Number(row.avg_rating),
        rating_count: Number(row.rating_count || 0),
      };
    });
    return res.json(tutors);
  } catch (error) {
    console.error('List tutors failed:', error);
    return res.status(500).json({ message: 'Could not load tutors' });
  }
});

// ---------------------------------------------------------------------------
// Tutor profile management (FR-03). Only a logged-in tutor, only their own row.
// ---------------------------------------------------------------------------
function requireTutor(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) {
    return res.status(401).json({ message: 'Please log in first' });
  }
  if (user.role !== 'tutor') {
    return res.status(403).json({ message: 'Only tutors can manage a tutor profile' });
  }
  const tutorId = Number(user.id ?? user.tutor_id);
  if (!Number.isInteger(tutorId) || tutorId < 1) {
    return res.status(401).json({ message: 'Please log in again' });
  }
  req.tutorId = tutorId;
  return next();
}

router.get('/tutor/profile', requireTutor, async (req, res) => {
  try {
    const [profiles] = await pool.execute(
      `SELECT tutor_id, full_name, program, year_level, bio, max_daily_sessions
         FROM Tutor WHERE tutor_id = ?`,
      [req.tutorId]
    );
    if (!profiles.length) {
      return res.status(404).json({ message: 'Tutor account not found' });
    }
    const [subjects] = await pool.execute(
      `SELECT sb.subject_id, sb.subject_code, sb.subject_title
         FROM TutorSubject ts
         JOIN Subject sb ON sb.subject_id = ts.subject_id
        WHERE ts.tutor_id = ?
        ORDER BY sb.subject_title`,
      [req.tutorId]
    );
    return res.json({ profile: profiles[0], subjects });
  } catch (error) {
    console.error('Load tutor profile failed:', error);
    return res.status(500).json({ message: 'Could not load your profile' });
  }
});

router.put('/tutor/profile', requireTutor, async (req, res) => {
  const limit = Number(req.body.max_daily_sessions);
  if (!Number.isInteger(limit) || limit < 1 || limit > 6) {
    return res.status(400).json({ message: 'Daily session limit must be a whole number from 1 to 6' });
  }
  const rawBio = req.body.bio;
  if (rawBio !== undefined && rawBio !== null && typeof rawBio !== 'string') {
    return res.status(400).json({ message: 'Bio must be text' });
  }
  const bio = typeof rawBio === 'string' ? rawBio.trim() : '';
  if (bio.length > 500) {
    return res.status(400).json({ message: 'Bio must be 500 characters or fewer' });
  }

  try {
    await pool.execute(
      'UPDATE Tutor SET bio = ?, max_daily_sessions = ? WHERE tutor_id = ?',
      [bio || null, limit, req.tutorId]
    );
    return res.json({ message: 'Profile updated' });
  } catch (error) {
    console.error('Update tutor profile failed:', error);
    return res.status(500).json({ message: 'Could not update your profile' });
  }
});

router.post('/tutor/subjects', requireTutor, async (req, res) => {
  const subjectId = Number(req.body.subject_id);
  if (!Number.isInteger(subjectId) || subjectId < 1) {
    return res.status(400).json({ message: 'Choose a valid subject' });
  }

  try {
    const [subjects] = await pool.execute(
      'SELECT subject_id FROM Subject WHERE subject_id = ?',
      [subjectId]
    );
    if (!subjects.length) {
      return res.status(400).json({ message: 'That subject does not exist' });
    }
    await pool.execute(
      'INSERT INTO TutorSubject (tutor_id, subject_id) VALUES (?, ?)',
      [req.tutorId, subjectId]
    );
    return res.status(201).json({ message: 'Subject added' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'You already teach this subject' });
    }
    console.error('Add tutor subject failed:', error);
    return res.status(500).json({ message: 'Could not add the subject' });
  }
});

router.delete('/tutor/subjects/:subjectId', requireTutor, async (req, res) => {
  const subjectId = Number(req.params.subjectId);
  if (!Number.isInteger(subjectId) || subjectId < 1) {
    return res.status(400).json({ message: 'Choose a valid subject' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Lock the tutor row so two requests cannot both remove the last two subjects.
    await connection.execute('SELECT tutor_id FROM Tutor WHERE tutor_id = ? FOR UPDATE', [req.tutorId]);

    const [taught] = await connection.execute(
      'SELECT subject_id FROM TutorSubject WHERE tutor_id = ?',
      [req.tutorId]
    );
    if (!taught.some((row) => Number(row.subject_id) === subjectId)) {
      await connection.rollback();
      return res.status(404).json({ message: 'You do not teach this subject' });
    }
    if (taught.length <= 1) {
      await connection.rollback();
      return res.status(400).json({ message: 'A tutor must teach at least one subject' });
    }

    const [active] = await connection.execute(
      `SELECT COUNT(*) AS n FROM TutoringSession
        WHERE tutor_id = ? AND subject_id = ? AND status IN ('Pending', 'Accepted')`,
      [req.tutorId, subjectId]
    );
    if (Number(active[0].n) > 0) {
      await connection.rollback();
      return res.status(409).json({
        message: 'Resolve your Pending or Accepted sessions in this subject before removing it',
      });
    }

    await connection.execute(
      'DELETE FROM TutorSubject WHERE tutor_id = ? AND subject_id = ?',
      [req.tutorId, subjectId]
    );
    await connection.commit();
    return res.json({ message: 'Subject removed' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Remove tutor subject failed:', error);
    return res.status(500).json({ message: 'Could not remove the subject' });
  } finally {
    connection.release();
  }
});

module.exports = router;