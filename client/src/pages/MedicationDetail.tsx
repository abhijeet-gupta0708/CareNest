import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import type { Dose, Medication } from '../lib/types'
import {
  addDays,
  formatDateWithYear,
  formatTime,
  medicationScheduleLabel,
  relativeTime,
  todayInZone,
} from '../lib/format'
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Chip,
  Dialog,
  EmptyState,
  ErrorPanel,
  Field,
  Loading,
  PageHeader,
  StatusChip,
  Textarea,
  useToast,
} from '../components/ui'

interface HistoryEvent {
  id: string
  actorLabel: string
  action: string
  summary: string
  createdAt: string
}

type StatusTarget = 'active' | 'paused' | 'completed'

const STATUS_COPY: Record<StatusTarget, { title: string; description: string; confirm: string }> = {
  active: {
    title: 'Resume this medicine',
    description: 'Future doses will be scheduled again from the recorded schedule.',
    confirm: 'Resume medicine',
  },
  paused: {
    title: 'Pause this medicine',
    description:
      'Future unconfirmed doses are removed from the timeline. Recorded doses stay in the history. Only pause when the prescriber or care team has said so.',
    confirm: 'Pause medicine',
  },
  completed: {
    title: 'Mark this medicine as completed',
    description:
      'Use this only when the course has finished. Future unconfirmed doses are removed; history is kept.',
    confirm: 'Mark as completed',
  },
}

