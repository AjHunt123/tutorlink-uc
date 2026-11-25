const express = require('express');
const pool = require('../config/db');
const { parseBookingFormat, validateBookingInput } = require('../utils/sessionRules');
const { logCall, sendDbError } = require('../utils/dbCalls');

const router = express.Router();
const reservingStatuses = ['Pending', 'Accepted'];
const allStatuses = ['Pending', 'Accepted', 'Declined', 'Completed', 'Cancelled'];

// Whitelisted ORDER BY clauses for the My Sessions list (never built from user text).
const sessionOrder = {
  date_desc: 'TS.session_date DESC, TS.start_time DESC',
  date_asc: 'TS.session_date ASC, TS.start_time ASC',
  status: "FIELD(TS.status, 'Pending', 'Accepted', 'Completed', 'Declined', 'Cancelled'), TS.session_date DESC, TS.start_time DESC",
};

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Please log in to manage tutoring sessions' });
  }
  return next();
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function textField(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) return `${label} is required`;
  if (value.trim().length > maxLength) return `${label} must be ${maxLength} characters or fewer`;
  return null;
}

function validDateInput(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function beginTransaction() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    return connection;
  } catch (error) {
    connection.release();
    throw error;
  }
}

async function rollbackAndRelease(connection) {
  try {
    await connection.rollback();
  } catch (error) {
    console.error('Database rollback failed:', error);
  } finally {
    connection.release();
  }
}

async function checkTutorAndSubject(connection, tutorId, learnerId, subjectId) {
  const [accounts] = await connection.execute(
    `SELECT T.student_no AS tutor_student_no, T.status AS tutor_status,
            T.max_daily_sessions, L.student_no AS learner_student_no
       FROM Tutor T
       JOIN Learner L ON L.learner_id = ?
      WHERE T.tutor_id = ?
      FOR UPDATE`,
    [learnerId, tutorId]
  );
  if (!accounts.length) return { error: 'The selected tutor or learner account was not found' };
  if (accounts[0].tutor_status !== 'Active') {
    return { error: 'The selected tutor is inactive' };
  }
  if (accounts[0].tutor_student_no === accounts[0].learner_student_no) {
    return { error: 'You cannot book a tutoring session with yourself' };
  }

  const [subjects] = await connection.execute(
    'SELECT 1 FROM TutorSubject WHERE tutor_id = ? AND subject_id = ? LIMIT 1',
    [tutorId, subjectId]
  );
  if (!subjects.length) {
    return { error: 'The selected tutor does not teach this subject' };
  }
  return { maxDailySessions: accounts[0].max_daily_sessions };
}

async function checkAvailability(connection, booking, tutorId, learnerId, maxDailySessions, excludeId = 0) {
  const [overlaps] = await connection.execute(
    `SELECT session_id
       FROM TutoringSession
      WHERE session_date = ?
        AND status IN ('Pending', 'Accepted')
        AND session_id <> ?
        AND (
          (tutor_id = ? AND start_time < ? AND end_time > ?)
          OR
          (learner_id = ? AND start_time < ? AND end_time > ?)
        )
      LIMIT 1`,
    [
      booking.session_date,
      excludeId,
      tutorId,
      booking.end_time,
      booking.start_time,
      learnerId,
      booking.end_time,
      booking.start_time,
    ]
  );
  if (overlaps.length) {
    return { error: 'That time overlaps another pending or accepted session for you or the tutor' };
  }

  // BR-04 for the Edit route: the daily load comes from fn_tutor_appointment_count.
  // When the edited session already counts on the same date, it is not counted twice.
  const [counts] = await connection.execute(
    `SELECT fn_tutor_appointment_count(?, ?) AS session_count,
            (SELECT COUNT(*) FROM TutoringSession
              WHERE session_id = ? AND tutor_id = ? AND session_date = ?
                AND status IN ('Pending', 'Accepted')) AS own_count`,
    [tutorId, booking.session_date, excludeId, tutorId, booking.session_date]
  );
  if (Number(counts[0].session_count) - Number(counts[0].own_count) + 1 > maxDailySessions) {
    return { error: 'Tutor has reached the daily limit.' };
  }
  return {};
}

