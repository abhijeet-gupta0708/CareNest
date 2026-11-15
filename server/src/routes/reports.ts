import { param } from '../http.js'
import { Router, type Request, type Response } from 'express'
import { all } from '../db.js'
import { badRequest, unauthorized } from '../errors.js'
import type { UserRow } from '../auth.js'
import { requireProfileAccess } from '../permissions.js'
import { assertShare } from './medications.js'
import { ensureDoseRows } from '../medications.js'
import { listDoses, type DoseStatus } from '../doses.js'
import { addDaysToDateString, isValidDateString, localDateString } from '../time.js'
import { listAppointments } from '../appointments.js'

export const reportsRouter = Router()

function currentUser(res: Response): UserRow {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  return user
}

function emptyCounts(): Record<DoseStatus, number> {
  return {
    upcoming: 0,
    due: 0,
    snoozed: 0,
    taken: 0,
    skipped: 0,
    missed: 0,
    not_recorded: 0,
  }
}

reportsRouter.get('/:profileId/reports/adherence', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  assertShare(profile, member, 'medications')
  const today = localDateString(new Date(), profile.timezone)
  const from =
    typeof req.query.from === 'string' && isValidDateString(req.query.from)
      ? req.query.from
      : addDaysToDateString(today, -13)
  const to =
    typeof req.query.to === 'string' && isValidDateString(req.query.to) ? req.query.to : today
  if (from > to) throw badRequest('The start date must be before the end date.')
  if (addDaysToDateString(from, 92) < to) throw badRequest('Choose a period of 92 days or less.')

  ensureDoseRows(profile, from, to)
  const doses = listDoses(profile, from, to, { materialise: false })

  const counts = emptyCounts()
  const byMedication = new Map<
    string,
    { medicationId: string; name: string; strength: string | null; counts: Record<DoseStatus, number> }
  >()
  const daily = new Map<string, Record<DoseStatus, number>>()

  for (const dose of doses) {
    counts[dose.status] += 1
    const key = dose.medicationId
    const entry =
      byMedication.get(key) ??
      {
        medicationId: dose.medicationId,
        name: dose.medicationName,
        strength: dose.strength,
        counts: emptyCounts(),
      }
    entry.counts[dose.status] += 1
    byMedication.set(key, entry)

    const day = daily.get(dose.localDate) ?? emptyCounts()
    day[dose.status] += 1
    daily.set(dose.localDate, day)
  }

  const finalStates: DoseStatus[] = ['taken', 'skipped', 'missed', 'not_recorded']
  const denominator = finalStates.reduce((sum, status) => sum + counts[status], 0)
  const takenRate = denominator === 0 ? null : counts.taken / denominator
  const confirmedDenominator = counts.taken + counts.skipped + counts.missed
  const noMissesRate = confirmedDenominator === 0 ? null : (counts.taken + counts.skipped) / confirmedDenominator

  res.json({
    from,
    to,
    timezone: profile.timezone,
    generatedAt: new Date().toISOString(),
    counts: {
      scheduled: doses.length,
      taken: counts.taken,
      skipped: counts.skipped,
      missed: counts.missed,
      notRecorded: counts.not_recorded,
      upcoming: counts.upcoming + counts.due + counts.snoozed,
    },
    denominator,
    takenRate,
    noMissesRate,
    definitions: {
      scheduled: 'Every scheduled dose in the period, including doses that have not yet happened.',
      taken: 'A dose a permitted person confirmed as taken.',
      skipped: 'A dose a permitted person recorded as skipped.',
      missed: 'No confirmation was recorded within the grace period and the missed rule was applied.',
      notRecorded: 'No confirmation exists and the missed rule was not applied, so the app cannot say what happened. This is not the same as missed.',
      denominator: 'Taken + skipped + missed + not recorded. Upcoming doses are excluded from rates.',
    },
    byMedication: [...byMedication.values()].sort((a, b) => a.name.localeCompare(b.name)),
    daily: [...daily.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, dayCounts]) => ({ date, ...dayCounts })),
  })
})

reportsRouter.get('/:profileId/reports/handover', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'))
  const today = localDateString(new Date(), profile.timezone)
  ensureDoseRows(profile, addDaysToDateString(today, -7), today)
  const recent = listDoses(profile, addDaysToDateString(today, -7), today, { materialise: false })
  const outstanding = recent
    .filter((dose) => ['missed', 'not_recorded', 'due', 'snoozed'].includes(dose.status))
    .slice(-12)
    .reverse()
  const lastRecorded = recent
    .filter((dose) => ['taken', 'skipped', 'missed'].includes(dose.status))
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1))
    .slice(0, 8)
  const nextAppointment = listAppointments(profile.id, { view: 'upcoming' })[0] ?? null
  const auditFilter =
    member.role === 'family'
      ? `AND action IN ('appointment.created','appointment.updated','appointment.cancelled','member.joined','member.revoked','profile.updated')`
      : ''
  const changes = all<{ id: string; actor_label: string; summary: string; created_at: string }>(
    `SELECT id, actor_label, summary, created_at FROM audit_events WHERE profile_id = ? ${auditFilter}
      ORDER BY created_at DESC LIMIT 6`,
    profile.id,
  )
  res.json({
    generatedAt: new Date().toISOString(),
    timezone: profile.timezone,
    forDate: today,
    lastRecorded,
    outstanding,
    nextAppointment,
    recentChanges: changes.map((change) => ({
      id: change.id,
      actorLabel: change.actor_label,
      summary: change.summary,
      createdAt: change.created_at,
    })),
    note: 'Built only from recorded app events. CareNest does not interpret symptoms or give medical advice.',
  })
})
