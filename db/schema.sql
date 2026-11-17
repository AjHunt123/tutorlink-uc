CREATE TABLE IF NOT EXISTS Learner (
  learner_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(30) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  program VARCHAR(120) NOT NULL,
  year_level TINYINT UNSIGNED NOT NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_learner_year_level CHECK (year_level BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Tutor (
  tutor_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(30) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  program VARCHAR(120) NOT NULL,
  year_level TINYINT UNSIGNED NOT NULL,
  bio TEXT,
  max_daily_sessions TINYINT UNSIGNED NOT NULL DEFAULT 3,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_tutor_year_level CHECK (year_level BETWEEN 1 AND 6),
  CONSTRAINT chk_tutor_daily_limit CHECK (max_daily_sessions BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Subject (
  subject_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_code VARCHAR(30) NOT NULL UNIQUE,
  subject_title VARCHAR(150) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TutorSubject (
  tutor_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (tutor_id, subject_id),
  CONSTRAINT fk_tutorsubject_tutor FOREIGN KEY (tutor_id)
    REFERENCES Tutor (tutor_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tutorsubject_subject FOREIGN KEY (subject_id)
    REFERENCES Subject (subject_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TutoringSession (
  session_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  learner_id INT UNSIGNED NOT NULL,
  tutor_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  topic VARCHAR(200) NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue VARCHAR(160) NOT NULL,
  status ENUM('Pending', 'Accepted', 'Declined', 'Completed', 'Cancelled')
    NOT NULL DEFAULT 'Pending',
  rating TINYINT UNSIGNED NULL,
  feedback TEXT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT fk_tutoring_session_learner FOREIGN KEY (learner_id)
    REFERENCES Learner (learner_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tutoring_session_tutor FOREIGN KEY (tutor_id)
    REFERENCES Tutor (tutor_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tutoring_session_subject FOREIGN KEY (subject_id)
    REFERENCES Subject (subject_id) ON DELETE RESTRICT,
  CONSTRAINT chk_tutoring_session_time CHECK (end_time > start_time),
  CONSTRAINT chk_tutoring_session_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  INDEX idx_session_tutor_date_status (tutor_id, session_date, status),
  INDEX idx_session_learner_date_status (learner_id, session_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SessionAudit (
  audit_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NOT NULL,
  old_status ENUM('Pending', 'Accepted', 'Declined', 'Completed', 'Cancelled') NULL,
  new_status ENUM('Pending', 'Accepted', 'Declined', 'Completed', 'Cancelled') NOT NULL,
  changed_by_role VARCHAR(20) NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks VARCHAR(500) NULL,
  CONSTRAINT fk_session_audit_session FOREIGN KEY (session_id)
    REFERENCES TutoringSession (session_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;