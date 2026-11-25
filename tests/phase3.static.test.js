// Static checks for the Phase 3 SQL script (no database needed).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routines = fs.readFileSync(path.join(__dirname, '..', 'db', 'routines.sql'), 'utf8');

const required = [
  /CREATE FUNCTION fn_tutor_appointment_count/i,
  /CREATE PROCEDURE sp_request_session/i,
  /CREATE PROCEDURE sp_update_session_status/i,
  /CREATE TRIGGER trg_session_after_insert\s+AFTER INSERT ON TutoringSession/i,
  /CREATE TRIGGER trg_session_before_update\s+BEFORE UPDATE ON TutoringSession/i,
  /CREATE TRIGGER trg_session_after_update\s+AFTER UPDATE ON TutoringSession/i,
  /SIGNAL SQLSTATE '45000'/,
  /FOR UPDATE/,
  /DECLARE EXIT HANDLER FOR SQLEXCEPTION/,
];
for (const pattern of required) {
  assert.match(routines, pattern, `routines.sql is missing ${pattern}`);
}

// The routes must call the procedures instead of writing the session directly.
const sessions = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sessions.js'), 'utf8');
assert.match(sessions, /CALL sp_request_session\(/, 'POST /api/sessions must CALL sp_request_session');
assert.match(sessions, /CALL sp_update_session_status\(/, 'status changes must CALL sp_update_session_status');
assert.doesNotMatch(sessions, /INSERT INTO TutoringSession/, 'sessions must be created by the procedure, not by an INSERT in the route');

// Messages passed to SIGNAL must be 128 characters or fewer (MySQL limit).
for (const match of routines.matchAll(/MESSAGE_TEXT = '([^']*)'/g)) {
  assert.ok(match[1].length <= 128, `SIGNAL message is longer than 128 characters: ${match[1]}`);
}

console.log('Phase 3 SQL script and route wiring checks passed');
