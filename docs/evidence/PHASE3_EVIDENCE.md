# TutorLink UC - Phase 3 test evidence

Generated: Wed Nov 25 2026 09:51:17 GMT+0800 (Philippine Standard Time)  
Database: 8.0.46-0ubuntu0.24.04.4  
Result: **44 passed, 0 failed** of 44 test cases.

## 1. SQL objects installed

| type | name |
| --- | --- |
| FUNCTION | fn_tutor_appointment_count |
| PROCEDURE | sp_request_session |
| PROCEDURE | sp_update_session_status |

_Triggers are not visible to the application user. Run `SHOW TRIGGERS;` as the administrator, or set EVIDENCE_ADMIN_USER and EVIDENCE_ADMIN_PASSWORD in .env and rerun this test._

## 2. Output of fn_tutor_appointment_count

| call | result |
| --- | --- |
| fn_tutor_appointment_count(Juan, '2026-12-25') before the request | 0 |
| fn_tutor_appointment_count(Juan, '2026-12-25') after the request | 1 |
| fn_tutor_appointment_count(Liza, '2026-12-26') before her bookings | 0 |
| fn_tutor_appointment_count(Liza, '2026-12-26') after two bookings (limit 2, FULL) | 2 |

## 3. Before and after tables for the main workflow

Tutor: Juan Dela Cruz, learner: Ana Lim, subject DBSYS32, date 2026-12-25.

**After the request (sp_request_session + trg_session_after_insert)**

TutoringSession

| session_id | status | rating | completed_at |
| --- | --- | --- | --- |
| 17 | Pending | NULL | NULL |

SessionAudit

| audit_id | session_id | old_status | new_status | changed_by_role | remarks |
| --- | --- | --- | --- | --- | --- |
| 33 | 17 | NULL | Pending | learner | Session requested |

**After the tutor accepts (sp_update_session_status + trg_session_before_update/after_update)**

TutoringSession

| session_id | status | rating | completed_at |
| --- | --- | --- | --- |
| 17 | Accepted | NULL | NULL |

SessionAudit

| audit_id | session_id | old_status | new_status | changed_by_role | remarks |
| --- | --- | --- | --- | --- | --- |
| 33 | 17 | NULL | Pending | learner | Session requested |
| 34 | 17 | Pending | Accepted | tutor | See you at the library. |

Row counts around the first request: TutoringSession 12 -> 13, SessionAudit 21 -> 22.

### Rejected requests leave both tables unchanged

Before TC-03 to TC-08: TutoringSession 13, SessionAudit 23.  
After TC-03 to TC-08: TutoringSession 13, SessionAudit 23 (unchanged: the rejected requests saved nothing).

## 4. Test-case matrix

