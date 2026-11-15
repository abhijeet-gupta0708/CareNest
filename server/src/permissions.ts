import { all, one, run, nowIso } from './db.js'
import { forbidden, notFound } from './errors.js'
import type { UserRow } from './auth.js'

export type Role = 'older_adult' | 'caregiver' | 'family' | 'admin'

export const ROLES: Role[] = ['older_adult', 'caregiver', 'family', 'admin']

export const ROLE_LABELS: Record<Role, string> = {
  older_adult: 'Older adult',
  caregiver: 'Primary caregiver',
  family: 'Family viewer',
  admin: 'Care-team administrator',
}

export interface ProfileRow {
  id: string
  preferred_name: string
  full_name: string | null
  timezone: string
  date_of_birth: string | null
  created_by: string
  share_medications: number
  share_appointments: number
  missed_tracking: number
  grace_minutes: number
  dose_reminder_lead_minutes: number
  appointment_reminder_lead_minutes: number
  created_at: string
}

export interface MemberRow {
  id: string
  profile_id: string
  user_id: string | null
  invited_email: string
  role: Role
  can_edit_medications: number
  can_edit_appointments: number
  can_record_doses: number
  can_manage_members: number
  invite_status: 'pending' | 'active' | 'revoked' | 'expired'
  invite_token_hash: string | null
  invite_expires_at: string | null
  invited_by: string
  accepted_at: string | null
  revoked_at: string | null
  last_active_at: string | null
  notify_upcoming_doses: number
  notify_missed_doses: number
  notify_appointments: number
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  created_at: string
  updated_at: string
}

export interface Capabilities {
  viewProfile: boolean
  editMedications: boolean
  editAppointments: boolean
  recordDoses: boolean
  manageMembers: boolean
  viewAudit: boolean
  viewReminders: boolean
  exportData: boolean
}

export function defaultPermissions(role: Role) {
  switch (role) {
    case 'older_adult':
      return {
        can_edit_medications: 1,
        can_edit_appointments: 1,
        can_record_doses: 1,
        can_manage_members: 1,
      }
    case 'caregiver':
      return {
        can_edit_medications: 0,
        can_edit_appointments: 0,
        can_record_doses: 1,
        can_manage_members: 0,
      }
    case 'admin':
      return {
        can_edit_medications: 0,
        can_edit_appointments: 0,
        can_record_doses: 0,
        can_manage_members: 1,
      }
    case 'family':
    default:
      return {
        can_edit_medications: 0,
        can_edit_appointments: 0,
        can_record_doses: 0,
        can_manage_members: 0,
      }
  }
}

export function capabilitiesFor(member: MemberRow): Capabilities {
  const isOwner = member.role === 'older_adult'
  return {
    viewProfile: true,
    editMedications: isOwner || Number(member.can_edit_medications) === 1,
    editAppointments: isOwner || Number(member.can_edit_appointments) === 1,
    recordDoses: isOwner || Number(member.can_record_doses) === 1,
    manageMembers: isOwner || Number(member.can_manage_members) === 1,
    viewAudit: member.role !== 'family',
    viewReminders: member.role !== 'family',
    exportData: isOwner || member.role === 'admin',
  }
}

export type Capability = keyof Capabilities

export function getProfile(profileId: string): ProfileRow | undefined {
  return one<ProfileRow>('SELECT * FROM care_profiles WHERE id = ?', profileId)
}

export function getMembershipForUser(userId: string, profileId: string): MemberRow | undefined {
  const member = one<MemberRow>(
    'SELECT * FROM care_team_members WHERE profile_id = ? AND user_id = ? ORDER BY created_at LIMIT 1',
    profileId,
    userId,
  )
  if (!member) return undefined
  if (member.invite_status !== 'active' || member.revoked_at) return undefined
  return member
}

/** Any membership (including pending/revoked) for invitation display purposes. */
export function getAnyMembershipForUser(userId: string, profileId: string): MemberRow | undefined {
  return one<MemberRow>(
    'SELECT * FROM care_team_members WHERE profile_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
    profileId,
    userId,
  )
}

export function requireProfileAccess(
  user: UserRow,
  profileId: string,
  capability: Capability = 'viewProfile',
): { profile: ProfileRow; member: MemberRow; capabilities: Capabilities } {
  const profile = getProfile(profileId)
  if (!profile) throw notFound('That care profile is not available.')
  const member = getMembershipForUser(user.id, profileId)
  if (!member) throw notFound('That care profile is not available.')
  const capabilities = capabilitiesFor(member)
  if (!capabilities[capability]) {
    throw forbidden(
      capability === 'viewProfile'
        ? 'You do not have access to this care profile.'
        : 'Your access level does not allow that action. Ask the care-team administrator if you need it.',
    )
  }
  run('UPDATE care_team_members SET last_active_at = ? WHERE id = ?', nowIso(), member.id)
  return { profile, member, capabilities }
}

export function listMemberships(userId: string) {
  return all<MemberRow & { preferred_name: string; timezone: string }>(
    `SELECT m.*, p.preferred_name, p.timezone
       FROM care_team_members m
       JOIN care_profiles p ON p.id = m.profile_id
      WHERE m.user_id = ? AND m.invite_status = 'active' AND m.revoked_at IS NULL
      ORDER BY m.created_at`,
    userId,
  )
}

export function memberIsActive(member: MemberRow): boolean {
  return member.invite_status === 'active' && !member.revoked_at
}
