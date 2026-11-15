import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import type { AdherenceReport, AuditEvent, Handover, Reminder } from '../lib/types'
import {
  addDays,
  formatDateShort,
  formatDateWithYear,
  formatDateTime,
  formatTime,
  percent,
  relativeTime,
  statusLabel,
  todayInZone,
} from '../lib/format'
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  StatusChip,
  useToast,
} from '../components/ui'

type Tab = 'adherence' | 'handover' | 'reminders' | 'audit'

const REMINDER_TYPE_LABELS: Record<string, string> = {
  upcoming_dose: 'Upcoming dose',
  missed_dose: 'Missed dose',
  appointment: 'Appointment',
  test: 'Test reminder',
}

export function ReportsPage() {
  const { profileId, profile, capabilities } = useProfile()
  const toast = useToast()
  const today = todayInZone(profile.timezone)
  const [tab, setTab] = useState<Tab>('adherence')
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)

  const [report, setReport] = useState<AdherenceReport | null>(null)
  const [handover, setHandover] = useState<Handover | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testBusy, setTestBusy] = useState(false)

  const loadReport = useCallback(async () => {
    try {
      const data = await api.get<AdherenceReport>(
        `/api/profiles/${profileId}/reports/adherence?from=${from}&to=${to}`,
      )
      setReport(data)
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [from, profileId, to])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  useEffect(() => {
    api
      .get<Handover>(`/api/profiles/${profileId}/reports/handover`)
      .then(setHandover)
      .catch(() => setHandover(null))
    if (capabilities.viewReminders) {
      api
        .get<{ reminders: Reminder[] }>(`/api/profiles/${profileId}/reminders?limit=40`)
        .then((data) => setReminders(data.reminders))
        .catch(() => setReminders([]))
    }
    if (capabilities.viewAudit) {
      api
        .get<{ events: AuditEvent[] }>(`/api/profiles/${profileId}/audit?limit=100`)
        .then((data) => setAudit(data.events))
        .catch(() => setAudit([]))
    }
  }, [capabilities.viewAudit, capabilities.viewReminders, profileId])

  const sendTest = async () => {
    setTestBusy(true)
    try {
      await api.post(`/api/profiles/${profileId}/reminders/test`, {})
      const data = await api.get<{ reminders: Reminder[] }>(`/api/profiles/${profileId}/reminders?limit=40`)
      setReminders(data.reminders)
      toast.push('Test reminder created and written to the delivery log.')
    } catch (caught) {
      toast.push(errorMessage(caught), 'error')
    } finally {
      setTestBusy(false)
    }
  }

  const maxDaily = useMemo(() => {
    if (!report) return 1
    return Math.max(
      1,
      ...report.daily.map(
        (day) => day.taken + day.skipped + day.missed + day.not_recorded + day.upcoming + day.due + day.snoozed,
      ),
    )
  }, [report])

  const tabs: Array<{ id: Tab; label: string; hidden?: boolean }> = [
    { id: 'adherence', label: 'Adherence' },
    { id: 'handover', label: 'Handover' },
    { id: 'reminders', label: 'Reminders', hidden: !capabilities.viewReminders },
    { id: 'audit', label: 'Audit history', hidden: !capabilities.viewAudit },
  ]

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Adherence, handover and records"
        description="Simple counts with explicit definitions. CareNest does not draw medical conclusions from adherence trends."
        actions={
          capabilities.viewReminders ? (
            <Button variant="secondary" loading={testBusy} onClick={() => void sendTest()}>
              Send a test reminder
            </Button>
          ) : null
        }
      />

      <div className="tabs" role="tablist" aria-label="Report sections">
        {tabs
          .filter((item) => !item.hidden)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              className={`tab ${tab === item.id ? 'tab-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
      </div>

      {tab === 'adherence' ? (
        <div role="tabpanel" id="panel-adherence" aria-labelledby="tab-adherence">
          <Card className="range-card">
            <div className="range-controls">
              <div className="filter-chips" role="group" aria-label="Reporting period">
                {[7, 14, 30].map((days) => {
                  const presetFrom = addDays(today, -(days - 1))
                  const active = from === presetFrom && to === today
                  return (
                    <button
                      key={days}
                      type="button"
                      className={`filter-chip ${active ? 'filter-chip-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => {
                        setFrom(presetFrom)
                        setTo(today)
                      }}
                    >
                      Last {days} days
                    </button>
                  )
                })}
              </div>
              <div className="range-dates">
                <label className="range-field">
                  <span>From</span>
                  <input
                    className="input"
                    type="date"
                    value={from}
                    max={to}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label className="range-field">
                  <span>To</span>
                  <input
                    className="input"
                    type="date"
                    value={to}
                    min={from}
                    max={today}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </label>
              </div>
            </div>
          </Card>

          {error ? <ErrorPanel message={error} onRetry={() => void loadReport()} /> : null}
          {loading && !report ? <Loading label="Building the adherence summary…" /> : null}

          {report ? (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-label">Scheduled</span>
                  <span className="stat-value">{report.counts.scheduled}</span>
                  <span className="stat-note">Doses in this period</span>
                </div>
                <div className="stat-card stat-success">
                  <span className="stat-label">Taken</span>
                  <span className="stat-value">{report.counts.taken}</span>
                  <span className="stat-note">Confirmed by a permitted person</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Skipped</span>
                  <span className="stat-value">{report.counts.skipped}</span>
                  <span className="stat-note">Recorded as not taken</span>
                </div>
                <div className="stat-card stat-danger">
                  <span className="stat-label">Missed</span>
                  <span className="stat-value">{report.counts.missed}</span>
                  <span className="stat-note">Grace period passed with no record</span>
                </div>
                <div className="stat-card stat-warn">
                  <span className="stat-label">Not recorded</span>
                  <span className="stat-value">{report.counts.notRecorded}</span>
                  <span className="stat-note">No confirmation or missed rule</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Still to come</span>
                  <span className="stat-value">{report.counts.upcoming}</span>
                  <span className="stat-note">Upcoming, due or snoozed</span>
                </div>
              </div>

              <div className="report-grid">
                <Card>
                  <CardHeader
                    title="Taken rate"
                    description={`${formatDateWithYear(report.from)} to ${formatDateWithYear(report.to)} · ${report.timezone}`}
                  />
                  <div className="rate-block">
                    <span className="rate-value">{percent(report.takenRate)}</span>
                    <div
                      className="rate-bar"
                      role="img"
                      aria-label={`${percent(report.takenRate)} of finalised doses were confirmed as taken`}
                    >
                      <span style={{ width: `${Math.round((report.takenRate ?? 0) * 100)}%` }} />
                    </div>
                    <p className="rate-formula">
                      {report.counts.taken} taken ÷ {report.denominator} finalised doses (taken + skipped + missed
                      + not recorded). Upcoming doses are excluded.
                    </p>
                    <p className="rate-formula">
                      Of the doses that were confirmed, {percent(report.noMissesRate)} were not marked missed.
                    </p>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="What each status means" description="The definitions used in every calculation." />
                  <dl className="definition-list">
                    {(['taken', 'skipped', 'missed', 'notRecorded', 'scheduled'] as const).map((key) => (
                      <div key={key}>
                        <dt>{report.definitions[key] ? keyLabel(key) : key}</dt>
                        <dd>{report.definitions[key]}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="muted-note">
                    “Not recorded” is deliberately separate from “missed”. CareNest never assumes what
                    happened when no one confirmed a dose.
                  </p>
                </Card>
              </div>

              <Card>
                <CardHeader title="Daily pattern" description="Stacked counts per day. Hover or focus a bar for the exact numbers." />
                {report.daily.length === 0 ? (
                  <EmptyState icon="▥" title="No doses in this period" />
                ) : (
                  <div className="bar-chart" role="list" aria-label="Doses per day">
                    {report.daily.map((day) => {
                      const total =
                        day.taken + day.skipped + day.missed + day.not_recorded + day.upcoming + day.due + day.snoozed
                      return (
                        <div key={day.date} className="bar-col" role="listitem">
                          <div
                            className="bar-stack"
                            style={{ height: `${Math.max((total / maxDaily) * 100, 4)}%` }}
                            title={`${formatDateWithYear(day.date)}: ${day.taken} taken, ${day.skipped} skipped, ${day.missed} missed, ${day.not_recorded} not recorded`}
                          >
                            <span className="bar-seg bar-taken" style={{ flexGrow: day.taken }} />
                            <span className="bar-seg bar-skipped" style={{ flexGrow: day.skipped }} />
                            <span className="bar-seg bar-missed" style={{ flexGrow: day.missed }} />
                            <span className="bar-seg bar-not-recorded" style={{ flexGrow: day.not_recorded }} />
                            <span
                              className="bar-seg bar-upcoming"
                              style={{ flexGrow: day.upcoming + day.due + day.snoozed }}
                            />
                          </div>
                          <span className="bar-label">{formatDateShort(day.date)}</span>
                          <span className="sr-only">
                            {formatDateWithYear(day.date)}: {day.taken} taken, {day.skipped} skipped,{' '}
                            {day.missed} missed, {day.not_recorded} not recorded
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="chart-legend">
                  <Chip tone="success">Taken</Chip>
                  <Chip tone="neutral">Skipped</Chip>
                  <Chip tone="danger">Missed</Chip>
                  <Chip tone="warn">Not recorded</Chip>
                  <Chip tone="info">Still to come</Chip>
                </div>
              </Card>

              <Card>
                <CardHeader title="By medicine" description="Counts use the same definitions and period." />
                {report.byMedication.length === 0 ? (
                  <EmptyState icon="▥" title="No medicine doses in this period" />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <caption className="sr-only">Adherence by medicine</caption>
                      <thead>
                        <tr>
                          <th scope="col">Medicine</th>
                          <th scope="col">Scheduled</th>
                          <th scope="col">Taken</th>
                          <th scope="col">Skipped</th>
                          <th scope="col">Missed</th>
                          <th scope="col">Not recorded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byMedication.map((entry) => {
                          const scheduled =
                            entry.counts.taken +
                            entry.counts.skipped +
                            entry.counts.missed +
                            entry.counts.not_recorded +
                            entry.counts.upcoming +
                            entry.counts.due +
                            entry.counts.snoozed
                          return (
                            <tr key={entry.medicationId}>
                              <th scope="row">
                                {entry.name}
                                {entry.strength ? ` ${entry.strength}` : ''}
                              </th>
                              <td>{scheduled}</td>
                              <td>{entry.counts.taken}</td>
                              <td>{entry.counts.skipped}</td>
                              <td>{entry.counts.missed}</td>
                              <td>{entry.counts.not_recorded}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'handover' ? (
        <div role="tabpanel" id="panel-handover" aria-labelledby="tab-handover">
          {!handover ? (
            <Loading label="Building the handover summary…" />
          ) : (
            <>
              <Banner tone="info" title="Handover from recorded events only">
                {handover.note} Generated {relativeTime(handover.generatedAt)} for{' '}
                {formatDateWithYear(handover.forDate)}.
              </Banner>
              <div className="report-grid">
                <Card>
                  <CardHeader title="Last recorded events" description="Most recent confirmed or classified outcomes." />
                  {handover.lastRecorded.length === 0 ? (
                    <p className="muted-note">Nothing recorded in the last seven days.</p>
                  ) : (
                    <ul className="handover-events">
                      {handover.lastRecorded.map((dose) => (
                        <li key={dose.id}>
                          <div>
                            <p className="handover-event-title">
                              {dose.medicationName}
                              {dose.strength ? ` ${dose.strength}` : ''}
                            </p>
                            <p className="handover-event-meta">
                              {formatDateShort(dose.localDate)} · {formatTime(dose.scheduledFor, handover.timezone)}
                              {dose.recordedByName ? ` · ${dose.recordedByName}` : ''}
                            </p>
                          </div>
                          <StatusChip status={dose.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Outstanding items" description="Missed, not recorded, due or snoozed in the last seven days." />
                  {handover.outstanding.length === 0 ? (
                    <EmptyState icon="✓" title="Nothing outstanding" description="Every recent dose has a recorded or classified outcome." />
                  ) : (
                    <ul className="handover-events">
                      {handover.outstanding.map((dose) => (
                        <li key={dose.id}>
                          <div>
                            <p className="handover-event-title">
                              {dose.medicationName}
                              {dose.strength ? ` ${dose.strength}` : ''}
                            </p>
                            <p className="handover-event-meta">
                              {formatDateShort(dose.localDate)} · {formatTime(dose.scheduledFor, handover.timezone)}
                            </p>
                          </div>
                          <StatusChip status={dose.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
              <div className="report-grid">
                <Card tone="mint">
                  <CardHeader title="Next appointment" />
                  {handover.nextAppointment ? (
                    <div>
                      <p className="handover-event-title">{handover.nextAppointment.title}</p>
                      <p className="handover-event-meta">{handover.nextAppointment.provider}</p>
                      <p className="handover-event-meta">
                        {formatDateTime(handover.nextAppointment.startAt, handover.nextAppointment.timezone)} ·{' '}
                        {handover.nextAppointment.timezone}
                      </p>
                      {handover.nextAppointment.location ? (
                        <p className="handover-event-meta">{handover.nextAppointment.location}</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted-note">No upcoming appointment recorded.</p>
                  )}
                </Card>
                <Card>
                  <CardHeader title="Recent changes" />
                  {handover.recentChanges.length === 0 ? (
                    <p className="muted-note">No changes recorded.</p>
                  ) : (
                    <ul className="history-list">
                      {handover.recentChanges.map((change) => (
                        <li key={change.id}>
                          <span className="history-dot" aria-hidden="true" />
                          <div>
                            <p className="history-summary">{change.summary}</p>
                            <p className="history-meta">
                              {change.actorLabel} · {relativeTime(change.createdAt)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === 'reminders' ? (
        <div role="tabpanel" id="panel-reminders" aria-labelledby="tab-reminders">
          <Banner tone="info" title="Email delivery in this environment">
            {capabilities.viewReminders
              ? 'Reminders are generated by the server scheduler. In test mode they are written to the delivery log below instead of being emailed. Each reminder has a unique event key, so retries do not create duplicates.'
              : 'Reminder delivery is limited to people with that access.'}
          </Banner>
          {reminders.length === 0 ? (
            <Card>
              <EmptyState
                icon="✉"
                title="No reminders yet"
                description="Create a test reminder, or wait for the scheduler to reach an upcoming dose or appointment."
              />
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="Delivery log"
                description={`${reminders.length} most recent reminder events. Subject lines deliberately avoid medicine names.`}
                action={
                  <Button variant="secondary" size="sm" loading={testBusy} onClick={() => void sendTest()}>
                    Send test reminder
                  </Button>
                }
              />
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="sr-only">Reminder delivery log</caption>
                  <thead>
                    <tr>
                      <th scope="col">Created</th>
                      <th scope="col">Type</th>
                      <th scope="col">Recipient</th>
                      <th scope="col">Status</th>
                      <th scope="col">Attempts</th>
                      <th scope="col">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reminders.map((reminder) => (
                      <tr key={reminder.id}>
                        <td>
                          {relativeTime(reminder.created_at)}
                          <span className="cell-sub">{formatTime(reminder.created_at, profile.timezone)}</span>
                        </td>
                        <td>{REMINDER_TYPE_LABELS[reminder.reminder_type] ?? reminder.reminder_type}</td>
                        <td>{reminder.recipient_email}</td>
                        <td>
                          <Chip
                            tone={
                              reminder.status === 'sent'
                                ? 'success'
                                : reminder.status === 'failed'
                                  ? 'danger'
                                  : reminder.status === 'skipped'
                                    ? 'neutral'
                                    : 'warn'
                            }
                          >
                            {reminder.status}
                          </Chip>
                          {reminder.last_error ? <span className="cell-sub">{reminder.last_error}</span> : null}
                        </td>
                        <td>{reminder.attempt_count}</td>
                        <td>{reminder.sent_at ? relativeTime(reminder.sent_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="log-details">
                <summary>See a sample message and its safety copy</summary>
                <pre className="message-preview">{reminders[0]?.body}</pre>
              </details>
            </Card>
          )}
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div role="tabpanel" id="panel-audit" aria-labelledby="tab-audit">
          <Card>
            <CardHeader
              title="Audit history"
              description="Who did what and when, limited to records you are permitted to see."
            />
            {audit.length === 0 ? (
              <EmptyState icon="▤" title="No audit events yet" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="sr-only">Audit history</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Who</th>
                      <th scope="col">Action</th>
                      <th scope="col">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((event) => (
                      <tr key={event.id}>
                        <td>
                          {relativeTime(event.createdAt)}
                          <span className="cell-sub">{formatDateTime(event.createdAt, profile.timezone)}</span>
                        </td>
                        <td>{event.actorLabel}</td>
                        <td>
                          <code className="action-code">{event.action}</code>
                        </td>
                        <td>{event.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function keyLabel(key: string) {
  switch (key) {
    case 'notRecorded':
      return 'Not recorded'
    default:
      return statusLabel(key as never)
  }
}
