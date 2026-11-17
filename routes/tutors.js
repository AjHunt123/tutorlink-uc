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

module.exports = router;
