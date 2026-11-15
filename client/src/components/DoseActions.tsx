import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { formatTime } from '../lib/format'
import type { Dose } from '../lib/types'
import { useProfile } from '../context/ProfileProvider'
import { useToast, Button, Dialog, Field, Textarea } from './ui'

type Mode = 'taken' | 'skipped' | 'snooze' | 'correct' | null

export function DoseActions({
  dose,
  onChanged,
  layout = 'row',
}: {
  dose: Dose
  onChanged: () => void
  layout?: 'row' | 'stacked'
}) {
  const { profileId, profile, capabilities } = useProfile()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [snoozeMinutes, setSnoozeMinutes] = useState(30)
  const [correctionStatus, setCorrectionStatus] = useState<'taken' | 'skipped'>('taken')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!capabilities.recordDoses) return null

  const open = (next: Mode) => {
    setMode(next)
    setNote('')
    setReason('')
    setError(null)
    setSnoozeMinutes(30)
    setCorrectionStatus(dose.status === 'taken' ? 'skipped' : 'taken')
  }

  const close = () => {
    setMode(null)
    setBusy(false)
    setError(null)
  }

  const recorded = dose.status === 'taken' || dose.status === 'skipped'
  const canRecordOutcome = ['due', 'upcoming', 'snoozed', 'missed', 'not_recorded'].includes(dose.status)

  const submitRecord = async (action: 'taken' | 'skipped' | 'snooze') => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/profiles/${profileId}/doses/${dose.id}/record`, {
        action,
        note: note.trim() || null,
        snoozeMinutes: action === 'snooze' ? snoozeMinutes : undefined,
      })
      toast.push(
        action === 'taken'
          ? `${dose.medicationName} confirmed as taken.`
          : action === 'skipped'
            ? `${dose.medicationName} recorded as skipped.`
            : `Snoozed ${dose.medicationName} for ${snoozeMinutes} minutes.`,
      )
      close()
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const submitCorrection = async () => {
    if (reason.trim().length < 3) {
      setError('Add a short reason so the correction is clear in the history.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post(`/api/profiles/${profileId}/doses/${dose.id}/correct`, {
        status: correctionStatus,
        reason: reason.trim(),
      })
      toast.push('Dose record corrected and added to the history.')
      close()
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={layout === 'stacked' ? 'dose-actions dose-actions-stacked' : 'dose-actions'}>
      {recorded ? (
        <Button variant="quiet" size="sm" onClick={() => open('correct')}>
          Correct
        </Button>
      ) : canRecordOutcome ? (
        <>
          <Button size="sm" onClick={() => open('taken')}>
            Taken
          </Button>
          <Button variant="secondary" size="sm" onClick={() => open('skipped')}>
            Skipped
          </Button>
          <Button variant="quiet" size="sm" onClick={() => open('snooze')}>
            Snooze
          </Button>
        </>
      ) : null}

      <Dialog
        open={mode === 'taken' || mode === 'skipped'}
        onClose={close}
        title={mode === 'skipped' ? 'Record this dose as skipped?' : 'Confirm this dose as taken?'}
        description={`${dose.medicationName}${dose.strength ? ` ${dose.strength}` : ''}, scheduled for ${formatTime(
          dose.scheduledFor,
          profile?.timezone ?? 'Europe/London',
        )}.`}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={mode === 'skipped' ? 'secondary' : 'primary'}
              loading={busy}
              onClick={() => void submitRecord(mode === 'skipped' ? 'skipped' : 'taken')}
            >
              {mode === 'skipped' ? 'Record as skipped' : 'Yes, confirm as taken'}
            </Button>
          </>
        }
      >
        <div className="prose">
          {mode === 'skipped' ? (
            <p>
              This records that the dose was skipped. It does not change the prescribed instructions or
              suggest a replacement dose.
            </p>
          ) : (
            <p>
              This records that the dose was taken, together with your name and the time. Only confirm what
              actually happened.
            </p>
          )}
          <Field id="dose-note" label="Add a note (optional)" hint="For example: taken with breakfast.">
            <Textarea
              id="dose-note"
              rows={2}
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          {error ? (
            <p className="field-message" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={mode === 'snooze'}
        onClose={close}
        title="Snooze this reminder"
        description="Snoozing only delays the reminder. It does not record the dose as taken."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void submitRecord('snooze')}>
              Snooze reminder
            </Button>
          </>
        }
      >
        <fieldset className="fieldset">
          <legend className="field-label">Remind me again in</legend>
          {[15, 30, 60].map((minutes) => (
            <label key={minutes} className="radio-row">
              <input
                type="radio"
                name="snooze"
                value={minutes}
                checked={snoozeMinutes === minutes}
                onChange={() => setSnoozeMinutes(minutes)}
              />
              <span>
                {minutes} minutes
                {minutes === 30 ? ' (recommended)' : ''}
              </span>
            </label>
          ))}
        </fieldset>
        {error ? (
          <p className="field-message" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={mode === 'correct'}
        onClose={close}
        title="Correct a recorded dose"
        description="Corrections keep the original action in the audit history."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void submitCorrection()}>
              Save correction
            </Button>
          </>
        }
      >
        <div className="prose">
          <p>
            {dose.medicationName} is currently recorded as <strong>{dose.status}</strong>
            {dose.recordedByName ? ` by ${dose.recordedByName}` : ''}.
          </p>
          <Field id="correction-status" label="Correct the record to">
            <div className="radio-row-group">
              <label className="radio-row">
                <input
                  type="radio"
                  name="correction"
                  checked={correctionStatus === 'taken'}
                  onChange={() => setCorrectionStatus('taken')}
                />
                <span>Taken</span>
              </label>
              <label className="radio-row">
                <input
                  type="radio"
                  name="correction"
                  checked={correctionStatus === 'skipped'}
                  onChange={() => setCorrectionStatus('skipped')}
                />
                <span>Skipped</span>
              </label>
            </div>
          </Field>
          <p className="muted-note">
            The correction is saved with your name, the new outcome and the reason. The original entry stays
            in the audit history.
          </p>
          <Field id="correction-reason" label="Reason for the correction" required>
            <Textarea
              id="correction-reason"
              rows={2}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: confirmed with Margaret that the dose was taken at 08:10."
            />
          </Field>
          {error ? (
            <p className="field-message" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}
