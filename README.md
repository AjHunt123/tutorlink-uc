# TutorLink UC

Campus Peer Tutoring Session Booking and Tracking System  
IMDBSYS / DBSYS32 final project, University of Cebu – Banilad (Case Study 12, Campus Tutoring Sessions)

**Stack:** HTML / CSS / JavaScript front end, Node.js + Express back end, `mysql2` with parameterized queries, MySQL 8.

| Phase | Content | Where |
| --- | --- | --- |
| 2 | Schema, constraints, sample data, CRUD, joins, validation | `db/schema.sql`, `db/seed.sql`, `routes/`, `public/index.html` |
| 3 | 1 function, 2 stored procedures, 3 triggers used by the application | `db/routines.sql`, `routes/sessions.js` |

---

## 1. Setup (GitHub Codespaces or any Linux machine)

### 1.1 Install and start MySQL

```bash
sudo apt-get update && sudo apt-get install -y mysql-server   # skip if already installed
sudo service mysql start
```

### 1.2 Create the database and the application user (run once)

Run the SQL scripts as the MySQL administrator (`sudo mysql`), **in this order**:

```bash
sudo mysql -e "CREATE DATABASE IF NOT EXISTS tutorlink_uc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'tutorlink_app'@'localhost' IDENTIFIED BY 'choose-a-password';"

sudo mysql tutorlink_uc < db/schema.sql       # 6 tables, constraints, indexes
sudo mysql tutorlink_uc < db/seed.sql         # synthetic sample data (+ audit history for it)
sudo mysql tutorlink_uc < db/routines.sql     # Phase 3: function, procedures, triggers
sudo mysql tutorlink_uc < db/privileges.sql   # least-privilege rights for tutorlink_app
```

To start again from scratch:

```bash
sudo mysql -e "DROP DATABASE tutorlink_uc; CREATE DATABASE tutorlink_uc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
# then repeat the four scripts above
```

### 1.3 Configure and run the application

```bash
cp .env.example .env      # then edit DB_USER, DB_PASSWORD and SESSION_SECRET
npm install
npm start                 # http://localhost:3000  (in Codespaces open the forwarded port 3000)
```

`.env` is ignored by Git. `DB_USER` must be `tutorlink_app` and `DB_PASSWORD` the password chosen in step 1.2.
`APP_TZ=Asia/Manila` and `DB_TIMEZONE=+08:00` keep the booking rules on campus time even when the server runs in UTC.

### Demo accounts (synthetic data, password `Password123`)

| Role | Email |
| --- | --- |
| Learner | `ana.lim@tutorlink.test`, `ben.torres@tutorlink.test`, `carla.mendoza@tutorlink.test` |
| Tutor | `juan.delacruz@tutorlink.test` (DBSYS32, INTPROG, WEBDEV), `liza.navarro@tutorlink.test` (limit 2 per day) |

---

## 2. Tests and evidence

```bash
npm test                # fast checks, no database needed (booking rules, SQL script and route wiring)
npm run test:phase3     # end-to-end run against the real database (see below)
```

`npm run test:phase3` starts the server, drives it over HTTP like the browser, checks the database after each step and writes:

* `docs/evidence/PHASE2_EVIDENCE.md` – Phase 2 test-case matrix
* `docs/evidence/PHASE3_EVIDENCE.md` – SQL objects, `fn_tutor_appointment_count` output, before/after `TutoringSession` and `SessionAudit` tables, rejected requests that change nothing, concurrency tests, complex query results, test-case matrix, server log of every `CALL`
* `docs/evidence/server_call_log.txt` – raw server log

Run it on a freshly loaded database (it adds test rows) and **run it on your own MySQL 8 before submitting**, so the evidence shows your database version. To list the triggers in the evidence file, add `EVIDENCE_ADMIN_USER` and `EVIDENCE_ADMIN_PASSWORD` (an administrator login) to `.env`; the application user is deliberately not allowed to see triggers.

`docs/evidence/screenshots/` holds screenshots of the working screens (login, directory with daily load, request form with FULL, rule message, cancel reason, remarks, audit trail, reports, tutor queue).

---

## 3. How the SQL objects are used (proposal Section 7.3)

