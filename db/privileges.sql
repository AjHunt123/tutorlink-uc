-- TutorLink UC: least-privilege access for the web application (proposal Section 8.4)
-- Run as the MySQL administrator, not as tutorlink_app:
--   sudo mysql tutorlink_uc < db/privileges.sql

REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'tutorlink_app'@'localhost';

GRANT SELECT, INSERT, UPDATE ON tutorlink_uc.* TO 'tutorlink_app'@'localhost';
GRANT DELETE ON tutorlink_uc.TutorSubject TO 'tutorlink_app'@'localhost';
GRANT EXECUTE ON tutorlink_uc.* TO 'tutorlink_app'@'localhost';

FLUSH PRIVILEGES;

SHOW GRANTS FOR 'tutorlink_app'@'localhost';
