const timeFormatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string) {
  let formatter = timeFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    timeFormatters.set(timeZone, formatter)
  }
  return formatter
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone })
    return true
  } catch {
    return false
  }
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** Offset of the zone at the given instant, in milliseconds (local - UTC). */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Convert a wall-clock time in a specific IANA time zone to a UTC instant.
 * Uses an offset guess refined against the zone's real offset, which handles
 * daylight-saving transitions for ordinary (non-skipped) times.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = wall
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = zoneOffsetMs(new Date(instant), timeZone)
    const next = wall - offset
    if (next === instant) break
    instant = next
  }
  return new Date(instant)
}

export function localDateString(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone)
  return `${p.year.toString().padStart(4, '0')}-${p.month
    .toString()
    .padStart(2, '0')}-${p.day.toString().padStart(2, '0')}`
}

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function addDaysToDateString(dateString: string, days: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

export function dateRange(from: string, to: string): string[] {
  const dates: string[] = []
  let cursor = from
  let guard = 0
  while (cursor <= to && guard < 800) {
    dates.push(cursor)
    cursor = addDaysToDateString(cursor, 1)
    guard += 1
  }
  return dates
}

/** 0 = Sunday ... 6 = Saturday for a local date string. */
export function weekdayOfDateString(dateString: string): number {
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function parseLocalTime(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

export interface ScheduleLike {
  localTimes: string[]
  recurrence: 'daily' | 'weekly' | 'as_needed'
  weekdays: number[]
  timezone: string
  activeFrom: string
  activeTo: string | null
}

/**
 * All scheduled dose instants for a schedule between two UTC instants.
 * Iterates local calendar days so DST and timezone boundaries stay explicit.
 */
export function occurrencesBetween(
  schedule: ScheduleLike,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  if (schedule.recurrence === 'as_needed') return []
  const timezone = schedule.timezone
  const firstLocal = addDaysToDateString(localDateString(rangeStart, timezone), -1)
  const lastLocal = addDaysToDateString(localDateString(rangeEnd, timezone), 1)
  const results: Date[] = []
  for (const localDate of dateRange(firstLocal, lastLocal)) {
    if (localDate < schedule.activeFrom) continue
    if (schedule.activeTo && localDate > schedule.activeTo) continue
    if (schedule.recurrence === 'weekly') {
      const weekday = weekdayOfDateString(localDate)
      if (!schedule.weekdays.includes(weekday)) continue
    }
    const [y, m, d] = localDate.split('-').map(Number)
    for (const localTime of schedule.localTimes) {
      const parsed = parseLocalTime(localTime)
      if (!parsed) continue
      const instant = zonedWallTimeToUtc(y, m, d, parsed.hour, parsed.minute, timezone)
      if (instant >= rangeStart && instant <= rangeEnd) results.push(instant)
    }
  }
  return results.sort((a, b) => a.getTime() - b.getTime())
}

export function startOfLocalDayUtc(localDate: string, timezone: string): Date {
  const [y, m, d] = localDate.split('-').map(Number)
  return zonedWallTimeToUtc(y, m, d, 0, 0, timezone)
}

/** Local hour (0-23) for quiet-hours checks. */
export function localHour(date: Date, timezone: string): number {
  return partsInZone(date, timezone).hour
}

export function inQuietHours(
  date: Date,
  timezone: string,
  quietStart: string | null,
  quietEnd: string | null,
): boolean {
  if (!quietStart || !quietEnd) return false
  const start = parseLocalTime(quietStart)
  const end = parseLocalTime(quietEnd)
  if (!start || !end) return false
  const hour = localHour(date, timezone)
  const now = hour * 60 + partsInZone(date, timezone).minute
  const startMinutes = start.hour * 60 + start.minute
  const endMinutes = end.hour * 60 + end.minute
  if (startMinutes === endMinutes) return false
  if (startMinutes < endMinutes) return now >= startMinutes && now < endMinutes
  return now >= startMinutes || now < endMinutes
}
