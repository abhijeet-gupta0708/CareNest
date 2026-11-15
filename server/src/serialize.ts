import { toBool } from './db.js'
import {
  capabilitiesFor,
  ROLE_LABELS,
  type MemberRow,
  type ProfileRow,
} from './permissions.js'
import type { UserRow } from './auth.js'

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    locale: user.locale,
    pinEnabled: Boolean(user.pin_hash),
    createdAt: user.created_at,
  }
}

export function serializeProfile(profile: ProfileRow) {
  return {
    id: profile.id,
    preferredName: profile.preferred_name,
    fullName: profile.full_name,
    timezone: profile.timezone,
    dateOfBirth: profile.date_of_birth,
    shareMedications: toBool(profile.share_medications),
    shareAppointments: toBool(profile.share_appointments),
    missedTracking: toBool(profile.missed_tracking),
    graceMinutes: profile.grace_minutes,
    doseReminderLeadMinutes: profile.dose_reminder_lead_minutes,
    appointmentReminderLeadMinutes: profile.appointment_reminder_lead_minutes,
    createdAt: profile.created_at,
  }
}

export function effectiveInviteStatus(member: MemberRow): MemberRow['invite_status'] {
  if (member.invite_status === 'pending' && member.invite_expires_at) {
    if (new Date(member.invite_expires_at).getTime() <= Date.now()) return 'expired'
  }
  return member.invite_status
}

export function serializeMember(member: MemberRow) {
  const capabilities = capabilitiesFor(member)
  return {
    id: member.id,
    email: member.invited_email,
    role: member.role,
    roleLabel: ROLE_LABELS[member.role],
    inviteStatus: effectiveInviteStatus(member),
    capabilities,
    permissions: {
      editMedications: capabilities.editMedications,
      editAppointments: capabilities.editAppointments,
      recordDoses: capabilities.recordDoses,
      manageMembers: capabilities.manageMembers,
    },
    notifications: {
      upcomingDoses: toBool(member.notify_upcoming_doses),
      missedDoses: toBool(member.notify_missed_doses),
      appointments: toBool(member.notify_appointments),
    },
    quietHours: { start: member.quiet_hours_start, end: member.quiet_hours_end },
    isOwner: member.role === 'older_adult',
    acceptedAt: member.accepted_at,
    revokedAt: member.revoked_at,
    invitedAt: member.created_at,
    lastActiveAt: member.last_active_at,
    inviteExpiresAt: member.invite_expires_at,
  }
}
