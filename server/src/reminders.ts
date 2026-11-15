import nodemailer from 'nodemailer'
import { all, newId, nowIso, one, run } from './db.js'
import { config, isSmtpConfigured } from './config.js'
import { addDaysToDateString, inQuietHours, localDateString } from './time.js'
import { classifyMissedDoses } from './doses.js'
import { ensureDoseRows } from './medications.js'
import type { MemberRow, ProfileRow } from './permissions.js'

export interface ReminderRow {
  id: string
  event_key: string
  profile_id: string
  recipient_user_id: string | null
  recipient_email: string
  channel: string
  reminder_type: string
  subject: string
  body: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  attempt_count: number
  last_error: string | null
  next_attempt_at: string | null
  scheduled_for: string
  sent_at: string | null
  created_at: string
  updated_at: string
}

type Recipient = MemberRow & { email: string; display_name: string }

function reminderRecipients(profileId: string): Recipient[] {
  return all<Recipient>(
    `SELECT m.*, u.email, u.display_name
       FROM care_team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.profile_id = ? AND m.invite_status = 'active' AND m.revoked_at IS NULL
      ORDER BY m.created_at`,
    profileId,
  )
}

function recipientAllows(recipient: Recipient, type: string): boolean {
  if (type === 'upcoming_dose') return Number(recipient.notify_upcoming_doses) === 1
  if (type === 'missed_dose') return Number(recipient.notify_missed_doses) === 1
  if (type === 'appointment') return Number(recipient.notify_appointments) === 1
  return true
}

const TYPE_LABELS: Record<string, string> = {
  upcoming_dose: 'an upcoming medicine dose',
  missed_dose: 'a dose with no confirmation',
  appointment: 'an upcoming appointment',
  test: 'a test reminder',
}

function buildMessage(options: {
  type: string
  profile: ProfileRow
  recipient: Recipient
  when: string
}): { subject: string; body: string } {
  const { type, profile, recipient, when } = options
  const subject = `CareNest reminder: ${TYPE_LABELS[type] ?? 'a care reminder'}`
  const intro = `Hello ${recipient.display_name.split(' ')[0]},`
  let detail: string
  if (type === 'missed_dose') {
    detail = `A medicine dose scheduled ${when} has been marked as missed because no confirmation was recorded within the grace period. CareNest does not advise catch-up dosing. Please follow the instructions from the prescriber or pharmacist.`
  } else if (type === 'appointment') {
    detail = `An appointment is coming up ${when}.`
  } else if (type === 'test') {
    detail = `This is a test reminder to confirm that CareNest reminder delivery is working. No action is needed.`
  } else {
    detail = `A medicine dose is due ${when}.`
  }
  const body = [
    intro,
    '',
    detail,
    '',
    `Sign in to CareNest to see the details for ${profile.preferred_name}: ${config.appBaseUrl}`,
    '',
    'This is a scheduling reminder, not medical advice or emergency monitoring. Reminders can be delayed or fail.',
    'CareNest / fictional demo environment',
  ].join('\n')
  return { subject, body }
}

