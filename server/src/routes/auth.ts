import { param } from '../http.js'
import { Router } from 'express'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { all, newId, nowIso, one, run, transaction } from '../db.js'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  hashSecret,
  readSessionToken,
  setSessionCookie,
  verifySecret,
  type UserRow,
} from '../auth.js'
import { recordAudit } from '../audit.js'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.js'
import { defaultPermissions, listMemberships, type MemberRow } from '../permissions.js'
import { parse, isValidEmail } from '../validation.js'
import { rateLimit } from '../rateLimit.js'
import { publicUser } from '../serialize.js'
import { config } from '../config.js'
import { isValidTimeZone } from '../time.js'
import type { Request, Response } from 'express'

export const authRouter = Router()

const registerSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter your name.').max(80),
  email: z.string().trim().max(254).refine(isValidEmail, 'Enter a valid email address.'),
  password: z.string().min(10, 'Use at least 10 characters for your password.').max(200),
  timezone: z.string().trim().max(60).optional(),
})

const loginSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
})

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'A quick-unlock PIN must be 4 to 6 digits.'),
})

const passwordSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(200),
})

function sessionPayload(user: UserRow) {
  const memberships = listMemberships(user.id).map((membership) => ({
    memberId: membership.id,
    role: membership.role,
    profileId: membership.profile_id,
    preferredName: membership.preferred_name,
    timezone: membership.timezone,
  }))
  return { user: publicUser(user), profiles: memberships }
}

function findUserByEmail(email: string) {
  return one<UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email.trim())
}

function acceptPendingInvitesFor(user: UserRow): number {
  const pending = all<MemberRow>(
    `SELECT * FROM care_team_members
      WHERE invited_email = ? COLLATE NOCASE AND invite_status = 'pending' AND revoked_at IS NULL`,
    user.email,
  )
  let accepted = 0
  for (const member of pending) {
    if (member.invite_expires_at && new Date(member.invite_expires_at).getTime() <= Date.now()) {
      run("UPDATE care_team_members SET invite_status = 'expired', updated_at = ? WHERE id = ?", nowIso(), member.id)
      continue
    }
    run(
      `UPDATE care_team_members
          SET user_id = ?, invite_status = 'active', accepted_at = ?, invite_token_hash = NULL, updated_at = ?
        WHERE id = ?`,
      user.id,
      nowIso(),
      nowIso(),
      member.id,
    )
    recordAudit({
      profileId: member.profile_id,
      actorId: user.id,
      actorLabel: user.display_name,
      action: 'member.joined',
      entity: 'care_team_member',
      entityId: member.id,
      summary: `${user.display_name} accepted the invitation as ${member.role}.`,
    })
    accepted += 1
  }
  return accepted
}

