import './helpers.js'
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import type { TestServer } from './helpers.js'
import { createTestClient, medicationPayload, registerAccount, startTestServer } from './helpers.js'

interface SessionPayload {
  user: { id: string; email: string; displayName: string }
  profiles: Array<{ profileId: string; role: string }>
}

interface MemberSummary {
  id: string
  email: string
  role: string
  inviteStatus: string
  capabilities: { recordDoses: boolean; editMedications: boolean }
}

interface DoseSummary {
  id: string
  medicationId: string
  status: string
}

interface TodayPayload {
  date: string
  doses: DoseSummary[]
  capabilities: { recordDoses: boolean }
}

let server: TestServer

before(async () => {
  server = await startTestServer()
})

after(async () => {
  await server?.close()
})

test('registration creates an owned care profile and a working session', async () => {
  const owner = await registerAccount(server.url, { displayName: 'Ada Owner' })
  assert.equal(owner.session.profiles.length, 1)
  assert.equal(owner.session.profiles[0].role, 'older_adult')

  const me = await owner.client.get<SessionPayload>('/api/auth/me')
  assert.equal(me.status, 200)
  assert.equal(me.body.user.email, owner.email)

  const anonymous = createTestClient(server.url)
  const blocked = await anonymous.get(`/api/profiles/${owner.profileId}`)
  assert.equal(blocked.status, 401)

  const wrongPassword = await anonymous.post('/api/auth/login', {
    email: owner.email,
    password: 'definitely-not-the-password',
  })
  assert.equal(wrongPassword.status, 401)

  const login = await anonymous.post<SessionPayload>('/api/auth/login', {
    email: owner.email,
    password: owner.password,
  })
  assert.equal(login.status, 200)
  assert.equal(login.body.profiles[0].profileId, owner.profileId)
})