export function MedicationDetailPage() {
  const { profileId, profile, capabilities } = useProfile()
  const { medicationId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [medication, setMedication] = useState<Medication | null>(null)
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [recentDoses, setRecentDoses] = useState<Dose[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!medicationId) return
    setLoading(true)
    try {
      const [detail, doseData] = await Promise.all([
        api.get<{ medication: Medication; history: HistoryEvent[] }>(
          `/api/profiles/${profileId}/medications/${medicationId}`,
        ),
        api
          .get<{ doses: Dose[] }>(
            `/api/profiles/${profileId}/doses?from=${addDays(todayInZone(profile.timezone), -28)}&to=${todayInZone(profile.timezone)}`,
          )
          .catch(() => ({ doses: [] as Dose[] })),
      ])
      setMedication(detail.medication)
      setHistory(detail.history)
      setRecentDoses(
        doseData.doses
          .filter((dose) => dose.medicationId === medicationId)
          .sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1))
          .slice(0, 8),
      )
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [medicationId, profile.timezone, profileId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Loading label="Loading medicine…" />
  if (error || !medication) {
    return (
      <div className="page">
        <ErrorPanel message={error ?? 'That medicine could not be found.'} onRetry={() => void load()} />
        <Link className="btn btn-secondary" to={`/app/${profileId}/medications`}>
          Back to medicines
        </Link>
      </div>
    )
  }

  const changeStatus = async () => {
    if (!statusTarget) return
    if (statusTarget !== 'active' && reason.trim().length < 3) {
      setDialogError('Add a short reason for this change.')
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      await api.post(`/api/profiles/${profileId}/medications/${medication.id}/status`, {
        status: statusTarget,
        reason: reason.trim() || 'Resumed with the recorded schedule.',
      })
      toast.push(
        statusTarget === 'active'
          ? `${medication.name} resumed.`
          : statusTarget === 'paused'
            ? `${medication.name} paused.`
            : `${medication.name} marked as completed.`,
      )
      setStatusTarget(null)
      setReason('')
      await load()
    } catch (caught) {
      setDialogError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const statusChipTone =
    medication.status === 'active' ? 'success' : medication.status === 'paused' ? 'warn' : 'neutral'

  return (
    <div className="page">
      <PageHeader
        eyebrow="Medicine details"
        title={
          <>
            {medication.name}
            {medication.strength ? <span className="title-strength"> {medication.strength}</span> : null}
          </>
        }
        description={[medication.form, medication.status === 'active' ? 'Active medicine' : medication.status]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Chip tone={statusChipTone}>{medication.status}</Chip>
            {capabilities.editMedications ? (
              <Link className="btn btn-primary" to={`/app/${profileId}/medications/${medication.id}/edit`}>
                Edit medicine
              </Link>
            ) : null}
          </>
        }
      />

      <div className="detail-grid">
        <div className="detail-main">
          <Card>
            <CardHeader title="Prescribed instructions" />
            <p className="instruction-large">{medication.prescribedInstructions}</p>
            <div className="instruction-meta">
              <Chip tone="teal">
                {medication.schedule ? medicationScheduleLabel(medication) : 'No schedule'}
              </Chip>
              <Chip>
                {formatDateWithYear(medication.startDate)}
                {medication.endDate ? ` → ${formatDateWithYear(medication.endDate)}` : ' · ongoing'}
              </Chip>
              <Chip>{profile.timezone}</Chip>
            </div>
            <p className="safety-note">
              This is the instruction entered by an authorised person. CareNest does not calculate doses,
              change schedules or advise catch-up dosing. Check any change against the prescription or the
              prescriber’s instructions.
            </p>
          </Card>

          <Card>
            <CardHeader
              title="Recent dose record"
              description="The last four weeks for this medicine."
              action={
                <Link className="text-link" to={`/app/${profileId}/reports`}>
                  Adherence report
                </Link>
              }
            />
            {recentDoses.length === 0 ? (
              <EmptyState
                icon="○"
                title="No doses recorded in the last four weeks"
                description="Scheduled doses will appear here once they are due."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="sr-only">Recent doses for {medication.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Scheduled</th>
                      <th scope="col">Status</th>
                      <th scope="col">Recorded by</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDoses.map((dose) => (
                      <tr key={dose.id}>
                        <td>
                          {formatDateWithYear(dose.localDate)} · {formatTime(dose.scheduledFor, profile.timezone)}
                        </td>
                        <td>
                          <StatusChip status={dose.status} />
                        </td>
                        <td>
                          {dose.recordedByName ?? '—'}
                          {dose.recordedAt ? (
                            <span className="cell-sub">{formatTime(dose.recordedAt, profile.timezone)}</span>
                          ) : null}
                        </td>
                        <td>{dose.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Change history" description="Who changed this record, and when." />
            {history.length === 0 ? (
              <p className="muted-note">No changes recorded yet.</p>
            ) : (
              <ul className="history-list">
                {history.map((event) => (
                  <li key={event.id}>
                    <span className="history-dot" aria-hidden="true" />
                    <div>
                      <p className="history-summary">{event.summary}</p>
                      <p className="history-meta">
                        {event.actorLabel} · {relativeTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="detail-side">
          <Card tone="mint">
            <CardHeader title="Recorded facts" level={3} />
            <dl className="fact-list">
              <div>
                <dt>Added by</dt>
                <dd>{medication.createdByName ?? 'Recorded user'}</dd>
              </div>
              <div>
                <dt>Last edited by</dt>
                <dd>
                  {medication.updatedByName ?? 'Recorded user'} · {relativeTime(medication.updatedAt)}
                </dd>
              </div>
              <div>
                <dt>Source note</dt>
                <dd>{medication.sourceNote ?? 'None recorded'}</dd>
              </div>
              <div>
                <dt>Schedule</dt>
                <dd>{medicationScheduleLabel(medication)}</dd>
              </div>
            </dl>
          </Card>

          {capabilities.editMedications ? (
            <Card>
              <CardHeader title="Medicine status" level={3} />
              <p className="muted-note">
                Pausing or completing a medicine affects future doses only. Every change is recorded in the
                history.
              </p>
              <div className="stacked-actions">
                {medication.status !== 'active' ? (
                  <Button variant="secondary" onClick={() => setStatusTarget('active')}>
                    Resume medicine
                  </Button>
                ) : null}
                {medication.status === 'active' ? (
                  <Button variant="secondary" onClick={() => setStatusTarget('paused')}>
                    Pause medicine
                  </Button>
                ) : null}
                {medication.status !== 'completed' ? (
                  <Button variant="quiet" onClick={() => setStatusTarget('completed')}>
                    Mark as completed
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Access" level={3} />
            <p className="muted-note">
              {capabilities.editMedications
                ? 'You can edit this medicine because your role includes medication editing.'
                : 'You can view this medicine. Editing is limited to the older adult or an authorised caregiver.'}
            </p>
            <Link className="text-link" to={`/app/${profileId}/care-circle`}>
              See who has access
            </Link>
          </Card>
        </aside>
      </div>

      <Dialog
        open={statusTarget !== null}
        onClose={() => {
          setStatusTarget(null)
          setReason('')
          setDialogError(null)
        }}
        title={statusTarget ? STATUS_COPY[statusTarget].title : ''}
        description={statusTarget ? STATUS_COPY[statusTarget].description : undefined}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setStatusTarget(null)
                setReason('')
              }}
            >
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void changeStatus()}>
              {statusTarget ? STATUS_COPY[statusTarget].confirm : 'Save'}
            </Button>
          </>
        }
      >
        <div className="prose">
          <p>
            {medication.name} {medication.strength ?? ''} will be updated for {profile.preferredName}. Your
            name and the reason will be visible in the change history.
          </p>
          <Field
            id="status-reason"
            label="Reason"
            required={statusTarget !== 'active'}
            hint="For example: paused after the GP review on 12 November."
          >
            <Textarea
              id="status-reason"
              rows={2}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {dialogError ? (
            <p className="field-message" role="alert">
              {dialogError}
            </p>
          ) : null}
        </div>
      </Dialog>

      <div className="detail-back">
        <Button
          variant="quiet"
          onClick={() => {
            navigate(`/app/${profileId}/medications`)
          }}
        >
          ← Back to all medicines
        </Button>
      </div>

      <Banner tone="info" title="Looking for a dose record?">
        Find today’s doses on the <Link to={`/app/${profileId}/today`}>Today</Link> screen, or review trends in{' '}
        <Link to={`/app/${profileId}/reports`}>Reports</Link>.
      </Banner>
    </div>
  )
}
