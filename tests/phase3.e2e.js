// Phase 3 end-to-end test and evidence generator.
//
//   npm run test:phase3
//
// Starts the real server on a spare port, drives it over HTTP like a browser
// would, checks the database after every step, and writes the evidence file
// docs/evidence/PHASE2_EVIDENCE.md and PHASE3_EVIDENCE.md (test-case matrix, before/after tables,
// output of fn_tutor_appointment_count, server log of every CALL).
//
// Run it on a freshly loaded database (schema.sql, seed.sql, routines.sql,
// privileges.sql). It adds test rows, so reload the sample data before a demo.
require('dotenv').config();
process.env.TZ = process.env.APP_TZ || 'Asia/Manila';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const pool = require('../config/db');

const PORT = process.env.TEST_PORT || '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(__dirname, '..', 'docs', 'evidence');

// ---------- small helpers ---------------------------------------------------
function ymd(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}
const D_FLOW = daysFromNow(30);    // request -> accept flow
const D_LIMIT = daysFromNow(31);   // daily-limit test
const D_OVERLAP = daysFromNow(32); // overlap tests
const D_SELF = daysFromNow(33);    // self-booking test
const D_FUTURE_ACCEPT = daysFromNow(34); // accepted, not yet finished
const YESTERDAY = daysFromNow(-1);

function mdTable(rows, columns) {
  if (!rows.length) return '_(no rows)_\n';
  const head = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
  const body = rows
    .map((r) => `| ${columns.map((c) => String(r[c] ?? 'NULL').replace(/\|/g, '/')).join(' | ')} |`)
    .join('\n');
  return `${head}${body}\n`;
}

class Client {
  constructor(name) { this.name = name; this.cookie = ''; this.user = null; }
  async call(method, url, body, { csrf = true } = {}) {
    const headers = { 'X-Forwarded-Proto': 'https' };
    if (csrf) headers['X-Requested-With'] = 'tutorlink';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`${BASE}${url}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie.length) this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }
  async login(email, password = 'Password123') {
    const r = await this.call('POST', '/api/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.data)}`);
    this.user = r.data.user;
    return this;
  }
}

