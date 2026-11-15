import { param } from '../http.js'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { all, newId, nowIso, one, run, transaction } from '../db.js'
import { recordAudit } from '../audit.js'
import { badRequest, forbidden, notFound, unauthorized } from '../errors.js'
import type { UserRow } from '../auth.js'
import { getProfile, requireProfileAccess, type MemberRow, type ProfileRow } from '../permissions.js'
import { parse } from '../validation.js'
import {
  clearFuturePendingDoses,
  ensureDoseRows,
  getMedication,
  getScheduleForMedication,
  listMedications,
  serializeMedication,
  validateScheduleInput,
  type MedicationRow,
} from '../medications.js'
import { addDaysToDateString, isValidDateString, localDateString } from '../time.js'

export const medicationsRouter = Router()

function currentUser(res: Response): UserRow {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  return user
}

export function assertShare(
  profile: ProfileRow,
  member: MemberRow,
  kind: 'medications' | 'appointments',
) {
  if (member.role !== 'family') return
  const allowed = kind === 'medications' ? profile.share_medications : profile.share_appointments
  if (!allowed) {
    throw forbidden(
      `The older adult has not shared ${kind} with family viewers. Ask them to change sharing settings if this is needed.`,
    )
  }
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

const scheduleSchema = z.object({
  localTimes: z.array(z.string().regex(timePattern, 'Use 24-hour times such as 08:00.')).max(6).default([]),
  recurrence: z.enum(['daily', 'weekly', 'as_needed']),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  activeTo: z.string().nullable().optional(),
  pausedFrom: z.string().nullable().optional(),
  pausedUntil: z.string().nullable().optional(),
})

const medicationSchema = z.object({
  name: z.string().trim().min(1, 'Enter the medicine name.').max(120),
  strength: z.string().trim().max(80).nullable().optional(),
  form: z.string().trim().max(40).nullable().optional(),
  prescribedInstructions: z
    .string()
    .trim()
    .min(5, 'Copy the prescribed instructions exactly as they were supplied.')
    .max(2000),
  sourceNote: z.string().trim().max(500).nullable().optional(),
  startDate: z.string().refine(isValidDateString, 'Choose a valid start date.'),
  endDate: z.string().refine(isValidDateString, 'Choose a valid end date.').nullable().optional(),
  status: z.enum(['active', 'paused', 'completed']).default('active'),
  schedule: scheduleSchema,
  verified: z
    .boolean()
    .refine((value) => value === true, 'Confirm that these details match the prescription or clinician instruction.'),
  changeNote: z.string().trim().max(300).optional(),
})

medicationsRouter.get('/:profileId/medications', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'medications')
  res.json({ medications: listMedications(profile.id) })
})

medicationsRouter.get('/:profileId/medications/:medicationId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'medications')
  const { row, schedule } = getMedication(profile.id, param(req, 'medicationId'))
  const history = all<{
    id: string
    actor_label: string
    action: string
    summary: string
    created_at: string
  }>(
    `SELECT id, actor_label, action, summary, created_at FROM audit_events
      WHERE profile_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 30`,
    profile.id,
    row.id,
  )
  res.json({
    medication: serializeMedication(row, schedule),
    history: history.map((event) => ({
      id: event.id,
      actorLabel: event.actor_label,
      action: event.action,
      summary: event.summary,
      createdAt: event.created_at,
    })),
  })
})

medicationsRouter.post('/:profileId/medications', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'), 'editMedications')
  const input = parse(medicationSchema, req.body)
  validateScheduleInput({
    localTimes: input.schedule.localTimes,
    recurrence: input.schedule.recurrence,
    weekdays: input.schedule.weekdays,
    activeTo: input.endDate ?? null,
  })
  if (!input.verified) throw badRequest('Confirm the details against the prescription before saving.')
  const now = nowIso()
  const medicationId = newId()
  const scheduleId = newId()
  transaction(() => {
    run(
      `INSERT INTO medications
        (id, profile_id, name, strength, form, prescribed_instructions, source_note, start_date, end_date,
         status, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      medicationId,
      profile.id,
      input.name,
      input.strength ?? null,
      input.form ?? null,
      input.prescribedInstructions,
      input.sourceNote ?? null,
      input.startDate,
      input.endDate ?? null,
      input.status,
      user.id,
      user.id,
      now,
      now,
    )
    run(
      `INSERT INTO medication_schedules
        (id, medication_id, local_times, recurrence, weekdays, timezone, active_from, active_to,
         paused_from, paused_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scheduleId,
      medicationId,
      JSON.stringify([...new Set(input.schedule.localTimes)].sort()),
      input.schedule.recurrence,
      JSON.stringify([...new Set(input.schedule.weekdays)].sort()),
      profile.timezone,
      input.startDate,
      input.endDate ?? null,
      input.schedule.pausedFrom ?? null,
      input.schedule.pausedUntil ?? null,
      now,
    )
    recordAudit({
      profileId: profile.id,
      actorId: user.id,
      actorLabel: user.display_name,
      action: 'medication.created',
      entity: 'medication',
      entityId: medicationId,
      summary: `Added ${input.name}${input.strength ? ` ${input.strength}` : ''} from supplied instructions.`,
    })
  })
  const created = getMedication(profile.id, medicationId)
  if (input.status === 'active') {
    const today = localDateString(new Date(), profile.timezone)
    ensureDoseRows(profile, today, addDaysToDateString(today, 2))
  }
  void member
  res.status(201).json({ medication: serializeMedication(created.row, created.schedule) })
})

