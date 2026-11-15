import { param } from '../http.js'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { all, newId, nowIso, one, run, transaction } from '../db.js'
import { recordAudit } from '../audit.js'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.js'
import type { UserRow } from '../auth.js'
import {
  capabilitiesFor,
  defaultPermissions,
  getProfile,
  requireProfileAccess,
  ROLES,
  ROLE_LABELS,
  type MemberRow,
  type Role,
} from '../permissions.js'
import { parse } from '../validation.js'
import { serializeMember, serializeProfile } from '../serialize.js'
import { createInviteToken } from './auth.js'
import { config } from '../config.js'
import { isValidTimeZone } from '../time.js'
import { createTestReminder, listReminders } from '../reminders.js'

export const profilesRouter = Router()

function currentUser(res: Response): UserRow {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  return user
}

profilesRouter.get('/:profileId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member, capabilities } = requireProfileAccess(user, param(req, 'profileId'))
  res.json({ profile: serializeProfile(profile), membership: serializeMember(member), capabilities })
})

const updateProfileSchema = z.object({
  preferredName: z.string().trim().min(1, 'Enter a preferred name.').max(60).optional(),
  fullName: z.string().trim().max(120).nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
  graceMinutes: z.number().int().min(15).max(1440).optional(),
  missedTracking: z.boolean().optional(),
  shareMedications: z.boolean().optional(),
  shareAppointments: z.boolean().optional(),
  doseReminderLeadMinutes: z.number().int().min(0).max(240).optional(),
  appointmentReminderLeadMinutes: z.number().int().min(0).max(10080).optional(),
})

profilesRouter.patch('/:profileId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'manageMembers')
  const input = parse(updateProfileSchema, req.body)
  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw badRequest('Choose a valid time zone.')
  }
  const updates: string[] = []
  const params: (string | number | null)[] = []
  const push = (column: string, value: string | number | null) => {
    updates.push(`${column} = ?`)
    params.push(value)
  }
  if (input.preferredName !== undefined) push('preferred_name', input.preferredName)
  if (input.fullName !== undefined) push('full_name', input.fullName)
  if (input.timezone !== undefined) push('timezone', input.timezone)
  if (input.graceMinutes !== undefined) push('grace_minutes', input.graceMinutes)
  if (input.missedTracking !== undefined) push('missed_tracking', input.missedTracking ? 1 : 0)
  if (input.shareMedications !== undefined) push('share_medications', input.shareMedications ? 1 : 0)
  if (input.shareAppointments !== undefined) push('share_appointments', input.shareAppointments ? 1 : 0)
  if (input.doseReminderLeadMinutes !== undefined)
    push('dose_reminder_lead_minutes', input.doseReminderLeadMinutes)
  if (input.appointmentReminderLeadMinutes !== undefined)
    push('appointment_reminder_lead_minutes', input.appointmentReminderLeadMinutes)

  if (updates.length === 0) {
    res.json({ profile: serializeProfile(profile) })
    return
  }
  params.push(profile.id)
  transaction(() => {
    run(`UPDATE care_profiles SET ${updates.join(', ')} WHERE id = ?`, ...params)
    if (input.timezone && input.timezone !== profile.timezone) {
      run(
        `UPDATE medication_schedules SET timezone = ?
          WHERE medication_id IN (SELECT id FROM medications WHERE profile_id = ?)`,
        input.timezone,
        profile.id,
      )
      // Future pending doses were computed against the previous zone.
      run(
        "DELETE FROM dose_events WHERE profile_id = ? AND status = 'pending' AND scheduled_for > ?",
        profile.id,
        nowIso(),
      )
    }
    recordAudit({
      profileId: profile.id,
      actorId: user.id,
      actorLabel: user.display_name,
      action: 'profile.updated',
      entity: 'care_profile',
      entityId: profile.id,
      summary: `Updated care profile settings (${Object.keys(input).join(', ')}).`,
    })
  })
  const updated = getProfile(profile.id)
  res.json({ profile: serializeProfile(updated ?? profile) })
})

profilesRouter.get('/:profileId/members', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'))
  const members = all<MemberRow>(
    'SELECT * FROM care_team_members WHERE profile_id = ? ORDER BY created_at',
    profile.id,
  )
  res.json({ members: members.map(serializeMember) })
})

