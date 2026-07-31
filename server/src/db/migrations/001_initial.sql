-- 001_initial.sql — Creates the full schema for the Clinic Shift Scheduler.

-- Custom enum types for role, profession, and import actions.
CREATE TYPE user_role AS ENUM ('manager', 'staff');
CREATE TYPE profession AS ENUM ('doctor', 'nurse', 'receptionist');
CREATE TYPE import_action AS ENUM ('accepted', 'auto_corrected', 'merged', 'rejected');

-- Users table: stores both managers and staff in one table.
-- Managers have role='manager' and NULL profession.
-- Staff have role='staff' and a non-null profession.
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          user_role NOT NULL DEFAULT 'staff',
  profession    profession,
  staff_id      VARCHAR(50) UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_staff_has_profession CHECK (
    (role = 'staff' AND profession IS NOT NULL) OR
    (role = 'manager' AND profession IS NULL)
  )
);

-- Shifts table: each row is one schedulable shift with staffing requirements.
-- is_overnight is set when end_time < start_time (e.g. 22:00–06:00).
CREATE TABLE shifts (
  id                SERIAL PRIMARY KEY,
  original_csv_id   VARCHAR(50),
  date              DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  is_overnight      BOOLEAN NOT NULL DEFAULT FALSE,
  req_doctors       INTEGER NOT NULL DEFAULT 0 CHECK (req_doctors >= 0),
  req_nurses        INTEGER NOT NULL DEFAULT 0 CHECK (req_nurses >= 0),
  req_receptionists INTEGER NOT NULL DEFAULT 0 CHECK (req_receptionists >= 0),
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shift assignments: links a staff user to a shift they've claimed or been assigned to.
-- The unique constraint on (shift_id, user_id) is the DB-level safety net preventing
-- double-assignment, even if application logic has a bug.
CREATE TABLE shift_assignments (
  id         SERIAL PRIMARY KEY,
  shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_shift_user UNIQUE (shift_id, user_id)
);

-- Import reports: one row per CSV import operation, summarizing outcomes.
CREATE TABLE import_reports (
  id             SERIAL PRIMARY KEY,
  import_type    VARCHAR(20) NOT NULL,
  imported_by    INTEGER REFERENCES users(id),
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_rows     INTEGER NOT NULL,
  accepted       INTEGER NOT NULL,
  rejected       INTEGER NOT NULL,
  auto_corrected INTEGER NOT NULL,
  merged         INTEGER NOT NULL
);

-- Import report entries: one row per CSV row processed, with the original data,
-- action taken, and human-readable explanation.
CREATE TABLE import_report_entries (
  id              SERIAL PRIMARY KEY,
  report_id       INTEGER NOT NULL REFERENCES import_reports(id) ON DELETE CASCADE,
  row_number      INTEGER NOT NULL,
  original_data   JSONB NOT NULL,
  action          import_action NOT NULL,
  problems        TEXT[] NOT NULL DEFAULT '{}',
  details         TEXT,
  corrected_data  JSONB
);

-- Indexes for the two most common query patterns:
-- 1. Finding all shifts a user is assigned to (for overlap checks).
-- 2. Finding all shifts on a given date range (for the dashboard).
CREATE INDEX idx_assignments_user_id ON shift_assignments(user_id);
CREATE INDEX idx_shifts_date ON shifts(date);
CREATE INDEX idx_report_entries_report ON import_report_entries(report_id);

-- Migrations tracking table to avoid re-running migrations.
CREATE TABLE IF NOT EXISTS _migrations (
  name       VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
