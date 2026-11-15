export interface User {
  id: string
  displayName: string
  email: string
  locale: string
  pinEnabled: boolean
  createdAt: string
}

export type Role = 'older_adult' | 'caregiver' | 'family' | 'admin'

export interface ProfileSummary {
  memberId: string
  role: Role
  profileId: string
  preferredName: string
  timezone: string
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

export interface Membership {
  id: string
  email: string
  role: Role
  roleLabel: string
  inviteStatus: 'pending' | 'active' | 'revoked' | 'expired'
  capabilities: Capabilities
  permissions: {
    editMedications: boolean
    editAppointments: boolean
    recordDoses: boolean
    manageMembers: boolean
  }
  notifications: {
    upcomingDoses: boolean
    missedDoses: boolean
    appointments: boolean
  }
  quietHours: { start: string | null; end: string | null }
  isOwner: boolean
  acceptedAt: string | null
  revokedAt: string | null
  invitedAt: string
  lastActiveAt: string | null
  inviteExpiresAt: string | null
}

export interface CareProfile {
  id: string
  preferredName: string
  fullName: string | null
  timezone: string
  dateOfBirth: string | null
  shareMedications: boolean
  shareAppointments: boolean
  missedTracking: boolean
  graceMinutes: number
  doseReminderLeadMinutes: number
  appointmentReminderLeadMinutes: number
  createdAt: string
}

export type Recurrence = 'daily' | 'weekly' | 'as_needed'

export interface MedicationSchedule {
  id: string
  localTimes: string[]
  recurrence: Recurrence
  weekdays: number[]
  timezone: string
  activeFrom: string
  activeTo: string | null
  pausedFrom: string | null
  pausedUntil: string | null
}

export interface Medication {
  id: string
  profileId: string
  name: string
  strength: string | null
  form: string | null
  prescribedInstructions: string
  sourceNote: string | null
  startDate: string
  endDate: string | null
  status: 'active' | 'paused' | 'completed'
  createdBy: string
  updatedBy: string
  createdByName: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
  schedule: MedicationSchedule | null
}

export type DoseStatus =
  | 'upcoming'
  | 'due'
  | 'snoozed'
  | 'taken'
  | 'skipped'
  | 'missed'
  | 'not_recorded'

export interface Dose {
  id: string
  medicationId: string
  medicationName: string
  strength: string | null
  form: string | null
  prescribedInstructions: string
  scheduledFor: string
  localDate: string
  status: DoseStatus
  storedStatus: 'pending' | 'taken' | 'skipped' | 'missed'
  recordedAt: string | null
  recordedBy: string | null
  recordedByName: string | null
  note: string | null
  snoozedUntil: string | null
  missedAt: string | null
  correctionOf: string | null
  graceMinutes: number
}

export interface Appointment {
  id: string
  profileId: string
  title: string
  provider: string
  location: string | null
  videoLink: string | null
  notes: string | null
  startAt: string
  timezone: string
  durationMinutes: number
  status: 'upcoming' | 'completed' | 'cancelled'
  displayStatus: 'upcoming' | 'past' | 'completed' | 'cancelled'
  reminderLeadMinutes: number
  createdAt: string
  updatedAt: string
}

export interface ActivityEvent {
  id: string
  actorLabel: string
  action: string
  summary: string
  createdAt: string
}

export interface TodayResponse {
  date: string
  today: string
  timezone: string
  profile: CareProfile
  membership: Membership
  capabilities: Capabilities
  doses: Dose[]
  counts: Record<DoseStatus, number>
  nextDose: Dose | null
  appointments: { today: Appointment[]; next: Appointment | null }
  activity: ActivityEvent[]
}

export interface Reminder {
  id: string
  event_key: string
  profile_id: string
  recipient_email: string
  reminder_type: 'upcoming_dose' | 'missed_dose' | 'appointment' | 'test'
  subject: string
  body: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  attempt_count: number
  last_error: string | null
  scheduled_for: string
  sent_at: string | null
  created_at: string
}

export interface AuditEvent {
  id: string
  actorId: string | null
  actorLabel: string
  action: string
  entity: string
  entityId: string | null
  summary: string
  createdAt: string
}

export interface AdherenceReport {
  from: string
  to: string
  timezone: string
  generatedAt: string
  counts: {
    scheduled: number
    taken: number
    skipped: number
    missed: number
    notRecorded: number
    upcoming: number
  }
  denominator: number
  takenRate: number | null
  noMissesRate: number | null
  definitions: Record<string, string>
  byMedication: Array<{
    medicationId: string
    name: string
    strength: string | null
    counts: Record<DoseStatus, number>
  }>
  daily: Array<{ date: string } & Record<DoseStatus, number>>
}

export interface Handover {
  generatedAt: string
  timezone: string
  forDate: string
  lastRecorded: Dose[]
  outstanding: Dose[]
  nextAppointment: Appointment | null
  recentChanges: Array<{ id: string; actorLabel: string; summary: string; createdAt: string }>
  note: string
}
