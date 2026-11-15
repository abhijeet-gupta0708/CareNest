import { createHash } from 'node:crypto'
import { db, newId, one, run, transaction } from './db.js'
import { hashSecret } from './auth.js'
import { recordAudit } from './audit.js'
import { occurrencesBetween, localDateString, startOfLocalDayUtc, addDaysToDateString } from './time.js'

const DEMO_PASSWORD = 'CareNest#2026'

const DEMO_USERS = [
  { key: 'margaret', name: 'Margaret Ellis', email: 'margaret@carenest.example', role: 'older_adult' },
  { key: 'daniel', name: 'Daniel Ellis', email: 'daniel@carenest.example', role: 'caregiver' },
  { key: 'sara', name: 'Sara Ellis', email: 'sara@carenest.example', role: 'family' },
  { key: 'priya', name: 'Priya Shah', email: 'priya@carenest.example', role: 'admin' },
] as const

const TABLES = [
  'email_delivery_log',
  'reminder_events',
  'audit_events',
  'dose_events',
  'medication_schedules',
  'medications',
  'appointments',
  'care_team_members',
  'care_profiles',
  'sessions',
  'users',
]

function resetDatabase() {
  for (const table of TABLES) {
    run(`DELETE FROM ${table}`)
  }
}

interface SeedMedication {
  name: string
  strength: string
  form: string
  instructions: string
  sourceNote: string
  times: string[]
  recurrence: 'daily' | 'weekly' | 'as_needed'
  weekdays: number[]
  daysAgo: number
  status: 'active' | 'paused' | 'completed'
  statusReason?: string
}

const MEDICATIONS: SeedMedication[] = [
  {
    name: 'Cardizen',
    strength: '5 mg',
    form: 'Tablet',
    instructions: 'Take ONE tablet by mouth each morning.',
    sourceNote: 'Entered from the fictional demo prescription issued by Riverside GP Surgery.',
    times: ['08:00'],
    recurrence: 'daily',
    weekdays: [],
    daysAgo: 24,
    status: 'active',
  },
  {
    name: 'Metfora',
    strength: '500 mg',
    form: 'Tablet',
    instructions: 'Take ONE tablet by mouth twice daily with food.',
    sourceNote: 'Entered from the fictional demo prescription issued by Riverside GP Surgery.',
    times: ['08:00', '20:00'],
    recurrence: 'daily',
    weekdays: [],
    daysAgo: 24,
    status: 'active',
  },
  {
    name: 'Warfex',
    strength: '2 mg',
    form: 'Tablet',
    instructions: 'Take ONE tablet by mouth on Monday, Wednesday and Friday evenings.',
    sourceNote: 'Dose and days copied from the fictional demo anticoagulation card.',
    times: ['18:30'],
    recurrence: 'weekly',
    weekdays: [1, 3, 5],
    daysAgo: 60,
    status: 'active',
  },
  {
    name: 'Soothelief',
    strength: '200 mg',
    form: 'Capsule',
    instructions: 'Take ONE capsule by mouth when needed for joint pain. Do not exceed the label.',
    sourceNote: 'As-needed instruction copied from the fictional demo pharmacy label.',
    times: [],
    recurrence: 'as_needed',
    weekdays: [],
    daysAgo: 40,
    status: 'active',
  },
  {
    name: 'Ferroline',
    strength: '200 mg',
    form: 'Tablet',
    instructions: 'Take ONE tablet by mouth each morning.',
    sourceNote: 'From the fictional demo prescription. Paused while awaiting a blood test review.',
    times: ['09:00'],
    recurrence: 'daily',
    weekdays: [],
    daysAgo: 90,
    status: 'paused',
    statusReason: 'Paused while awaiting a blood test review, as recorded in the demo notes.',
  },
]

