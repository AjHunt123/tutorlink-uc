-- =============================================================================
-- TutorLink UC - Phase 3 SQL objects (proposal Section 7.3)
--
--   1 stored function : fn_tutor_appointment_count
--   2 stored procedures: sp_request_session, sp_update_session_status
--   3 triggers        : trg_session_after_insert, trg_session_before_update,
--                       trg_session_after_update
--
-- Run AFTER schema.sql and seed.sql, as the MySQL administrator:
--   mysql -u root -p tutorlink_uc < db/routines.sql
-- (The file uses DELIMITER, so run it with the mysql client or MySQL Workbench,
--  not through the Node application.)
--
-- Error convention: every business-rule failure is raised with
--   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '<readable message>', MYSQL_ERRNO = <code>
-- The MYSQL_ERRNO only tells the Express route which HTTP status to use:
--   50001 = invalid input (400)   50002 = not found (404)
--   50003 = not allowed   (403)   50004 = conflict  (409)
-- =============================================================================

DROP TRIGGER   IF EXISTS trg_session_after_insert;
DROP TRIGGER   IF EXISTS trg_session_before_update;
DROP TRIGGER   IF EXISTS trg_session_after_update;
DROP PROCEDURE IF EXISTS sp_request_session;
DROP PROCEDURE IF EXISTS sp_update_session_status;
DROP FUNCTION  IF EXISTS fn_tutor_appointment_count;

DELIMITER $$

-- -----------------------------------------------------------------------------
-- fn_tutor_appointment_count: number of Pending and Accepted sessions that a
-- tutor has on one date. Used by sp_request_session (daily limit, BR-04) and by
-- the queries behind the directory, the request form and the tutor dashboard.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_tutor_appointment_count(p_tutor_id INT UNSIGNED, p_date DATE)
RETURNS INT
READS SQL DATA
BEGIN
  DECLARE v_count INT DEFAULT 0;

  SELECT COUNT(*) INTO v_count
    FROM TutoringSession
   WHERE tutor_id = p_tutor_id
     AND session_date = p_date
     AND status IN ('Pending', 'Accepted');

  RETURN v_count;
END$$