medicationsRouter.patch('/:profileId/medications/:medicationId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'editMedications')
  const { row, schedule } = getMedication(profile.id, param(req, 'medicationId'))
  const input = parse(medicationSchema, req.body)
  validateScheduleInput({
    localTimes: input.schedule.localTimes,
    recurrence: input.schedule.recurrence,
    weekdays: input.schedule.weekdays,
    activeTo: input.endDate ?? null,
  })
  if (!input.verified) throw badRequest('Confirm the details against the prescription before saving.')
  const now = nowIso()
  transaction(() => {
    run(
      `UPDATE medications SET name = ?, strength = ?, form = ?, prescribed_instructions = ?, source_note = ?,
              start_date = ?, end_date = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      input.name,
      input.strength ?? null,
      input.form ?? null,
      input.prescribedInstructions,
      input.sourceNote ?? null,
      input.startDate,
      input.endDate ?? null,
      input.status,
      user.id,
      now,
      row.id,
    )
    if (schedule) {
      run(
        `UPDATE medication_schedules SET local_times = ?, recurrence = ?, weekdays = ?, timezone = ?,
                active_from = ?, active_to = ?, paused_from = ?, paused_until = ? WHERE id = ?`,
        JSON.stringify([...new Set(input.schedule.localTimes)].sort()),
        input.schedule.recurrence,
        JSON.stringify([...new Set(input.schedule.weekdays)].sort()),
        profile.timezone,
        input.startDate,
        input.endDate ?? null,
        input.schedule.pausedFrom ?? null,
        input.schedule.pausedUntil ?? null,
        schedule.id,
      )
    } else {
      run(
        `INSERT INTO medication_schedules
          (id, medication_id, local_times, recurrence, weekdays, timezone, active_from, active_to,
           paused_from, paused_until, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        row.id,
        JSON.stringify([...new Set(input.schedule.localTimes)].sort()),
        input.schedule.recurrence,
        JSON.stringify([...new Set(input.schedule.weekdays)].sort()),
        profile.timezone,
        input.startDate,
        input.endDate ?? null,
        input.schedule.pausedFrom ?? null,
        input.schedule.pausedUntil ?? null,
        now,
      )
    }
    // Schedules may have changed: rebuild only future, unrecorded doses.
    clearFuturePendingDoses(row.id)
    recordAudit({
      profileId: profile.id,
      actorId: user.id,
      actorLabel: user.display_name,
      action: 'medication.updated',
      entity: 'medication',
      entityId: row.id,
      summary: `Updated ${input.name}.${input.changeNote ? ` Note: ${input.changeNote}` : ''}`,
    })
  })
  if (input.status === 'active') {
    const today = localDateString(new Date(), profile.timezone)
    ensureDoseRows(profile, today, addDaysToDateString(today, 2))
  }
  const updated = getMedication(profile.id, row.id)
  res.json({ medication: serializeMedication(updated.row, updated.schedule) })
})

medicationsRouter.post('/:profileId/medications/:medicationId/status', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'editMedications')
  const { row } = getMedication(profile.id, param(req, 'medicationId'))
  const input = parse(
    z.object({
      status: z.enum(['active', 'paused', 'completed']),
      reason: z.string().trim().min(3, 'Add a short reason for this change.').max(300),
    }),
    req.body,
  )
  if (row.status === input.status) {
    res.json({ medication: serializeMedication(row, getScheduleForMedication(row.id)) })
    return
  }
  run(
    'UPDATE medications SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    input.status,
    user.id,
    nowIso(),
    row.id,
  )
  if (input.status !== 'active') clearFuturePendingDoses(row.id)
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: `medication.${input.status}`,
    entity: 'medication',
    entityId: row.id,
    summary: `Set ${row.name} to ${input.status}. Reason: ${input.reason}`,
  })
  if (input.status === 'active') {
    const today = localDateString(new Date(), profile.timezone)
    ensureDoseRows(profile, today, addDaysToDateString(today, 2))
  }
  const updated = one<MedicationRow>('SELECT * FROM medications WHERE id = ?', row.id)
  res.json({ medication: serializeMedication(updated ?? row, getScheduleForMedication(row.id)) })
})

medicationsRouter.get('/:profileId/medications/:medicationId/audit', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'viewAudit')
  const medication = one<MedicationRow>(
    'SELECT * FROM medications WHERE id = ? AND profile_id = ?',
    param(req, 'medicationId'),
    profile.id,
  )
  if (!medication) throw notFound('That medication could not be found.')
  const events = all<{ id: string; actor_label: string; action: string; summary: string; created_at: string }>(
    `SELECT id, actor_label, action, summary, created_at FROM audit_events
      WHERE profile_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 50`,
    profile.id,
    medication.id,
  )
  res.json({ events })
})

/** The care profile is loaded here to make the import graph explicit for tests. */
export { getProfile }
export type { ProfileRow }
