import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

export type SqlValue = string | number | null | Uint8Array

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en-GB',
  pin_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_profiles (
  id TEXT PRIMARY KEY,
  preferred_name TEXT NOT NULL,
  full_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  date_of_birth TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  share_medications INTEGER NOT NULL DEFAULT 1,
  share_appointments INTEGER NOT NULL DEFAULT 1,
  missed_tracking INTEGER NOT NULL DEFAULT 1,
  grace_minutes INTEGER NOT NULL DEFAULT 120,
  dose_reminder_lead_minutes INTEGER NOT NULL DEFAULT 15,
  appointment_reminder_lead_minutes INTEGER NOT NULL DEFAULT 1440,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_team_members (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  can_edit_medications INTEGER NOT NULL DEFAULT 0,
  can_edit_appointments INTEGER NOT NULL DEFAULT 0,
  can_record_doses INTEGER NOT NULL DEFAULT 0,
  can_manage_members INTEGER NOT NULL DEFAULT 0,
  invite_status TEXT NOT NULL DEFAULT 'pending',
  invite_token_hash TEXT,
  invite_expires_at TEXT,
  invited_by TEXT NOT NULL REFERENCES users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  last_active_at TEXT,
  notify_upcoming_doses INTEGER NOT NULL DEFAULT 1,
  notify_missed_doses INTEGER NOT NULL DEFAULT 1,
  notify_appointments INTEGER NOT NULL DEFAULT 1,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_members_profile ON care_team_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON care_team_members(user_id);

CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  strength TEXT,
  form TEXT,
  prescribed_instructions TEXT NOT NULL,
  source_note TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_medications_profile ON medications(profile_id);

CREATE TABLE IF NOT EXISTS medication_schedules (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  local_times TEXT NOT NULL DEFAULT '[]',
  recurrence TEXT NOT NULL DEFAULT 'daily',
  weekdays TEXT NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL,
  active_from TEXT NOT NULL,
  active_to TEXT,
  paused_from TEXT,
  paused_until TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_medication ON medication_schedules(medication_id);

CREATE TABLE IF NOT EXISTS dose_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  recorded_at TEXT,
  recorded_by TEXT REFERENCES users(id),
  note TEXT,
  snoozed_until TEXT,
  missed_at TEXT,
  correction_of TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_doses_profile_date ON dose_events(profile_id, local_date);
CREATE INDEX IF NOT EXISTS idx_doses_status ON dose_events(profile_id, status);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  location TEXT,
  video_link TEXT,
  notes TEXT,
  start_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'upcoming',
  reminder_lead_minutes INTEGER NOT NULL DEFAULT 1440,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_profile ON appointments(profile_id, start_at);

CREATE TABLE IF NOT EXISTS reminder_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  reminder_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_profile ON reminder_events(profile_id, status);

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id TEXT PRIMARY KEY,
  reminder_id TEXT,
  profile_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  mode TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_profile ON audit_events(profile_id, created_at);
`

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const database = new DatabaseSync(file)
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA foreign_keys = ON;')
  database.exec('PRAGMA busy_timeout = 5000;')
  database.exec(SCHEMA)
  return database
}

export const db = openDatabase(
  process.env.DATABASE_FILE === ':memory:' ? ':memory:' : config.databaseFile,
)

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function one<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function run(sql: string, ...params: SqlValue[]) {
  return db.prepare(sql).run(...params)
}

export function transaction<T>(work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const nowIso = () => new Date().toISOString()

export function newId(): string {
  return crypto.randomUUID()
}

export function toBool(value: number | null | undefined): boolean {
  return Number(value ?? 0) === 1
}