test('family viewers stay read-only, sharing can be withdrawn, and revocation removes access', async () => {
  const owner = await registerAccount(server.url, { displayName: 'Grace Owner' })
  const viewerEmail = `viewer-${Date.now()}@carenest.test`

  const invite = await owner.client.post<{ inviteUrl: string }>(
    `/api/profiles/${owner.profileId}/members/invite`,
    { email: viewerEmail, role: 'family' },
  )
  assert.equal(invite.status, 201)
  const token = invite.body.inviteUrl.split('/invite/')[1]
  assert.ok(token, 'invitation URL should contain a token')
  assert.equal(owner.client.cookies.size > 0, true)

  // Registering with the invited email accepts the pending invitation.
  const viewer = await registerAccount(server.url, {
    displayName: 'Victor Viewer',
    email: viewerEmail,
  })
  const sharedProfileIds = viewer.session.profiles.map((entry) => entry.profileId)
  assert.ok(sharedProfileIds.includes(owner.profileId))

  const viewerProfile = await viewer.client.get<{
    membership: { role: string }
    capabilities: { recordDoses: boolean; editMedications: boolean }
  }>(`/api/profiles/${owner.profileId}`)
  assert.equal(viewerProfile.status, 200)
  assert.equal(viewerProfile.body.membership.role, 'family')
  assert.equal(viewerProfile.body.capabilities.recordDoses, false)
  assert.equal(viewerProfile.body.capabilities.editMedications, false)

  const viewerCreate = await viewer.client.post(`/api/profiles/${owner.profileId}/medications`, {
    ...medicationPayload({ name: 'Viewer Medicine' }),
  })
  assert.equal(viewerCreate.status, 403)

  const medication = await owner.client.post<{ medication: { id: string } }>(
    `/api/profiles/${owner.profileId}/medications`,
    medicationPayload({ name: 'Owner Medicine', localTimes: ['09:00'] }),
  )
  assert.equal(medication.status, 201)

  const viewerRead = await viewer.client.get(`/api/profiles/${owner.profileId}/medications`)
  assert.equal(viewerRead.status, 200)

  const today = await viewer.client.get<TodayPayload>(`/api/profiles/${owner.profileId}/today`)
  assert.equal(today.status, 200)
  const sharedDose = today.body.doses.find(
    (dose) => dose.medicationId === medication.body.medication.id,
  )
  assert.ok(sharedDose, 'the shared medicine should have a dose for today')

  const viewerRecord = await viewer.client.post(
    `/api/profiles/${owner.profileId}/doses/${sharedDose.id}/record`,
    { action: 'taken' },
  )
  assert.equal(viewerRecord.status, 403)

  const shareOff = await owner.client.patch(`/api/profiles/${owner.profileId}`, {
    shareMedications: false,
  })
  assert.equal(shareOff.status, 200)
  const viewerReadBlocked = await viewer.client.get(`/api/profiles/${owner.profileId}/medications`)
  assert.equal(viewerReadBlocked.status, 403)
  await owner.client.patch(`/api/profiles/${owner.profileId}`, { shareMedications: true })

  const familyAppointment = await viewer.client.post(
    `/api/profiles/${owner.profileId}/appointments`,
    {
      title: 'Family Booked',
      provider: 'Should Not Work',
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  )
  assert.equal(familyAppointment.status, 403)
  const ownerAppointment = await owner.client.post(
    `/api/profiles/${owner.profileId}/appointments`,
    {
      title: 'Medication review',
      provider: 'Fictional Clinic',
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      reminderLeadMinutes: 1440,
    },
  )
  assert.equal(ownerAppointment.status, 201)
  const viewerAppointments = await viewer.client.get(
    `/api/profiles/${owner.profileId}/appointments`,
  )
  assert.equal(viewerAppointments.status, 200)

  const members = await owner.client.get<{ members: MemberSummary[] }>(
    `/api/profiles/${owner.profileId}/members`,
  )
  assert.equal(members.status, 200)
  const viewerMember = members.body.members.find(
    (member) => member.email.toLowerCase() === viewerEmail.toLowerCase(),
  )
  assert.ok(viewerMember)
  assert.equal(viewerMember.inviteStatus, 'active')
  assert.equal(viewerMember.capabilities.recordDoses, false)

  const revoked = await owner.client.post(
    `/api/profiles/${owner.profileId}/members/${viewerMember.id}/revoke`,
    {},
  )
  assert.equal(revoked.status, 200)

  const afterRevoke = await viewer.client.get(`/api/profiles/${owner.profileId}`)
  assert.equal(afterRevoke.status, 404)
  const memberListAfter = await owner.client.get<{ members: MemberSummary[] }>(
    `/api/profiles/${owner.profileId}/members`,
  )
  assert.equal(
    memberListAfter.body.members.find((member) => member.id === viewerMember.id)?.inviteStatus,
    'revoked',
  )
})

test('invitations cannot be accepted by the wrong signed-in account', async () => {
  const owner = await registerAccount(server.url, { displayName: 'Hana Owner' })
  const outsiderEmail = `outsider-${Date.now()}@carenest.test`
  const outsider = await registerAccount(server.url, {
    displayName: 'Otto Outsider',
    email: outsiderEmail,
  })
  const invite = await owner.client.post<{ inviteUrl: string }>(
    `/api/profiles/${owner.profileId}/members/invite`,
    { email: `someone-else-${Date.now()}@carenest.test`, role: 'family' },
  )
  assert.equal(invite.status, 201)
  const token = invite.body.inviteUrl.split('/invite/')[1]

  const preview = await outsider.client.get<{ status: string; emailMatches: boolean }>(
    `/api/invites/${token}`,
  )
  assert.equal(preview.status, 200)
  assert.equal(preview.body.emailMatches, false)

  const wrongAccount = await outsider.client.post(`/api/invites/${token}/accept`, {})
  assert.equal(wrongAccount.status, 403)
  assert.match(JSON.stringify(wrongAccount.body), /sent to/i)
})

test('dose recording is idempotent, conflicts are explicit, and corrections are audited', async () => {
  const owner = await registerAccount(server.url, { displayName: 'Iris Owner' })
  const medication = await owner.client.post<{ medication: { id: string } }>(
    `/api/profiles/${owner.profileId}/medications`,
    medicationPayload({ name: 'Idempotent Medicine', localTimes: ['09:00'] }),
  )
  assert.equal(medication.status, 201)

  const today = await owner.client.get<TodayPayload>(`/api/profiles/${owner.profileId}/today`)
  const dose = today.body.doses.find(
    (entry) => entry.medicationId === medication.body.medication.id,
  )
  assert.ok(dose, 'expected a dose for the new medicine today')

  const first = await owner.client.post<{ alreadyApplied: boolean; dose: DoseSummary }>(
    `/api/profiles/${owner.profileId}/doses/${dose.id}/record`,
    { action: 'taken' },
  )
  assert.equal(first.status, 200)
  assert.equal(first.body.alreadyApplied, false)
  assert.equal(first.body.dose.status, 'taken')

  const doubleTap = await owner.client.post<{ alreadyApplied: boolean; dose: DoseSummary }>(
    `/api/profiles/${owner.profileId}/doses/${dose.id}/record`,
    { action: 'taken' },
  )
  assert.equal(doubleTap.status, 200)
  assert.equal(doubleTap.body.alreadyApplied, true)
  assert.equal(doubleTap.body.dose.status, 'taken')

  const conflicting = await owner.client.post(
    `/api/profiles/${owner.profileId}/doses/${dose.id}/record`,
    { action: 'skipped' },
  )
  assert.equal(conflicting.status, 409)

  const correction = await owner.client.post<{ changed: boolean; dose: DoseSummary }>(
    `/api/profiles/${owner.profileId}/doses/${dose.id}/correct`,
    { status: 'skipped', reason: 'Tablet was returned to the pharmacy pack.' },
  )
  assert.equal(correction.status, 200)
  assert.equal(correction.body.changed, true)
  assert.equal(correction.body.dose.status, 'skipped')

  const audit = await owner.client.get<{ events: Array<{ action: string; summary: string }> }>(
    `/api/profiles/${owner.profileId}/audit`,
  )
  assert.equal(audit.status, 200)
  const corrected = audit.body.events.find((event) => event.action === 'dose.corrected')
  assert.ok(corrected, 'correction should be audited')
  assert.match(corrected.summary, /Reason: Tablet was returned/i)
})

test('invalid clinical input is rejected without creating a medicine', async () => {
  const owner = await registerAccount(server.url, { displayName: 'Jon Owner' })
  const payload = medicationPayload({ name: 'Unverified Medicine' })
  const unverified = await owner.client.post(`/api/profiles/${owner.profileId}/medications`, {
    ...payload,
    verified: false,
  })
  assert.equal(unverified.status, 400)

  const badTime = await owner.client.post(`/api/profiles/${owner.profileId}/medications`, {
    ...medicationPayload({ name: 'Bad Time Medicine' }),
    schedule: {
      localTimes: ['25:00'],
      recurrence: 'daily',
      weekdays: [],
      activeTo: null,
      pausedFrom: null,
      pausedUntil: null,
    },
  })
  assert.equal(badTime.status, 400)

  const list = await owner.client.get<{ medications: unknown[] }>(
    `/api/profiles/${owner.profileId}/medications`,
  )
  assert.equal(list.status, 200)
  assert.equal(list.body.medications.length, 0)
})
