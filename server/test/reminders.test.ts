import './helpers.js'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'

const NOW = new Date('2026-05-01T10:00:00.000Z')

const TABLES = [
  'email_delivery_log',
  'reminder_events',
  'audit_events',
  'dose_events',
  'medication_schedules',
  'medications',
  'appointments',
  'care_team_members',
  'care_profiles',
  'sessions',
  'users',
]

let sequence = 0

beforeEach(async () => {
  const { run } = await import('../src/db.js')
  for (const table of TABLES) run(`DELETE FROM ${table}`)
})

interface FixtureOptions {
  notifyUpcoming?: boolean
  notifyMissed?: boolean
  notifyAppointments?: boolean
  quietHours?: { start: string; end: string } | null
  doseReminderLeadMinutes?: number
  graceMinutes?: number
  missedTracking?: boolean
  timezone?: string
}

async function createFixture(options: FixtureOptions = {}) {
  const { run } = await import('../src/db.js')
  sequence += 1
  const suffix = `${Date.now()}-${sequence}`
  const userId = `rem-user-${suffix}`
  const profileId = `rem-profile-${suffix}`
  const memberId = `rem-member-${suffix}`
  const medicationId = `rem-med-${suffix}`
  const scheduleId = `rem-schedule-${suffix}`
  const timezone = options.timezone ?? 'UTC'
  const now = new Date().toISOString()

  run(
    `INSERT INTO users (id, email, display_name, password_hash, locale, pin_hash, created_at)
     VALUES (?, ?, 'Reminder Tester', 'not-a-real-hash', 'en-GB', NULL, ?)`,
    userId,
    `${userId}@carenest.test`,
    now,
  )
  run(
    `INSERT INTO care_profiles
      (id, preferred_name, full_name, timezone, created_by, share_medications, share_appointments,
       missed_tracking, grace_minutes, dose_reminder_lead_minutes, appointment_reminder_lead_minutes, created_at)
     VALUES (?, 'Tester', 'Reminder Tester', ?, ?, 1, 1, ?, ?, ?, 1440, ?)`,
    profileId,
    timezone,
    userId,
    options.missedTracking === false ? 0 : 1,
    options.graceMinutes ?? 120,
    options.doseReminderLeadMinutes ?? 15,
    now,
  )
  run(
    `INSERT INTO care_team_members
      (id, profile_id, user_id, invited_email, role, can_edit_medications, can_edit_appointments,
       can_record_doses, can_manage_members, invite_status, invited_by,
       notify_upcoming_doses, notify_missed_doses, notify_appointments,
       quiet_hours_start, quiet_hours_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'caregiver', 1, 1, 1, 0, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    memberId,
    profileId,
    userId,
    `${userId}@carenest.test`,
    userId,
    options.notifyUpcoming === false ? 0 : 1,
    options.notifyMissed === false ? 0 : 1,
    options.notifyAppointments === false ? 0 : 1,
    options.quietHours?.start ?? null,
    options.quietHours?.end ?? null,
    now,
    now,
  )
  run(
    `INSERT INTO medications
      (id, profile_id, name, strength, form, prescribed_instructions, source_note, start_date, end_date,
       status, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, 'Test Medicine', '10 mg', 'Tablet', 'Take ONE tablet as prescribed.', NULL,
             '2024-01-01', NULL, 'active', ?, ?, ?, ?)`,
    medicationId,
    profileId,
    userId,
    userId,
    now,
    now,
  )
  run(
    `INSERT INTO medication_schedules
      (id, medication_id, local_times, recurrence, weekdays, timezone, active_from, active_to,
       paused_from, paused_until, created_at)
     VALUES (?, ?, '[]', 'as_needed', '[]', ?, '2024-01-01', NULL, NULL, NULL, ?)`,
    scheduleId,
    medicationId,
    timezone,
    now,
  )

  async function addDose(scheduledFor: string, status = 'pending') {
    const { run: insert } = await import('../src/db.js')
    const doseId = `rem-dose-${suffix}-${scheduledFor}`
    insert(
      `INSERT INTO dose_events
        (id, profile_id, medication_id, schedule_id, scheduled_for, local_date, status,
         recorded_at, recorded_by, note, snoozed_until, missed_at, correction_of, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      doseId,
      profileId,
      medicationId,
      scheduleId,
      scheduledFor,
      scheduledFor.slice(0, 10),
      status,
      now,
      now,
    )
    return doseId
  }

  async function addAppointment(startAt: string, reminderLeadMinutes = 1440) {
    const { run: insert } = await import('../src/db.js')
    const appointmentId = `rem-appt-${suffix}-${startAt}`
    insert(
      `INSERT INTO appointments
        (id, profile_id, title, provider, location, video_link, notes, start_at, timezone,
         duration_minutes, status, reminder_lead_minutes, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 'Review', 'Fictional Clinic', NULL, NULL, NULL, ?, ?, 30, 'upcoming', ?, ?, ?, ?, ?)`,
      appointmentId,
      profileId,
      startAt,
      timezone,
      reminderLeadMinutes,
      userId,
      userId,
      now,
      now,
    )
    return appointmentId
  }

  return { userId, profileId, memberId, medicationId, scheduleId, addDose, addAppointment }
}

