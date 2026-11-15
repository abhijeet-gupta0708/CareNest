import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDaysToDateString,
  dateRange,
  inQuietHours,
  isValidDateString,
  isValidTimeZone,
  localDateString,
  occurrencesBetween,
  parseLocalTime,
  startOfLocalDayUtc,
  weekdayOfDateString,
  zonedWallTimeToUtc,
} from '../src/time.js'

test('zonedWallTimeToUtc converts London wall time in winter and summer', () => {
  assert.equal(
    zonedWallTimeToUtc(2026, 1, 15, 9, 0, 'Europe/London').toISOString(),
    '2026-01-15T09:00:00.000Z',
  )
  assert.equal(
    zonedWallTimeToUtc(2026, 7, 15, 9, 0, 'Europe/London').toISOString(),
    '2026-07-15T08:00:00.000Z',
  )
})

test('zonedWallTimeToUtc handles the spring daylight-saving boundary', () => {
  // On 2026-03-29 the UK moves from GMT to BST at 01:00 UTC.
  assert.equal(
    zonedWallTimeToUtc(2026, 3, 29, 0, 30, 'Europe/London').toISOString(),
    '2026-03-29T00:30:00.000Z',
  )
  assert.equal(
    zonedWallTimeToUtc(2026, 3, 29, 3, 30, 'Europe/London').toISOString(),
    '2026-03-29T02:30:00.000Z',
  )
})

test('zonedWallTimeToUtc handles the autumn daylight-saving boundary and other zones', () => {
  // On 2026-10-25 the UK returns to GMT at 01:00 UTC.
  assert.equal(
    zonedWallTimeToUtc(2026, 10, 25, 12, 0, 'Europe/London').toISOString(),
    '2026-10-25T12:00:00.000Z',
  )
  assert.equal(
    zonedWallTimeToUtc(2026, 7, 15, 9, 0, 'America/New_York').toISOString(),
    '2026-07-15T13:00:00.000Z',
  )
})

test('occurrencesBetween keeps local clock times stable across DST', () => {
  const occurrences = occurrencesBetween(
    {
      localTimes: ['08:00'],
      recurrence: 'daily',
      weekdays: [],
      timezone: 'Europe/London',
      activeFrom: '2026-03-27',
      activeTo: null,
    },
    new Date('2026-03-27T00:00:00Z'),
    new Date('2026-03-31T00:00:00Z'),
  )
  assert.deepEqual(
    occurrences.map((date) => date.toISOString()),
    [
      '2026-03-27T08:00:00.000Z',
      '2026-03-28T08:00:00.000Z',
      '2026-03-29T07:00:00.000Z',
      '2026-03-30T07:00:00.000Z',
    ],
  )
})

test('occurrencesBetween respects weekly weekdays and returns nothing for as-needed', () => {
  const weekly = occurrencesBetween(
    {
      localTimes: ['18:30'],
      recurrence: 'weekly',
      weekdays: [1, 3, 5],
      timezone: 'UTC',
      activeFrom: '2026-03-01',
      activeTo: null,
    },
    new Date('2026-03-29T00:00:00Z'),
    new Date('2026-04-05T00:00:00Z'),
  )
  assert.deepEqual(
    weekly.map((date) => date.toISOString().slice(0, 10)),
    ['2026-03-30', '2026-04-01', '2026-04-03'],
  )

  const asNeeded = occurrencesBetween(
    {
      localTimes: [],
      recurrence: 'as_needed',
      weekdays: [],
      timezone: 'UTC',
      activeFrom: '2026-01-01',
      activeTo: null,
    },
    new Date('2026-03-01T00:00:00Z'),
    new Date('2026-03-31T00:00:00Z'),
  )
  assert.deepEqual(asNeeded, [])
})

test('local dates roll over at local midnight, not UTC midnight', () => {
  assert.equal(localDateString(new Date('2026-06-01T23:30:00Z'), 'Europe/London'), '2026-06-02')
  assert.equal(localDateString(new Date('2026-06-01T22:30:00Z'), 'Europe/London'), '2026-06-01')
  assert.equal(localDateString(new Date('2026-06-01T23:30:00Z'), 'UTC'), '2026-06-01')
})

test('startOfLocalDayUtc returns the UTC instant of local midnight', () => {
  assert.equal(
    startOfLocalDayUtc('2026-07-15', 'Europe/London').toISOString(),
    '2026-07-14T23:00:00.000Z',
  )
})

test('quiet hours handle overnight ranges, inclusive start and exclusive end', () => {
  const quiet = (iso: string) => inQuietHours(new Date(iso), 'UTC', '21:30', '07:00')
  assert.equal(quiet('2026-01-01T22:30:00Z'), true)
  assert.equal(quiet('2026-01-01T06:59:00Z'), true)
  assert.equal(quiet('2026-01-01T21:30:00Z'), true)
  assert.equal(quiet('2026-01-01T07:00:00Z'), false)
  assert.equal(quiet('2026-01-01T12:00:00Z'), false)
  assert.equal(inQuietHours(new Date('2026-01-01T12:00:00Z'), 'UTC', null, null), false)
  assert.equal(inQuietHours(new Date('2026-01-01T12:00:00Z'), 'UTC', '09:00', '09:00'), false)
})

test('quiet hours use the profile time zone', () => {
  // 2026-01-01T22:30Z is 22:30 in London (GMT) but 23:30 in Paris.
  assert.equal(inQuietHours(new Date('2026-01-01T22:30:00Z'), 'Europe/London', '23:00', '07:00'), false)
  assert.equal(inQuietHours(new Date('2026-01-01T22:30:00Z'), 'Europe/Paris', '23:00', '07:00'), true)
})

test('date helpers validate and step local dates without drifting', () => {
  assert.equal(isValidDateString('2026-02-28'), true)
  assert.equal(isValidDateString('2026-13-01'), false)
  assert.equal(isValidDateString('28/02/2026'), false)
  assert.equal(addDaysToDateString('2026-02-28', 1), '2026-03-01')
  assert.equal(addDaysToDateString('2026-03-01', -1), '2026-02-28')
  assert.deepEqual(dateRange('2026-03-30', '2026-04-02'), [
    '2026-03-30',
    '2026-03-31',
    '2026-04-01',
    '2026-04-02',
  ])
})

test('weekday numbering and local-time parsing are explicit', () => {
  assert.equal(weekdayOfDateString('2026-03-30'), 1) // Monday
  assert.equal(weekdayOfDateString('2026-03-29'), 0) // Sunday
  assert.deepEqual(parseLocalTime('08:05'), { hour: 8, minute: 5 })
  assert.equal(parseLocalTime('24:00'), null)
  assert.equal(parseLocalTime('8:05'), null)
})

test('time zones are validated against the platform database', () => {
  assert.equal(isValidTimeZone('Europe/London'), true)
  assert.equal(isValidTimeZone('Not/AZone'), false)
})