let phase = 2;
const results = [];
const report = [];
function record(id, requirement, input, expected, r, ok, note = '') {
  const actual = `${r.status} ${r.data.message || r.data.error || ''}`.trim() + (note ? ` (${note})` : '');
  results.push({ phase, id, requirement, input, expected, actual, pass: ok ? 'PASS' : 'FAIL' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${requirement}  ->  ${actual}`);
}

async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
async function snapshot(sessionId) {
  const session = await q(
    `SELECT session_id, status, rating, completed_at FROM TutoringSession WHERE session_id = ?`, [sessionId]
  );
  const audit = await q(
    `SELECT audit_id, session_id, old_status, new_status, changed_by_role, remarks
       FROM SessionAudit WHERE session_id = ? ORDER BY audit_id`, [sessionId]
  );
  return { session, audit };
}
async function counts() {
  const [a] = await q('SELECT COUNT(*) AS n FROM TutoringSession');
  const [b] = await q('SELECT COUNT(*) AS n FROM SessionAudit');
  return { sessions: Number(a.n), audit: Number(b.n) };
}

// ---------- server ----------------------------------------------------------
let serverProcess;
const serverLog = [];
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT, SESSION_SECRET: process.env.SESSION_SECRET || 'test-secret-for-evidence-run' },
    });
    const onData = (chunk) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        serverLog.push(line);
        if (line.includes('running on port')) resolve();
      }
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    serverProcess.on('exit', (code) => reject(new Error(`server exited early (${code}): ${serverLog.join('\n')}`)));
    setTimeout(() => reject(new Error('server did not start in time')), 15000);
  });
}

// ---------- the tests -------------------------------------------------------
async function main() {
  await startServer();
  const guest = new Client('guest');

  const subjects = (await guest.call('GET', '/api/subjects')).data;
  const subjectId = (code) => subjects.find((s) => s.subject_code === code).subject_id;
  const tutors = (await guest.call('GET', '/api/tutors?sort=name')).data;
  const tutorId = (name) => tutors.find((t) => t.full_name === name).tutor_id;

  const ana = await new Client('ana').login('ana.lim@tutorlink.test');
  const ben = await new Client('ben').login('ben.torres@tutorlink.test');
  const carla = await new Client('carla').login('carla.mendoza@tutorlink.test');
  const juan = await new Client('juan').login('juan.delacruz@tutorlink.test');
  const maria = await new Client('maria').login('maria.santos@tutorlink.test');
  const liza = await new Client('liza').login('liza.navarro@tutorlink.test');
  const paolo = await new Client('paolo').login('paolo.reyes@tutorlink.test');
  const dino = await new Client('dino').login('dino.garcia@tutorlink.test');
  const eli = await new Client('eli').login('eli.ramos@tutorlink.test');

  const book = (client, tutor, subject, date, start, end, topic = 'Evidence test') => client.call('POST', '/api/sessions', {
    tutor_id: tutorId(tutor), subject_id: subjectId(subject), topic, session_date: date,
    start_time: start, end_time: end, venue: 'UC Banilad Library',
  });

  let r;
  // ===== PHASE 2: core application (accounts, profile CRUD, joins, filters) ==
  phase = 2;
  const stamp = String(Date.now()).slice(-6);
  const newLearner = { role: 'learner', student_no: `20-${stamp}`, full_name: 'Test Learner', email: `learner${stamp}@tutorlink.test`, password: 'Password123', program: 'BSIT', year_level: 2 };
  const reg = new Client('new-learner');
  r = await reg.call('POST', '/api/register', newLearner);
  const who = await reg.call('GET', '/api/session');
  record('P2-01', 'FR-01 register a learner', 'POST /api/register', '201 and the user is logged in', r,
    r.status === 201 && who.data.loggedIn === true && who.data.user.role === 'learner');
  r = await guest.call('POST', '/api/register', { ...newLearner, email: `other${stamp}@tutorlink.test` });
  record('P2-02', 'FR-01 duplicate student number rejected', 'Same student_no, new email', '409', r, r.status === 409);
  r = await guest.call('POST', '/api/register', { ...newLearner, student_no: `21-${stamp}` });
  record('P2-03', 'FR-01 duplicate email rejected', 'Same email, new student_no', '409', r, r.status === 409);
  r = await guest.call('POST', '/api/register', { ...newLearner, student_no: `22-${stamp}`, email: 'not-an-email' });
  record('P2-04', 'Validation: malformed email', 'email = not-an-email', '400', r, r.status === 400);
  r = await guest.call('POST', '/api/register', { ...newLearner, student_no: `23-${stamp}`, email: `pw${stamp}@tutorlink.test`, password: 'short' });
  record('P2-05', 'Validation: password shorter than 8 characters', 'password = short', '400', r, r.status === 400);
  r = await guest.call('POST', '/api/register', { ...newLearner, role: 'tutor', student_no: `24-${stamp}`, email: `t0${stamp}@tutorlink.test`, subject_ids: [] });
  record('P2-06', 'FR-01 a tutor must choose at least one subject', 'role tutor, subject_ids []', '400', r, r.status === 400);
  const newTutorClient = new Client('new-tutor');
  r = await newTutorClient.call('POST', '/api/register', {
    ...newLearner, role: 'tutor', student_no: `25-${stamp}`, email: `t1${stamp}@tutorlink.test`, full_name: 'Test Tutor',
    subject_ids: [subjectId('OOP')], bio: 'Test bio', max_daily_sessions: 2,
  });
  record('P2-07', 'FR-01 register a tutor with a subject', 'POST /api/register role tutor', '201', r, r.status === 201);
  r = await guest.call('POST', '/api/login', { email: 'ana.lim@tutorlink.test', password: 'wrong-password' });
  record('P2-08', 'FR-02 wrong password rejected', 'POST /api/login', '401', r, r.status === 401);
  const inactiveHash = await bcrypt.hash('Password123', 10);
  await q(`INSERT INTO Learner (student_no, full_name, email, password_hash, program, year_level, status)
           VALUES ('30-${stamp}', 'Inactive Learner', 'inactive${stamp}@tutorlink.test', ?, 'BSIT', 1, 'Inactive')`, [inactiveHash]);
  r = await guest.call('POST', '/api/login', { email: `inactive${stamp}@tutorlink.test`, password: 'Password123' });
  record('P2-09', 'Accounts are deactivated by status, not deleted: an Inactive account cannot log in', 'POST /api/login', '401', r, r.status === 401);

  // Tutor profile CRUD (FR-03)
  r = await newTutorClient.call('PUT', '/api/tutor/profile', { bio: 'Updated bio', max_daily_sessions: 4 });
  const prof = await newTutorClient.call('GET', '/api/tutor/profile');
  record('P2-10', 'FR-03 tutor edits bio and daily limit (UPDATE)', 'PUT /api/tutor/profile', '200 and saved',
    r, r.status === 200 && prof.data.profile.bio === 'Updated bio' && prof.data.profile.max_daily_sessions === 4);
  r = await newTutorClient.call('PUT', '/api/tutor/profile', { bio: 'x', max_daily_sessions: 9 });
  record('P2-11', 'FR-03 daily limit must be 1 to 6', 'max_daily_sessions = 9', '400', r, r.status === 400);
  r = await newTutorClient.call('POST', '/api/tutor/subjects', { subject_id: subjectId('WEBDEV') });
  record('P2-12', 'FR-03 tutor adds a subject (INSERT into TutorSubject)', 'POST /api/tutor/subjects', '201', r, r.status === 201);
  r = await newTutorClient.call('POST', '/api/tutor/subjects', { subject_id: subjectId('WEBDEV') });
  record('P2-13', 'Duplicate subject blocked by the composite primary key', 'Same subject again', '409', r, r.status === 409);
  r = await newTutorClient.call('DELETE', `/api/tutor/subjects/${subjectId('WEBDEV')}`);
  record('P2-14', 'FR-03 tutor removes a subject (DELETE from TutorSubject)', 'DELETE /api/tutor/subjects/:id', '200', r, r.status === 200);
  r = await newTutorClient.call('DELETE', `/api/tutor/subjects/${subjectId('OOP')}`);
  record('P2-15', 'A tutor must keep at least one subject', 'Remove the last subject', '400', r, r.status === 400);
  r = await juan.call('DELETE', `/api/tutor/subjects/${subjectId('DBSYS32')}`);
  record('P2-16', 'A subject with Pending or Accepted sessions cannot be removed', 'Juan removes DBSYS32', '409', r, r.status === 409);
  r = await ana.call('GET', '/api/tutor/profile');
  record('P2-17', 'Role check: a learner cannot open the tutor profile API', 'Ana GET /api/tutor/profile', '403', r, r.status === 403);

  // Directory (FR-04): joins, search, filter, sort
  let list = (await guest.call('GET', '/api/tutors?q=juan')).data;
  record('P2-18', 'FR-04 directory search by name', 'GET /api/tutors?q=juan', 'only tutors whose name contains "juan"',
    { status: 200, data: { message: list.map((t) => t.full_name).join(', ') } }, list.length === 1 && /Juan/.test(list[0].full_name));
  list = (await guest.call('GET', `/api/tutors?subject_id=${subjectId('NETWORK')}`)).data;
  record('P2-19', 'FR-04 directory filter by subject', 'GET /api/tutors?subject_id=NETWORK', 'only tutors who teach NETWORK',
    { status: 200, data: { message: list.map((t) => t.full_name).join(', ') } },
    list.length >= 1 && list.every((t) => t.subjects.some((x) => x.subject_code === 'NETWORK')));
  list = (await guest.call('GET', '/api/tutors?sort=name')).data;
  const names = list.map((t) => t.full_name);
  record('P2-20', 'FR-04 directory sorted by name', 'GET /api/tutors?sort=name', 'names in ascending order',
    { status: 200, data: { message: names.slice(0, 3).join(', ') + ', ...' } }, JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b))) || names.every((n, i) => i === 0 || names[i - 1] <= n));
  list = (await guest.call('GET', '/api/tutors?sort=rating')).data;
  const rated = list.filter((t) => t.avg_rating !== null).map((t) => t.avg_rating);
  record('P2-21', 'FR-04 directory sorted by rating (average from joined sessions)', 'GET /api/tutors?sort=rating', 'highest first',
    { status: 200, data: { message: rated.join(', ') } }, rated.every((v, i) => i === 0 || rated[i - 1] >= v));

  // My Sessions (FR-08)
  let mySessions = (await ana.call('GET', '/api/sessions?status=Completed')).data;
  record('P2-22', 'FR-08 My Sessions filtered by status', 'GET /api/sessions?status=Completed', 'only Completed sessions',
    { status: 200, data: { message: `${mySessions.length} rows` } }, mySessions.length >= 1 && mySessions.every((x) => x.status === 'Completed'));
  mySessions = (await ana.call('GET', '/api/sessions?from=2026-11-01&to=2026-11-05')).data;
  record('P2-23', 'FR-08 My Sessions filtered by date range', 'from=2026-11-01&to=2026-11-05', 'only dates inside the range',
    { status: 200, data: { message: `${mySessions.length} rows` } },
    mySessions.length >= 1 && mySessions.every((x) => x.session_date >= '2026-11-01' && x.session_date <= '2026-11-05'));
  mySessions = (await ana.call('GET', '/api/sessions?sort=date_asc')).data;
  record('P2-24', 'FR-08 My Sessions sorted by date', 'sort=date_asc', 'oldest first',
    { status: 200, data: { message: mySessions.map((x) => x.session_date).slice(0, 3).join(', ') + ', ...' } },
    mySessions.every((x, i) => i === 0 || mySessions[i - 1].session_date <= x.session_date));
  r = await ana.call('GET', `/api/sessions?status=Nope`);
  record('P2-25', 'Validation: unknown status filter', 'status=Nope', '400', r, r.status === 400);
  const anyId = (await ana.call('GET', '/api/sessions?sort=date_asc')).data[0].session_id;
  const dtl = await ana.call('GET', `/api/sessions/${anyId}`);
  record('P2-26', 'FR-08 session detail joins TutoringSession, Learner, Tutor and Subject', 'GET /api/sessions/:id',
    'learner, tutor and subject names present',
    { status: dtl.status, data: { message: `${dtl.data.learner_name} / ${dtl.data.tutor_name} / ${dtl.data.subject_title}` } },
    Boolean(dtl.data.learner_name && dtl.data.tutor_name && dtl.data.subject_title));
  r = await guest.call('GET', '/api/sessions');
  record('P2-27', 'Guests cannot read sessions', 'GET /api/sessions without login', '401', r, r.status === 401);

  // Edit a Pending request (UPDATE) with transaction and validation
  const D_EDIT = daysFromNow(50);
  r = await book(eli, 'Marco Villanueva', 'DSALGO', D_EDIT, '09:00', '10:00', 'Edit me');
  const editId = r.data.session_id;
  r = await eli.call('PUT', `/api/sessions/${editId}`, { topic: 'Edited topic', session_date: D_EDIT, start_time: '10:00', end_time: '11:00', venue: 'CCS Lounge' });
  record('P2-28', 'A learner edits a Pending request (UPDATE in a transaction)', 'PUT /api/sessions/:id', '200', r, r.status === 200);
  r = await eli.call('PUT', `/api/sessions/${editId}`, { topic: 'Bad', session_date: YESTERDAY, start_time: '10:00', end_time: '11:00', venue: 'CCS Lounge' });
  record('P2-29', 'Validation: edit to a past date', 'PUT with yesterday', '400', r, r.status === 400);
  r = await eli.call('DELETE', `/api/sessions/${editId}`, { remarks: 'Clean up after the test' });
  record('P2-30', 'Sessions are never deleted: DELETE cancels the session (status change)', 'DELETE /api/sessions/:id', '200, status Cancelled', r, r.status === 200);
  const stillThere = await q('SELECT status FROM TutoringSession WHERE session_id = ?', [editId]);
  record('P2-31', 'The cancelled session row still exists', 'SELECT status', 'Cancelled',
    { status: 200, data: { message: stillThere.length ? stillThere[0].status : 'row missing' } }, stillThere.length === 1 && stillThere[0].status === 'Cancelled');
  phase = 3;

  // ===== A. Main workflow with before/after evidence =========================
  const flow = [];
  report.push('## 3. Before and after tables for the main workflow\n');
  report.push(`Tutor: Juan Dela Cruz, learner: Ana Lim, subject DBSYS32, date ${D_FLOW}.\n`);

  const loadBefore = await q('SELECT fn_tutor_appointment_count(?, ?) AS appointments', [tutorId('Juan Dela Cruz'), D_FLOW]);
  const c0 = await counts();
  r = await book(ana, 'Juan Dela Cruz', 'DBSYS32', D_FLOW, '09:00', '10:00', 'Normalization review');
  const flowId = r.data.session_id;
  record('TC-01', 'FR-05 / BR-01..04 valid request through sp_request_session', 'Ana requests Juan, DBSYS32, 09:00-10:00',
    '201, session saved as Pending, audit row written', r, r.status === 201 && Number.isInteger(flowId));
  let s = await snapshot(flowId);
  flow.push(['After the request (sp_request_session + trg_session_after_insert)', s]);
  const c1 = await counts();
  const loadAfter = await q('SELECT fn_tutor_appointment_count(?, ?) AS appointments', [tutorId('Juan Dela Cruz'), D_FLOW]);

  r = await juan.call('PATCH', `/api/sessions/${flowId}/status`, { status: 'Accepted', remarks: 'See you at the library.' });
  record('TC-02', 'FR-07 tutor accepts a Pending request with a remark', 'Juan PATCH status Accepted',
    '200, status Accepted, audit row Pending to Accepted', r, r.status === 200);
  flow.push(['After the tutor accepts (sp_update_session_status + trg_session_before_update/after_update)', await snapshot(flowId)]);

  // ===== B. Business-rule rejections (each leaves both tables unchanged) =====
  const rejectedBefore = await counts();
  const ruleChecks = [
    ['TC-03', 'BR-01 date in the past', () => book(ana, 'Paolo Reyes', 'NETWORK', YESTERDAY, '09:00', '10:00'), 400, /future/i],
    ['TC-04', 'BR-01 duration shorter than 30 minutes', () => book(ana, 'Paolo Reyes', 'NETWORK', D_OVERLAP, '09:00', '09:20'), 400, /30 to 120/i],
    ['TC-05', 'BR-01 duration longer than 120 minutes', () => book(ana, 'Paolo Reyes', 'NETWORK', D_OVERLAP, '09:00', '11:30'), 400, /30 to 120/i],
    ['TC-06', 'BR-01 end time before start time', () => book(ana, 'Paolo Reyes', 'NETWORK', D_OVERLAP, '10:00', '09:00'), 400, /30 to 120/i],
    ['TC-07', 'BR-02 subject not taught by the tutor', () => book(ana, 'Paolo Reyes', 'DBSYS32', D_OVERLAP, '09:00', '10:00'), 400, /does not teach/i],
  ];
  for (const [id, title, run, status, pattern] of ruleChecks) {
    const res = await run();
    record(id, title, 'POST /api/sessions', `${status} rule message, nothing saved`, res,
      res.status === status && pattern.test(res.data.message || ''));
  }

  // BR-02: tutor equals learner (same student number). Registration blocks this, so the
  // row is inserted directly to show that the database-side check still rejects it.
  const selfHash = await bcrypt.hash('Password123', 10);
  await q(`INSERT INTO Learner (student_no, full_name, email, password_hash, program, year_level)
           VALUES ('99-0002', 'Maria Santos (learner copy)', 'maria.learner@tutorlink.test', ?, 'BSCS', 3)`, [selfHash]);
  const mariaLearner = await new Client('maria-learner').login('maria.learner@tutorlink.test');
  r = await book(mariaLearner, 'Maria Santos', 'OOP', D_SELF, '09:00', '10:00');
  record('TC-08', 'BR-02 tutor and learner share one student number', 'Learner 99-0002 requests tutor 99-0002',
    '400 cannot book with yourself', r, r.status === 400 && /yourself/i.test(r.data.message));

  const rejectedAfter = await counts();
  record('TC-08A', 'A rejected request changes no data', 'Row counts before and after TC-03 to TC-08',
    'TutoringSession and SessionAudit counts unchanged (one extra Learner row is not a session)',
    { status: 200, data: { message: `sessions ${rejectedBefore.sessions} -> ${rejectedAfter.sessions}, audit ${rejectedBefore.audit} -> ${rejectedAfter.audit}` } },
    rejectedBefore.sessions === rejectedAfter.sessions && rejectedBefore.audit === rejectedAfter.audit);

  // BR-03 overlaps
  r = await book(ana, 'Paolo Reyes', 'NETWORK', D_OVERLAP, '13:00', '14:00', 'Subnetting');
  const overlapBase = r.data.session_id;
  record('TC-09', 'Setup: Ana books Paolo 13:00-14:00', 'POST /api/sessions', '201', r, r.status === 201);
  r = await book(ben, 'Paolo Reyes', 'NETWORK', D_OVERLAP, '13:30', '14:30');
  record('TC-10', 'BR-03 tutor already has an overlapping session', 'Ben requests Paolo 13:30-14:30',
    '409 message names the clashing slot 13:00 to 14:00', r, r.status === 409 && /13:00 to 14:00/.test(r.data.message));
  r = await book(ana, 'Maria Santos', 'OOP', D_OVERLAP, '13:30', '14:30');
  record('TC-11', 'BR-03 learner already has an overlapping session', 'Ana requests Maria 13:30-14:30',
    '409 message names the clashing slot', r, r.status === 409 && /You already have a session from 13:00 to 14:00/.test(r.data.message));
  r = await book(ben, 'Paolo Reyes', 'NETWORK', D_OVERLAP, '14:00', '15:00');
  record('TC-12', 'BR-03 back-to-back sessions are allowed (14:00 starts when 13:00-14:00 ends)', 'Ben requests Paolo 14:00-15:00',
    '201', r, r.status === 201);

  // BR-04 daily limit (Liza has a limit of 2)
  const lizaLoadBefore = await q('SELECT fn_tutor_appointment_count(?, ?) AS appointments', [tutorId('Liza Navarro'), D_LIMIT]);
  await book(ana, 'Liza Navarro', 'MOBDEV', D_LIMIT, '09:00', '10:00');
  await book(ben, 'Liza Navarro', 'MOBDEV', D_LIMIT, '10:30', '11:30');
  const lizaLoadFull = await q('SELECT fn_tutor_appointment_count(?, ?) AS appointments', [tutorId('Liza Navarro'), D_LIMIT]);
  r = await book(carla, 'Liza Navarro', 'MOBDEV', D_LIMIT, '13:00', '14:00');
  record('TC-13', 'BR-04 tutor reached the daily limit (limit 2)', 'Carla requests Liza as a third session',
    '409 Tutor has reached the daily limit.', r, r.status === 409 && /daily limit/i.test(r.data.message));
  const dir = (await guest.call('GET', `/api/tutors?date=${D_LIMIT}&sort=name`)).data;
  const lizaRow = dir.find((t) => t.full_name === 'Liza Navarro');
  record('TC-14', 'BR-04 directory shows the tutor as FULL for that date', `GET /api/tutors?date=${D_LIMIT}`,
    'day_load 2 / 2 and is_full true', { status: 200, data: { message: `day_load=${lizaRow.day_load}, max=${lizaRow.max_daily_sessions}, is_full=${lizaRow.is_full}` } },
    lizaRow.day_load === 2 && lizaRow.is_full === true);
  const ld = await guest.call('GET', `/api/tutors/${tutorId('Liza Navarro')}/load?date=${D_LIMIT}`);
  record('TC-15', 'Request form load line (fn_tutor_appointment_count)', 'GET /api/tutors/:id/load', 'count 2, full true',
    { status: ld.status, data: { message: `count=${ld.data.appointment_count}, full=${ld.data.full}` } }, ld.data.appointment_count === 2 && ld.data.full === true);

  // ===== C. Status rules (BR-05) ============================================
  r = await juan.call('PATCH', `/api/sessions/${flowId}/status`, { status: 'Declined' });
  record('TC-17', 'BR-05 Accepted cannot become Declined', 'Juan PATCH status Declined on an Accepted session',
    '409 Invalid status change', r, r.status === 409 && /Invalid status change/.test(r.data.message));
  r = await ana.call('PATCH', `/api/sessions/${flowId}/status`, { status: 'Completed' });
  record('TC-18', 'BR-05 only the tutor may complete', 'Ana PATCH status Completed', '403', r, r.status === 403);
  r = await juan.call('PATCH', `/api/sessions/${flowId}/status`, { status: 'Completed' });
  record('TC-19', 'BR-05 completing before the end time', 'Juan completes a session dated in the future',
    '409 only after its end time', r, r.status === 409 && /after its end time/i.test(r.data.message));
  r = await ana.call('PATCH', `/api/sessions/${flowId}/status`, { status: 'Cancelled', remarks: '' });
  record('TC-20', 'FR-09 cancelling needs a reason', 'Ana cancels with an empty reason', '400 reason required', r,
    r.status === 400 && /reason/i.test(r.data.message));
  r = await ben.call('PATCH', `/api/sessions/${flowId}/status`, { status: 'Cancelled', remarks: 'not mine' });
  record('TC-21', 'Ownership: another learner cannot change the session', 'Ben cancels Ana\'s session', '404 not found', r, r.status === 404);

  // Past Accepted session from the sample data -> complete and rate it
  const past = (await q(
    `SELECT s.session_id FROM TutoringSession s JOIN Tutor t ON t.tutor_id = s.tutor_id
      WHERE t.email = 'juan.delacruz@tutorlink.test' AND s.status = 'Accepted' AND s.session_date < CURDATE()
      ORDER BY s.session_id LIMIT 1`))[0];
  r = await ana.call('PATCH', `/api/sessions/${past.session_id}/status`, { status: 'Cancelled', remarks: 'too late' });
  record('TC-22', 'FR-09 a session that already started cannot be cancelled', 'Ana cancels a past Accepted session',
    '409 only before its start time', r, r.status === 409 && /before its start time/i.test(r.data.message));
  const avgBefore = (await guest.call('GET', '/api/tutors?sort=name')).data.find((t) => t.full_name === 'Juan Dela Cruz');
  r = await juan.call('PATCH', `/api/sessions/${past.session_id}/status`, { status: 'Completed' });
  record('TC-23', 'FR-10 tutor completes a session after its end time', 'Juan completes a past Accepted session',
    '200, completed_at set by the trigger', r, r.status === 200);
  const done = await snapshot(past.session_id);
  record('TC-24', 'trg_session_before_update sets completed_at', 'SELECT completed_at', 'not NULL',
    { status: 200, data: { message: `completed_at=${done.session[0].completed_at}` } }, done.session[0].completed_at !== null);
  r = await ana.call('POST', `/api/sessions/${past.session_id}/rating`, { rating: 5, feedback: 'Very helpful' });
  record('TC-25', 'FR-11 / BR-06 learner rates a Completed session', 'Ana rates 5', '200', r, r.status === 200);
  const avgAfter = (await guest.call('GET', '/api/tutors?sort=name')).data.find((t) => t.full_name === 'Juan Dela Cruz');
  record('TC-26', 'FR-11 the tutor average rating changes in the directory', 'GET /api/tutors',
    'rating_count increases by 1',
    { status: 200, data: { message: `avg ${avgBefore.avg_rating} (${avgBefore.rating_count}) -> ${avgAfter.avg_rating} (${avgAfter.rating_count})` } },
    avgAfter.rating_count === avgBefore.rating_count + 1);
  r = await ana.call('POST', `/api/sessions/${past.session_id}/rating`, { rating: 1 });
  record('TC-27', 'BR-06 a session can be rated only once', 'Ana rates the same session again', '409', r, r.status === 409);
  r = await ben.call('POST', `/api/sessions/${flowId}/rating`, { rating: 4 });
  record('TC-28', 'BR-06 rating only by the owning learner', 'Ben rates Ana\'s session', '404', r, r.status === 404);

  // Decline path
  r = await book(carla, 'Paolo Reyes', 'DSALGO', D_FUTURE_ACCEPT, '09:00', '10:00', 'Sorting');
  const declineId = r.data.session_id;
  r = await paolo.call('PATCH', `/api/sessions/${declineId}/status`, { status: 'Declined', remarks: 'Not available that day' });
  record('TC-29', 'FR-07 tutor declines a request with a remark', 'Paolo declines', '200', r, r.status === 200);
  r = await paolo.call('PATCH', `/api/sessions/${declineId}/status`, { status: 'Accepted' });
  record('TC-30', 'BR-05 Declined is final', 'Paolo accepts a Declined session', '409 Invalid status change', r,
    r.status === 409 && /Invalid status change/.test(r.data.message));

  // Cancel path with reason, learner side
  r = await book(carla, 'Maria Santos', 'WEBDEV', D_FUTURE_ACCEPT, '09:00', '10:00', 'Flexbox');
  const cancelId = r.data.session_id;
  r = await carla.call('DELETE', `/api/sessions/${cancelId}`, { remarks: 'Schedule conflict' });
  record('TC-31', 'FR-09 learner cancels a Pending session with a reason', 'DELETE /api/sessions/:id', '200', r, r.status === 200);

  // ===== D. Database-level rules (any client) ================================
  const direct = [];
  const tryDirect = async (id, requirement, sql, params, expectPattern) => {
    let message = 'no error';
    try { await pool.execute(sql, params); } catch (e) { message = `${e.errno} ${e.sqlMessage}`; }
    const ok = expectPattern.test(message);
    results.push({ phase, id, requirement, input: sql.replace(/\s+/g, ' ').slice(0, 80), expected: String(expectPattern), actual: message, pass: ok ? 'PASS' : 'FAIL' });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${requirement}  ->  ${message}`);
    direct.push({ id, message });
  };
  const pendingRow = (await q(`SELECT session_id FROM TutoringSession WHERE status = 'Pending' ORDER BY session_id LIMIT 1`))[0];
  await tryDirect('TC-32', 'Trigger blocks Pending -> Completed written straight in SQL',
    `UPDATE TutoringSession SET status = 'Completed' WHERE session_id = ?`, [pendingRow.session_id], /Invalid status change/);
  const finalRow = (await q(`SELECT session_id FROM TutoringSession WHERE status = 'Declined' ORDER BY session_id LIMIT 1`))[0];
  await tryDirect('TC-33', 'Trigger blocks a change of a final (Declined) status',
    `UPDATE TutoringSession SET status = 'Accepted' WHERE session_id = ?`, [finalRow.session_id], /Invalid status change/);
  const unrated = (await q(`SELECT session_id FROM TutoringSession WHERE status = 'Pending' ORDER BY session_id LIMIT 1`))[0];
  await tryDirect('TC-34', 'Trigger blocks rating a session that is not Completed',
    `UPDATE TutoringSession SET rating = 5 WHERE session_id = ?`, [unrated.session_id], /rate a session only after/);
  const completedUnrated = (await q(`SELECT session_id FROM TutoringSession WHERE status = 'Completed' AND rating IS NULL ORDER BY session_id LIMIT 1`))[0];
  await tryDirect('TC-35', 'CHECK constraint: rating 6 on a Completed session',
    `UPDATE TutoringSession SET rating = 6 WHERE session_id = ?`, [completedUnrated.session_id], /constraint/i);
  await tryDirect('TC-36', 'SessionAudit is append-only: UPDATE denied to the application user',
    `UPDATE SessionAudit SET remarks = 'tampered' WHERE audit_id = 1`, [], /denied|1142/i);
  await tryDirect('TC-37', 'SessionAudit is append-only: DELETE denied to the application user',
    `DELETE FROM SessionAudit WHERE audit_id = 1`, [], /denied|1142/i);

  // ===== E. Access control and security ======================================
  r = await guest.call('POST', '/api/sessions', { tutor_id: 1 });
  record('TC-38', 'Guests cannot request sessions', 'POST without login', '401', r, r.status === 401);
  r = await ana.call('POST', '/api/login', { email: 'x@y.z', password: 'x' }, { csrf: false });
  record('TC-39', 'CSRF: a state-changing request without the custom header is blocked', 'POST /api/login without X-Requested-With',
    '403', r, r.status === 403);
  r = await ben.call('GET', `/api/sessions/${flowId}`);
  record('TC-40', 'Audit trail is visible only to the learner and tutor of the session', 'Ben GET Ana\'s session', '404', r, r.status === 404);

  // ===== E2. Time zone and concurrency ======================================
  // The test machine may run in UTC. The rules must still use campus time (UTC+8).
  const manilaNow = new Date();
  const hour = manilaNow.getHours();
  if (hour >= 3) {
    const p2 = (n) => String(n).padStart(2, '0');
    const earlier = new Date(manilaNow.getTime() - 2 * 3600 * 1000);
    const start = `${p2(earlier.getHours())}:${p2(earlier.getMinutes())}`;
    const end = `${p2(earlier.getHours() + 1)}:${p2(earlier.getMinutes())}`;
    r = await book(ben, 'Marco Villanueva', 'DSALGO', ymd(manilaNow), start, end);
    record('TC-42', 'BR-01 uses campus time: today, 2 hours ago (Asia/Manila) is rejected', `POST today ${start}-${end}`,
      '400 must be in the future', r, r.status === 400 && /future/i.test(r.data.message));
  } else {
    console.log('SKIP  TC-42  (too close to midnight to build a past time on the same day)');
  }

  const D_RACE = daysFromNow(40);
  const sameSlot = await Promise.all([
    book(ana, 'Marco Villanueva', 'DSALGO', D_RACE, '09:00', '10:00', 'Race A'),
    book(ben, 'Marco Villanueva', 'DSALGO', D_RACE, '09:00', '10:00', 'Race B'),
    book(carla, 'Marco Villanueva', 'DSALGO', D_RACE, '09:30', '10:30', 'Race C'),
  ]);
  const okCount = sameSlot.filter((x) => x.status === 201).length;
  const stored = (await q(`SELECT COUNT(*) AS n FROM TutoringSession WHERE tutor_id = ? AND session_date = ?`, [tutorId('Marco Villanueva'), D_RACE]))[0].n;
  record('TC-43', 'Concurrency: three learners request overlapping slots at the same moment', '3 parallel POSTs, one tutor',
    'exactly one is saved (row lock in sp_request_session)',
    { status: 200, data: { message: `201 responses=${okCount}, rows saved=${stored}` } }, okCount === 1 && Number(stored) === 1);

  const D_RACE2 = daysFromNow(41);
  const burst = await Promise.all([
    book(ana, 'Paolo Reyes', 'NETWORK', D_RACE2, '08:00', '09:00'),
    book(ben, 'Paolo Reyes', 'NETWORK', D_RACE2, '09:30', '10:30'),
    book(carla, 'Paolo Reyes', 'NETWORK', D_RACE2, '11:00', '12:00'),
    book(dino, 'Paolo Reyes', 'NETWORK', D_RACE2, '13:00', '14:00'),
    book(eli, 'Paolo Reyes', 'NETWORK', D_RACE2, '15:00', '16:00'),
  ]);
  const okBurst = burst.filter((x) => x.status === 201).length;
  record('TC-44', 'Concurrency: five learners fill a tutor with a limit of 3 at the same moment', '5 parallel POSTs, non-overlapping times',
    'exactly 3 are saved, the others get the daily-limit message',
    { status: 200, data: { message: `201 responses=${okBurst}, daily-limit rejections=${burst.filter((x) => /daily limit/.test(x.data.message || '')).length}` } },
    okBurst === 3);

  // ===== F. Session details with audit trail ================================
  const detail = await ana.call('GET', `/api/sessions/${flowId}`);
  record('TC-45', 'FR-12 session details return the audit trail', 'Ana GET /api/sessions/:id',
    '200 with 2 audit rows (Pending, Accepted)', { status: detail.status, data: { message: `audit rows=${(detail.data.audit || []).length}` } },
    detail.status === 200 && detail.data.audit.length === 2);

  // ---------- evidence files --------------------------------------------------
  const version = (await q('SELECT VERSION() AS v'))[0].v;
  const summary = (list) => {
    const n = list.filter((x) => x.pass === 'PASS').length;
    return { n, f: list.length - n };
  };
  const p2results = results.filter((x) => x.phase === 2);
  const p3results = results.filter((x) => x.phase === 3);
  const s2 = summary(p2results);
  const s3 = summary(p3results);

  let md2 = `# TutorLink UC - Phase 2 test evidence\n\n`;
  md2 += `Generated: ${new Date().toString()}  \nDatabase: ${version}  \nResult: **${s2.n} passed, ${s2.f} failed** of ${p2results.length} test cases.\n\n`;
  md2 += `Each case calls the running web application over HTTP (the same requests the pages make) and checks the response and, where useful, the database.\n\n`;
  md2 += `## Test-case matrix\n\n${mdTable(p2results, ['id', 'requirement', 'input', 'expected', 'actual', 'pass'])}`;

  let md = `# TutorLink UC - Phase 3 test evidence\n\n`;
  md += `Generated: ${new Date().toString()}  \nDatabase: ${version}  \n`;
  md += `Result: **${s3.n} passed, ${s3.f} failed** of ${p3results.length} test cases.\n\n`;

  md += `## 1. SQL objects installed\n\n`;
  md += mdTable(await q(`SELECT ROUTINE_TYPE AS type, ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_TYPE, ROUTINE_NAME`), ['type', 'name']);
  // The application user has no TRIGGER privilege (least privilege), so the trigger list
  // is read with an administrator login when EVIDENCE_ADMIN_USER is set in .env.
  let triggerRows = [];
  if (process.env.EVIDENCE_ADMIN_USER) {
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST, user: process.env.EVIDENCE_ADMIN_USER,
      password: process.env.EVIDENCE_ADMIN_PASSWORD || '', database: process.env.DB_NAME || 'tutorlink_uc',
    });
    [triggerRows] = await admin.query(`SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS on_table FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`);
    await admin.end();
  }
  md += '\n' + (triggerRows.length
    ? mdTable(triggerRows, ['name', 'timing', 'event', 'on_table'])
    : '_Triggers are not visible to the application user. Run `SHOW TRIGGERS;` as the administrator, or set EVIDENCE_ADMIN_USER and EVIDENCE_ADMIN_PASSWORD in .env and rerun this test._\n');

  md += `\n## 2. Output of fn_tutor_appointment_count\n\n`;
  md += mdTable([
    { call: `fn_tutor_appointment_count(Juan, '${D_FLOW}') before the request`, result: loadBefore[0].appointments },
    { call: `fn_tutor_appointment_count(Juan, '${D_FLOW}') after the request`, result: loadAfter[0].appointments },
    { call: `fn_tutor_appointment_count(Liza, '${D_LIMIT}') before her bookings`, result: lizaLoadBefore[0].appointments },
    { call: `fn_tutor_appointment_count(Liza, '${D_LIMIT}') after two bookings (limit 2, FULL)`, result: lizaLoadFull[0].appointments },
  ], ['call', 'result']);

  md += `\n${report.join('\n')}\n`;
  for (const [title, snap] of flow) {
    md += `**${title}**\n\nTutoringSession\n\n${mdTable(snap.session, ['session_id', 'status', 'rating', 'completed_at'])}\nSessionAudit\n\n${mdTable(snap.audit, ['audit_id', 'session_id', 'old_status', 'new_status', 'changed_by_role', 'remarks'])}\n`;
  }
  md += `Row counts around the first request: TutoringSession ${c0.sessions} -> ${c1.sessions}, SessionAudit ${c0.audit} -> ${c1.audit}.\n\n`;

  md += `### Rejected requests leave both tables unchanged\n\n`;
  md += `Before TC-03 to TC-08: TutoringSession ${rejectedBefore.sessions}, SessionAudit ${rejectedBefore.audit}.  \n`;
  md += `After TC-03 to TC-08: TutoringSession ${rejectedAfter.sessions}, SessionAudit ${rejectedAfter.audit} (unchanged: the rejected requests saved nothing).\n\n`;

  md += `## 4. Test-case matrix\n\n`;
  md += mdTable(p3results, ['id', 'requirement', 'input', 'expected', 'actual', 'pass']);

  md += `\n## 5. Complex query outputs (aggregates and subqueries)\n\n`;
  md += `Subject demand report (GET /api/reports/subject-demand)\n\n`;
  const demand = (await ana.call('GET', '/api/reports/subject-demand')).data;
  md += mdTable(demand, ['subject_code', 'tutors', 'total_sessions', 'completed_sessions', 'avg_rating']);
  md += `\nTutor Juan: my sessions by subject (GET /api/reports/my-summary)\n\n`;
  const mine = (await juan.call('GET', '/api/reports/my-summary')).data;
  md += mdTable(mine, ['subject_code', 'total_sessions', 'completed_sessions', 'not_held', 'avg_rating', 'overall_avg_rating']);

  md += `\n## 6. Server log of every CALL statement\n\n\`\`\`\n${serverLog.filter((l) => l.startsWith('[CALL]') || l.startsWith('[RULE]')).join('\n')}\n\`\`\`\n`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'PHASE2_EVIDENCE.md'), md2);
  fs.writeFileSync(path.join(OUT_DIR, 'PHASE3_EVIDENCE.md'), md);
  fs.writeFileSync(path.join(OUT_DIR, 'server_call_log.txt'), serverLog.join('\n') + '\n');

  console.log(`\nPhase 2: ${s2.n} passed, ${s2.f} failed. Phase 3: ${s3.n} passed, ${s3.f} failed.`);
  console.log('Evidence written to docs/evidence/');
  process.exitCode = s2.f + s3.f ? 1 : 0;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (serverProcess) serverProcess.kill();
    await pool.end().catch(() => {});
  });