authRouter.post('/register', (req: Request, res: Response) => {
  const input = parse(registerSchema, req.body)
  if (!rateLimit(`register:${req.ip}`, 10, 60 * 60 * 1000)) {
    throw badRequest('Too many attempts. Please wait a little and try again.')
  }
  const email = input.email.trim().toLowerCase()
  if (findUserByEmail(email)) {
    throw conflict('An account already exists for that email address. Try signing in instead.')
  }
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : 'Europe/London'
  const now = nowIso()
  const user: UserRow = {
    id: newId(),
    email,
    display_name: input.displayName.trim(),
    password_hash: hashSecret(input.password),
    locale: 'en-GB',
    pin_hash: null,
    created_at: now,
  }
  const profileId = newId()
  const memberId = newId()
  const firstName = input.displayName.trim().split(/\s+/)[0] ?? input.displayName.trim()
  const permissions = defaultPermissions('older_adult')

  transaction(() => {
    run(
      'INSERT INTO users (id, email, display_name, password_hash, locale, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
      user.id,
      user.email,
      user.display_name,
      user.password_hash,
      user.locale,
      user.created_at,
    )
    run(
      `INSERT INTO care_profiles
        (id, preferred_name, full_name, timezone, created_by, share_medications, share_appointments,
         missed_tracking, grace_minutes, dose_reminder_lead_minutes, appointment_reminder_lead_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, 1, 120, 15, 1440, ?)`,
      profileId,
      firstName,
      user.display_name,
      timezone,
      user.id,
      now,
    )
    run(
      `INSERT INTO care_team_members
        (id, profile_id, user_id, invited_email, role, can_edit_medications, can_edit_appointments,
         can_record_doses, can_manage_members, invite_status, invited_by, accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'older_adult', ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      memberId,
      profileId,
      user.id,
      user.email,
      permissions.can_edit_medications,
      permissions.can_edit_appointments,
      permissions.can_record_doses,
      permissions.can_manage_members,
      user.id,
      now,
      now,
      now,
    )
    recordAudit({
      profileId,
      actorId: user.id,
      actorLabel: user.display_name,
      action: 'profile.created',
      entity: 'care_profile',
      entityId: profileId,
      summary: `Created the care profile for ${firstName}.`,
    })
  })

  acceptPendingInvitesFor(user)
  const { token, expiresAt } = createSession(user.id)
  setSessionCookie(res, token, expiresAt)
  res.status(201).json(sessionPayload(user))
})

authRouter.post('/login', (req: Request, res: Response) => {
  const input = parse(loginSchema, req.body)
  const key = `login:${input.email.trim().toLowerCase()}:${req.ip}`
  if (!rateLimit(key, 8, 15 * 60 * 1000)) {
    throw badRequest('Too many sign-in attempts. Please wait a few minutes and try again.')
  }
  const user = findUserByEmail(input.email)
  if (!user || !verifySecret(input.password, user.password_hash)) {
    throw unauthorized('That email and password combination did not match.')
  }
  acceptPendingInvitesFor(user)
  const { token, expiresAt } = createSession(user.id)
  setSessionCookie(res, token, expiresAt)
  res.json(sessionPayload(user))
})

authRouter.post('/logout', (req: Request, res: Response) => {
  const cookies = (res.locals.cookies ?? {}) as Record<string, string>
  deleteSession(readSessionToken(cookies))
  clearSessionCookie(res)
  res.json({ ok: true })
})

authRouter.get('/me', (_req: Request, res: Response) => {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  res.json(sessionPayload(user))
})

authRouter.patch('/me', (req: Request, res: Response) => {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  const input = parse(z.object({ displayName: z.string().trim().min(2).max(80) }), req.body)
  run('UPDATE users SET display_name = ? WHERE id = ?', input.displayName, user.id)
  res.json(sessionPayload({ ...user, display_name: input.displayName }))
})

authRouter.post('/pin', (req: Request, res: Response) => {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  const input = parse(pinSchema, req.body)
  run('UPDATE users SET pin_hash = ? WHERE id = ?', hashSecret(input.pin), user.id)
  res.json({ ok: true, pinEnabled: true })
})

authRouter.delete('/pin', (req: Request, res: Response) => {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  const input = parse(passwordSchema, req.body ?? {})
  if (!verifySecret(input.password, user.password_hash)) {
    throw forbidden('That password did not match. The PIN was not removed.')
  }
  run('UPDATE users SET pin_hash = NULL WHERE id = ?', user.id)
  res.json({ ok: true, pinEnabled: false })
})

authRouter.post('/pin/verify', (req: Request, res: Response) => {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized()
  const input = parse(pinSchema, req.body)
  if (!rateLimit(`pin:${user.id}`, 6, 5 * 60 * 1000)) {
    throw forbidden('Too many PIN attempts. Sign in again to continue.')
  }
  if (!verifySecret(input.pin, user.pin_hash)) {
    throw forbidden('That PIN did not match.')
  }
  res.json({ ok: true })
})

export const inviteRouter = Router()

function findInvite(token: string) {
  return one<MemberRow & { preferred_name: string; timezone: string; invited_by_name: string }>(
    `SELECT m.*, p.preferred_name, p.timezone, u.display_name AS invited_by_name
       FROM care_team_members m
       JOIN care_profiles p ON p.id = m.profile_id
       JOIN users u ON u.id = m.invited_by
      WHERE m.invite_token_hash = ?`,
    hashInviteToken(token),
  )
}

/**
 * Invitation tokens are 192-bit random values, so an unsalted SHA-256 digest is
 * sufficient for lookup and prevents the raw token being stored in the database.
 */
export function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createInviteToken() {
  const token = randomBytes(24).toString('base64url')
  return { token, hash: hashInviteToken(token), inviteUrl: `${config.appBaseUrl}/invite/${token}` }
}

inviteRouter.get('/:token', (req: Request, res: Response) => {
  const invite = findInvite(param(req, 'token'))
  if (!invite) throw notFound('This invitation link is not valid. Ask for a new invitation.')
  const status =
    invite.invite_status === 'pending' &&
    invite.invite_expires_at &&
    new Date(invite.invite_expires_at).getTime() <= Date.now()
      ? 'expired'
      : invite.invite_status
  const viewer = res.locals.user as UserRow | undefined
  res.json({
    profileName: invite.preferred_name,
    role: invite.role,
    invitedBy: invite.invited_by_name,
    email: invite.invited_email,
    status,
    expiresAt: invite.invite_expires_at,
    emailMatches: viewer ? viewer.email.toLowerCase() === invite.invited_email.toLowerCase() : null,
    signedInEmail: viewer?.email ?? null,
  })
})

inviteRouter.post('/:token/accept', (req: Request, res: Response) => {
  const user = res.locals.user as UserRow | undefined
  if (!user) throw unauthorized('Sign in with the invited email address to accept this invitation.')
  const invite = findInvite(param(req, 'token'))
  if (!invite) throw notFound('This invitation link is not valid. Ask for a new invitation.')
  if (invite.invite_status === 'revoked') throw forbidden('This invitation was revoked.')
  if (invite.invite_status === 'active' && invite.user_id === user.id) {
    res.json({ ok: true, profileId: invite.profile_id, alreadyAccepted: true })
    return
  }
  if (invite.invite_status !== 'pending') throw conflict('This invitation can no longer be used.')
  if (invite.invite_expires_at && new Date(invite.invite_expires_at).getTime() <= Date.now()) {
    run("UPDATE care_team_members SET invite_status = 'expired', updated_at = ? WHERE id = ?", nowIso(), invite.id)
    throw conflict('This invitation has expired. Ask the care-team administrator to send a new one.')
  }
  if (invite.invited_email.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden(
      `This invitation was sent to ${invite.invited_email}. Sign in with that email address to accept it.`,
    )
  }
  const existing = one<MemberRow>(
    'SELECT * FROM care_team_members WHERE profile_id = ? AND user_id = ? AND invite_status = ?',
    invite.profile_id,
    user.id,
    'active',
  )
  if (existing && existing.id !== invite.id) {
    run("UPDATE care_team_members SET invite_status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), invite.id)
    res.json({ ok: true, profileId: invite.profile_id, alreadyAccepted: true })
    return
  }
  run(
    `UPDATE care_team_members SET user_id = ?, invite_status = 'active', accepted_at = ?,
            invite_token_hash = NULL, updated_at = ? WHERE id = ?`,
    user.id,
    nowIso(),
    nowIso(),
    invite.id,
  )
  recordAudit({
    profileId: invite.profile_id,
    actorId: user.id,
    actorLabel: user.display_name,
    action: 'member.joined',
    entity: 'care_team_member',
    entityId: invite.id,
    summary: `${user.display_name} accepted the invitation as ${invite.role}.`,
  })
  res.json({ ok: true, profileId: invite.profile_id })
})