function bookingFields(body, now) {
  const topicError = textField(body.topic, 'Topic', 200);
  if (topicError) return { error: topicError };
  const venueError = textField(body.venue, 'Venue', 160);
  if (venueError) return { error: venueError };

  const checked = validateBookingInput(body, now);
  if (checked.error) return checked;
  return {
    value: {
      ...checked.value,
      topic: body.topic.trim(),
      venue: body.venue.trim(),
    },
  };
}

router.use(requireLogin);

// My Sessions list (proposal Query 2): optional status, from, to and sort filters.
router.get('/', async (req, res) => {
  const user = req.session.user;
  if (!['learner', 'tutor'].includes(user.role)) {
    return res.status(403).json({ message: 'This account cannot view tutoring sessions' });
  }

  const status = req.query.status ? String(req.query.status) : null;
  if (status !== null && !allStatuses.includes(status)) {
    return res.status(400).json({ message: 'Choose a valid status filter' });
  }
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  if ((from !== null && !validDateInput(from)) || (to !== null && !validDateInput(to))) {
    return res.status(400).json({ message: 'Dates must use the YYYY-MM-DD format' });
  }
  if (from !== null && to !== null && from > to) {
    return res.status(400).json({ message: 'The "from" date must not be after the "to" date' });
  }
  const sortKey = typeof req.query.sort === 'string'
    && Object.prototype.hasOwnProperty.call(sessionOrder, req.query.sort)
    ? req.query.sort
    : 'date_desc';

  try {
    const [sessions] = await pool.execute(
      `SELECT TS.session_id, TS.learner_id, TS.tutor_id, TS.subject_id,
              TS.topic, TS.session_date, TS.start_time, TS.end_time, TS.venue,
              TS.status, TS.rating, TS.feedback, TS.requested_at, TS.completed_at,
              L.full_name AS learner_name, T.full_name AS tutor_name,
              S.subject_code, S.subject_title,
              T.max_daily_sessions,
              fn_tutor_appointment_count(TS.tutor_id, TS.session_date) AS day_load
         FROM TutoringSession TS
         JOIN Learner L ON L.learner_id = TS.learner_id
         JOIN Tutor T ON T.tutor_id = TS.tutor_id
         JOIN Subject S ON S.subject_id = TS.subject_id
        WHERE ((? = 'learner' AND TS.learner_id = ?)
            OR (? = 'tutor' AND TS.tutor_id = ?))
          AND (? IS NULL OR TS.status = ?)
          AND (? IS NULL OR TS.session_date >= ?)
          AND (? IS NULL OR TS.session_date <= ?)
        ORDER BY ${sessionOrder[sortKey]}`,
      [user.role, user.id, user.role, user.id, status, status, from, from, to, to]
    );
    return res.json(sessions);
  } catch (error) {
    return sendDbError(res, error, 'Could not load tutoring sessions', 'List tutoring sessions');
  }
});

// Request Session (FR-05, FR-06): the booking rules BR-01 to BR-04 run inside
// sp_request_session. A rule message is shown on the form and nothing is saved.
router.post('/', async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'learner') {
    return res.status(403).json({ message: 'Only learners can request tutoring sessions' });
  }

  const tutorId = positiveId(req.body.tutor_id);
  const subjectId = positiveId(req.body.subject_id);
  if (!tutorId || !subjectId) {
    return res.status(400).json({ message: 'Choose a valid tutor and subject' });
  }
  const topicError = textField(req.body.topic, 'Topic', 200);
  if (topicError) return res.status(400).json({ message: topicError });
  const venueError = textField(req.body.venue, 'Venue', 160);
  if (venueError) return res.status(400).json({ message: venueError });
  const format = parseBookingFormat(req.body);
  if (format.error) return res.status(400).json({ message: format.error });

  const params = [
    user.id,
    tutorId,
    subjectId,
    req.body.topic.trim(),
    format.value.date,
    format.value.start.value,
    format.value.end.value,
    req.body.venue.trim(),
  ];

  let connection;
  try {
    connection = await pool.getConnection();
    logCall('sp_request_session', params, '@new_session_id');
    await connection.execute(
      'CALL sp_request_session(?, ?, ?, ?, ?, ?, ?, ?, @new_session_id)',
      params
    );
    const [rows] = await connection.query('SELECT @new_session_id AS session_id');
    return res.status(201).json({
      message: 'Tutoring session requested',
      session_id: rows[0].session_id,
    });
  } catch (error) {
    return sendDbError(res, error, 'Could not create the tutoring session', 'sp_request_session');
  } finally {
    if (connection) connection.release();
  }
});

