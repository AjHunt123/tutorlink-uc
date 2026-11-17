-- TutorLink UC seed data (synthetic only, no real student information)
-- Every demo account uses the password: Password123
-- Safe to run again: subjects, tutors, learners and sessions are not duplicated

INSERT INTO Subject (subject_code, subject_title) VALUES
('DBSYS32', 'Database Systems 2'),
('INTPROG', 'Integrative Programming'),
('WEBDEV',  'Web Development'),
('NETWORK', 'Networking'),
('DSALGO',  'Data Structures and Algorithms'),
('OOP',     'Object-Oriented Programming'),
('SYSANA',  'Systems Analysis and Design'),
('MOBDEV',  'Mobile Application Development')
ON DUPLICATE KEY UPDATE subject_title = VALUES(subject_title);

INSERT INTO Tutor (student_no, full_name, email, password_hash, program, year_level, bio, max_daily_sessions) VALUES
('99-0001', 'Juan Dela Cruz',   'juan.delacruz@tutorlink.test',   '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIT', 4, 'Enjoys explaining SQL, joins and stored procedures with real examples.', 3),
('99-0002', 'Maria Santos',     'maria.santos@tutorlink.test',    '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSCS', 3, 'Patient with beginners in programming and object-oriented design.', 3),
('99-0003', 'Paolo Reyes',      'paolo.reyes@tutorlink.test',     '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIT', 3, 'Networking labs, subnetting and algorithm practice.', 3),
('99-0004', 'Liza Navarro',     'liza.navarro@tutorlink.test',    '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIT', 4, 'Mobile app development and systems analysis help.', 2),
('99-0005', 'Marco Villanueva', 'marco.villanueva@tutorlink.test','$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSCS', 4, 'Data structures, algorithms and database design.', 4)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO Learner (student_no, full_name, email, password_hash, program, year_level) VALUES
('98-0001', 'Ana Lim',        'ana.lim@tutorlink.test',        '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIT', 3),
('98-0002', 'Ben Torres',     'ben.torres@tutorlink.test',     '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIT', 2),
('98-0003', 'Carla Mendoza',  'carla.mendoza@tutorlink.test',  '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSCS', 2),
('98-0004', 'Dino Garcia',    'dino.garcia@tutorlink.test',    '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIT', 1),
('98-0005', 'Eli Ramos',      'eli.ramos@tutorlink.test',      '$2b$10$0D2oWsdqm0P0k44v04JRpuWGRCQnkIGzdExXz8Ol1a4/qpy78SEEq', 'BSIS', 3)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT IGNORE INTO TutorSubject (tutor_id, subject_id)
SELECT t.tutor_id, s.subject_id
FROM (
  SELECT 'juan.delacruz@tutorlink.test' AS email, 'DBSYS32' AS code UNION ALL
  SELECT 'juan.delacruz@tutorlink.test', 'INTPROG' UNION ALL
  SELECT 'juan.delacruz@tutorlink.test', 'WEBDEV' UNION ALL
  SELECT 'maria.santos@tutorlink.test', 'INTPROG' UNION ALL
  SELECT 'maria.santos@tutorlink.test', 'OOP' UNION ALL
  SELECT 'maria.santos@tutorlink.test', 'WEBDEV' UNION ALL
  SELECT 'paolo.reyes@tutorlink.test', 'NETWORK' UNION ALL
  SELECT 'paolo.reyes@tutorlink.test', 'DSALGO' UNION ALL
  SELECT 'liza.navarro@tutorlink.test', 'MOBDEV' UNION ALL
  SELECT 'liza.navarro@tutorlink.test', 'OOP' UNION ALL
  SELECT 'liza.navarro@tutorlink.test', 'SYSANA' UNION ALL
  SELECT 'marco.villanueva@tutorlink.test', 'DSALGO' UNION ALL
  SELECT 'marco.villanueva@tutorlink.test', 'DBSYS32' UNION ALL
  SELECT 'marco.villanueva@tutorlink.test', 'INTPROG'
) m
JOIN Tutor t ON t.email = m.email
JOIN Subject s ON s.subject_code = m.code;

INSERT INTO TutoringSession
  (learner_id, tutor_id, subject_id, topic, session_date, start_time, end_time, venue, status, rating, feedback, completed_at)