| id | requirement | input | expected | actual | pass |
| --- | --- | --- | --- | --- | --- |
| TC-01 | FR-05 / BR-01..04 valid request through sp_request_session | Ana requests Juan, DBSYS32, 09:00-10:00 | 201, session saved as Pending, audit row written | 201 Tutoring session requested | PASS |
| TC-02 | FR-07 tutor accepts a Pending request with a remark | Juan PATCH status Accepted | 200, status Accepted, audit row Pending to Accepted | 200 Session accepted | PASS |
| TC-03 | BR-01 date in the past | POST /api/sessions | 400 rule message, nothing saved | 400 Session must be scheduled in the future and last 30 to 120 minutes. | PASS |
| TC-04 | BR-01 duration shorter than 30 minutes | POST /api/sessions | 400 rule message, nothing saved | 400 Session must be scheduled in the future and last 30 to 120 minutes. | PASS |
| TC-05 | BR-01 duration longer than 120 minutes | POST /api/sessions | 400 rule message, nothing saved | 400 Session must be scheduled in the future and last 30 to 120 minutes. | PASS |
| TC-06 | BR-01 end time before start time | POST /api/sessions | 400 rule message, nothing saved | 400 Session must be scheduled in the future and last 30 to 120 minutes. | PASS |
| TC-07 | BR-02 subject not taught by the tutor | POST /api/sessions | 400 rule message, nothing saved | 400 The selected tutor does not teach this subject. | PASS |
| TC-08 | BR-02 tutor and learner share one student number | Learner 99-0002 requests tutor 99-0002 | 400 cannot book with yourself | 400 You cannot book a tutoring session with yourself. | PASS |
| TC-08A | A rejected request changes no data | Row counts before and after TC-03 to TC-08 | TutoringSession and SessionAudit counts unchanged (one extra Learner row is not a session) | 200 sessions 13 -> 13, audit 23 -> 23 | PASS |
| TC-09 | Setup: Ana books Paolo 13:00-14:00 | POST /api/sessions | 201 | 201 Tutoring session requested | PASS |
| TC-10 | BR-03 tutor already has an overlapping session | Ben requests Paolo 13:30-14:30 | 409 message names the clashing slot 13:00 to 14:00 | 409 Tutor already has a session from 13:00 to 14:00 that overlaps this time. | PASS |
| TC-11 | BR-03 learner already has an overlapping session | Ana requests Maria 13:30-14:30 | 409 message names the clashing slot | 409 You already have a session from 13:00 to 14:00 that overlaps this time. | PASS |
| TC-12 | BR-03 back-to-back sessions are allowed (14:00 starts when 13:00-14:00 ends) | Ben requests Paolo 14:00-15:00 | 201 | 201 Tutoring session requested | PASS |
| TC-13 | BR-04 tutor reached the daily limit (limit 2) | Carla requests Liza as a third session | 409 Tutor has reached the daily limit. | 409 Tutor has reached the daily limit. | PASS |
| TC-14 | BR-04 directory shows the tutor as FULL for that date | GET /api/tutors?date=2026-12-26 | day_load 2 / 2 and is_full true | 200 day_load=2, max=2, is_full=true | PASS |
| TC-15 | Request form load line (fn_tutor_appointment_count) | GET /api/tutors/:id/load | count 2, full true | 200 count=2, full=true | PASS |
| TC-17 | BR-05 Accepted cannot become Declined | Juan PATCH status Declined on an Accepted session | 409 Invalid status change | 409 Invalid status change: Accepted to Declined is not allowed. | PASS |
| TC-18 | BR-05 only the tutor may complete | Ana PATCH status Completed | 403 | 403 Only the session tutor can accept, decline or complete a session. | PASS |
| TC-19 | BR-05 completing before the end time | Juan completes a session dated in the future | 409 only after its end time | 409 A session can be completed only after its end time. | PASS |
| TC-20 | FR-09 cancelling needs a reason | Ana cancels with an empty reason | 400 reason required | 400 Please give a reason for cancelling this session. | PASS |
| TC-21 | Ownership: another learner cannot change the session | Ben cancels Ana's session | 404 not found | 404 Tutoring session not found. | PASS |
| TC-22 | FR-09 a session that already started cannot be cancelled | Ana cancels a past Accepted session | 409 only before its start time | 409 A session can be cancelled only before its start time. | PASS |
| TC-23 | FR-10 tutor completes a session after its end time | Juan completes a past Accepted session | 200, completed_at set by the trigger | 200 Session completed | PASS |
| TC-24 | trg_session_before_update sets completed_at | SELECT completed_at | not NULL | 200 completed_at=2026-11-25 09:51:16 | PASS |
| TC-25 | FR-11 / BR-06 learner rates a Completed session | Ana rates 5 | 200 | 200 Thank you for rating this session | PASS |
| TC-26 | FR-11 the tutor average rating changes in the directory | GET /api/tutors | rating_count increases by 1 | 200 avg 4.5 (2) -> 4.7 (3) | PASS |
| TC-27 | BR-06 a session can be rated only once | Ana rates the same session again | 409 | 409 This session has already been rated | PASS |
| TC-28 | BR-06 rating only by the owning learner | Ben rates Ana's session | 404 | 404 Tutoring session not found | PASS |
| TC-29 | FR-07 tutor declines a request with a remark | Paolo declines | 200 | 200 Session declined | PASS |
| TC-30 | BR-05 Declined is final | Paolo accepts a Declined session | 409 Invalid status change | 409 Invalid status change: Declined to Accepted is not allowed. | PASS |
| TC-31 | FR-09 learner cancels a Pending session with a reason | DELETE /api/sessions/:id | 200 | 200 Session cancelled | PASS |
| TC-32 | Trigger blocks Pending -> Completed written straight in SQL | UPDATE TutoringSession SET status = 'Completed' WHERE session_id = ? | /Invalid status change/ | 50004 Invalid status change: Pending to Completed is not allowed. | PASS |
| TC-33 | Trigger blocks a change of a final (Declined) status | UPDATE TutoringSession SET status = 'Accepted' WHERE session_id = ? | /Invalid status change/ | 50004 Invalid status change: Declined to Accepted is not allowed. | PASS |
| TC-34 | Trigger blocks rating a session that is not Completed | UPDATE TutoringSession SET rating = 5 WHERE session_id = ? | /rate a session only after/ | 50004 You can rate a session only after it is completed. | PASS |
| TC-35 | CHECK constraint: rating 6 on a Completed session | UPDATE TutoringSession SET rating = 6 WHERE session_id = ? | /constraint/i | 3819 Check constraint 'chk_tutoring_session_rating' is violated. | PASS |
| TC-36 | SessionAudit is append-only: UPDATE denied to the application user | UPDATE SessionAudit SET remarks = 'tampered' WHERE audit_id = 1 | /denied/1142/i | 1142 UPDATE command denied to user 'tutorlink_app'@'localhost' for table 'SessionAudit' | PASS |
| TC-37 | SessionAudit is append-only: DELETE denied to the application user | DELETE FROM SessionAudit WHERE audit_id = 1 | /denied/1142/i | 1142 DELETE command denied to user 'tutorlink_app'@'localhost' for table 'SessionAudit' | PASS |
| TC-38 | Guests cannot request sessions | POST without login | 401 | 401 Please log in to manage tutoring sessions | PASS |
| TC-39 | CSRF: a state-changing request without the custom header is blocked | POST /api/login without X-Requested-With | 403 | 403 Request blocked: missing security header | PASS |
| TC-40 | Audit trail is visible only to the learner and tutor of the session | Ben GET Ana's session | 404 | 404 Tutoring session not found | PASS |
| TC-42 | BR-01 uses campus time: today, 2 hours ago (Asia/Manila) is rejected | POST today 07:51-08:51 | 400 must be in the future | 400 Session must be scheduled in the future and last 30 to 120 minutes. | PASS |
| TC-43 | Concurrency: three learners request overlapping slots at the same moment | 3 parallel POSTs, one tutor | exactly one is saved (row lock in sp_request_session) | 200 201 responses=1, rows saved=1 | PASS |
| TC-44 | Concurrency: five learners fill a tutor with a limit of 3 at the same moment | 5 parallel POSTs, non-overlapping times | exactly 3 are saved, the others get the daily-limit message | 200 201 responses=3, daily-limit rejections=2 | PASS |
| TC-45 | FR-12 session details return the audit trail | Ana GET /api/sessions/:id | 200 with 2 audit rows (Pending, Accepted) | 200 audit rows=2 | PASS |