router.get('/:sessionId', async (req, res) => {
  const sessionId = positiveId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ message: 'Invalid session ID' });
  const user = req.session.user;

  try {
    const [rows] = await pool.execute(
      `SELECT TS.session_id, TS.learner_id, TS.tutor_id, TS.subject_id,
              TS.topic, TS.session_date, TS.start_time, TS.end_time, TS.venue,
              TS.status, TS.rating, TS.feedback, TS.requested_at, TS.completed_at,
              L.full_name AS learner_name, T.full_name AS tutor_name,
              S.subject_code, S.subject_title
         FROM TutoringSession TS
         JOIN Learner L ON L.learner_id = TS.learner_id
         JOIN Tutor T ON T.tutor_id = TS.tutor_id
         JOIN Subject S ON S.subject_id = TS.subject_id
        WHERE TS.session_id = ?
          AND ((? = 'learner' AND TS.learner_id = ?)
            OR (? = 'tutor' AND TS.tutor_id = ?))`,
      [sessionId, user.role, user.id, user.role, user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Tutoring session not found' });

    // Audit trail (FR-12, proposal Query 4): written by the triggers, shown only
    // to the learner or the tutor of the session.
    const [audit] = await pool.execute(
      `SELECT a.audit_id, a.changed_at, a.old_status, a.new_status, a.changed_by_role, a.remarks
         FROM SessionAudit a
         JOIN TutoringSession s ON s.session_id = a.session_id
        WHERE a.session_id = ?
          AND ((? = 'learner' AND s.learner_id = ?) OR (? = 'tutor' AND s.tutor_id = ?))
        ORDER BY a.changed_at, a.audit_id`,
      [sessionId, user.role, user.id, user.role, user.id]
    );
    return res.json({ ...rows[0], audit });
  } catch (error) {
    return sendDbError(res, error, 'Could not load the tutoring session', 'Get tutoring session');
  }
});

router.put('/:sessionId', async (req, res) => {
  const sessionId = positiveId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ message: 'Invalid session ID' });
  const user = req.session.user;
  if (user.role !== 'learner') {
    return res.status(403).json({ message: 'Only the learner can edit a session request' });
  }
  const booking = bookingFields(req.body, new Date());
  if (booking.error) return res.status(400).json({ message: booking.error });

  let connection;
  try {
    connection = await beginTransaction();
    const [rows] = await connection.execute(
      `SELECT learner_id, tutor_id, subject_id, status
         FROM TutoringSession
        WHERE session_id = ?
        FOR UPDATE`,
      [sessionId]
    );
    if (!rows.length || Number(rows[0].learner_id) !== Number(user.id)) {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(404).json({ message: 'Tutoring session not found' });
    }
    if (rows[0].status !== 'Pending') {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(409).json({ message: 'Only pending session requests can be edited' });
    }

    const tutorResult = await checkTutorAndSubject(
      connection,
      rows[0].tutor_id,
      user.id,
      rows[0].subject_id
    );
    if (tutorResult.error) {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(400).json({ message: tutorResult.error });
    }
    const availability = await checkAvailability(
      connection,
      booking.value,
      rows[0].tutor_id,
      user.id,
      tutorResult.maxDailySessions,
      sessionId
    );
    if (availability.error) {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(409).json({ message: availability.error });
    }

    await connection.execute(
      `UPDATE TutoringSession
          SET topic = ?, session_date = ?, start_time = ?, end_time = ?, venue = ?
        WHERE session_id = ?`,
      [
        booking.value.topic,
        booking.value.session_date,
        booking.value.start_time,
        booking.value.end_time,
        booking.value.venue,
        sessionId,
      ]
    );
    await connection.commit();
    connection.release();
    connection = null;
    return res.json({ message: 'Tutoring session request updated' });
  } catch (error) {
    if (connection) await rollbackAndRelease(connection);
    return sendDbError(res, error, 'Could not update the tutoring session', 'Update tutoring session');
  }
});