function queueReminder(options: {
  eventKey: string
  profile: ProfileRow
  recipient: Recipient
  type: string
  subject: string
  body: string
  scheduledFor: string
}): boolean {
  const result = run(
    `INSERT OR IGNORE INTO reminder_events
      (id, event_key, profile_id, recipient_user_id, recipient_email, channel, reminder_type,
       subject, body, status, attempt_count, scheduled_for, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'email', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    newId(),
    options.eventKey,
    options.profile.id,
    options.recipient.user_id,
    options.recipient.email,
    options.type,
    options.subject,
    options.body,
    options.scheduledFor,
    nowIso(),
    nowIso(),
  )
  return Number(result.changes ?? 0) > 0
}

export function queueUpcomingDoseReminders(now = new Date()): number {
  const profiles = all<ProfileRow>('SELECT * FROM care_profiles')
  let queued = 0
  for (const profile of profiles) {
    const today = localDateString(now, profile.timezone)
    ensureDoseRows(profile, today, addDaysToDateString(today, 1))
    const horizon = new Date(now.getTime() + profile.dose_reminder_lead_minutes * 60 * 1000)
    const due = all<{
      id: string
      name: string
      scheduled_for: string
      snoozed_until: string | null
    }>(
      `SELECT d.id, m.name, d.scheduled_for, d.snoozed_until
         FROM dose_events d JOIN medications m ON m.id = d.medication_id
        WHERE d.profile_id = ? AND d.status = 'pending'
          AND d.scheduled_for > ? AND d.scheduled_for <= ?`,
      profile.id,
      now.toISOString(),
      horizon.toISOString(),
    )
    if (due.length === 0) continue
    for (const dose of due) {
      if (dose.snoozed_until && new Date(dose.snoozed_until) > now) continue
      for (const recipient of reminderRecipients(profile.id)) {
        if (!recipientAllows(recipient, 'upcoming_dose')) continue
        if (inQuietHours(now, profile.timezone, recipient.quiet_hours_start, recipient.quiet_hours_end)) {
          continue
        }
        const when = new Date(dose.scheduled_for).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: profile.timezone,
        })
        const message = buildMessage({ type: 'upcoming_dose', profile, recipient, when })
        const created = queueReminder({
          eventKey: `dose-upcoming:${dose.id}:${recipient.user_id}`,
          profile,
          recipient,
          type: 'upcoming_dose',
          subject: message.subject,
          body: message.body,
          scheduledFor: dose.scheduled_for,
        })
        if (created) queued += 1
      }
    }
  }
  return queued
}

export function queueMissedDoseReminders(now = new Date()): number {
  const profiles = all<ProfileRow>('SELECT * FROM care_profiles')
  let queued = 0
  for (const profile of profiles) {
    const recent = all<{ id: string; name: string; scheduled_for: string }>(
      `SELECT d.id, m.name, d.scheduled_for
         FROM dose_events d JOIN medications m ON m.id = d.medication_id
        WHERE d.profile_id = ? AND d.status = 'missed' AND d.missed_at > ?`,
      profile.id,
      new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    )
    for (const dose of recent) {
      for (const recipient of reminderRecipients(profile.id)) {
        if (!recipientAllows(recipient, 'missed_dose')) continue
        if (inQuietHours(now, profile.timezone, recipient.quiet_hours_start, recipient.quiet_hours_end)) {
          continue
        }
        const when = new Date(dose.scheduled_for).toLocaleString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: profile.timezone,
        })
        const message = buildMessage({ type: 'missed_dose', profile, recipient, when })
        const created = queueReminder({
          eventKey: `dose-missed:${dose.id}:${recipient.user_id}`,
          profile,
          recipient,
          type: 'missed_dose',
          subject: message.subject,
          body: message.body,
          scheduledFor: dose.scheduled_for,
        })
        if (created) queued += 1
      }
    }
  }
  return queued
}

export function queueAppointmentReminders(now = new Date()): number {
  const profiles = all<ProfileRow>('SELECT * FROM care_profiles')
  let queued = 0
  for (const profile of profiles) {
    const appointments = all<{
      id: string
      title: string
      start_at: string
      reminder_lead_minutes: number
    }>(
      `SELECT id, title, start_at, reminder_lead_minutes FROM appointments
        WHERE profile_id = ? AND status = 'upcoming' AND start_at > ?`,
      profile.id,
      now.toISOString(),
    )
    for (const appointment of appointments) {
      const remindAt = new Date(
        new Date(appointment.start_at).getTime() - appointment.reminder_lead_minutes * 60 * 1000,
      )
      if (remindAt > now) continue
      for (const recipient of reminderRecipients(profile.id)) {
        if (!recipientAllows(recipient, 'appointment')) continue
        if (inQuietHours(now, profile.timezone, recipient.quiet_hours_start, recipient.quiet_hours_end)) {
          continue
        }
        const when = new Date(appointment.start_at).toLocaleString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: profile.timezone,
        })
        const message = buildMessage({ type: 'appointment', profile, recipient, when })
        const created = queueReminder({
          eventKey: `appointment:${appointment.id}:${appointment.start_at}:${recipient.user_id}`,
          profile,
          recipient,
          type: 'appointment',
          subject: message.subject,
          body: message.body,
          scheduledFor: appointment.start_at,
        })
        if (created) queued += 1
      }
    }
  }
  return queued
}

let transport: nodemailer.Transporter | null = null
function mailTransport() {
  if (!isSmtpConfigured()) return null
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  }
  return transport
}

const MAX_ATTEMPTS = 3

export function dispatchQueuedReminders(now = new Date(), limit = 50): { sent: number; failed: number } {
  const pending = all<ReminderRow>(
    `SELECT * FROM reminder_events
      WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at LIMIT ?`,
    now.toISOString(),
    limit,
  )
  let sent = 0
  let failed = 0
  for (const reminder of pending) {
    const attempts = reminder.attempt_count + 1
    try {
      const mailer = mailTransport()
      if (config.emailMode === 'test' || !mailer) {
        run(
          `INSERT INTO email_delivery_log (id, reminder_id, profile_id, to_email, subject, body, mode, ok, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'test', 1, NULL, ?)`,
          newId(),
          reminder.id,
          reminder.profile_id,
          reminder.recipient_email,
          reminder.subject,
          reminder.body,
          nowIso(),
        )
      } else {
        mailer.sendMail({
          from: config.smtp.from,
          to: reminder.recipient_email,
          subject: reminder.subject,
          text: reminder.body,
        })
        run(
          `INSERT INTO email_delivery_log (id, reminder_id, profile_id, to_email, subject, body, mode, ok, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'smtp', 1, NULL, ?)`,
          newId(),
          reminder.id,
          reminder.profile_id,
          reminder.recipient_email,
          reminder.subject,
          reminder.body,
          nowIso(),
        )
      }
      run(
        `UPDATE reminder_events SET status = 'sent', attempt_count = ?, sent_at = ?,
                last_error = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
        attempts,
        nowIso(),
        nowIso(),
        reminder.id,
      )
      sent += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown delivery error'
      const exhausted = attempts >= MAX_ATTEMPTS
      const retryAt = new Date(now.getTime() + attempts * 2 * 60 * 1000).toISOString()
      run(
        `UPDATE reminder_events SET status = ?, attempt_count = ?, last_error = ?,
                next_attempt_at = ?, updated_at = ? WHERE id = ?`,
        exhausted ? 'failed' : 'queued',
        attempts,
        message,
        exhausted ? null : retryAt,
        nowIso(),
        reminder.id,
      )
      failed += 1
    }
  }
  return { sent, failed }
}

