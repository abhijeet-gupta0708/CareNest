import { all, one } from './db.js'
import { notFound } from './errors.js'

export interface AppointmentRow {
  id: string
  profile_id: string
  title: string
  provider: string
  location: string | null
  video_link: string | null
  notes: string | null
  start_at: string
  timezone: string
  duration_minutes: number
  status: 'upcoming' | 'completed' | 'cancelled'
  reminder_lead_minutes: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export function serializeAppointment(row: AppointmentRow) {
  const past = row.status === 'upcoming' && new Date(row.start_at).getTime() < Date.now()
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    provider: row.provider,
    location: row.location,
    videoLink: row.video_link,
    notes: row.notes,
    startAt: row.start_at,
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    status: row.status,
    displayStatus: past ? 'past' : row.status,
    reminderLeadMinutes: row.reminder_lead_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listAppointments(
  profileId: string,
  options: { from?: string; to?: string; view?: 'upcoming' | 'past' | 'all' } = {},
) {
  const now = new Date().toISOString()
  const clauses = ['profile_id = ?']
  const params: (string | number)[] = [profileId]
  if (options.from) {
    clauses.push('start_at >= ?')
    params.push(options.from)
  }
  if (options.to) {
    clauses.push('start_at <= ?')
    params.push(options.to)
  }
  if (options.view === 'upcoming') {
    clauses.push("status = 'upcoming' AND start_at >= ?")
    params.push(now)
  } else if (options.view === 'past') {
    clauses.push("(status != 'upcoming' OR start_at < ?)")
    params.push(now)
  }
  const rows = all<AppointmentRow>(
    `SELECT * FROM appointments WHERE ${clauses.join(' AND ')} ORDER BY start_at ${
      options.view === 'past' ? 'DESC' : 'ASC'
    }`,
    ...params,
  )
  return rows.map(serializeAppointment)
}

export function getAppointment(profileId: string, appointmentId: string) {
  const row = one<AppointmentRow>(
    'SELECT * FROM appointments WHERE id = ? AND profile_id = ?',
    appointmentId,
    profileId,
  )
  if (!row) throw notFound('That appointment could not be found.')
  return row
}
