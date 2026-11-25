-- TutorLink UC: least-privilege access for the web application (proposal Section 8.4)
-- Run as the MySQL administrator, not as tutorlink_app, AFTER schema.sql, seed.sql
-- and routines.sql:
--   sudo mysql tutorlink_uc < db/privileges.sql
--
-- The application user can read and write the data tables, DELETE only from
-- TutorSubject, run the stored routines, and may only read and append to the
-- audit table: it has no UPDATE or DELETE on SessionAudit, so history cannot be
-- changed from the application. The triggers write the audit rows.

REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'tutorlink_app'@'localhost';

GRANT SELECT, INSERT, UPDATE ON tutorlink_uc.Learner         TO 'tutorlink_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON tutorlink_uc.Tutor           TO 'tutorlink_app'@'localhost';
GRANT SELECT                 ON tutorlink_uc.Subject         TO 'tutorlink_app'@'localhost';
GRANT SELECT, INSERT, DELETE ON tutorlink_uc.TutorSubject    TO 'tutorlink_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON tutorlink_uc.TutoringSession TO 'tutorlink_app'@'localhost';
GRANT SELECT, INSERT         ON tutorlink_uc.SessionAudit    TO 'tutorlink_app'@'localhost';
GRANT EXECUTE ON tutorlink_uc.* TO 'tutorlink_app'@'localhost';

FLUSH PRIVILEGES;

SHOW GRANTS FOR 'tutorlink_app'@'localhost';