export function runReminderTick(now = new Date()) {
  const missed = classifyMissedDoses(now)
  const upcoming = queueUpcomingDoseReminders(now)
  const missedQueued = queueMissedDoseReminders(now)
  const appointments = queueAppointmentReminders(now)
  const delivery = dispatchQueuedReminders(now)
  return { missed, upcoming, missedQueued, appointments, ...delivery }
}

let timer: NodeJS.Timeout | null = null
let ticking = false

export function startReminderScheduler() {
  if (timer || !config.remindersEnabled) return
  const tick = () => {
    if (ticking) return
    ticking = true
    try {
      const result = runReminderTick()
      if (result.missed || result.upcoming || result.missedQueued || result.appointments || result.sent) {
        console.log('[reminders]', result)
      }
    } catch (error) {
      console.error('[reminders] tick failed', error)
    } finally {
      ticking = false
    }
  }
  timer = setInterval(tick, config.reminderTickSeconds * 1000)
  timer.unref?.()
  setTimeout(tick, 1500).unref?.()
  console.log(
    `[reminders] scheduler started (every ${config.reminderTickSeconds}s, mode ${config.emailMode})`,
  )
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

export function createTestReminder(profile: ProfileRow, member: MemberRow) {
  const recipient = one<Recipient>(
    `SELECT m.*, u.email, u.display_name FROM care_team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.profile_id = ? AND m.user_id = ?`,
    profile.id,
    member.user_id,
  )
  if (!recipient) return null
  const message = buildMessage({
    type: 'test',
    profile,
    recipient,
    when: new Date().toISOString(),
  })
  const created = queueReminder({
    eventKey: `test:${newId()}`,
    profile,
    recipient,
    type: 'test',
    subject: message.subject,
    body: message.body,
    scheduledFor: new Date().toISOString(),
  })
  if (created) {
    dispatchQueuedReminders(new Date())
  }
  return one<ReminderRow>('SELECT * FROM reminder_events ORDER BY created_at DESC LIMIT 1')
}

export function listReminders(profileId: string, limit = 40) {
  return all<ReminderRow>(
    'SELECT * FROM reminder_events WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?',
    profileId,
    limit,
  )
}