export function seedDemoData(options: { reset?: boolean } = {}) {
  const existing = one<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0
  if (existing > 0 && !options.reset) {
    return { seeded: false, reason: 'database already has users' }
  }

  transaction(() => {
    if (options.reset) resetDatabase()

    const now = new Date()
    const nowText = now.toISOString()
    const userIds = new Map<string, string>()
    const timezone = 'Europe/London'

    for (const demo of DEMO_USERS) {
      const id = newId()
      userIds.set(demo.key, id)
      run(
        `INSERT INTO users (id, email, display_name, password_hash, locale, pin_hash, created_at)
         VALUES (?, ?, ?, ?, 'en-GB', NULL, ?)`,
        id,
        demo.email,
        demo.name,
        hashSecret(DEMO_PASSWORD),
        nowText,
      )
    }

    const margaretId = userIds.get('margaret')!
    const danielId = userIds.get('daniel')!
    const saraId = userIds.get('sara')!
    const priyaId = userIds.get('priya')!

    const profileId = newId()
    run(
      `INSERT INTO care_profiles
        (id, preferred_name, full_name, timezone, created_by, share_medications, share_appointments,
         missed_tracking, grace_minutes, dose_reminder_lead_minutes, appointment_reminder_lead_minutes, created_at)
       VALUES (?, 'Margaret', 'Margaret Ellis', ?, ?, 1, 1, 1, 120, 15, 1440, ?)`,
      profileId,
      timezone,
      margaretId,
      nowText,
    )

    // Margaret owns her profile; Daniel is an explicitly authorised caregiver;
    // Sara is read-only; Priya manages membership but cannot edit clinical data.
    const members = [
      {
        userId: margaretId,
        email: 'margaret@carenest.example',
        role: 'older_adult',
        notify: [1, 1, 1],
        editMed: 1,
        editAppt: 1,
        record: 1,
        manage: 1,
        status: 'active',
      },
      {
        userId: danielId,
        email: 'daniel@carenest.example',
        role: 'caregiver',
        notify: [1, 1, 1],
        editMed: 1,
        editAppt: 1,
        record: 1,
        manage: 0,
        status: 'active',
      },
      {
        userId: saraId,
        email: 'sara@carenest.example',
        role: 'family',
        notify: [0, 0, 1],
        editMed: 0,
        editAppt: 0,
        record: 0,
        manage: 0,
        status: 'active',
      },
      {
        userId: priyaId,
        email: 'priya@carenest.example',
        role: 'admin',
        notify: [0, 0, 1],
        editMed: 0,
        editAppt: 0,
        record: 0,
        manage: 1,
        status: 'active',
      },
    ]

    for (const member of members) {
      const memberId = newId()
      run(
        `INSERT INTO care_team_members
          (id, profile_id, user_id, invited_email, role, can_edit_medications, can_edit_appointments,
           can_record_doses, can_manage_members, invite_status, invited_by, accepted_at,
           notify_upcoming_doses, notify_missed_doses, notify_appointments,
           quiet_hours_start, quiet_hours_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        memberId,
        profileId,
        member.userId,
        member.email,
        member.role,
        member.editMed,
        member.editAppt,
        member.record,
        member.manage,
        member.status,
        margaretId,
        nowText,
        member.notify[0],
        member.notify[1],
        member.notify[2],
        member.role === 'older_adult' ? '21:30' : null,
        member.role === 'older_adult' ? '07:00' : null,
        nowText,
        nowText,
      )
    }

    // A pending invitation so the invitation flow can be demonstrated safely.
    const demoInviteToken = 'demo-tom-invite-token'
    run(
      `INSERT INTO care_team_members
        (id, profile_id, user_id, invited_email, role, can_edit_medications, can_edit_appointments,
         can_record_doses, can_manage_members, invite_status, invite_token_hash, invite_expires_at,
         invited_by, created_at, updated_at)
       VALUES (?, ?, NULL, 'tom@carenest.example', 'caregiver', 0, 0, 1, 0, 'pending', ?, ?, ?, ?, ?)`,
      newId(),
      profileId,
      createHash('sha256').update(demoInviteToken).digest('hex'),
      new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      margaretId,
      nowText,
      nowText,
    )

    const medicationIds = new Map<string, { id: string; scheduleId: string }>()

    for (const medication of MEDICATIONS) {
      const medicationId = newId()
      const scheduleId = newId()
      const startDate = addDaysToDateString(localDateString(now, timezone), -medication.daysAgo)
      run(
        `INSERT INTO medications
          (id, profile_id, name, strength, form, prescribed_instructions, source_note, start_date, end_date,
           status, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        medicationId,
        profileId,
        medication.name,
        medication.strength,
        medication.form,
        medication.instructions,
        medication.sourceNote,
        startDate,
        medication.status,
        danielId,
        danielId,
        nowText,
        nowText,
      )
      run(
        `INSERT INTO medication_schedules
          (id, medication_id, local_times, recurrence, weekdays, timezone, active_from, active_to,
           paused_from, paused_until, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
        scheduleId,
        medicationId,
        JSON.stringify(medication.times),
        medication.recurrence,
        JSON.stringify(medication.weekdays),
        timezone,
        startDate,
        nowText,
      )
      medicationIds.set(medication.name, { id: medicationId, scheduleId })
      recordAudit({
        profileId,
        actorId: danielId,
        actorLabel: 'Daniel Ellis',
        action: 'medication.created',
        entity: 'medication',
        entityId: medicationId,
        summary: `Added ${medication.name} ${medication.strength} from supplied instructions.`,
      })
      if (medication.statusReason) {
        recordAudit({
          profileId,
          actorId: danielId,
          actorLabel: 'Daniel Ellis',
          action: 'medication.paused',
          entity: 'medication',
          entityId: medicationId,
          summary: `${medication.name} paused. ${medication.statusReason}`,
        })
      }
    }

    // Build a believable dose history for the last three weeks.
    const historyStart = addDaysToDateString(localDateString(now, timezone), -21)
    const rangeStart = startOfLocalDayUtc(historyStart, timezone)
    let index = 0
    for (const medication of MEDICATIONS) {
      if (medication.recurrence === 'as_needed' || medication.status !== 'active') continue
      const entry = medicationIds.get(medication.name)!
      const occurrences = occurrencesBetween(
        {
          localTimes: medication.times,
          recurrence: medication.recurrence,
          weekdays: medication.weekdays,
          timezone,
          activeFrom: addDaysToDateString(localStringToday(now), -medication.daysAgo),
          activeTo: null,
        },
        rangeStart,
        now,
      )
      for (const occurrence of occurrences) {
        index += 1
        // Leave a deliberate historical gap nine days ago to show "not recorded".
        if (medication.name === 'Cardizen' && occurrenceIndexDaysAgo(occurrence, now) === 9) continue
        const isEvening = new Date(occurrence).getUTCHours() >= 18
        let status: 'taken' | 'skipped' | 'missed' | 'pending' = 'taken'
        if (medication.name === 'Cardizen' && index % 17 === 5) status = 'missed'
        else if (medication.name === 'Metfora' && index % 19 === 7) status = 'missed'
        else if (index % 23 === 9) status = 'skipped'
        // Keep the most recent evening dose open so the Today view has an action.
        if (isEvening && occurrenceIndexDaysAgo(occurrence, now) === 0) status = 'pending'
        const recordedBy = isEvening ? danielId : margaretId
        const recordedAt =
          status === 'pending'
            ? null
            : new Date(new Date(occurrence).getTime() + 11 * 60 * 1000).toISOString()
        run(
          `INSERT OR IGNORE INTO dose_events
            (id, profile_id, medication_id, schedule_id, scheduled_for, local_date, status,
             recorded_at, recorded_by, note, snoozed_until, missed_at, correction_of, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
          newId(),
          profileId,
          entry.id,
          entry.scheduleId,
          new Date(occurrence).toISOString(),
          localDateString(new Date(occurrence), timezone),
          status,
          recordedAt,
          status === 'pending' ? null : recordedBy,
          status === 'missed' ? new Date(new Date(occurrence).getTime() + 2 * 60 * 60 * 1000).toISOString() : null,
          nowText,
          nowText,
        )
      }
    }

    const appointments = [
      {
        title: 'Medication review',
        provider: 'Riverside GP Surgery',
        location: 'Riverside Surgery, Room 3',
        notes: 'Bring the current prescription list. Daniel is driving.',
        daysFromNow: 1,
        hour: 10,
        minute: 30,
        status: 'upcoming',
        lead: 1440,
      },
      {
        title: 'Podiatry appointment',
        provider: 'Community Foot Clinic',
        location: 'Elm Community Centre',
        notes: 'Ask about the new insoles.',
        daysFromNow: 6,
        hour: 14,
        minute: 0,
        status: 'upcoming',
        lead: 1440,
      },
      {
        title: 'Pharmacist check-in',
        provider: 'Green Lane Pharmacy',
        location: null,
        notes: 'Video call. The link is in the appointment notes.',
        daysFromNow: 20,
        hour: 11,
        minute: 0,
        status: 'upcoming',
        lead: 2880,
      },
      {
        title: 'Blood pressure check',
        provider: 'Riverside GP Surgery',
        location: 'Riverside Surgery',
        notes: 'Completed at the desk.',
        daysFromNow: -12,
        hour: 9,
        minute: 15,
        status: 'completed',
        lead: 1440,
      },
      {
        title: 'Hospital transport',
        provider: 'County Transport Service',
        location: 'Pick-up from home',
        notes: 'Cancelled by the transport service and rearranged.',
        daysFromNow: -26,
        hour: 8,
        minute: 0,
        status: 'cancelled',
        lead: 1440,
      },
    ]

    for (const appointment of appointments) {
      const day = addDaysToDateString(localStringToday(now), appointment.daysFromNow)
      const [year, month, date] = day.split('-').map(Number)
      const start = new Date(Date.UTC(year, month - 1, date, appointment.hour, appointment.minute))
      // Seed times are written as UTC for simplicity and displayed in the profile zone.
      const id = newId()
      run(
        `INSERT INTO appointments
          (id, profile_id, title, provider, location, video_link, notes, start_at, timezone,
           duration_minutes, status, reminder_lead_minutes, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 30, ?, ?, ?, ?, ?, ?)`,
        id,
        profileId,
        appointment.title,
        appointment.provider,
        appointment.location,
        appointment.notes,
        start.toISOString(),
        timezone,
        appointment.status,
        appointment.lead,
        danielId,
        danielId,
        nowText,
        nowText,
      )
      recordAudit({
        profileId,
        actorId: danielId,
        actorLabel: 'Daniel Ellis',
        action: 'appointment.created',
        entity: 'appointment',
        entityId: id,
        summary: `Added appointment “${appointment.title}” with ${appointment.provider}.`,
      })
    }

    recordAudit({
      profileId,
      actorId: margaretId,
      actorLabel: 'Margaret Ellis',
      action: 'profile.created',
      entity: 'care_profile',
      entityId: profileId,
      summary: 'Created the care profile and invited the care circle.',
    })
    recordAudit({
      profileId,
      actorId: margaretId,
      actorLabel: 'Margaret Ellis',
      action: 'member.invited',
      entity: 'care_team_member',
      entityId: null,
      summary: 'Invited Daniel Ellis as Primary caregiver with medication editing authorised.',
    })

    run(
      `INSERT INTO email_delivery_log (id, reminder_id, profile_id, to_email, subject, body, mode, ok, error, created_at)
       VALUES (?, NULL, ?, 'tom@carenest.example', 'You have been invited to a CareNest care circle', ?, 'test', 1, NULL, ?)`,
      newId(),
      profileId,
      `Tom, you have been invited to help coordinate care for Margaret in CareNest.\n\nAccept: http://localhost:5173/invite/${demoInviteToken}`,
      nowText,
    )
  })

  return { seeded: true }
}

function localStringToday(date: Date) {
  return localDateString(date, 'Europe/London')
}

function occurrenceIndexDaysAgo(occurrence: Date, now: Date) {
  const oneDay = 24 * 60 * 60 * 1000
  return Math.round(
    (startOfLocalDayUtc(localStringToday(now), 'Europe/London').getTime() -
      startOfLocalDayUtc(localDateString(occurrence, 'Europe/London'), 'Europe/London').getTime()) /
      oneDay,
  )
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('/seed.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('/seed.js')

if (isDirectRun) {
  const reset = process.argv.includes('--reset')
  const result = seedDemoData({ reset })
  if (!result.seeded) {
    console.log(`[seed] skipped: ${result.reason}`)
  } else {
    console.log('[seed] fictional demo data loaded')
    console.log(`[seed] sign in with margaret@carenest.example / ${DEMO_PASSWORD}`)
  }
  db.close()
}

export { DEMO_PASSWORD, DEMO_USERS }