-- -----------------------------------------------------------------------------
-- sp_request_session: BR-01 to BR-04 in one transaction.
-- Saves a Pending session and returns its id in p_session_id, or raises a rule
-- message and saves nothing (the EXIT handler rolls back).
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_request_session(
  IN  p_learner_id INT UNSIGNED,
  IN  p_tutor_id   INT UNSIGNED,
  IN  p_subject_id INT UNSIGNED,
  IN  p_topic      VARCHAR(200),
  IN  p_date       DATE,
  IN  p_start      TIME,
  IN  p_end        TIME,
  IN  p_venue      VARCHAR(160),
  OUT p_session_id INT UNSIGNED
)
BEGIN
  DECLARE v_minutes        INT;
  DECLARE v_tutor_status   VARCHAR(10);
  DECLARE v_tutor_no       VARCHAR(30);
  DECLARE v_max_daily      TINYINT UNSIGNED;
  DECLARE v_learner_status VARCHAR(10);
  DECLARE v_learner_no     VARCHAR(30);
  DECLARE v_taught         INT DEFAULT 0;
  DECLARE v_clash_start    TIME;
  DECLARE v_clash_end      TIME;
  DECLARE v_msg            VARCHAR(128);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET @actor_role = NULL, @status_remarks = NULL;
    RESIGNAL;
  END;

  SET p_session_id = NULL;

  START TRANSACTION;

  -- BR-01: future start, 30 to 120 minutes, end later than start.
  SET v_minutes = TIMESTAMPDIFF(MINUTE, TIMESTAMP(p_date, p_start), TIMESTAMP(p_date, p_end));
  IF p_date IS NULL OR p_start IS NULL OR p_end IS NULL
     OR TIMESTAMP(p_date, p_start) <= NOW()
     OR v_minutes < 30 OR v_minutes > 120 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Session must be scheduled in the future and last 30 to 120 minutes.',
          MYSQL_ERRNO = 50001;
  END IF;

  -- Lock the learner row, then the tutor row (always in this order), so two
  -- concurrent requests cannot take the same slot or exceed the daily limit.
  SELECT student_no, status INTO v_learner_no, v_learner_status
    FROM Learner WHERE learner_id = p_learner_id FOR UPDATE;
  IF v_learner_no IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Learner account was not found.', MYSQL_ERRNO = 50002;
  END IF;
  IF v_learner_status <> 'Active' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Your account is inactive and cannot request sessions.', MYSQL_ERRNO = 50003;
  END IF;

  SELECT student_no, status, max_daily_sessions INTO v_tutor_no, v_tutor_status, v_max_daily
    FROM Tutor WHERE tutor_id = p_tutor_id FOR UPDATE;
  IF v_tutor_no IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected tutor was not found.', MYSQL_ERRNO = 50002;
  END IF;

  -- BR-02: active tutor, teaches the subject, not the same student.
  IF v_tutor_status <> 'Active' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected tutor is not active.', MYSQL_ERRNO = 50001;
  END IF;

  SELECT COUNT(*) INTO v_taught
    FROM TutorSubject WHERE tutor_id = p_tutor_id AND subject_id = p_subject_id;
  IF v_taught = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected tutor does not teach this subject.', MYSQL_ERRNO = 50001;
  END IF;

  IF v_tutor_no = v_learner_no THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'You cannot book a tutoring session with yourself.', MYSQL_ERRNO = 50001;
  END IF;

  -- BR-03: no overlapping Pending or Accepted session, for the tutor...
  SELECT start_time, end_time INTO v_clash_start, v_clash_end
    FROM TutoringSession
   WHERE tutor_id = p_tutor_id AND session_date = p_date
     AND status IN ('Pending', 'Accepted')
     AND start_time < p_end AND end_time > p_start
   LIMIT 1;
  IF v_clash_start IS NOT NULL THEN
    SET v_msg = CONCAT('Tutor already has a session from ',
          TIME_FORMAT(v_clash_start, '%H:%i'), ' to ', TIME_FORMAT(v_clash_end, '%H:%i'),
          ' that overlaps this time.');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg, MYSQL_ERRNO = 50004;
  END IF;

  -- ...and likewise for the learner.
  SELECT start_time, end_time INTO v_clash_start, v_clash_end
    FROM TutoringSession
   WHERE learner_id = p_learner_id AND session_date = p_date
     AND status IN ('Pending', 'Accepted')
     AND start_time < p_end AND end_time > p_start
   LIMIT 1;
  IF v_clash_start IS NOT NULL THEN
    SET v_msg = CONCAT('You already have a session from ',
          TIME_FORMAT(v_clash_start, '%H:%i'), ' to ', TIME_FORMAT(v_clash_end, '%H:%i'),
          ' that overlaps this time.');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg, MYSQL_ERRNO = 50004;
  END IF;

  -- BR-04: daily limit (uses the stored function).
  IF fn_tutor_appointment_count(p_tutor_id, p_date) >= v_max_daily THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Tutor has reached the daily limit.', MYSQL_ERRNO = 50004;
  END IF;

  -- The audit trigger reads these two variables.
  SET @actor_role = 'learner', @status_remarks = 'Session requested';

  INSERT INTO TutoringSession
    (learner_id, tutor_id, subject_id, topic, session_date, start_time, end_time, venue)
  VALUES
    (p_learner_id, p_tutor_id, p_subject_id, p_topic, p_date, p_start, p_end, p_venue);

  SET p_session_id = LAST_INSERT_ID();
  SET @actor_role = NULL, @status_remarks = NULL;

  COMMIT;
END$$

