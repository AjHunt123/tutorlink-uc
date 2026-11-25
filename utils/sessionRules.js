function parseTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    return null;
  }
  const [hours, minutes, seconds = 0] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59 || seconds !== 0) return null;
  return { hours, minutes, value: `${value.slice(0, 5)}:00` };
}

// Format-only check (date and times are well formed). Phase 3: the booking rules
// BR-01 to BR-04 are enforced by sp_request_session, so the request route only
// needs well-formed values before it calls the procedure.
function parseBookingFormat(input) {
  const { session_date: date, start_time: startValue, end_time: endValue } = input;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'Choose a valid session date' };
  }
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return { error: 'Choose a valid session date' };
  }

  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (!start || !end) {
    return { error: 'Choose valid start and end times' };
  }
  return { value: { date, start, end } };
}

// Full check used when a learner edits a Pending request (that route is not a
// stored procedure): format plus BR-01 in the application.
function validateBookingInput(input, now = new Date()) {
  const parsed = parseBookingFormat(input);
  if (parsed.error) return parsed;
  const { date, start, end } = parsed.value;

  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;
  const duration = endMinutes - startMinutes;
  if (duration < 30 || duration > 120) {
    return { error: 'Sessions must be between 30 and 120 minutes long' };
  }

  const startAt = new Date(`${date}T${start.value}`);
  if (Number.isNaN(startAt.getTime()) || startAt <= now) {
    return { error: 'Choose a session time in the future' };
  }

  return {
    value: {
      session_date: date,
      start_time: start.value,
      end_time: end.value,
    },
  };
}

// Application-side mirror of BR-05 from Phase 2 (kept for the unit tests).
// Phase 3 enforces BR-05 in sp_update_session_status and the triggers.
function statusTransitionError({ currentStatus, newStatus, isLearner, isTutor, endAt, now }) {
  const pendingTransition = currentStatus === 'Pending'
    && ['Accepted', 'Declined', 'Cancelled'].includes(newStatus);
  const acceptedTransition = currentStatus === 'Accepted'
    && ['Completed', 'Cancelled'].includes(newStatus);
  if (!pendingTransition && !acceptedTransition) {
    return 'This session can no longer change to that status';
  }
  if (['Accepted', 'Declined', 'Completed'].includes(newStatus) && !isTutor) {
    return 'Only the session tutor can make that status change';
  }
  if (!isLearner && !isTutor) {
    return 'This session can no longer change to that status';
  }
  if (newStatus === 'Completed' && endAt > now) {
    return 'A session can be completed only after its end time';
  }
  return null;
}

module.exports = { parseBookingFormat, validateBookingInput, statusTransitionError };