// Accept, decline, cancel and complete (FR-07, FR-09, FR-10): BR-05 is applied by
// sp_update_session_status and, again, by the triggers on TutoringSession, which
// also write the SessionAudit row.
async function changeStatus(req, res) {
  const sessionId = positiveId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ message: 'Invalid session ID' });
  const user = req.session.user;
  const newStatus = req.body.status;
  if (!['Accepted', 'Declined', 'Completed', 'Cancelled'].includes(newStatus)) {
    return res.status(400).json({ message: 'Choose a valid session status' });
  }
  const rawRemarks = req.body.remarks;
  if (rawRemarks !== undefined && rawRemarks !== null && typeof rawRemarks !== 'string') {
    return res.status(400).json({ message: 'Remarks must be text' });
  }
  const remarks = typeof rawRemarks === 'string' ? rawRemarks.trim() : '';
  if (remarks.length > 500) {
    return res.status(400).json({ message: 'Remarks must be 500 characters or fewer' });
  }

  const params = [sessionId, user.role, user.id, newStatus, remarks || null];
  let connection;
  try {
    connection = await pool.getConnection();
    logCall('sp_update_session_status', params);
    await connection.execute('CALL sp_update_session_status(?, ?, ?, ?, ?)', params);
    return res.json({ message: `Session ${newStatus.toLowerCase()}`, status: newStatus });
  } catch (error) {
    return sendDbError(res, error, 'Could not change the session status', 'sp_update_session_status');
  } finally {
    if (connection) connection.release();
  }
}

router.patch('/:sessionId/status', changeStatus);
router.delete('/:sessionId', (req, res) => {
  req.body = { status: 'Cancelled', remarks: req.body.remarks };
  return changeStatus(req, res);
});

router.post('/:sessionId/rating', async (req, res) => {
  const sessionId = positiveId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ message: 'Invalid session ID' });
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5' });
  }
  const feedback = typeof req.body.feedback === 'string' ? req.body.feedback.trim() : '';
  if (feedback.length > 2000) {
    return res.status(400).json({ message: 'Feedback must be 2000 characters or fewer' });
  }

  let connection;
  try {
    connection = await beginTransaction();
    const [rows] = await connection.execute(
      `SELECT learner_id, status, rating
         FROM TutoringSession
        WHERE session_id = ?
        FOR UPDATE`,
      [sessionId]
    );
    if (!rows.length || req.session.user.role !== 'learner'
      || Number(rows[0].learner_id) !== Number(req.session.user.id)) {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(404).json({ message: 'Tutoring session not found' });
    }
    if (rows[0].status !== 'Completed') {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(409).json({ message: 'You can rate a session only after it is completed' });
    }
    if (rows[0].rating !== null) {
      await rollbackAndRelease(connection);
      connection = null;
      return res.status(409).json({ message: 'This session has already been rated' });
    }

    await connection.execute(
      `UPDATE TutoringSession SET rating = ?, feedback = ?
        WHERE session_id = ? AND rating IS NULL`,
      [rating, feedback || null, sessionId]
    );
    await connection.commit();
    connection.release();
    connection = null;
    return res.json({ message: 'Thank you for rating this session' });
  } catch (error) {
    if (connection) await rollbackAndRelease(connection);
    return sendDbError(res, error, 'Could not save your rating', 'Rate tutoring session');
  }
});

module.exports = router;