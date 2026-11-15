import { all, nowIso, one, run } from './db.js'
import { conflict, notFound } from './errors.js'
import { recordAudit } from './audit.js'
import { ensureDoseRows } from './medications.js'
import type { MemberRow, ProfileRow } from './permissions.js'
import { addDaysToDateString, localDateString } from './time.js'

export type DoseStatus = 'upcoming' | 'due' | 'snoozed' | 'taken' | 'skipped' | 'missed' | 'not_recorded'

export interface DoseRow {
  id: string
  profile_id: string
  medication_id: string
  schedule_id: string
  scheduled_for: string
  local_date: string
  status: 'pending' | 'taken' | 'skipped' | 'missed'
  recorded_at: string | null
  recorded_by: string | null
  note: string | null
  snoozed_until: string | null
  missed_at: string | null
  correction_of: string | null
  created_at: string
  updated_at: string
}

interface DoseRowJoined extends DoseRow {
  medication_name: string
  strength: string | null
  form: string | null
  prescribed_instructions: string
  medication_status: string
  recorded_by_name: string | null
}

export function effectiveStatus(dose: DoseRow, profile: ProfileRow, now = new Date()): DoseStatus {
  if (dose.status === 'taken' || dose.status === 'skipped') return dose.status
  if (dose.status === 'missed' || dose.missed_at) return 'missed'
  const scheduled = new Date(dose.scheduled_for)
  if (scheduled.getTime() > now.getTime()) return 'upcoming'
  if (dose.snoozed_until && new Date(dose.snoozed_until).getTime() > now.getTime()) return 'snoozed'
  const deadlineSource = dose.snoozed_until ? new Date(dose.snoozed_until) : scheduled
  const deadline = deadlineSource.getTime() + profile.grace_minutes * 60 * 1000
  if (now.getTime() <= deadline) return 'due'
  return 'not_recorded'
}

export function serializeDose(dose: DoseRowJoined, profile: ProfileRow, now = new Date()) {
  return {
    id: dose.id,
    medicationId: dose.medication_id,
    medicationName: dose.medication_name,
    strength: dose.strength,
    form: dose.form,
    prescribedInstructions: dose.prescribed_instructions,
    scheduledFor: dose.scheduled_for,
    localDate: dose.local_date,
    status: effectiveStatus(dose, profile, now),
    storedStatus: dose.status,
    recordedAt: dose.recorded_at,
    recordedBy: dose.recorded_by,
    recordedByName: dose.recorded_by_name,
    note: dose.note,
    snoozedUntil: dose.snoozed_until,
    missedAt: dose.missed_at,
    correctionOf: dose.correction_of,
    graceMinutes: profile.grace_minutes,
  }
}

const DOSE_SELECT = `
  SELECT d.*, m.name AS medication_name, m.strength, m.form,
         m.prescribed_instructions, m.status AS medication_status,
         u.display_name AS recorded_by_name
    FROM dose_events d
    JOIN medications m ON m.id = d.medication_id
    LEFT JOIN users u ON u.id = d.recorded_by
`

export function listDoses(
  profile: ProfileRow,
  fromLocalDate: string,
  toLocalDate: string,
  options: { materialise?: boolean } = {},
) {
  if (options.materialise !== false) ensureDoseRows(profile, fromLocalDate, toLocalDate)
  const now = new Date()
  const rows = all<DoseRowJoined>(
    `${DOSE_SELECT} WHERE d.profile_id = ? AND d.local_date BETWEEN ? AND ?
      ORDER BY d.scheduled_for ASC`,
    profile.id,
    fromLocalDate,
    toLocalDate,
  )
  return rows.map((row) => serializeDose(row, profile, now))
}

export function getDoseJoined(doseId: string, profileId: string): DoseRowJoined | undefined {
  return one<DoseRowJoined>(`${DOSE_SELECT} WHERE d.id = ? AND d.profile_id = ?`, doseId, profileId)
}

export type DoseAction = 'taken' | 'skipped' | 'snooze'

export function recordDose(options: {
  profile: ProfileRow
  member: MemberRow
  actorLabel: string
  doseId: string
  action: DoseAction
  note?: string | null
  snoozeMinutes?: number
}) {
  const { profile, member, actorLabel, doseId, action } = options
  const dose = getDoseJoined(doseId, profile.id)
  if (!dose) throw notFound('That dose could not be found.')
  const current = effectiveStatus(dose, profile)
  const timestamp = nowIso()

  if (current === 'taken' || current === 'skipped') {
    if (current === action) {
      return { dose: serializeDose(dose, profile), alreadyApplied: true }
    }
    throw conflict(
      `This dose is already recorded as ${current === 'taken' ? 'taken' : 'skipped'}. Use “Correct” to change a recorded dose.`,
    )
  }

  if (action === 'snooze') {
    const minutes = Math.min(Math.max(options.snoozeMinutes ?? 30, 5), 180)
    if (current === 'missed') {
      throw conflict('A missed dose cannot be snoozed. Record the outcome or correct the record.')
    }
    run(
      'UPDATE dose_events SET snoozed_until = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?',
      new Date(Date.now() + minutes * 60 * 1000).toISOString(),
      options.note ?? null,
      timestamp,
      doseId,
    )
    recordAudit({
      profileId: profile.id,
      actorId: member.user_id,
      actorLabel,
      action: 'dose.snoozed',
      entity: 'dose_event',
      entityId: doseId,
      summary: `Snoozed the ${dose.medication_name} dose scheduled for ${dose.scheduled_for} for ${minutes} minutes.`,
    })
    const updated = getDoseJoined(doseId, profile.id)
    return { dose: serializeDose(updated ?? dose, profile), alreadyApplied: false }
  }

  run(
    `UPDATE dose_events
        SET status = ?, recorded_at = ?, recorded_by = ?, note = COALESCE(?, note),
            snoozed_until = NULL, updated_at = ?
      WHERE id = ?`,
    action,
    timestamp,
    member.user_id,
    options.note ?? null,
    timestamp,
    doseId,
  )
  recordAudit({
    profileId: profile.id,
    actorId: member.user_id,
    actorLabel,
    action: `dose.${action}`,
    entity: 'dose_event',
    entityId: doseId,
    summary: `${action === 'taken' ? 'Confirmed as taken' : 'Marked as skipped'}: ${dose.medication_name}, scheduled ${dose.scheduled_for}.`,
  })
  const updated = getDoseJoined(doseId, profile.id)
  return { dose: serializeDose(updated ?? dose, profile), alreadyApplied: false }
}

