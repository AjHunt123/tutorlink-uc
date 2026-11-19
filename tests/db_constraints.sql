SELECT 'TC-DB-01 duplicate subject_code (UNIQUE)' AS test;
INSERT INTO Subject (subject_code, subject_title) VALUES ('DBSYS32', 'Duplicate');

SELECT 'TC-DB-02 duplicate email (UNIQUE)' AS test;
INSERT INTO Learner (student_no, full_name, email, password_hash, program, year_level)
VALUES ('97-0001', 'Dup Email', 'ana.lim@tutorlink.test', 'x', 'BSIT', 1);

SELECT 'TC-DB-03 year_level 9 (CHECK 1-6)' AS test;
INSERT INTO Learner (student_no, full_name, email, password_hash, program, year_level)
VALUES ('97-0002', 'Bad Year', 'bad.year@tutorlink.test', 'x', 'BSIT', 9);

SELECT 'TC-DB-04 max_daily_sessions 9 (CHECK 1-6)' AS test;
INSERT INTO Tutor (student_no, full_name, email, password_hash, program, year_level, max_daily_sessions)
VALUES ('97-0003', 'Bad Limit', 'bad.limit@tutorlink.test', 'x', 'BSIT', 2, 9);

SELECT 'TC-DB-05 end_time before start_time (CHECK)' AS test;
INSERT INTO TutoringSession (learner_id, tutor_id, subject_id, topic, session_date, start_time, end_time, venue)
VALUES (1, 1, 1, 'Bad time', '2026-12-01', '10:00', '09:00', 'Library');

SELECT 'TC-DB-06 rating 6 (CHECK 1-5)' AS test;
INSERT INTO TutoringSession (learner_id, tutor_id, subject_id, topic, session_date, start_time, end_time, venue, status, rating)
VALUES (1, 1, 1, 'Bad rating', '2026-12-01', '10:00', '11:00', 'Library', 'Completed', 6);

SELECT 'TC-DB-07 invalid status (ENUM)' AS test;
INSERT INTO TutoringSession (learner_id, tutor_id, subject_id, topic, session_date, start_time, end_time, venue, status)
VALUES (1, 1, 1, 'Bad status', '2026-12-01', '10:00', '11:00', 'Library', 'Maybe');

SELECT 'TC-DB-08 session for a tutor that does not exist (FK)' AS test;
INSERT INTO TutoringSession (learner_id, tutor_id, subject_id, topic, session_date, start_time, end_time, venue)
VALUES (1, 999, 1, 'No tutor', '2026-12-01', '10:00', '11:00', 'Library');

SELECT 'TC-DB-09 delete a tutor that has sessions (FK RESTRICT)' AS test;
DELETE FROM Tutor WHERE tutor_id = 1;

SELECT 'TC-DB-10 delete a subject that is in use (FK RESTRICT)' AS test;
DELETE FROM Subject WHERE subject_id = 1;

SELECT 'TC-DB-11 same subject twice for one tutor (composite PK)' AS test;
INSERT INTO TutorSubject (tutor_id, subject_id) VALUES (1, 1);
