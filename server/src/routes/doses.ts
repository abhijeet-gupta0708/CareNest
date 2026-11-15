import { param } from '../http.js'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { all } from '../db.js'
import { badRequest, unauthorized } from '../errors.js'
import type { UserRow } from '../auth.js'
import { requireProfileAccess } from '../permissions.js'
import { parse } from '../validation.js'
import { assertShare } from './medications.js'
import {
  dailyCounts,
  effectiveStatus,
  listDoses,
  recordDose,
  correctDose,
  upcomingDoses,
  type DoseRow,
  type DoseStatus,
} from '../doses.js'
import { ensureDoseRows } from '../medications.js'
import {
  addDaysToDateString,
  isValidDateString,
  localDateString,
  startOfLocalDayUtc,
} from '../time.js'
import { serializeMember, serializeProfile } from '../serialize.js'
import { serializeAppointment } from '../appointments.js'

export const dosesRouter = Router()

function currentUser(res: Response): UserRow {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  return user
}

function addDays(dateString: string, days: number) {
  return addDaysToDateString(dateString, days)
}

interface AppointmentSummaryRow {
  id: string
  profile_id: string
  title: string
  provider: string
  location: string | null
  video_link: string | null
  start_at: string
  timezone: string
  duration_minutes: number
  status: 'upcoming' | 'completed' | 'cancelled'
  notes: string | null
  reminder_lead_minutes: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

dosesRouter.get('/:profileId/today', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member, capabilities } = requireProfileAccess(user, param(req, 'profileId'))
  const now = new Date()
  const requested = typeof req.query.date === 'string' ? req.query.date : null
  const date = requested && isValidDateString(requested) ? requested : localDateString(now, profile.timezone)
  ensureDoseRows(profile, date, date)
  const { doses, counts } = dailyCounts(profile, date)
  const nextDose =
    doses.find((dose) => ['due', 'upcoming', 'snoozed'].includes(dose.status)) ??
    upcomingDoses(profile, 7)[0] ??
    null

  const appointmentsToday = all<AppointmentSummaryRow>(
    `SELECT * FROM appointments WHERE profile_id = ? AND status != 'cancelled'
      AND start_at >= ? AND start_at < ? ORDER BY start_at`,
    profile.id,
    startOfLocalDayUtc(date, profile.timezone).toISOString(),
    startOfLocalDayUtc(addDays(date, 1), profile.timezone).toISOString(),
  )
  const nextAppointment = all<AppointmentSummaryRow>(
    `SELECT * FROM appointments WHERE profile_id = ? AND status = 'upcoming' AND start_at >= ?
      ORDER BY start_at LIMIT 1`,
    profile.id,
    now.toISOString(),
  )[0]

  const auditFilter =
    member.role === 'family'
      ? `AND action IN ('appointment.created','appointment.updated','appointment.cancelled','member.joined','member.revoked','profile.updated')`
      : ''
  const activity = all<{
    id: string
    actor_label: string
    action: string
    summary: string
    created_at: string
  }>(
    `SELECT id, actor_label, action, summary, created_at FROM audit_events
      WHERE profile_id = ? ${auditFilter} ORDER BY created_at DESC LIMIT 8`,
    profile.id,
  )

  res.json({
    date,
    today: localDateString(now, profile.timezone),
    timezone: profile.timezone,
    profile: serializeProfile(profile),
    membership: serializeMember(member),
    capabilities,
    doses,
    counts,
    nextDose,
    appointments: {
      today: appointmentsToday.map(serializeAppointment),
      next: nextAppointment ? serializeAppointment(nextAppointment) : null,
    },
    activity: activity.map((event) => ({
      id: event.id,
      actorLabel: event.actor_label,
      action: event.action,
      summary: event.summary,
      createdAt: event.created_at,
    })),
  })
})

dosesRouter.get('/:profileId/doses', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'medications')
  const today = localDateString(new Date(), profile.timezone)
  const from = typeof req.query.from === 'string' && isValidDateString(req.query.from) ? req.query.from : addDays(today, -7)
  const to = typeof req.query.to === 'string' && isValidDateString(req.query.to) ? req.query.to : today
  if (from > to) throw badRequest('The start date must be before the end date.')
  if (addDays(from, 92) < to) throw badRequest('Choose a date range of 92 days or less.')
  res.json({ from, to, doses: listDoses(profile, from, to) })
})

const recordSchema = z.object({
  action: z.enum(['taken', 'skipped', 'snooze']),
  note: z.string().trim().max(300).nullable().optional(),
  snoozeMinutes: z.number().int().min(5).max(180).optional(),
})

dosesRouter.post('/:profileId/doses/:doseId/record', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'), 'recordDoses')
  const input = parse(recordSchema, req.body)
  const result = recordDose({
    profile,
    member,
    actorLabel: user.display_name,
    doseId: param(req, 'doseId'),
    action: input.action,
    note: input.note ?? null,
    snoozeMinutes: input.snoozeMinutes,
  })
  res.json(result)
})

const correctSchema = z.object({
  status: z.enum(['taken', 'skipped']),
  reason: z.string().trim().min(3, 'Add a short reason for the correction.').max(300),
})

dosesRouter.post('/:profileId/doses/:doseId/correct', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'), 'recordDoses')
  const input = parse(correctSchema, req.body)
  const result = correctDose({
    profile,
    member,
    actorLabel: user.display_name,
    doseId: param(req, 'doseId'),
    status: input.status,
    reason: input.reason,
  })
  res.json(result)
})

dosesRouter.get('/:profileId/doses-summary', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'))
  const today = localDateString(new Date(), profile.timezone)
  const from = addDays(today, -13)
  ensureDoseRows(profile, from, today)
  const rows = all<DoseRow>(
    'SELECT * FROM dose_events WHERE profile_id = ? AND local_date BETWEEN ? AND ?',
    profile.id,
    from,
    today,
  )
  const counts: Record<DoseStatus, number> = {
    upcoming: 0,
    due: 0,
    snoozed: 0,
    taken: 0,
    skipped: 0,
    missed: 0,
    not_recorded: 0,
  }
  for (const row of rows) counts[effectiveStatus(row, profile)] += 1
  res.json({ from, to: today, counts })
})