export function correctDose(options: {
  profile: ProfileRow
  member: MemberRow
  actorLabel: string
  doseId: string
  status: 'taken' | 'skipped'
  reason: string
}) {
  const { profile, member, actorLabel, doseId, status, reason } = options
  const dose = getDoseJoined(doseId, profile.id)
  if (!dose) throw notFound('That dose could not be found.')
  const previous = effectiveStatus(dose, profile)
  if (previous === status) {
    return { dose: serializeDose(dose, profile), changed: false }
  }
  const timestamp = nowIso()
  run(
    `UPDATE dose_events
        SET status = ?, recorded_at = ?, recorded_by = ?, correction_of = ?, updated_at = ?
      WHERE id = ?`,
    status,
    timestamp,
    member.user_id,
    dose.status === 'pending' ? previous : dose.status,
    timestamp,
    doseId,
  )
  recordAudit({
    profileId: profile.id,
    actorId: member.user_id,
    actorLabel,
    action: 'dose.corrected',
    entity: 'dose_event',
    entityId: doseId,
    summary: `Corrected ${dose.medication_name} dose from ${previous} to ${status}. Reason: ${reason}`,
  })
  const updated = getDoseJoined(doseId, profile.id)
  return { dose: serializeDose(updated ?? dose, profile), changed: true }
}

/**
 * Assign "missed" only after the configured grace period, and only for recent
 * doses. Older doses with no confirmation stay "not recorded" rather than being
 * retroactively labelled.
 */
export function classifyMissedDoses(now = new Date()): number {
  const profiles = all<ProfileRow>('SELECT * FROM care_profiles')
  let classified = 0
  for (const profile of profiles) {
    if (!profile.missed_tracking) continue
    const candidates = all<DoseRow>(
      `SELECT * FROM dose_events
        WHERE profile_id = ? AND status = 'pending' AND missed_at IS NULL AND scheduled_for > ?
        ORDER BY scheduled_for LIMIT 500`,
      profile.id,
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    for (const dose of candidates) {
      const deadlineSource = dose.snoozed_until ?? dose.scheduled_for
      const deadline = new Date(deadlineSource).getTime() + profile.grace_minutes * 60 * 1000
      if (now.getTime() <= deadline) continue
      run(
        "UPDATE dose_events SET status = 'missed', missed_at = ?, updated_at = ? WHERE id = ?",
        now.toISOString(),
        now.toISOString(),
        dose.id,
      )
      const medication = one<{ name: string }>(
        'SELECT name FROM medications WHERE id = ?',
        dose.medication_id,
      )
      recordAudit({
        profileId: profile.id,
        actorId: null,
        actorLabel: 'CareNest',
        action: 'dose.missed',
        entity: 'dose_event',
        entityId: dose.id,
        summary: `No confirmation recorded within the ${profile.grace_minutes}-minute grace period for ${medication?.name ?? 'a medicine'}. Marked as missed.`,
      })
      classified += 1
    }
  }
  return classified
}

export function dailyCounts(profile: ProfileRow, localDate: string) {
  const doses = listDoses(profile, localDate, localDate, { materialise: false })
  const counts: Record<DoseStatus, number> = {
    upcoming: 0,
    due: 0,
    snoozed: 0,
    taken: 0,
    skipped: 0,
    missed: 0,
    not_recorded: 0,
  }
  for (const dose of doses) counts[dose.status] += 1
  return { doses, counts }
}

export function upcomingDoses(profile: ProfileRow, days = 7) {
  const today = localDateString(new Date(), profile.timezone)
  ensureDoseRows(profile, today, addDaysToDateString(today, days))
  const now = new Date()
  const rows = all<DoseRowJoined>(
    `${DOSE_SELECT} WHERE d.profile_id = ? AND d.status = 'pending' AND d.scheduled_for >= ?
      ORDER BY d.scheduled_for ASC LIMIT 50`,
    profile.id,
    now.toISOString(),
  )
  return rows.map((row) => serializeDose(row, profile, now))
}
