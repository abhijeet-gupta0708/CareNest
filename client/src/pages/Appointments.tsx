import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import type { Appointment } from '../lib/types'
import {
  TIMEZONES,
  dateInZone,
  durationLabel,
  formatDateLong,
  formatDateShort,
  formatMonthYear,
  formatTime,
  isoToZonedParts,
  monthGrid,
  relativeDay,
  reminderLeadLabel,
  timezoneLabel,
  todayInZone,
  zonedToIso,
} from '../lib/format'
import {
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  ErrorPanel,
  Field,
  Loading,
  PageHeader,
  Select,
  TextInput,
  Textarea,
  useToast,
} from '../components/ui'

type ViewFilter = 'upcoming' | 'past' | 'all'

interface AppointmentForm {
  title: string
  provider: string
  location: string
  videoLink: string
  notes: string
  date: string
  time: string
  timezone: string
  durationMinutes: number
  reminderLeadMinutes: number
  status: Appointment['status']
}

const REMINDER_OPTIONS = [
  { value: 0, label: 'At the time' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
]

export function AppointmentsPage() {
  const { profileId, profile, capabilities } = useProfile()
  const toast = useToast()
  const today = todayInZone(profile.timezone)

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ViewFilter>('upcoming')
  const [mode, setMode] = useState<'list' | 'calendar'>('list')
  const [cursor, setCursor] = useState(() => {
    const [year, month] = today.split('-').map(Number)
    return { year, month: month - 1 }
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [form, setForm] = useState<AppointmentForm>(emptyForm(today, profile.timezone))
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ appointments: Appointment[] }>(
        `/api/profiles/${profileId}/appointments?view=all`,
      )
      setAppointments(data.appointments)
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (filter === 'all') return appointments
    if (filter === 'upcoming') return appointments.filter((item) => item.displayStatus === 'upcoming')
    return appointments.filter((item) => item.displayStatus !== 'upcoming')
  }, [appointments, filter])

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const appointment of appointments) {
      const day = dateInZone(appointment.startAt, profile.timezone)
      const list = map.get(day) ?? []
      list.push(appointment)
      map.set(day, list)
    }
    return map
  }, [appointments, profile.timezone])

  const openCreate = (day?: string) => {
    setEditing(null)
    setForm(emptyForm(day ?? today, profile.timezone))
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (appointment: Appointment) => {
    const parts = isoToZonedParts(appointment.startAt, appointment.timezone)
    setEditing(appointment)
    setForm({
      title: appointment.title,
      provider: appointment.provider,
      location: appointment.location ?? '',
      videoLink: appointment.videoLink ?? '',
      notes: appointment.notes ?? '',
      date: parts.date,
      time: parts.time,
      timezone: appointment.timezone,
      durationMinutes: appointment.durationMinutes,
      reminderLeadMinutes: appointment.reminderLeadMinutes,
      status: appointment.status,
    })
    setFormError(null)
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.title.trim() || !form.provider.trim()) {
      setFormError('Add an appointment title and the clinic, provider or service.')
      return
    }
    if (!form.date || !form.time) {
      setFormError('Choose the date and time for this appointment.')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const payload = {
        title: form.title.trim(),
        provider: form.provider.trim(),
        location: form.location.trim() || null,
        videoLink: form.videoLink.trim() || null,
        notes: form.notes.trim() || null,
        startAt: zonedToIso(form.date, form.time, form.timezone),
        timezone: form.timezone,
        durationMinutes: Number(form.durationMinutes),
        reminderLeadMinutes: Number(form.reminderLeadMinutes),
        status: form.status,
      }
      if (editing) {
        await api.patch(`/api/profiles/${profileId}/appointments/${editing.id}`, payload)
        toast.push('Appointment updated. Reminder settings saved.')
      } else {
        await api.post(`/api/profiles/${profileId}/appointments`, payload)
        toast.push('Appointment added. The care circle can see it.')
      }
      setDialogOpen(false)
      await load()
    } catch (caught) {
      setFormError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const updateStatus = async (appointment: Appointment, status: Appointment['status'], reason?: string) => {
    setBusy(true)
    setCancelError(null)
    try {
      await api.post(`/api/profiles/${profileId}/appointments/${appointment.id}/status`, {
        status,
        reason,
      })
      toast.push(status === 'cancelled' ? 'Appointment cancelled.' : 'Appointment marked as completed.')
      setCancelTarget(null)
      setCancelReason('')
      await load()
    } catch (caught) {
      setCancelError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading label="Loading appointments…" />

  const monthCells = monthGrid(cursor.year, cursor.month)
  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const selectedAppointments = selectedDay ? (byDay.get(selectedDay) ?? []) : []

  const moveMonth = (delta: number) => {
    setCursor((current) => {
      const date = new Date(Date.UTC(current.year, current.month + delta, 1))
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
    })
    setSelectedDay(null)
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Appointments"
        title="Appointments and reminders"
        description={`Times are shown explicitly in each appointment’s time zone. The care profile is set to ${profile.timezone}.`}
        actions={
          capabilities.editAppointments ? (
            <Button onClick={() => openCreate()}>Add appointment</Button>
          ) : (
            <Chip tone="info">Read-only access</Chip>
          )
        }
      />

      {error ? <ErrorPanel message={error} onRetry={() => void load()} /> : null}

      <div className="list-toolbar">
        <div className="filter-chips" role="group" aria-label="Filter appointments">
          {(['upcoming', 'past', 'all'] as ViewFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All' : value === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Appointment view">
          <button
            type="button"
            className={`segment ${mode === 'list' ? 'segment-active' : ''}`}
            aria-pressed={mode === 'list'}
            onClick={() => setMode('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`segment ${mode === 'calendar' ? 'segment-active' : ''}`}
            aria-pressed={mode === 'calendar'}
            onClick={() => setMode('calendar')}
          >
            Calendar
          </button>
        </div>
      </div>

      {mode === 'calendar' ? (
        <Card className="calendar-card">
          <div className="calendar-head">
            <Button variant="quiet" size="sm" onClick={() => moveMonth(-1)} aria-label="Previous month">
              ←
            </Button>
            <h2 className="calendar-title">{formatMonthYear(cursor.year, cursor.month)}</h2>
            <Button variant="quiet" size="sm" onClick={() => moveMonth(1)} aria-label="Next month">
              →
            </Button>
          </div>
          <div className="calendar-grid" role="grid" aria-label="Appointment calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="calendar-weekday" role="columnheader">
                {day}
              </div>
            ))}
            {monthCells.map((cell) => {
              const inMonth = cell.startsWith(monthPrefix)
              const items = byDay.get(cell) ?? []
              const isToday = cell === today
              return (
                <button
                  key={cell}
                  type="button"
                  role="gridcell"
                  className={`calendar-cell ${inMonth ? '' : 'calendar-cell-muted'} ${isToday ? 'calendar-cell-today' : ''} ${selectedDay === cell ? 'calendar-cell-selected' : ''}`}
                  onClick={() => setSelectedDay(cell)}
                  aria-label={`${formatDateLong(cell)}${items.length ? `, ${items.length} appointment${items.length === 1 ? '' : 's'}` : ', no appointments'}`}
                  aria-pressed={selectedDay === cell}
                >
                  <span className="calendar-day">{Number(cell.slice(8, 10))}</span>
                  {items.slice(0, 2).map((item) => (
                    <span key={item.id} className="calendar-event">
                      {formatTime(item.startAt, item.timezone)} {item.title}
                    </span>
                  ))}
                  {items.length > 2 ? <span className="calendar-more">+{items.length - 2} more</span> : null}
                </button>
              )
            })}
          </div>
          <div className="calendar-detail">
            {selectedDay ? (
              <>
                <h3>{formatDateLong(selectedDay)}</h3>
                {selectedAppointments.length === 0 ? (
                  <p className="muted-note">No appointments on this day.</p>
                ) : (
                  selectedAppointments.map((appointment) => (
                    <AppointmentRow
                      key={appointment.id}
                      appointment={appointment}
                      profileTimezone={profile.timezone}
                      canEdit={capabilities.editAppointments}
                      onEdit={() => openEdit(appointment)}
                      onCancel={() => {
                        setCancelTarget(appointment)
                        setCancelReason('')
                        setCancelError(null)
                      }}
                      onComplete={() => void updateStatus(appointment, 'completed', 'Completed from calendar view.')}
                    />
                  ))
                )}
              </>
            ) : (
              <p className="muted-note">Choose a day to see its appointments.</p>
            )}
          </div>
        </Card>
      ) : (
        <div className="appointment-list">
          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon="▤"
                title={filter === 'upcoming' ? 'No upcoming appointments' : 'No appointments in this view'}
                description={
                  capabilities.editAppointments
                    ? 'Add an appointment with the provider, time and reminder preference.'
                    : 'Appointments added by an authorised person will appear here.'
                }
                action={
                  capabilities.editAppointments ? (
                    <Button onClick={() => openCreate()}>Add appointment</Button>
                  ) : null
                }
              />
            </Card>
          ) : (
            filtered.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                profileTimezone={profile.timezone}
                canEdit={capabilities.editAppointments}
                onEdit={() => openEdit(appointment)}
                onCancel={() => {
                  setCancelTarget(appointment)
                  setCancelReason('')
                  setCancelError(null)
                }}
                onComplete={() => void updateStatus(appointment, 'completed', 'Completed by the care team.')}
              />
            ))
          )}
        </div>
      )}

      <Banner tone="info" title="Reminders are not emergency monitoring">
        Email reminders can be delayed or fail. Keep using the arrangements agreed with your care team for
        urgent needs.
      </Banner>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        size="lg"
        title={editing ? 'Edit appointment' : 'Add an appointment'}
        description="The care circle sees the appointment details shared with them. Reminders go to members whose preferences allow it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              {editing ? 'Save changes' : 'Add appointment'}
            </Button>
          </>
        }
      >
        <div className="modal-form">
          {formError ? (
            <Banner tone="danger" title="The appointment was not saved">
              {formError}
            </Banner>
          ) : null}
          <Field id="appt-title" label="Appointment title" required>
            <TextInput
              id="appt-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="For example: Medication review"
            />
          </Field>
          <Field id="appt-provider" label="Clinic, provider or service" required>
            <TextInput
              id="appt-provider"
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
              placeholder="Riverside GP Surgery"
            />
          </Field>
          <div className="form-grid">
            <Field id="appt-date" label="Date" required>
              <TextInput
                id="appt-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
            <Field id="appt-time" label="Time" required>
              <TextInput
                id="appt-time"
                type="time"
                value={form.time}
                onChange={(event) => setForm({ ...form, time: event.target.value })}
              />
            </Field>
          </div>
          <Field
            id="appt-timezone"
            label="Time zone"
            hint="Stored explicitly so the time does not shift silently."
          >
            <Select
              id="appt-timezone"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {timezoneLabel(zone)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="form-grid">
            <Field id="appt-duration" label="Usual length">
              <Select
                id="appt-duration"
                value={form.durationMinutes}
                onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })}
              >
                {[15, 20, 30, 45, 60, 90, 120].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {durationLabel(minutes)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="appt-reminder" label="Email reminder">
              <Select
                id="appt-reminder"
                value={form.reminderLeadMinutes}
                onChange={(event) => setForm({ ...form, reminderLeadMinutes: Number(event.target.value) })}
              >
                {REMINDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="appt-location" label="Location">
            <TextInput
              id="appt-location"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              placeholder="Riverside Surgery, Room 3"
            />
          </Field>
          <Field id="appt-video" label="Video link" hint="Optional. Only share links the care circle is allowed to see.">
            <TextInput
              id="appt-video"
              type="url"
              value={form.videoLink}
              onChange={(event) => setForm({ ...form, videoLink: event.target.value })}
              placeholder="https://"
            />
          </Field>
          <Field id="appt-notes" label="Notes for the care circle">
            <Textarea
              id="appt-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="For example: bring the current prescription list."
            />
          </Field>
          <Field id="appt-status" label="Status">
            <Select
              id="appt-status"
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as Appointment['status'] })
              }
            >
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <p className="muted-note">
            Local time: {form.date && form.time ? `${form.date} at ${form.time}` : 'not set'} ·{' '}
            {timezoneLabel(form.timezone)}
          </p>
        </div>
      </Dialog>

      <Dialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Cancel this appointment?"
        description={
          cancelTarget
            ? `${cancelTarget.title} with ${cancelTarget.provider}. The care circle will see that it was cancelled.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              Keep appointment
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => cancelTarget && void updateStatus(cancelTarget, 'cancelled', cancelReason)}
            >
              Cancel appointment
            </Button>
          </>
        }
      >
        <div className="prose">
          <Field id="cancel-reason" label="Reason (optional)">
            <Textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              maxLength={300}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </Field>
          {cancelError ? (
            <p className="field-message" role="alert">
              {cancelError}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}

function emptyForm(day: string, timezone: string): AppointmentForm {
  return {
    title: '',
    provider: '',
    location: '',
    videoLink: '',
    notes: '',
    date: day,
    time: '10:00',
    timezone,
    durationMinutes: 30,
    reminderLeadMinutes: 1440,
    status: 'upcoming',
  }
}

function AppointmentRow({
  appointment,
  profileTimezone,
  canEdit,
  onEdit,
  onCancel,
  onComplete,
}: {
  appointment: Appointment
  profileTimezone: string
  canEdit: boolean
  onEdit: () => void
  onCancel: () => void
  onComplete: () => void
}) {
  const statusTone =
    appointment.displayStatus === 'upcoming'
      ? 'info'
      : appointment.displayStatus === 'cancelled'
        ? 'danger'
        : 'neutral'
  const day = dateInZone(appointment.startAt, profileTimezone)
  return (
    <Card className={`appointment-card appointment-${appointment.displayStatus}`}>
      <div className="appointment-date">
        <span className="appointment-day">{formatDateShort(day)}</span>
        <span className="appointment-relative">
          {relativeDay(appointment.startAt, profileTimezone, todayInZone(profileTimezone))}
        </span>
      </div>
      <div className="appointment-body">
        <div className="appointment-head">
          <h2>{appointment.title}</h2>
          <Chip tone={statusTone}>{appointment.displayStatus}</Chip>
        </div>
        <p className="appointment-provider">{appointment.provider}</p>
        <p className="appointment-when">
          {formatTime(appointment.startAt, appointment.timezone)} · {appointment.timezone} ·{' '}
          {durationLabel(appointment.durationMinutes)}
        </p>
        {appointment.location ? <p className="appointment-meta">{appointment.location}</p> : null}
        {appointment.videoLink ? (
          <p className="appointment-meta">
            Video link recorded. Open it from the appointment details in the care plan.
          </p>
        ) : null}
        {appointment.notes ? <p className="appointment-notes">{appointment.notes}</p> : null}
        <p className="appointment-reminder">
          Email reminder: {reminderLeadLabel(appointment.reminderLeadMinutes)} ·{' '}
          {appointment.displayStatus === 'past' ? 'This appointment is in the past' : 'Reminders respect each member’s preferences'}
        </p>
        {canEdit ? (
          <div className="appointment-actions">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Edit
            </Button>
            {appointment.displayStatus === 'upcoming' ? (
              <>
                <Button variant="quiet" size="sm" onClick={onComplete}>
                  Mark completed
                </Button>
                <Button variant="quiet" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
