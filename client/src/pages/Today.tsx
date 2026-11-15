import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import type { Dose, TodayResponse } from '../lib/types'
import {
  dayGreeting,
  formatDateLong,
  formatDateTime,
  formatTime,
  relativeDay,
  relativeTime,
  statusLabel,
} from '../lib/format'
import {
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  StatusChip,
} from '../components/ui'
import { DoseActions } from '../components/DoseActions'

function recordedLine(dose: Dose, timezone: string): string {
  if (!dose.recordedAt) return ''
  const time = formatTime(dose.recordedAt, timezone)
  const actor = dose.recordedByName ?? 'a care-circle member'
  if (dose.status === 'taken') return `Taken ${time} by ${actor}`
  if (dose.status === 'skipped') return `Skipped ${time} by ${actor}`
  return ''
}

export function TodayPage() {
  const { profileId, profile, capabilities } = useProfile()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const payload = await api.get<TodayResponse>(`/api/profiles/${profileId}/today`)
      setData(payload)
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  if (loading && !data) return <Loading label="Loading today’s care plan…" />
  if (error && !data) return <ErrorPanel message={error} onRetry={() => void load()} />
  if (!data) return null

  const { doses, counts, nextDose, appointments } = data
  const timezone = data.timezone
  const total = doses.length
  const recorded = counts.taken + counts.skipped
  const outstanding = counts.due + counts.upcoming + counts.snoozed
  const unconfirmed = counts.missed + counts.not_recorded
  const nextIsToday = nextDose?.localDate === data.date
  const allDone = total > 0 && outstanding === 0
  const progress =
    recorded === total
      ? `All ${total} doses scheduled today have a recorded outcome.`
      : `${recorded} of ${total} doses recorded today.` +
        (outstanding > 0 ? ` ${outstanding} still to come.` : '') +
        (unconfirmed > 0
          ? ` ${unconfirmed} ${unconfirmed === 1 ? 'dose has' : 'doses have'} no confirmation.`
          : '')

  return (
    <div className="page today-page">
      <PageHeader
        eyebrow={formatDateLong(data.date)}
        title={`${dayGreeting(timezone)}, ${profile.preferredName}`}
        description={
          total === 0
            ? 'There are no medicines scheduled for today. Appointments and care-circle updates are below.'
            : progress
        }
        actions={
          <Link className="btn btn-secondary" to="medications">
            View medicines
          </Link>
        }
      />

      {error ? <ErrorPanel message={error} onRetry={() => void load()} /> : null}

      <div className="summary-strip" role="list" aria-label="Today’s dose status summary">
        <div className="summary-item" role="listitem">
          <span className="summary-value">{counts.taken}</span>
          <span className="summary-label">Taken</span>
        </div>
        <div className="summary-item" role="listitem">
          <span className="summary-value">{counts.due}</span>
          <span className="summary-label">Due now</span>
        </div>
        <div className="summary-item" role="listitem">
          <span className="summary-value">{counts.upcoming + counts.snoozed}</span>
          <span className="summary-label">Later today</span>
        </div>
        <div className="summary-item summary-item-warn" role="listitem">
          <span className="summary-value">{counts.missed}</span>
          <span className="summary-label">Missed</span>
        </div>
        <div className="summary-item" role="listitem">
          <span className="summary-value">{counts.not_recorded}</span>
          <span className="summary-label">Not recorded</span>
        </div>
      </div>

      <div className="today-grid">
        <div className="today-main">
          <Card className="next-card" tone={nextDose?.status === 'missed' ? 'danger' : undefined}>
            {nextDose ? (
              <>
                <div className="next-time">
                  <span className="next-time-value">{formatTime(nextDose.scheduledFor, timezone)}</span>
                  <span className="next-time-day">
                    {nextIsToday ? 'Today' : relativeDay(nextDose.scheduledFor, timezone, data.today)}
                  </span>
                </div>
                <div className="next-body">
                  <div className="next-meta">
                    <p className="eyebrow">
                      {nextDose.status === 'due'
                        ? 'Due now'
                        : nextDose.status === 'missed'
                          ? 'Missed dose'
                          : nextDose.status === 'snoozed'
                            ? 'Snoozed'
                            : 'Next dose'}
                    </p>
                    <StatusChip status={nextDose.status} />
                  </div>
                  <h2 className="next-title">
                    {nextDose.medicationName}
                    {nextDose.strength ? <span className="next-strength"> {nextDose.strength}</span> : null}
                  </h2>
                  <p className="next-instruction">{nextDose.prescribedInstructions}</p>
                  {nextDose.snoozedUntil ? (
                    <p className="next-note">
                      Snoozed until {formatTime(nextDose.snoozedUntil, timezone)}. No outcome has been
                      recorded yet.
                    </p>
                  ) : null}
                  {nextDose.status === 'missed' ? (
                    <p className="safety-note">
                      This dose is marked as missed. Follow the instructions from your prescriber or
                      pharmacist. CareNest does not advise catch-up dosing.
                    </p>
                  ) : null}
                  {nextDose.status === 'not_recorded' ? (
                    <p className="safety-note">
                      No confirmation was recorded for this dose, so CareNest cannot say what happened. This
                      is not the same as missed. Record the outcome if you know it.
                    </p>
                  ) : null}

                  {capabilities.recordDoses ? (
                    <div className="next-actions">
                      <DoseActions dose={nextDose} onChanged={() => void load()} layout="stacked" />
                    </div>
                  ) : (
                    <p className="muted-note">
                      Your access is read-only. A caregiver or the older adult can record this dose.
                    </p>
                  )}
                </div>
              </>
            ) : allDone ? (
              <div className="all-clear">
                <div className="all-clear-mark" aria-hidden="true">
                  ✓
                </div>
                <div>
                  <h2>Today has a recorded outcome for every dose</h2>
                  <p>
                    {counts.missed > 0
                      ? 'Neutral note: a missed dose is not a clinical emergency. Follow the prescriber or pharmacist instructions.'
                      : 'Nothing else is due today in this care plan.'}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState
                icon="○"
                title="Nothing scheduled today"
                description="When a medicine is added with a schedule, today’s doses will appear here."
                action={
                  capabilities.editMedications ? (
                    <Link className="btn btn-secondary" to="medications/new">
                      Add a medicine
                    </Link>
                  ) : null
                }
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Today’s medicine timeline"
              description="Every scheduled dose, with who recorded it and when."
              action={
                <Link className="text-link" to="medications">
                  All medicines
                </Link>
              }
            />
            {doses.length === 0 ? (
              <EmptyState
                icon="○"
                title="No doses scheduled"
                description="This care profile has no active medicine schedule for today."
              />
            ) : (
              <ul className="timeline">
                {doses.map((dose) => {
                  const line = recordedLine(dose, timezone)
                  return (
                    <li key={dose.id} className={`timeline-item timeline-${dose.status}`}>
                      <div className="timeline-time">
                        <span>{formatTime(dose.scheduledFor, timezone)}</span>
                      </div>
                      <span className={`timeline-dot timeline-dot-${dose.status}`} aria-hidden="true" />
                      <div className="timeline-content">
                        <div className="timeline-head">
                          <p className="timeline-title">
                            {dose.medicationName}
                            {dose.strength ? (
                              <span className="timeline-strength"> {dose.strength}</span>
                            ) : null}
                            {dose.form ? <span className="timeline-form"> · {dose.form}</span> : null}
                          </p>
                          <StatusChip status={dose.status} />
                        </div>
                        <p className="timeline-instruction">{dose.prescribedInstructions}</p>
                        {line ? <p className="timeline-recorded">{line}</p> : null}
                        {dose.status === 'missed' ? (
                          <p className="timeline-note">
                            No confirmation within the {dose.graceMinutes}-minute grace period. Follow the
                            prescriber or pharmacist instructions; CareNest does not advise catch-up dosing.
                          </p>
                        ) : null}
                        {dose.status === 'not_recorded' ? (
                          <p className="timeline-note">
                            No confirmation and no missed classification. Not the same as missed.
                          </p>
                        ) : null}
                        {dose.status === 'snoozed' && dose.snoozedUntil ? (
                          <p className="timeline-note">
                            Reminder snoozed until {formatTime(dose.snoozedUntil, timezone)}.
                          </p>
                        ) : null}
                        <DoseActions dose={dose} onChanged={() => void load()} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        <aside className="today-side" aria-label="Appointments, handover and care-circle activity">
          <Card tone="mint">
            <CardHeader
              title={appointments.today.length > 0 ? 'Today’s appointments' : 'Next appointment'}
              action={
                <Link className="text-link" to="appointments">
                  View all
                </Link>
              }
            />
            {appointments.today.length > 0 ? (
              <ul className="appointment-mini-list">
                {appointments.today.map((appointment) => (
                  <li key={appointment.id} className="appointment-mini">
                    <p className="appointment-mini-time">
                      {formatTime(appointment.startAt, appointment.timezone)}
                    </p>
                    <p className="appointment-mini-title">{appointment.title}</p>
                    <p className="appointment-mini-meta">{appointment.provider}</p>
                    {appointment.location ? (
                      <p className="appointment-mini-meta">{appointment.location}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : appointments.next ? (
              <div className="appointment-mini">
                <p className="appointment-mini-time">
                  {relativeDay(appointments.next.startAt, timezone, data.today)} ·{' '}
                  {formatTime(appointments.next.startAt, appointments.next.timezone)}
                </p>
                <p className="appointment-mini-title">{appointments.next.title}</p>
                <p className="appointment-mini-meta">{appointments.next.provider}</p>
                <p className="appointment-mini-meta">
                  Reminder {appointments.next.reminderLeadMinutes >= 1440
                    ? `${Math.round(appointments.next.reminderLeadMinutes / 1440)} day(s) before`
                    : `${appointments.next.reminderLeadMinutes} minutes before`}
                </p>
              </div>
            ) : (
              <EmptyState
                icon="○"
                title="No appointments booked"
                description="Appointments added by the care circle will appear here."
              />
            )}
          </Card>

          <Card>
            <CardHeader title="Care-circle handover" level={3} />
            <dl className="handover-list">
              <div>
                <dt>Last confirmed</dt>
                <dd>
                  {(() => {
                    const last = [...doses]
                      .reverse()
                      .find((dose) => dose.recordedAt && (dose.status === 'taken' || dose.status === 'skipped'))
                    if (!last) return 'Nothing recorded yet today'
                    return `${last.medicationName} · ${statusLabel(last.status)} ${formatTime(last.recordedAt!, timezone)} by ${last.recordedByName ?? '—'}`
                  })()}
                </dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd>
                  {outstanding + counts.missed + counts.not_recorded === 0
                    ? 'None'
                    : `${outstanding} due or later · ${counts.missed} missed · ${counts.not_recorded} not recorded`}
                </dd>
              </div>
              <div>
                <dt>Next appointment</dt>
                <dd>
                  {appointments.next
                    ? `${appointments.next.title} · ${formatDateTime(appointments.next.startAt, appointments.next.timezone)}`
                    : 'None booked'}
                </dd>
              </div>
            </dl>
            <Link className="text-link" to="reports">
              Open the full handover summary
            </Link>
          </Card>

          <Card>
            <CardHeader title="Care-circle activity" level={3} />
            {data.activity.length === 0 ? (
              <p className="muted-note">No care-circle updates yet.</p>
            ) : (
              <ul className="activity-list">
                {data.activity.map((event) => (
                  <li key={event.id} className="activity-item">
                    <span className="activity-dot" aria-hidden="true" />
                    <div>
                      <p className="activity-summary">{event.summary}</p>
                      <p className="activity-meta">
                        {event.actorLabel} · {relativeTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Chip tone="neutral" className="safety-chip">
            Scheduling support only — not medical advice or emergency monitoring
          </Chip>
        </aside>
      </div>
    </div>
  )
}
