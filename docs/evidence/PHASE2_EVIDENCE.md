# TutorLink UC - Phase 2 test evidence

Generated: Wed Nov 25 2026 09:51:17 GMT+0800 (Philippine Standard Time)  
Database: 8.0.46-0ubuntu0.24.04.4  
Result: **31 passed, 0 failed** of 31 test cases.

Each case calls the running web application over HTTP (the same requests the pages make) and checks the response and, where useful, the database.

## Test-case matrix

| id | requirement | input | expected | actual | pass |
| --- | --- | --- | --- | --- | --- |
| P2-01 | FR-01 register a learner | POST /api/register | 201 and the user is logged in | 201 | PASS |
| P2-02 | FR-01 duplicate student number rejected | Same student_no, new email | 409 | 409 Student number or email is already registered | PASS |
| P2-03 | FR-01 duplicate email rejected | Same email, new student_no | 409 | 409 Student number or email is already registered | PASS |
| P2-04 | Validation: malformed email | email = not-an-email | 400 | 400 Email must be a valid email address | PASS |
| P2-05 | Validation: password shorter than 8 characters | password = short | 400 | 400 Password must be at least 8 characters | PASS |
| P2-06 | FR-01 a tutor must choose at least one subject | role tutor, subject_ids [] | 400 | 400 Choose at least one subject you teach | PASS |
| P2-07 | FR-01 register a tutor with a subject | POST /api/register role tutor | 201 | 201 | PASS |
| P2-08 | FR-02 wrong password rejected | POST /api/login | 401 | 401 Invalid email or password | PASS |
| P2-09 | Accounts are deactivated by status, not deleted: an Inactive account cannot log in | POST /api/login | 401 | 401 Invalid email or password, or this account is inactive | PASS |
| P2-10 | FR-03 tutor edits bio and daily limit (UPDATE) | PUT /api/tutor/profile | 200 and saved | 200 Profile updated | PASS |
| P2-11 | FR-03 daily limit must be 1 to 6 | max_daily_sessions = 9 | 400 | 400 Daily session limit must be a whole number from 1 to 6 | PASS |
| P2-12 | FR-03 tutor adds a subject (INSERT into TutorSubject) | POST /api/tutor/subjects | 201 | 201 Subject added | PASS |
| P2-13 | Duplicate subject blocked by the composite primary key | Same subject again | 409 | 409 You already teach this subject | PASS |
| P2-14 | FR-03 tutor removes a subject (DELETE from TutorSubject) | DELETE /api/tutor/subjects/:id | 200 | 200 Subject removed | PASS |
| P2-15 | A tutor must keep at least one subject | Remove the last subject | 400 | 400 A tutor must teach at least one subject | PASS |
| P2-16 | A subject with Pending or Accepted sessions cannot be removed | Juan removes DBSYS32 | 409 | 409 Resolve your Pending or Accepted sessions in this subject before removing it | PASS |
| P2-17 | Role check: a learner cannot open the tutor profile API | Ana GET /api/tutor/profile | 403 | 403 Only tutors can manage a tutor profile | PASS |
| P2-18 | FR-04 directory search by name | GET /api/tutors?q=juan | only tutors whose name contains "juan" | 200 Juan Dela Cruz | PASS |
| P2-19 | FR-04 directory filter by subject | GET /api/tutors?subject_id=NETWORK | only tutors who teach NETWORK | 200 Paolo Reyes | PASS |
| P2-20 | FR-04 directory sorted by name | GET /api/tutors?sort=name | names in ascending order | 200 Juan Dela Cruz, Liza Navarro, Marco Villanueva, ... | PASS |
| P2-21 | FR-04 directory sorted by rating (average from joined sessions) | GET /api/tutors?sort=rating | highest first | 200 5, 4.5 | PASS |
| P2-22 | FR-08 My Sessions filtered by status | GET /api/sessions?status=Completed | only Completed sessions | 200 1 rows | PASS |
| P2-23 | FR-08 My Sessions filtered by date range | from=2026-11-01&to=2026-11-05 | only dates inside the range | 200 1 rows | PASS |
| P2-24 | FR-08 My Sessions sorted by date | sort=date_asc | oldest first | 200 2026-11-03, 2026-11-10, 2026-11-20, ... | PASS |
| P2-25 | Validation: unknown status filter | status=Nope | 400 | 400 Choose a valid status filter | PASS |
| P2-26 | FR-08 session detail joins TutoringSession, Learner, Tutor and Subject | GET /api/sessions/:id | learner, tutor and subject names present | 200 Ana Lim / Juan Dela Cruz / Database Systems 2 | PASS |
| P2-27 | Guests cannot read sessions | GET /api/sessions without login | 401 | 401 Please log in to manage tutoring sessions | PASS |
| P2-28 | A learner edits a Pending request (UPDATE in a transaction) | PUT /api/sessions/:id | 200 | 200 Tutoring session request updated | PASS |
| P2-29 | Validation: edit to a past date | PUT with yesterday | 400 | 400 Choose a session time in the future | PASS |
| P2-30 | Sessions are never deleted: DELETE cancels the session (status change) | DELETE /api/sessions/:id | 200, status Cancelled | 200 Session cancelled | PASS |
| P2-31 | The cancelled session row still exists | SELECT status | Cancelled | 200 Cancelled | PASS |