## 5. Complex query outputs (aggregates and subqueries)

Subject demand report (GET /api/reports/subject-demand)

| subject_code | tutors | total_sessions | completed_sessions | avg_rating |
| --- | --- | --- | --- | --- |
| NETWORK | 1 | 8 | 1 | NULL |
| DBSYS32 | 2 | 4 | 3 | 4.7 |
| DSALGO | 2 | 3 | 0 | NULL |
| WEBDEV | 2 | 3 | 0 | NULL |
| INTPROG | 3 | 2 | 1 | 5 |
| MOBDEV | 1 | 2 | 0 | NULL |
| OOP | 3 | 1 | 0 | NULL |
| SYSANA | 1 | 0 | 0 | NULL |

Tutor Juan: my sessions by subject (GET /api/reports/my-summary)

| subject_code | total_sessions | completed_sessions | not_held | avg_rating | overall_avg_rating |
| --- | --- | --- | --- | --- | --- |
| DBSYS32 | 4 | 3 | 0 | 4.7 | 4.8 |
| INTPROG | 1 | 0 | 0 | NULL | 4.8 |
| WEBDEV | 1 | 0 | 0 | NULL | 4.8 |

## 6. Server log of every CALL statement

```
[CALL] sp_request_session(5, 5, 5, 'Edit me', '2027-01-14', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_update_session_status(16, 'learner', 5, 'Cancelled', 'Clean up after the test')
[CALL] sp_request_session(1, 1, 1, 'Normalization review', '2026-12-25', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_update_session_status(17, 'tutor', 1, 'Accepted', 'See you at the library.')
[CALL] sp_request_session(1, 3, 4, 'Evidence test', '2026-11-24', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Session must be scheduled in the future and last 30 to 120 minutes.
[CALL] sp_request_session(1, 3, 4, 'Evidence test', '2026-12-27', '09:00:00', '09:20:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Session must be scheduled in the future and last 30 to 120 minutes.
[CALL] sp_request_session(1, 3, 4, 'Evidence test', '2026-12-27', '09:00:00', '11:30:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Session must be scheduled in the future and last 30 to 120 minutes.
[CALL] sp_request_session(1, 3, 4, 'Evidence test', '2026-12-27', '10:00:00', '09:00:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Session must be scheduled in the future and last 30 to 120 minutes.
[CALL] sp_request_session(1, 3, 1, 'Evidence test', '2026-12-27', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: The selected tutor does not teach this subject.
[CALL] sp_request_session(8, 2, 6, 'Evidence test', '2026-12-28', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: You cannot book a tutoring session with yourself.
[CALL] sp_request_session(1, 3, 4, 'Subnetting', '2026-12-27', '13:00:00', '14:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(2, 3, 4, 'Evidence test', '2026-12-27', '13:30:00', '14:30:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Tutor already has a session from 13:00 to 14:00 that overlaps this time.
[CALL] sp_request_session(1, 2, 6, 'Evidence test', '2026-12-27', '13:30:00', '14:30:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: You already have a session from 13:00 to 14:00 that overlaps this time.
[CALL] sp_request_session(2, 3, 4, 'Evidence test', '2026-12-27', '14:00:00', '15:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(1, 4, 8, 'Evidence test', '2026-12-26', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(2, 4, 8, 'Evidence test', '2026-12-26', '10:30:00', '11:30:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(3, 4, 8, 'Evidence test', '2026-12-26', '13:00:00', '14:00:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Tutor has reached the daily limit.
[CALL] sp_update_session_status(17, 'tutor', 1, 'Declined', NULL)
[RULE] sp_update_session_status: Invalid status change: Accepted to Declined is not allowed.
[CALL] sp_update_session_status(17, 'learner', 1, 'Completed', NULL)
[RULE] sp_update_session_status: Only the session tutor can accept, decline or complete a session.
[CALL] sp_update_session_status(17, 'tutor', 1, 'Completed', NULL)
[RULE] sp_update_session_status: A session can be completed only after its end time.
[CALL] sp_update_session_status(17, 'learner', 1, 'Cancelled', NULL)
[RULE] sp_update_session_status: Please give a reason for cancelling this session.
[CALL] sp_update_session_status(17, 'learner', 2, 'Cancelled', 'not mine')
[RULE] sp_update_session_status: Tutoring session not found.
[CALL] sp_update_session_status(7, 'learner', 1, 'Cancelled', 'too late')
[RULE] sp_update_session_status: A session can be cancelled only before its start time.
[CALL] sp_update_session_status(7, 'tutor', 1, 'Completed', NULL)
[CALL] sp_request_session(3, 3, 5, 'Sorting', '2026-12-29', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_update_session_status(22, 'tutor', 3, 'Declined', 'Not available that day')
[CALL] sp_update_session_status(22, 'tutor', 3, 'Accepted', NULL)
[RULE] sp_update_session_status: Invalid status change: Declined to Accepted is not allowed.
[CALL] sp_request_session(3, 2, 3, 'Flexbox', '2026-12-29', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_update_session_status(23, 'learner', 3, 'Cancelled', 'Schedule conflict')
[CALL] sp_request_session(2, 5, 5, 'Evidence test', '2026-11-25', '07:51:00', '08:51:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Session must be scheduled in the future and last 30 to 120 minutes.
[CALL] sp_request_session(1, 5, 5, 'Race A', '2027-01-04', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(2, 5, 5, 'Race B', '2027-01-04', '09:00:00', '10:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(3, 5, 5, 'Race C', '2027-01-04', '09:30:00', '10:30:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Tutor already has a session from 09:00 to 10:00 that overlaps this time.
[RULE] sp_request_session: Tutor already has a session from 09:00 to 10:00 that overlaps this time.
[CALL] sp_request_session(1, 3, 4, 'Evidence test', '2027-01-05', '08:00:00', '09:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(2, 3, 4, 'Evidence test', '2027-01-05', '09:30:00', '10:30:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(3, 3, 4, 'Evidence test', '2027-01-05', '11:00:00', '12:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(4, 3, 4, 'Evidence test', '2027-01-05', '13:00:00', '14:00:00', 'UC Banilad Library', @new_session_id)
[CALL] sp_request_session(5, 3, 4, 'Evidence test', '2027-01-05', '15:00:00', '16:00:00', 'UC Banilad Library', @new_session_id)
[RULE] sp_request_session: Tutor has reached the daily limit.
[RULE] sp_request_session: Tutor has reached the daily limit.
```
