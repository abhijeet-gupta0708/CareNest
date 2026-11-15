import { all, newId, nowIso, one, run, transaction } from './db.js'
import { badRequest, notFound } from './errors.js'
import { occurrencesBetween, startOfLocalDayUtc, addDaysToDateString } from './time.js'
import type { ProfileRow } from './permissions.js'

export interface MedicationRow {
  id: string
  profile_id: string
  name: string
  strength: string | null
  form: string | null
  prescribed_instructions: string
  source_note: string | null
  start_date: string
  end_date: string | null
  status: 'active' | 'paused' | 'completed'
  created_by: string
  updated_by: string
  created_by_name?: string | null
  updated_by_name?: string | null
  created_at: string
  updated_at: string
}

export interface ScheduleRow {
  id: string
  medication_id: string
  local_times: string
  recurrence: 'daily' | 'weekly' | 'as_needed'
  weekdays: string
  timezone: string
  active_from: string
  active_to: string | null
  paused_from: string | null
  paused_until: string | null
  created_at: string
}

export interface ScheduleInput {
  localTimes: string[]
  recurrence: 'daily' | 'weekly' | 'as_needed'
  weekdays: number[]
  timezone?: string
  activeFrom?: string
  activeTo?: string | null
  pausedFrom?: string | null
  pausedUntil?: string | null
}

export function serializeSchedule(row: ScheduleRow) {
  return {
    id: row.id,
    localTimes: JSON.parse(row.local_times) as string[],
    recurrence: row.recurrence,
    weekdays: JSON.parse(row.weekdays) as number[],
    timezone: row.timezone,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    pausedFrom: row.paused_from,
    pausedUntil: row.paused_until,
  }
}

export function serializeMedication(row: MedicationRow, schedule?: ScheduleRow | null) {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    strength: row.strength,
    form: row.form,
    prescribedInstructions: row.prescribed_instructions,
    sourceNote: row.source_note,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdByName: row.created_by_name ?? null,
    updatedByName: row.updated_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schedule: schedule ? serializeSchedule(schedule) : null,
  }
}

export function getScheduleForMedication(medicationId: string): ScheduleRow | undefined {
  return one<ScheduleRow>(
    'SELECT * FROM medication_schedules WHERE medication_id = ? ORDER BY created_at LIMIT 1',
    medicationId,
  )
}

export function listMedications(profileId: string) {
  const rows = all<MedicationRow>(
    `SELECT m.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name
       FROM medications m
       LEFT JOIN users cu ON cu.id = m.created_by
       LEFT JOIN users uu ON uu.id = m.updated_by
      WHERE m.profile_id = ?
      ORDER BY m.status = 'active' DESC, m.name COLLATE NOCASE`,
    profileId,
  )
  return rows.map((row) => serializeMedication(row, getScheduleForMedication(row.id)))
}

export function getMedication(profileId: string, medicationId: string) {
  const row = one<MedicationRow>(
    `SELECT m.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name
       FROM medications m
       LEFT JOIN users cu ON cu.id = m.created_by
       LEFT JOIN users uu ON uu.id = m.updated_by
      WHERE m.id = ? AND m.profile_id = ?`,
    medicationId,
    profileId,
  )
  if (!row) throw notFound('That medication could not be found.')
  return { row, schedule: getScheduleForMedication(row.id) ?? null }
}

export function validateScheduleInput(input: ScheduleInput) {
  if (input.recurrence === 'as_needed') {
    if (input.localTimes.length > 0) {
      throw badRequest('As-needed medicines do not need scheduled times.')
    }
    return
  }
  if (input.localTimes.length === 0) {
    throw badRequest('Add at least one time of day for this schedule.')
  }
  for (const time of input.localTimes) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw badRequest('Times must use 24-hour HH:MM format.')
    }
  }
  if (input.recurrence === 'weekly' && input.weekdays.length === 0) {
    throw badRequest('Choose at least one day of the week.')
  }
  for (const day of input.weekdays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw badRequest('Days of the week must be between Sunday (0) and Saturday (6).')
    }
  }
  if (input.activeTo && input.activeTo < (input.activeFrom ?? '')) {
    throw badRequest('The end date must be on or after the start date.')
  }
}

function scheduleFromRow(row: ScheduleRow, profile: ProfileRow) {
  return {
    localTimes: JSON.parse(row.local_times) as string[],
    recurrence: row.recurrence,
    weekdays: JSON.parse(row.weekdays) as number[],
    timezone: row.timezone,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    pausedFrom: row.paused_from,
    pausedUntil: row.paused_until,
    profileTimezone: profile.timezone,
  }
}

/**
 * Materialise concrete dose rows so a dose can be confirmed, missed or reported
 * on. Unique (schedule_id, scheduled_for) makes this safe to run repeatedly.
 */
export function ensureDoseRows(profile: ProfileRow, fromLocalDate: string, toLocalDate: string): number {
  const medications = all<MedicationRow>(
    "SELECT * FROM medications WHERE profile_id = ? AND status = 'active'",
    profile.id,
  )
  let inserted = 0
  for (const medication of medications) {
    const schedule = getScheduleForMedication(medication.id)
    if (!schedule) continue
    if (schedule.recurrence === 'as_needed') continue
    const rangeStart = startOfLocalDayUtc(fromLocalDate, profile.timezone)
    const rangeEnd = startOfLocalDayUtc(addDaysToDateString(toLocalDate, 1), profile.timezone)
    const occurrences = occurrencesBetween(scheduleFromRow(schedule, profile), rangeStart, rangeEnd)
    for (const instant of occurrences) {
      const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: profile.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(instant)
      const result = run(
        `INSERT OR IGNORE INTO dose_events
          (id, profile_id, medication_id, schedule_id, scheduled_for, local_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        newId(),
        profile.id,
        medication.id,
        schedule.id,
        instant.toISOString(),
        localDate,
        nowIso(),
        nowIso(),
      )
      inserted += Number(result.changes ?? 0)
    }
  }
  return inserted
}

export function clearFuturePendingDoses(medicationId: string) {
  run(
    `DELETE FROM dose_events
      WHERE medication_id = ? AND status = 'pending' AND scheduled_for > ?`,
    medicationId,
    nowIso(),
  )
}
