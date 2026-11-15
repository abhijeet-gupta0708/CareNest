import './helpers.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { MemberRow, Role } from '../src/permissions.js'

const BASE_MEMBER: MemberRow = {
  id: 'member-1',
  profile_id: 'profile-1',
  user_id: 'user-1',
  invited_email: 'person@example.test',
  role: 'family',
  can_edit_medications: 0,
  can_edit_appointments: 0,
  can_record_doses: 0,
  can_manage_members: 0,
  invite_status: 'active',
  invite_token_hash: null,
  invite_expires_at: null,
  invited_by: 'user-1',
  accepted_at: null,
  revoked_at: null,
  last_active_at: null,
  notify_upcoming_doses: 1,
  notify_missed_doses: 1,
  notify_appointments: 1,
  quiet_hours_start: null,
  quiet_hours_end: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function memberFor(role: Role, overrides: Partial<MemberRow> = {}): MemberRow {
  return { ...BASE_MEMBER, role, ...overrides }
}

test('older adult keeps full access regardless of stored flags', async () => {
  const { capabilitiesFor } = await import('../src/permissions.js')
  const capabilities = capabilitiesFor(
    memberFor('older_adult', {
      can_edit_medications: 0,
      can_edit_appointments: 0,
      can_record_doses: 0,
      can_manage_members: 0,
    }),
  )
  assert.deepEqual(capabilities, {
    viewProfile: true,
    editMedications: true,
    editAppointments: true,
    recordDoses: true,
    manageMembers: true,
    viewAudit: true,
    viewReminders: true,
    exportData: true,
  })
})

test('family viewers are read-only even if notification flags are on', async () => {
  const { capabilitiesFor } = await import('../src/permissions.js')
  const capabilities = capabilitiesFor(memberFor('family'))
  assert.equal(capabilities.viewProfile, true)
  assert.equal(capabilities.editMedications, false)
  assert.equal(capabilities.editAppointments, false)
  assert.equal(capabilities.recordDoses, false)
  assert.equal(capabilities.manageMembers, false)
  assert.equal(capabilities.viewAudit, false)
  assert.equal(capabilities.viewReminders, false)
  assert.equal(capabilities.exportData, false)
})

test('care-team administrators manage membership and export but not clinical data', async () => {
  const { capabilitiesFor } = await import('../src/permissions.js')
  const capabilities = capabilitiesFor(memberFor('admin', { can_manage_members: 1 }))
  assert.equal(capabilities.manageMembers, true)
  assert.equal(capabilities.exportData, true)
  assert.equal(capabilities.viewAudit, true)
  assert.equal(capabilities.editMedications, false)
  assert.equal(capabilities.editAppointments, false)
  assert.equal(capabilities.recordDoses, false)
})

test('explicit caregiver grants are additive to the default role', async () => {
  const { capabilitiesFor } = await import('../src/permissions.js')
  const base = capabilitiesFor(memberFor('caregiver', { can_record_doses: 1 }))
  assert.equal(base.recordDoses, true)
  assert.equal(base.editMedications, false)

  const granted = capabilitiesFor(
    memberFor('caregiver', {
      can_edit_medications: 1,
      can_edit_appointments: 1,
      can_record_doses: 1,
    }),
  )
  assert.equal(granted.recordDoses, true)
  assert.equal(granted.editMedications, true)
  assert.equal(granted.editAppointments, true)
  assert.equal(granted.manageMembers, false)
})

test('default permissions mirror the documented role boundaries', async () => {
  const { defaultPermissions } = await import('../src/permissions.js')
  assert.deepEqual(defaultPermissions('family'), {
    can_edit_medications: 0,
    can_edit_appointments: 0,
    can_record_doses: 0,
    can_manage_members: 0,
  })
  assert.deepEqual(defaultPermissions('caregiver'), {
    can_edit_medications: 0,
    can_edit_appointments: 0,
    can_record_doses: 1,
    can_manage_members: 0,
  })
  assert.equal(defaultPermissions('admin').can_manage_members, 1)
  assert.equal(defaultPermissions('admin').can_edit_medications, 0)
  assert.equal(defaultPermissions('older_adult').can_manage_members, 1)
})

test('requireProfileAccess enforces capabilities and ignores revoked members', async () => {
  const { run } = await import('../src/db.js')
  const { requireProfileAccess } = await import('../src/permissions.js')
  const { HttpError } = await import('../src/errors.js')
  const now = new Date().toISOString()

  run(
    `INSERT INTO users (id, email, display_name, password_hash, locale, pin_hash, created_at)
     VALUES ('perm-user', 'perm@example.test', 'Perm User', 'not-a-real-hash', 'en-GB', NULL, ?)`,
    now,
  )
  run(
    `INSERT INTO care_profiles
      (id, preferred_name, full_name, timezone, created_by, share_medications, share_appointments,
       missed_tracking, grace_minutes, dose_reminder_lead_minutes, appointment_reminder_lead_minutes, created_at)
     VALUES ('perm-profile', 'Perm', 'Perm Person', 'Europe/London', 'perm-user', 1, 1, 1, 120, 15, 1440, ?)`,
    now,
  )
  run(
    `INSERT INTO care_team_members
      (id, profile_id, user_id, invited_email, role, can_edit_medications, can_edit_appointments,
       can_record_doses, can_manage_members, invite_status, invited_by, created_at, updated_at)
     VALUES ('perm-member', 'perm-profile', 'perm-user', 'perm@example.test', 'family', 0, 0, 0, 0,
             'active', 'perm-user', ?, ?)`,
    now,
    now,
  )

  const user = {
    id: 'perm-user',
    email: 'perm@example.test',
    display_name: 'Perm User',
    password_hash: 'not-a-real-hash',
    locale: 'en-GB',
    pin_hash: null,
    created_at: now,
  }

  const allowed = requireProfileAccess(user, 'perm-profile')
  assert.equal(allowed.capabilities.viewProfile, true)
  assert.equal(allowed.profile.preferred_name, 'Perm')

  assert.throws(
    () => requireProfileAccess(user, 'perm-profile', 'editMedications'),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  )

  run(
    "UPDATE care_team_members SET invite_status = 'revoked', revoked_at = ? WHERE id = 'perm-member'",
    now,
  )
  assert.throws(
    () => requireProfileAccess(user, 'perm-profile'),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  )
})