const inviteSchema = z.object({
  email: z.string().trim().max(254),
  role: z.enum(['caregiver', 'family', 'admin']),
  permissions: z
    .object({
      editMedications: z.boolean().optional(),
      editAppointments: z.boolean().optional(),
      recordDoses: z.boolean().optional(),
      manageMembers: z.boolean().optional(),
    })
    .optional(),
})

profilesRouter.post('/:profileId/members/invite', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'manageMembers')
  const input = parse(inviteSchema, req.body)
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw badRequest('Enter a valid email address for the invitation.')
  }
  const existing = one<MemberRow>(
    `SELECT * FROM care_team_members WHERE profile_id = ? AND invited_email = ? COLLATE NOCASE
      AND invite_status IN ('pending', 'active') AND revoked_at IS NULL`,
    profile.id,
    email,
  )
  if (existing) {
    throw conflict(
      existing.invite_status === 'active'
        ? 'That person already has access to this care circle.'
        : 'There is already a pending invitation for that email address.',
    )
  }
  const role = input.role as Role
  const defaults = defaultPermissions(role)
  const permissions = {
    editMedications: input.permissions?.editMedications ?? defaults.can_edit_medications === 1,
    editAppointments: input.permissions?.editAppointments ?? defaults.can_edit_appointments === 1,
    recordDoses: input.permissions?.recordDoses ?? defaults.can_record_doses === 1,
    manageMembers: input.permissions?.manageMembers ?? defaults.can_manage_members === 1,
  }
  const invite = createInviteToken()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const memberId = newId()
  const notifyDefaults =
    role === 'family' || role === 'admin'
      ? { upcoming: 0, missed: 0, appointments: 1 }
      : { upcoming: 1, missed: 1, appointments: 1 }
  transaction(() => {
    run(
      `INSERT INTO care_team_members
        (id, profile_id, user_id, invited_email, role, can_edit_medications, can_edit_appointments,
         can_record_doses, can_manage_members, invite_status, invite_token_hash, invite_expires_at,
         invited_by, notify_upcoming_doses, notify_missed_doses, notify_appointments,
         created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      memberId,
      profile.id,
      email,
      role,
      permissions.editMedications ? 1 : 0,
      permissions.editAppointments ? 1 : 0,
      permissions.recordDoses ? 1 : 0,
      permissions.manageMembers ? 1 : 0,
      invite.hash,
      expiresAt,
      user.id,
      notifyDefaults.upcoming,
      notifyDefaults.missed,
      notifyDefaults.appointments,
      now,
      now,
    )
    recordAudit({
      profileId: profile.id,
      actorId: user.id,
      actorLabel: user.display_name,
      action: 'member.invited',
      entity: 'care_team_member',
      entityId: memberId,
      summary: `Invited ${email} as ${ROLE_LABELS[role]}. Access begins only after they accept.`,
    })
    run(
      `INSERT INTO email_delivery_log (id, reminder_id, profile_id, to_email, subject, body, mode, ok, error, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, 1, NULL, ?)`,
      newId(),
      profile.id,
      email,
      'You have been invited to a CareNest care circle',
      `You have been invited to help coordinate care for ${profile.preferred_name} in CareNest.\n\nAccept the invitation: ${invite.inviteUrl}\n\nThis link expires in 14 days. If you were not expecting this, you can ignore this message.`,
      config.emailMode,
      now,
    )
  })
  const member = one<MemberRow>('SELECT * FROM care_team_members WHERE id = ?', memberId)
  res.status(201).json({
    member: member ? serializeMember(member) : null,
    inviteUrl: invite.inviteUrl,
  })
})

const updateMemberSchema = z.object({
  role: z.enum(['caregiver', 'family', 'admin']).optional(),
  permissions: z
    .object({
      editMedications: z.boolean().optional(),
      editAppointments: z.boolean().optional(),
      recordDoses: z.boolean().optional(),
      manageMembers: z.boolean().optional(),
    })
    .optional(),
  notifications: z
    .object({
      upcomingDoses: z.boolean().optional(),
      missedDoses: z.boolean().optional(),
      appointments: z.boolean().optional(),
    })
    .optional(),
  quietHours: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    })
    .optional(),
})

profilesRouter.patch('/:profileId/members/:memberId', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member: actor, capabilities } = requireProfileAccess(user, param(req, 'profileId'))
  const target = one<MemberRow>(
    'SELECT * FROM care_team_members WHERE id = ? AND profile_id = ?',
    param(req, 'memberId'),
    profile.id,
  )
  if (!target) throw notFound('That care-circle member could not be found.')
  const input = parse(updateMemberSchema, req.body)
  const isSelf = target.user_id === user.id

  const changesPermissions = Boolean(input.role || input.permissions)
  if (changesPermissions) {
    if (!capabilities.manageMembers) {
      throw forbidden('Only a care-team administrator can change roles or permissions.')
    }
    if (target.role === 'older_adult') {
      throw forbidden('The older adult’s own access cannot be reduced by another member.')
    }
  }
  if (!isSelf && !capabilities.manageMembers) {
    throw forbidden('You can only change your own reminder preferences.')
  }

  const updates: string[] = []
  const params: (string | number | null)[] = []
  const push = (column: string, value: string | number | null) => {
    updates.push(`${column} = ?`)
    params.push(value)
  }

  if (input.role) {
    const defaults = defaultPermissions(input.role as Role)
    push('role', input.role)
    push('can_edit_medications', input.permissions?.editMedications === false ? 0 : input.permissions?.editMedications === true ? 1 : defaults.can_edit_medications)
    push('can_edit_appointments', input.permissions?.editAppointments === false ? 0 : input.permissions?.editAppointments === true ? 1 : defaults.can_edit_appointments)
    push('can_record_doses', input.permissions?.recordDoses === false ? 0 : input.permissions?.recordDoses === true ? 1 : defaults.can_record_doses)
    push('can_manage_members', input.permissions?.manageMembers === false ? 0 : input.permissions?.manageMembers === true ? 1 : defaults.can_manage_members)
  } else if (input.permissions) {
    if (input.permissions.editMedications !== undefined)
      push('can_edit_medications', input.permissions.editMedications ? 1 : 0)
    if (input.permissions.editAppointments !== undefined)
      push('can_edit_appointments', input.permissions.editAppointments ? 1 : 0)
    if (input.permissions.recordDoses !== undefined)
      push('can_record_doses', input.permissions.recordDoses ? 1 : 0)
    if (input.permissions.manageMembers !== undefined)
      push('can_manage_members', input.permissions.manageMembers ? 1 : 0)
  }
  if (input.notifications) {
    if (input.notifications.upcomingDoses !== undefined)
      push('notify_upcoming_doses', input.notifications.upcomingDoses ? 1 : 0)
    if (input.notifications.missedDoses !== undefined)
      push('notify_missed_doses', input.notifications.missedDoses ? 1 : 0)
    if (input.notifications.appointments !== undefined)
      push('notify_appointments', input.notifications.appointments ? 1 : 0)
  }
  if (input.quietHours) {
    if (Boolean(input.quietHours.start) !== Boolean(input.quietHours.end)) {
      throw badRequest('Add both a quiet-hours start and end time, or clear both.')
    }
    push('quiet_hours_start', input.quietHours.start ?? null)
    push('quiet_hours_end', input.quietHours.end ?? null)
  }
  if (updates.length === 0) {
    res.json({ member: serializeMember(target) })
    return
  }
  push('updated_at', nowIso())
  params.push(target.id)
  run(`UPDATE care_team_members SET ${updates.join(', ')} WHERE id = ?`, ...params)
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: isSelf && !changesPermissions ? 'member.preferences_updated' : 'member.updated',
    entity: 'care_team_member',
    entityId: target.id,
    summary:
      isSelf && !changesPermissions
        ? 'Updated their own reminder preferences.'
        : `Updated access for ${target.invited_email} (${Object.keys(input).join(', ')}).`,
  })
  const updated = one<MemberRow>('SELECT * FROM care_team_members WHERE id = ?', target.id)
  res.json({ member: serializeMember(updated ?? target) })
})

profilesRouter.post('/:profileId/members/:memberId/reinvite', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'manageMembers')
  const target = one<MemberRow>(
    'SELECT * FROM care_team_members WHERE id = ? AND profile_id = ?',
    param(req, 'memberId'),
    profile.id,
  )
  if (!target) throw notFound('That care-circle member could not be found.')
  if (target.invite_status === 'active') throw conflict('That person already has access.')
  if (target.role === 'older_adult') throw conflict('The care profile owner cannot be re-invited.')
  const invite = createInviteToken()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  run(
    `UPDATE care_team_members SET invite_status = 'pending', invite_token_hash = ?, invite_expires_at = ?,
            user_id = NULL, revoked_at = NULL, accepted_at = NULL, updated_at = ? WHERE id = ?`,
    invite.hash,
    expiresAt,
    now,
    target.id,
  )
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: 'member.reinvited',
    entity: 'care_team_member',
    entityId: target.id,
    summary: `Sent a fresh invitation to ${target.invited_email}.`,
  })
  run(
    `INSERT INTO email_delivery_log (id, reminder_id, profile_id, to_email, subject, body, mode, ok, error, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 1, NULL, ?)`,
    newId(),
    profile.id,
    target.invited_email,
    'Your CareNest invitation has been renewed',
    `A fresh invitation to help coordinate care for ${profile.preferred_name} is ready.\n\nAccept: ${invite.inviteUrl}\n\nThis link expires in 14 days.`,
    config.emailMode,
    now,
  )
  res.status(201).json({ ok: true, inviteUrl: invite.inviteUrl })
})

profilesRouter.post('/:profileId/members/:memberId/revoke', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, capabilities } = requireProfileAccess(user, param(req, 'profileId'))
  const target = one<MemberRow>(
    'SELECT * FROM care_team_members WHERE id = ? AND profile_id = ?',
    param(req, 'memberId'),
    profile.id,
  )
  if (!target) throw notFound('That care-circle member could not be found.')
  const isSelf = target.user_id === user.id
  if (!isSelf && !capabilities.manageMembers) {
    throw forbidden('Only a care-team administrator can remove someone else’s access.')
  }
  if (target.role === 'older_adult') {
    throw forbidden('The older adult’s access cannot be revoked from their own care profile.')
  }
  run(
    `UPDATE care_team_members SET invite_status = 'revoked', revoked_at = ?, invite_token_hash = NULL,
            updated_at = ? WHERE id = ?`,
    nowIso(),
    nowIso(),
    target.id,
  )
  recordAudit({
    profileId: profile.id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: 'member.revoked',
    entity: 'care_team_member',
    entityId: target.id,
    summary: isSelf
      ? `${user.display_name} left the care circle.`
      : `Revoked access for ${target.invited_email}.`,
  })
  res.json({ ok: true })
})

profilesRouter.post('/:profileId/reminders/test', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile, member } = requireProfileAccess(user, param(req, 'profileId'), 'viewReminders')
  const reminder = createTestReminder(profile, member)
  res.status(201).json({ ok: true, reminder })
})

profilesRouter.get('/:profileId/reminders', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'viewReminders')
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? '40'), 10) || 40, 200)
  res.json({ reminders: listReminders(profile.id, limit) })
})

profilesRouter.get('/:profileId/audit', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'viewAudit')
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? '60'), 10) || 60, 300)
  const events = all<{
    id: string
    actor_id: string | null
    actor_label: string
    action: string
    entity: string
    entity_id: string | null
    summary: string
    created_at: string
  }>('SELECT * FROM audit_events WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?', profile.id, limit)
  res.json({
    events: events.map((event) => ({
      id: event.id,
      actorId: event.actor_id,
      actorLabel: event.actor_label,
      action: event.action,
      entity: event.entity,
      entityId: event.entity_id,
      summary: event.summary,
      createdAt: event.created_at,
    })),
  })
})

profilesRouter.get('/:profileId/export', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { profile } = requireProfileAccess(user, param(req, 'profileId'), 'exportData')
  const medications = all('SELECT * FROM medications WHERE profile_id = ?', profile.id)
  const members = all<MemberRow>('SELECT * FROM care_team_members WHERE profile_id = ?', profile.id)
  const appointments = all('SELECT * FROM appointments WHERE profile_id = ?', profile.id)
  const doses = all(
    'SELECT id, medication_id, scheduled_for, local_date, status, recorded_at, recorded_by FROM dose_events WHERE profile_id = ?',
    profile.id,
  )
  res.setHeader('Content-Disposition', `attachment; filename="carenest-export-${profile.id}.json"`)
  res.json({
    exportedAt: nowIso(),
    profile: serializeProfile(profile),
    members: members.map(serializeMember),
    medications,
    appointments,
    doses,
  })
})

profilesRouter.get('/:profileId/capabilities', (req: Request, res: Response) => {
  const user = currentUser(res)
  const { member } = requireProfileAccess(user, param(req, 'profileId'))
  res.json({ capabilities: capabilitiesFor(member), role: member.role, roles: ROLES })
})
