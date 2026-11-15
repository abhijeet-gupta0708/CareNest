import { param } from '../http.js'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { newId, nowIso, run } from '../db.js'
import { recordAudit } from '../audit.js'
import { badRequest, unauthorized } from '../errors.js'
import type { UserRow } from '../auth.js'
import { requireProfileAccess } from '../permissions.js'
import { parse } from '../validation.js'
import {
  getAppointment,
  listAppointments,
  serializeAppointment,
  type AppointmentRow,
} from '../appointments.js'
import { assertShare } from './medications.js'
import { isValidDateString, isValidTimeZone, localDateString } from '../time.js'

export const appointmentsRouter = Router()

function currentUser(res: Response): UserRow {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  return user
}

const appointmentSchema = z.object({
  title: z.string().trim().min(1, 'Give the appointment a short title.').max(120),
  provider: z.string().trim().min(1, 'Enter the clinic, provider or service.').max(120),
  location: z.string().trim().max(200).nullable().optional(),
  videoLink: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  startAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Choose a valid date and time.'),
  timezone: z.string().trim().max(60).optional(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  status: z.enum(['upcoming', 'completed', 'cancelled']).default('upcoming'),
  reminderLeadMinutes: z.number().int().min(0).max(10080).default(1440),
})

appointmentsRouter.get('/:profileId/appointments', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'appointments')
  const view =
    req.query.view === 'upcoming' || req.query.view === 'past' || req.query.view === 'all'
      ? req.query.view
      : 'all'
  const from =
    typeof req.query.from === 'string' && isValidDateString(req.query.from)
      ? new Date(`${req.query.from}T00:00:00Z`).toISOString()
      : undefined
  const to =
    typeof req.query.to === 'string' && isValidDateString(req.query.to)
      ? new Date(`${req.query.to}T23:59:59Z`).toISOString()
      : undefined
  res.json({ appointments: listAppointments(profile.id, { view, from, to }) })
})

appointmentsRouter.get('/:profileId/appointments/:appointmentId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'appointments')
  res.json({ appointment: serializeAppointment(getAppointment(profile.id, param(req, 'appointmentId'))) })
})

appointmentsRouter.post('/:profileId/appointments', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'editAppointments')
  const input = parse(appointmentSchema, req.body)
  const timezone = input.timezone ?? profile.timezone
  if (!isValidTimeZone(timezone)) throw badRequest('Choose a valid time zone for the appointment.')
  const startAt = new Date(input.startAt)
  const id = newId()
  const now = nowIso()
  run(
    `INSERT INTO appointments
      (id, profile_id, title, provider, location, video_link, notes, start_at, timezone, duration_minutes,
       status, reminder_lead_minutes, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    profile.id,
    input.title,
    input.provider,
    input.location ?? null,
    input.videoLink ?? null,
    input.notes ?? null,
    startAt.toISOString(),
    timezone,
    input.durationMinutes,
    input.status,
    input.reminderLeadMinutes,
    user.id,
    user.id,
    now,
    now,
  )
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: 'appointment.created',
    entity: 'appointment',
    entityId: id,
    summary: `Added appointment “${input.title}” with ${input.provider} on ${startAt.toISOString()}.`,
  })
  res.status(201).json({ appointment: serializeAppointment(getAppointment(profile.id, id)) })
})

appointmentsRouter.patch('/:profileId/appointments/:appointmentId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'editAppointments')
  const existing = getAppointment(profile.id, param(req, 'appointmentId'))
  const input = parse(appointmentSchema.partial(), req.body)
  const timezone = input.timezone ?? existing.timezone
  if (!isValidTimeZone(timezone)) throw badRequest('Choose a valid time zone for the appointment.')
  if (input.startAt && Number.isNaN(Date.parse(input.startAt))) {
    throw badRequest('Choose a valid date and time.')
  }
  const updates: string[] = []
  const params: (string | number | null)[] = []
  const push = (column: string, value: string | number | null) => {
    updates.push(`${column} = ?`)
    params.push(value)
  }
  if (input.title !== undefined) push('title', input.title)
  if (input.provider !== undefined) push('provider', input.provider)
  if (input.location !== undefined) push('location', input.location)
  if (input.videoLink !== undefined) push('video_link', input.videoLink)
  if (input.notes !== undefined) push('notes', input.notes)
  if (input.startAt !== undefined) push('start_at', new Date(input.startAt).toISOString())
  if (input.timezone !== undefined) push('timezone', timezone)
  if (input.durationMinutes !== undefined) push('duration_minutes', input.durationMinutes)
  if (input.status !== undefined) push('status', input.status)
  if (input.reminderLeadMinutes !== undefined) push('reminder_lead_minutes', input.reminderLeadMinutes)
  if (updates.length === 0) {
    res.json({ appointment: serializeAppointment(existing) })
    return
  }
  push('updated_by', user.id)
  push('updated_at', nowIso())
  params.push(existing.id)
  run(`UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`, ...params)
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: 'appointment.updated',
    entity: 'appointment',
    entityId: existing.id,
    summary: `Updated appointment “${input.title ?? existing.title}”.`,
  })
  res.json({ appointment: serializeAppointment(getAppointment(profile.id, existing.id)) })
})

const statusSchema = z.object({
  status: z.enum(['upcoming', 'completed', 'cancelled']),
  reason: z.string().trim().max(300).optional(),
})

appointmentsRouter.post('/:profileId/appointments/:appointmentId/status', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'editAppointments')
  const existing = getAppointment(profile.id, param(req, 'appointmentId'))
  const input = parse(statusSchema, req.body)
  if (existing.status === input.status) {
    res.json({ appointment: serializeAppointment(existing) })
    return
  }
  run(
    'UPDATE appointments SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    input.status,
    user.id,
    nowIso(),
    existing.id,
  )
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: `appointment.${input.status === 'cancelled' ? 'cancelled' : input.status}`,
    entity: 'appointment',
    entityId: existing.id,
    summary: `Marked appointment “${existing.title}” as ${input.status}.${input.reason ? ` Reason: ${input.reason}` : ''}`,
  })
  res.json({ appointment: serializeAppointment({ ...existing, status: input.status } as AppointmentRow) })
})

appointmentsRouter.get('/:profileId/appointments-agenda', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'appointments')
  const today = localDateString(new Date(), profile.timezone)
  res.json({ today, upcoming: listAppointments(profile.id, { view: 'upcoming' }).slice(0, 5) })
})
