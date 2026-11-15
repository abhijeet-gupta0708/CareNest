import type { DoseStatus, Medication, Recurrence } from './types'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let instance = formatters.get(key)
  if (!instance) {
    instance = new Intl.DateTimeFormat('en-GB', { timeZone, ...options })
    formatters.set(key, instance)
  }
  return instance
}

export const WEEKDAYS = [
  { value: 1, long: 'Monday', short: 'Mon', initial: 'M' },
  { value: 2, long: 'Tuesday', short: 'Tue', initial: 'T' },
  { value: 3, long: 'Wednesday', short: 'Wed', initial: 'W' },
  { value: 4, long: 'Thursday', short: 'Thu', initial: 'T' },
  { value: 5, long: 'Friday', short: 'Fri', initial: 'F' },
  { value: 6, long: 'Saturday', short: 'Sat', initial: 'S' },
  { value: 0, long: 'Sunday', short: 'Sun', initial: 'S' },
]

export function formatTime(iso: string, timeZone: string): string {
  return formatter(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  )
}

export function formatDateLong(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00Z`)
  return formatter('UTC', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

export function formatDateShort(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00Z`)
  return formatter('UTC', { day: 'numeric', month: 'short' }).format(date)
}

export function formatDateWithYear(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00Z`)
  return formatter('UTC', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function formatDateTime(iso: string, timeZone: string): string {
  return formatter(timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

export function formatMonthYear(year: number, month: number): string {
  return formatter('UTC', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month, 1, 12)),
  )
}

export function dateInZone(iso: string, timeZone: string): string {
  const parts = formatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const values: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return `${values.year}-${values.month}-${values.day}`
}

export function todayInZone(timeZone: string): string {
  return dateInZone(new Date().toISOString(), timeZone)
}

export function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function dayGreeting(timeZone: string): string {
  const hour = Number(
    formatter(timeZone, { hour: '2-digit', hourCycle: 'h23' }).format(new Date()),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function relativeDay(iso: string, timeZone: string, today: string): string {
  const date = dateInZone(iso, timeZone)
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return formatDateShort(date)
}

export function relativeTime(iso: string): string {
  const delta = new Date(iso).getTime() - Date.now()
  const minutes = Math.round(delta / 60000)
  const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  const days = Math.round(hours / 24)
  return relative.format(days, 'day')
}

export function timezoneLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    const name = parts.find((part) => part.type === 'timeZoneName')?.value
    return name ? `${timeZone} (${name})` : timeZone
  } catch {
    return timeZone
  }
}

export const TIMEZONES = [
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

export function scheduleSummary(
  schedule: { recurrence: Recurrence; localTimes: string[]; weekdays: number[] },
  options: { short?: boolean } = {},
): string {
  if (schedule.recurrence === 'as_needed') return 'Only when needed'
  const times = schedule.localTimes.join(' and ')
  if (schedule.recurrence === 'daily') {
    return options.short ? `Daily · ${times}` : `Every day at ${times}`
  }
  const days = schedule.weekdays
    .map((day) => WEEKDAYS.find((weekday) => weekday.value === day))
    .filter(Boolean)
    .sort((a, b) => ((a!.value === 0 ? 7 : a!.value) - (b!.value === 0 ? 7 : b!.value)))
    .map((day) => (options.short ? day!.short : day!.long))
    .join(', ')
  return `${days} at ${times}`
}

export function medicationScheduleLabel(medication: Medication): string {
  if (!medication.schedule) return 'No schedule recorded'
  const base = scheduleSummary(medication.schedule)
  if (medication.status === 'paused') return `${base} · paused`
  return base
}

const STATUS_LABELS: Record<DoseStatus, string> = {
  upcoming: 'Upcoming',
  due: 'Due now',
  snoozed: 'Snoozed',
  taken: 'Taken',
  skipped: 'Skipped',
  missed: 'Missed',
  not_recorded: 'Not recorded',
}

export function statusLabel(status: DoseStatus): string {
  return STATUS_LABELS[status]
}

export function statusTone(status: DoseStatus): 'success' | 'warn' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'taken':
      return 'success'
    case 'due':
    case 'upcoming':
      return 'warn'
    case 'snoozed':
      return 'info'
    case 'missed':
      return 'danger'
    case 'skipped':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function statusIcon(status: DoseStatus): string {
  switch (status) {
    case 'taken':
      return '✓'
    case 'skipped':
      return '–'
    case 'missed':
      return '!'
    case 'snoozed':
      return 'z'
    case 'due':
      return '•'
    default:
      return '○'
  }
}

export function reminderLeadLabel(minutes: number): string {
  if (minutes === 0) return 'At the time of the appointment'
  if (minutes < 60) return `${minutes} minutes before`
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60)
    return `${hours} hour${hours === 1 ? '' : 's'} before`
  }
  const days = Math.round(minutes / 1440)
  return `${days} day${days === 1 ? '' : 's'} before`
}

/** Convert a wall-clock date/time in a zone to a UTC ISO string. */
export function zonedToIso(dateString: string, timeString: string, timeZone: string): string {
  const [year, month, day] = dateString.split('-').map(Number)
  const [hour, minute] = timeString.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = wall
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter(timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant))
    const values: Record<string, string> = {}
    for (const part of parts) if (part.type !== 'literal') values[part.type] = part.value
    const offset =
      Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
      ) - instant
    const next = wall - offset
    if (next === instant) break
    instant = next
  }
  return new Date(instant).toISOString()
}

export function isoToZonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = formatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const values: Record<string, string> = {}
  for (const part of parts) if (part.type !== 'literal') values[part.type] = part.value
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  }
}

export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1))
  const startOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month, 1 - startOffset))
  const cells: string[] = []
  for (let index = 0; index < 42; index += 1) {
    const cell = new Date(start)
    cell.setUTCDate(start.getUTCDate() + index)
    cells.push(cell.toISOString().slice(0, 10))
  }
  return cells
}

export function percent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return `${Math.round(value * 100)}%`
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}