test('upcoming dose reminders are queued once per recipient and dose', async () => {
  const { all, one } = await import('../src/db.js')
  const { queueUpcomingDoseReminders, dispatchQueuedReminders } = await import('../src/reminders.js')
  const fixture = await createFixture({ doseReminderLeadMinutes: 15 })
  await fixture.addDose('2026-05-01T10:10:00.000Z')

  assert.equal(queueUpcomingDoseReminders(NOW), 1)
  assert.equal(queueUpcomingDoseReminders(NOW), 0, 're-running the scheduler must not duplicate reminders')

  const queued = one<{ event_key: string; status: string; reminder_type: string }>(
    'SELECT event_key, status, reminder_type FROM reminder_events WHERE profile_id = ?',
    fixture.profileId,
  )
  assert.ok(queued)
  assert.equal(queued.status, 'queued')
  assert.equal(queued.reminder_type, 'upcoming_dose')
  assert.match(queued.event_key, /^dose-upcoming:/)

  const firstDispatch = dispatchQueuedReminders(NOW)
  assert.deepEqual(firstDispatch, { sent: 1, failed: 0 })
  const sent = one<{ status: string; attempt_count: number; sent_at: string }>(
    'SELECT status, attempt_count, sent_at FROM reminder_events WHERE profile_id = ?',
    fixture.profileId,
  )
  assert.equal(sent?.status, 'sent')
  assert.equal(sent?.attempt_count, 1)
  assert.ok(sent?.sent_at)

  const log = all<{ mode: string; ok: number; to_email: string }>(
    'SELECT mode, ok, to_email FROM email_delivery_log WHERE profile_id = ?',
    fixture.profileId,
  )
  assert.equal(log.length, 1)
  assert.equal(log[0].mode, 'test', 'test mode must log instead of sending real email')
  assert.equal(log[0].ok, 1)

  assert.deepEqual(dispatchQueuedReminders(NOW), { sent: 0, failed: 0 })
})

test('reminders respect quiet hours and per-member notification choices', async () => {
  const { queueUpcomingDoseReminders } = await import('../src/reminders.js')

  const quiet = await createFixture({ quietHours: { start: '09:00', end: '17:00' } })
  await quiet.addDose('2026-05-01T10:10:00.000Z')
  assert.equal(queueUpcomingDoseReminders(NOW), 0)

  const optedOut = await createFixture({ notifyUpcoming: false })
  await optedOut.addDose('2026-05-01T10:10:00.000Z')
  assert.equal(queueUpcomingDoseReminders(NOW), 0)

  const outsideQuiet = await createFixture({ quietHours: { start: '21:00', end: '07:00' } })
  await outsideQuiet.addDose('2026-05-01T10:10:00.000Z')
  assert.equal(queueUpcomingDoseReminders(NOW), 1)
})