| Object | Called from | What it does |
| --- | --- | --- |
| `fn_tutor_appointment_count(tutor_id, date)` | `sp_request_session`; directory (`GET /api/tutors`), request form (`GET /api/tutors/:id/load`), tutor queue (`GET /api/sessions`), tutor dashboard (`GET /api/tutor/dashboard`) | Number of Pending + Accepted sessions of a tutor on a date. Screens show "1 / 3" and FULL. |
| `sp_request_session` | `POST /api/sessions` (`CALL sp_request_session(...)`) | One transaction. Locks the learner and tutor rows, checks BR-01 to BR-04, inserts the Pending session, rolls back on any error. Rule failures use `SIGNAL SQLSTATE '45000'` and the message is shown on the form. |
| `sp_update_session_status` | `PATCH /api/sessions/:id/status`, `DELETE /api/sessions/:id` (Accept, Decline, Cancel, Mark completed) | Checks ownership and BR-05 (who may do which change), requires a reason for cancelling, passes the remark to the audit trigger. |
| `trg_session_after_insert` | every new session | First `SessionAudit` row (Pending). |
| `trg_session_before_update` | every update of `TutoringSession` | Rejects invalid status changes (BR-05) and unrated/double ratings (BR-06) for **any** client, sets `completed_at`. |
| `trg_session_after_update` | every status change | Writes the `SessionAudit` row (old status, new status, role, remarks). |

Error handling: rule messages come from the database (`SIGNAL`) and reach the form as-is; duplicate keys (1062), foreign keys (1451/1452) and CHECK violations get fixed friendly messages; anything else shows a generic message and the details go to the server log (`routes` use `utils/dbCalls.js`). Every `CALL` is logged as `[CALL] ...` and every rejected rule as `[RULE] ...`.

Complex queries (aggregates, derived tables, subqueries): `routes/reports.js` (subject demand, my sessions by subject with an overall-average subquery), tutor directory (`routes/tutors.js`), audit trail (`routes/sessions.js`).

### Business rules map

| Rule | Enforced in |
| --- | --- |
| BR-01 future, 30–120 min | `sp_request_session` |
| BR-02 tutor active, teaches subject, not same student | `sp_request_session` |
| BR-03 no overlap (tutor and learner) | `sp_request_session` |
| BR-04 daily limit | `sp_request_session` + `fn_tutor_appointment_count` |
| BR-05 status changes, roles, Completed after end | `sp_update_session_status` + `trg_session_before_update` |
| BR-06 rate once, Completed only, owner only | rating route + `trg_session_before_update` |

### Known limit

"Edit request" (a learner changing a **Pending** request) is not in the proposal's SQL object plan. It keeps its Phase 2 checks in the Express route (inside a transaction, with the daily load read from `fn_tutor_appointment_count`).

---

## 4. Security notes

* All SQL uses `?` placeholders (`pool.execute`), including `CALL`. No user text is concatenated into SQL.
* The app connects as `tutorlink_app`, never root: `SELECT/INSERT/UPDATE` on the data tables, `DELETE` only on `TutorSubject`, `EXECUTE` on the routines, and only `SELECT/INSERT` on `SessionAudit` (history cannot be edited or deleted by the application).
* Passwords are bcrypt hashes; the session id is regenerated on login and registration; the cookie is `HttpOnly` and `Secure`.
* CSRF: every non-GET request must carry the `X-Requested-With: tutorlink` header (added by the page), which other sites cannot send. The cookie uses `SameSite=None` so the app also works in Codespaces' preview; set `COOKIE_SAMESITE=lax` in `.env` for plain local use.
* Role checks: Express middleware, ownership in every `WHERE`, and the actor check inside `sp_update_session_status`.

## 5. Backup and restore (proposal Section 8.4)

```bash
mysqldump --single-transaction --routines --triggers -u root -p tutorlink_uc > backup_$(date +%Y%m%d).sql
mysql -u root -p tutorlink_uc < backup_YYYYMMDD.sql      # restore into an empty database
```

## 6. Project structure

```
server.js              Express app, session, CSRF header check, time zone
config/db.js           MySQL pool (sets the session time zone)
routes/                auth.js, tutors.js, sessions.js, reports.js
utils/                 sessionRules.js (format + edit rules), dbCalls.js (CALL log, error mapping)
public/index.html      all screens
db/                    schema.sql, seed.sql, routines.sql, privileges.sql
tests/                 phase2.test.js, phase3.static.test.js, phase3.e2e.js, db_constraints.sql
docs/evidence/         generated test evidence and screenshots
```
