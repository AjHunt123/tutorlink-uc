// Helpers for the Phase 3 stored procedures: log every CALL (test evidence,
// proposal Section 8.4) and turn database errors into clear HTTP responses
// (proposal Section 8.3).

// MYSQL_ERRNO values raised by db/routines.sql together with SQLSTATE '45000'.
const RULE_STATUS = {
  50001: 400, // invalid input / rule not met
  50002: 404, // not found
  50003: 403, // not allowed for this user
  50004: 409, // conflict with current data (overlap, daily limit, status)
};

function formatParam(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  const text = String(value);
  return `'${text.length > 40 ? `${text.slice(0, 40)}...` : text}'`;
}

function logCall(procedure, params, outName = null) {
  const args = params.map(formatParam);
  if (outName) args.push(outName);
  console.log(`[CALL] ${procedure}(${args.join(', ')})`);
}

// Sends the response for a failed database action. Rule messages written with
// SIGNAL SQLSTATE '45000' are shown as they are; other errors get a generic
// message and the details go to the server log only.
function sendDbError(res, error, fallbackMessage, context) {
  if (error && error.sqlState === '45000' && RULE_STATUS[error.errno]) {
    console.log(`[RULE] ${context}: ${error.sqlMessage}`);
    return res.status(RULE_STATUS[error.errno]).json({ message: error.sqlMessage });
  }
  if (error && error.errno === 1062) {
    return res.status(409).json({ message: 'That record already exists' });
  }
  if (error && error.errno === 1452) {
    return res.status(400).json({ message: 'A related record does not exist' });
  }
  if (error && error.errno === 1451) {
    return res.status(409).json({ message: 'This record is still in use and cannot be removed' });
  }
  if (error && (error.errno === 3819 || error.errno === 4025)) {
    return res.status(400).json({ message: 'A value is outside the allowed range' });
  }
  console.error(`${context} failed:`, error);
  return res.status(500).json({ message: fallbackMessage });
}

module.exports = { logCall, sendDbError, RULE_STATUS };