test('missed classification waits for the grace period and never labels old blank doses', async () => {
  const { one } = await import('../src/db.js')
  const { classifyMissedDoses } = await import('../src/doses.js')
  const { queueMissedDoseReminders } = await import('../src/reminders.js')
  const fixture = await createFixture({ graceMinutes: 120 })

  const overdue = await fixture.addDose('2026-05-01T05:00:00.000Z')
  const withinGrace = await fixture.addDose('2026-05-01T09:00:00.000Z')
  const future = await fixture.addDose('2026-05-01T11:00:00.000Z')
  const ancient = await fixture.addDose('2026-04-01T09:00:00.000Z')

  assert.equal(classifyMissedDoses(NOW), 1)
  const statusOf = (id: string) =>
    one<{ status: string; missed_at: string | null }>(
      'SELECT status, missed_at FROM dose_events WHERE id = ?',
      id,
    )
  assert.equal(statusOf(overdue)?.status, 'missed')
  assert.ok(statusOf(overdue)?.missed_at)
  assert.equal(statusOf(withinGrace)?.status, 'pending')
  assert.equal(statusOf(future)?.status, 'pending')
  assert.equal(statusOf(ancient)?.status, 'pending', 'doses older than the window stay unlabelled')
  assert.equal(classifyMissedDoses(NOW), 0, 'classification is idempotent')

  assert.equal(queueMissedDoseReminders(NOW), 1)
  const reminder = one<{ reminder_type: string; body: string }>(
    'SELECT reminder_type, body FROM reminder_events WHERE profile_id = ?',
    fixture.profileId,
  )
  assert.equal(reminder?.reminder_type, 'missed_dose')
  assert.match(reminder?.body ?? '', /does not advise catch-up dosing/i)
})

test('appointment reminders wait for their lead time and are queued once', async () => {
  const { queueAppointmentReminders } = await import('../src/reminders.js')
  await createFixture()

  const due = await createFixture()
  await due.addAppointment('2026-05-01T11:00:00.000Z', 90)
  assert.equal(queueAppointmentReminders(NOW), 1)
  assert.equal(queueAppointmentReminders(NOW), 0)

  const notYet = await createFixture()
  await notYet.addAppointment('2026-05-01T13:00:00.000Z', 60)
  assert.equal(queueAppointmentReminders(NOW), 0)
})

test('the scheduler tick combines missed, upcoming, appointment and delivery steps', async () => {
  const { one } = await import('../src/db.js')
  const { runReminderTick } = await import('../src/reminders.js')
  const fixture = await createFixture({ graceMinutes: 60 })
  await fixture.addDose('2026-05-01T08:00:00.000Z')
  await fixture.addDose('2026-05-01T10:10:00.000Z')
  await fixture.addAppointment('2026-05-01T11:00:00.000Z', 90)

  const first = runReminderTick(NOW)
  assert.equal(first.missed, 1)
  assert.equal(first.upcoming, 1)
  assert.equal(first.missedQueued, 1)
  assert.equal(first.appointments, 1)
  assert.equal(first.sent, 3)
  assert.equal(first.failed, 0)

  const second = runReminderTick(NOW)
  assert.equal(second.missed, 0)
  assert.equal(second.upcoming, 0)
  assert.equal(second.missedQueued, 0)
  assert.equal(second.appointments, 0)
  assert.equal(second.sent, 0)

  const rows = one<{ count: number }>(
    'SELECT COUNT(*) AS count FROM reminder_events WHERE profile_id = ?',
    fixture.profileId,
  )
  assert.equal(rows?.count, 3)
})