-- -----------------------------------------------------------------------------
-- sp_update_session_status: BR-05 (who may do which status change) and the
-- remark / reason rules (FR-07, FR-09). The UPDATE fires the triggers, which
-- re-check the transition and write the SessionAudit row.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_update_session_status(
  IN p_session_id INT UNSIGNED,
  IN p_actor_role VARCHAR(20),
  IN p_actor_id   INT UNSIGNED,
  IN p_new_status VARCHAR(20),
  IN p_remarks    VARCHAR(500)
)
BEGIN
  DECLARE v_learner_id INT UNSIGNED;
  DECLARE v_tutor_id   INT UNSIGNED;
  DECLARE v_date       DATE;
  DECLARE v_start      TIME;
  DECLARE v_end        TIME;
  DECLARE v_status     VARCHAR(20);
  DECLARE v_remarks    VARCHAR(500);
  DECLARE v_msg        VARCHAR(128);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET @actor_role = NULL, @status_remarks = NULL;
    RESIGNAL;
  END;

  SET v_remarks = NULLIF(TRIM(p_remarks), '');

  START TRANSACTION;

  IF p_new_status IS NULL OR p_new_status NOT IN ('Accepted', 'Declined', 'Completed', 'Cancelled') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Choose a valid session status.', MYSQL_ERRNO = 50001;
  END IF;
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('learner', 'tutor') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Only a learner or a tutor can change a session.', MYSQL_ERRNO = 50003;
  END IF;
  IF CHAR_LENGTH(v_remarks) > 500 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Remarks must be 500 characters or fewer.', MYSQL_ERRNO = 50001;
  END IF;

  SELECT learner_id, tutor_id, session_date, start_time, end_time, status
    INTO v_learner_id, v_tutor_id, v_date, v_start, v_end, v_status
    FROM TutoringSession WHERE session_id = p_session_id FOR UPDATE;

  -- Unknown session, or a session that belongs to someone else: same answer.
  IF v_status IS NULL
     OR (p_actor_role = 'learner' AND v_learner_id <> p_actor_id)
     OR (p_actor_role = 'tutor'   AND v_tutor_id   <> p_actor_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Tutoring session not found.', MYSQL_ERRNO = 50002;
  END IF;

  -- BR-05: allowed changes (Declined, Completed and Cancelled are final).
  IF NOT ((v_status = 'Pending'  AND p_new_status IN ('Accepted', 'Declined', 'Cancelled'))
       OR (v_status = 'Accepted' AND p_new_status IN ('Completed', 'Cancelled'))) THEN
    SET v_msg = CONCAT('Invalid status change: ', v_status, ' to ', p_new_status, ' is not allowed.');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg, MYSQL_ERRNO = 50004;
  END IF;

  -- BR-05: only the session tutor may accept, decline or complete.
  IF p_new_status IN ('Accepted', 'Declined', 'Completed') AND p_actor_role <> 'tutor' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Only the session tutor can accept, decline or complete a session.',
          MYSQL_ERRNO = 50003;
  END IF;

  -- BR-05: Completed only after the end time.
  IF p_new_status = 'Completed' AND TIMESTAMP(v_date, v_end) > NOW() THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A session can be completed only after its end time.', MYSQL_ERRNO = 50004;
  END IF;

  -- FR-09: cancel before the start time, and record the reason.
  IF p_new_status = 'Cancelled' THEN
    IF TIMESTAMP(v_date, v_start) <= NOW() THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'A session can be cancelled only before its start time.', MYSQL_ERRNO = 50004;
    END IF;
    IF v_remarks IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Please give a reason for cancelling this session.', MYSQL_ERRNO = 50001;
    END IF;
  END IF;

  -- The audit trigger reads these two variables.
  SET @actor_role = p_actor_role, @status_remarks = v_remarks;

  UPDATE TutoringSession SET status = p_new_status WHERE session_id = p_session_id;

  SET @actor_role = NULL, @status_remarks = NULL;

  COMMIT;
END$$

-- -----------------------------------------------------------------------------
-- trg_session_after_insert: first audit row (status Pending).
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_session_after_insert
AFTER INSERT ON TutoringSession
FOR EACH ROW
BEGIN
  INSERT INTO SessionAudit (session_id, old_status, new_status, changed_by_role, remarks)
  VALUES (NEW.session_id, NULL, NEW.status,
          COALESCE(@actor_role, 'system'),
          COALESCE(@status_remarks, 'Session created'));
END$$

-- -----------------------------------------------------------------------------
-- trg_session_before_update: database-level rules that hold for any client.
--   * BR-05 allowed status changes, Completed only after the end time,
--     completed_at set when the status becomes Completed.
--   * BR-06 a rating can be saved once, and only on a Completed session.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_session_before_update
BEFORE UPDATE ON TutoringSession
FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(128);

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'Pending'  AND NEW.status IN ('Accepted', 'Declined', 'Cancelled'))
         OR (OLD.status = 'Accepted' AND NEW.status IN ('Completed', 'Cancelled'))) THEN
      SET v_msg = CONCAT('Invalid status change: ', OLD.status, ' to ', NEW.status, ' is not allowed.');
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg, MYSQL_ERRNO = 50004;
    END IF;

    IF NEW.status = 'Completed' THEN
      IF TIMESTAMP(OLD.session_date, OLD.end_time) > NOW() THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'A session can be completed only after its end time.', MYSQL_ERRNO = 50004;
      END IF;
      SET NEW.completed_at = NOW();
    END IF;
  END IF;

  IF NOT (NEW.rating <=> OLD.rating) THEN
    IF NEW.status <> 'Completed' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'You can rate a session only after it is completed.', MYSQL_ERRNO = 50004;
    END IF;
    IF OLD.rating IS NOT NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'This session has already been rated.', MYSQL_ERRNO = 50004;
    END IF;
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- trg_session_after_update: one audit row for every status change. A rejected
-- change never gets here (the BEFORE trigger raised an error), so no row exists.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_session_after_update
AFTER UPDATE ON TutoringSession
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO SessionAudit (session_id, old_status, new_status, changed_by_role, remarks)
    VALUES (NEW.session_id, OLD.status, NEW.status,
            COALESCE(@actor_role, 'system'),
            @status_remarks);
  END IF;
END$$

DELIMITER ;