SELECT l.learner_id, t.tutor_id, s.subject_id, d.topic, d.session_date, d.start_time, d.end_time, d.venue, d.status, d.rating, d.feedback, d.completed_at
FROM (
  SELECT 'ana.lim@tutorlink.test' AS learner_email, 'juan.delacruz@tutorlink.test' AS tutor_email, 'DBSYS32' AS code,
         'Writing JOIN queries' AS topic, DATE '2026-11-03' AS session_date, TIME '14:00:00' AS start_time, TIME '15:00:00' AS end_time,
         'UC Banilad Library' AS venue, 'Completed' AS status, 5 AS rating, 'Very clear explanations.' AS feedback, TIMESTAMP '2026-11-03 15:05:00' AS completed_at
  UNION ALL
  SELECT 'ben.torres@tutorlink.test', 'juan.delacruz@tutorlink.test', 'DBSYS32',
         'Normalization practice', DATE '2026-11-05', TIME '10:00:00', TIME '11:00:00',
         'CCS Lounge', 'Completed', 4, 'Helpful, went a little fast.', TIMESTAMP '2026-11-05 11:03:00'
  UNION ALL
  SELECT 'carla.mendoza@tutorlink.test', 'maria.santos@tutorlink.test', 'INTPROG',
         'Intro to REST endpoints', DATE '2026-11-04', TIME '13:00:00', TIME '14:30:00',
         'UC Banilad Library', 'Completed', 5, 'Great examples.', TIMESTAMP '2026-11-04 14:35:00'
  UNION ALL
  SELECT 'dino.garcia@tutorlink.test', 'paolo.reyes@tutorlink.test', 'NETWORK',
         'Subnetting basics', DATE '2026-11-06', TIME '15:00:00', TIME '16:00:00',
         'Room 301', 'Completed', NULL, NULL, TIMESTAMP '2026-11-06 16:02:00'
  UNION ALL
  SELECT 'ana.lim@tutorlink.test', 'maria.santos@tutorlink.test', 'WEBDEV',
         'CSS layout help', DATE '2026-11-10', TIME '09:00:00', TIME '10:00:00',
         'CCS Lounge', 'Cancelled', NULL, NULL, NULL
  UNION ALL
  SELECT 'ben.torres@tutorlink.test', 'paolo.reyes@tutorlink.test', 'NETWORK',
         'Routing review', DATE '2026-11-11', TIME '16:00:00', TIME '17:00:00',
         'Room 301', 'Declined', NULL, NULL, NULL
  UNION ALL
  SELECT 'ana.lim@tutorlink.test', 'juan.delacruz@tutorlink.test', 'DBSYS32',
         'Writing stored procedures', DATE '2026-11-20', TIME '14:00:00', TIME '15:00:00',
         'UC Banilad Library', 'Accepted', NULL, NULL, NULL
  UNION ALL
  SELECT 'carla.mendoza@tutorlink.test', 'juan.delacruz@tutorlink.test', 'WEBDEV',
         'Express routes and forms', DATE '2026-11-20', TIME '16:00:00', TIME '17:00:00',
         'CCS Lounge', 'Accepted', NULL, NULL, NULL
  UNION ALL
  SELECT 'ben.torres@tutorlink.test', 'juan.delacruz@tutorlink.test', 'INTPROG',
         'Connecting Node.js to MySQL', DATE '2026-11-20', TIME '17:30:00', TIME '18:30:00',
         'UC Banilad Library', 'Pending', NULL, NULL, NULL
  UNION ALL
  SELECT 'dino.garcia@tutorlink.test', 'maria.santos@tutorlink.test', 'OOP',
         'Classes and inheritance', DATE '2026-11-21', TIME '10:00:00', TIME '11:00:00',
         'CCS Lounge', 'Pending', NULL, NULL, NULL
  UNION ALL
  SELECT 'eli.ramos@tutorlink.test', 'paolo.reyes@tutorlink.test', 'NETWORK',
         'Packet tracer lab', DATE '2026-11-23', TIME '13:00:00', TIME '14:00:00',
         'Room 301', 'Pending', NULL, NULL, NULL
) d
JOIN Learner l ON l.email = d.learner_email
JOIN Tutor t ON t.email = d.tutor_email
JOIN Subject s ON s.subject_code = d.code
WHERE NOT EXISTS (
  SELECT 1 FROM TutoringSession x
  WHERE x.tutor_id = t.tutor_id
    AND x.session_date = d.session_date
    AND x.start_time = d.start_time
);