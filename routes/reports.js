const express = require('express');
const pool = require('../config/db');
const { sendDbError } = require('../utils/dbCalls');

const router = express.Router();

router.use((req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Please log in to view reports' });
  }
  return next();
});

// Report 1 - subject demand (aggregates, LEFT JOINs, derived table).
// How many tutors teach each subject, how many sessions it had, how many of
// them were completed and the average rating given.
router.get('/subject-demand', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT sb.subject_code, sb.subject_title,
              COUNT(DISTINCT ts.tutor_id)        AS tutors,
              COALESCE(d.total_sessions, 0)      AS total_sessions,
              COALESCE(d.completed_sessions, 0)  AS completed_sessions,
              d.avg_rating
         FROM Subject sb
         LEFT JOIN TutorSubject ts ON ts.subject_id = sb.subject_id
         LEFT JOIN (SELECT subject_id,
                           COUNT(*)                          AS total_sessions,
                           SUM(status = 'Completed')         AS completed_sessions,
                           ROUND(AVG(rating), 1)             AS avg_rating
                      FROM TutoringSession
                     GROUP BY subject_id) d ON d.subject_id = sb.subject_id
        GROUP BY sb.subject_id, sb.subject_code, sb.subject_title,
                 d.total_sessions, d.completed_sessions, d.avg_rating
        ORDER BY total_sessions DESC, sb.subject_title`
    );
    return res.json(rows.map((row) => ({
      ...row,
      tutors: Number(row.tutors),
      total_sessions: Number(row.total_sessions),
      completed_sessions: Number(row.completed_sessions),
      avg_rating: row.avg_rating === null ? null : Number(row.avg_rating),
    })));
  } catch (error) {
    return sendDbError(res, error, 'Could not load the report', 'Subject demand report');
  }
});

// Report 2 - my sessions by subject (aggregates, GROUP BY and a
// scalar subquery that compares the user's rating with the overall average).
// A tutor sees the sessions they taught; a learner sees the sessions they booked.
router.get('/my-summary', async (req, res) => {
  const user = req.session.user;
  if (!['learner', 'tutor'].includes(user.role)) {
    return res.status(403).json({ message: 'This account has no session report' });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT sb.subject_code, sb.subject_title,
              COUNT(*)                                          AS total_sessions,
              SUM(s.status = 'Completed')                       AS completed_sessions,
              SUM(s.status IN ('Declined', 'Cancelled'))        AS not_held,
              ROUND(AVG(s.rating), 1)                           AS avg_rating,
              (SELECT ROUND(AVG(rating), 1) FROM TutoringSession
                WHERE rating IS NOT NULL)                       AS overall_avg_rating
         FROM TutoringSession s
         JOIN Subject sb ON sb.subject_id = s.subject_id
        WHERE ((? = 'learner' AND s.learner_id = ?) OR (? = 'tutor' AND s.tutor_id = ?))
        GROUP BY sb.subject_id, sb.subject_code, sb.subject_title
        ORDER BY total_sessions DESC, sb.subject_title`,
      [user.role, user.id, user.role, user.id]
    );
    return res.json(rows.map((row) => ({
      ...row,
      total_sessions: Number(row.total_sessions),
      completed_sessions: Number(row.completed_sessions),
      not_held: Number(row.not_held),
      avg_rating: row.avg_rating === null ? null : Number(row.avg_rating),
      overall_avg_rating: row.overall_avg_rating === null ? null : Number(row.overall_avg_rating),
    })));
  } catch (error) {
    return sendDbError(res, error, 'Could not load the report', 'My summary report');
  }
});

module.exports = router;
