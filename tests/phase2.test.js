const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateBookingInput, statusTransitionError } = require('../utils/sessionRules');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');

for (const table of [
  'Learner',
  'Tutor',
  'Subject',
  'TutorSubject',
  'TutoringSession',
  'SessionAudit',
]) {
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'), `${table} table missing`);
}
assert.doesNotMatch(schema, /CREATE\s+(PROCEDURE|FUNCTION|TRIGGER)\b/i, 'Phase 2 must not add stored objects');

const now = new Date('2030-01-01T10:00:00');
const validBooking = {
  session_date: '2030-01-01',
  start_time: '10:30',
  end_time: '12:00',
};
assert.deepStrictEqual(validateBookingInput(validBooking, now).value, {
  session_date: '2030-01-01',
  start_time: '10:30:00',
  end_time: '12:00:00',
});
assert.deepStrictEqual(validateBookingInput({
  ...validBooking,
  end_time: '11:00',
}, now).value.end_time, '11:00:00', 'A 30-minute session is accepted');
assert.match(
  validateBookingInput({ ...validBooking, start_time: '10:00' }, now).error,
  /future/i,
  'A session starting now is not in the future'
);
assert.match(
  validateBookingInput({ ...validBooking, start_time: '10:30', end_time: '10:59' }, now).error,
  /30 and 120/i,
  'A session shorter than 30 minutes is rejected'
);
assert.match(
  validateBookingInput({ ...validBooking, start_time: '10:30', end_time: '12:31' }, now).error,
  /30 and 120/i,
  'A session longer than 120 minutes is rejected'
);
assert.deepStrictEqual(validateBookingInput({
  ...validBooking,
  end_time: '12:30',
}, now).value.end_time, '12:30:00', 'A 120-minute session is accepted');
assert.match(
  validateBookingInput({ ...validBooking, session_date: '2030-02-30' }, now).error,
  /valid session date/i,
  'Invalid calendar dates are rejected'
);

const futureEnd = new Date('2030-01-01T12:00:00');
assert.strictEqual(statusTransitionError({
  currentStatus: 'Pending',
  newStatus: 'Accepted',
  isLearner: false,
  isTutor: true,
  endAt: futureEnd,
  now,
}), null);
assert.match(statusTransitionError({
  currentStatus: 'Pending',
  newStatus: 'Accepted',
  isLearner: true,
  isTutor: false,
  endAt: futureEnd,
  now,
}), /Only the session tutor/i);
assert.match(statusTransitionError({
  currentStatus: 'Accepted',
  newStatus: 'Completed',
  isLearner: false,
  isTutor: true,
  endAt: futureEnd,
  now,
}), /after its end time/i);
assert.strictEqual(statusTransitionError({
  currentStatus: 'Accepted',
  newStatus: 'Cancelled',
  isLearner: true,
  isTutor: false,
  endAt: futureEnd,
  now,
}), null);
assert.match(statusTransitionError({
  currentStatus: 'Completed',
  newStatus: 'Cancelled',
  isLearner: false,
  isTutor: true,
  endAt: futureEnd,
  now,
}), /can no longer change/i);

console.log('Phase 2 schema and booking rule checks passed');
