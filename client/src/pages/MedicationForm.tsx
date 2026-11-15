import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import type { Medication, Recurrence } from '../lib/types'
import {
  WEEKDAYS,
  formatDateWithYear,
  scheduleSummary,
  todayInZone,
} from '../lib/format'
import {
  Banner,
  Button,
  Card,
  ErrorPanel,
  Field,
  Loading,
  PageHeader,
  Select,
  TextInput,
  Textarea,
} from '../components/ui'

type Step = 1 | 2 | 3

interface FormState {
  name: string
  strength: string
  form: string
  prescribedInstructions: string
  sourceNote: string
  startDate: string
  endDate: string
  recurrence: Recurrence
  times: string[]
  weekdays: number[]
  verified: boolean
  changeNote: string
}

interface FormErrors {
  name?: string
  prescribedInstructions?: string
  times?: string
  weekdays?: string
  dates?: string
  verified?: string
}

const FORM_OPTIONS = ['Tablet', 'Capsule', 'Liquid', 'Inhaler', 'Injection', 'Cream', 'Patch', 'Drops', 'Other']

export function MedicationFormPage() {
  const { profileId, profile, capabilities } = useProfile()
  const { medicationId } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(medicationId)

  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<FormState>({
    name: '',
    strength: '',
    form: '',
    prescribedInstructions: '',
    sourceNote: '',
    startDate: todayInZone(profile.timezone),
    endDate: '',
    recurrence: 'daily',
    times: ['08:00'],
    weekdays: [1, 2, 3, 4, 5],
    verified: false,
    changeNote: '',
  })
  const [timeDraft, setTimeDraft] = useState('08:00')
  const [errors, setErrors] = useState<FormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadMedication = useCallback(async () => {
    if (!medicationId) return
    setLoading(true)
    try {
      const data = await api.get<{ medication: Medication }>(
        `/api/profiles/${profileId}/medications/${medicationId}`,
      )
      const medication = data.medication
      setForm({
        name: medication.name,
        strength: medication.strength ?? '',
        form: medication.form ?? '',
        prescribedInstructions: medication.prescribedInstructions,
        sourceNote: medication.sourceNote ?? '',
        startDate: medication.startDate,
        endDate: medication.endDate ?? '',
        recurrence: medication.schedule?.recurrence ?? 'daily',
        times: medication.schedule?.localTimes ?? [],
        weekdays: medication.schedule?.weekdays ?? [],
        verified: false,
        changeNote: '',
      })
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [medicationId, profileId])

  useEffect(() => {
    void loadMedication()
  }, [loadMedication])

  const timezone = profile.timezone

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setServerError(null)
    if (key === 'name' || key === 'prescribedInstructions' || key === 'verified') {
      setErrors((current) => ({ ...current, [key]: undefined }))
    }
  }

  const addTime = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeDraft)) {
      setErrors((current) => ({ ...current, times: 'Choose a valid time.' }))
      return
    }
    if (form.times.includes(timeDraft)) {
      setErrors((current) => ({ ...current, times: 'That time is already in the schedule.' }))
      return
    }
    update('times', [...form.times, timeDraft].sort())
    setErrors((current) => ({ ...current, times: undefined }))
  }

  const validateStep = (target: Step): boolean => {
    const next: FormErrors = {}
    if (target >= 2) {
      if (!form.name.trim()) next.name = 'Enter the medicine name exactly as supplied.'
      if (form.prescribedInstructions.trim().length < 5) {
        next.prescribedInstructions =
          'Copy the prescribed instructions exactly as they were supplied. Do not summarise a dose.'
      }
    }
    if (target >= 3) {
      if (form.recurrence !== 'as_needed' && form.times.length === 0) {
        next.times = 'Add at least one time for this schedule.'
      }
      if (form.recurrence === 'weekly' && form.weekdays.length === 0) {
        next.weekdays = 'Choose at least one day of the week.'
      }
      if (form.endDate && form.endDate < form.startDate) {
        next.dates = 'The end date must be on or after the start date.'
      }
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      setStep(target === 3 ? 3 : 1)
      return false
    }
    return true
  }

  const goNext = () => {
    if (step === 1 && validateStep(2)) setStep(2)
    else if (step === 2 && validateStep(3)) setStep(3)
  }

  const submit = async () => {
    if (!form.verified) {
      setErrors({ verified: 'Confirm that these details match the prescription or clinician instruction.' })
      return
    }
    setSaving(true)
    setServerError(null)
    try {
      const payload = {
        name: form.name.trim(),
        strength: form.strength.trim() || null,
        form: form.form.trim() || null,
        prescribedInstructions: form.prescribedInstructions.trim(),
        sourceNote: form.sourceNote.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        status: 'active' as const,
        verified: form.verified,
        changeNote: form.changeNote.trim() || undefined,
        schedule: {
          localTimes: form.recurrence === 'as_needed' ? [] : form.times,
          recurrence: form.recurrence,
          weekdays: form.recurrence === 'weekly' ? form.weekdays : [],
        },
      }
      if (editing && medicationId) {
        await api.patch(`/api/profiles/${profileId}/medications/${medicationId}`, payload)
        navigate(`/app/${profileId}/medications/${medicationId}`)
      } else {
        const created = await api.post<{ medication: Medication }>(
          `/api/profiles/${profileId}/medications`,
          payload,
        )
        navigate(`/app/${profileId}/medications/${created.medication.id}`)
      }
    } catch (caught) {
      setServerError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  const schedulePreview = useMemo(
    () =>
      scheduleSummary({
        recurrence: form.recurrence,
        localTimes: form.times,
        weekdays: form.weekdays,
      }),
    [form.recurrence, form.times, form.weekdays],
  )

  if (!capabilities.editMedications) {
    return (
      <div className="page">
        <PageHeader title="Medication editing is not available" />
        <Banner tone="info" title="Read-only access">
          Your access level can view medicines but not add or change them. Ask the older adult or care-team
          administrator if you need editing access.
        </Banner>
        <Link className="btn btn-secondary" to={`/app/${profileId}/medications`}>
          Back to medicines
        </Link>
      </div>
    )
  }

  if (loading) return <Loading label="Loading medicine…" />
  if (loadError) {
    return (
      <div className="page">
        <ErrorPanel message={loadError} onRetry={() => void loadMedication()} />
        <Link className="btn btn-secondary" to={`/app/${profileId}/medications`}>
          Back to medicines
        </Link>
      </div>
    )
  }

  return (
    <div className="page form-page">
      <PageHeader
        eyebrow={editing ? 'Edit medicine' : 'New medicine'}
        title={editing ? `Edit ${form.name || 'medicine'}` : 'Add a medicine'}
        description="Enter only what is written on the prescription or the instruction from the prescriber, pharmacist or clinic. CareNest never infers a dose, frequency or timing."
        actions={
          <Link
            className="btn btn-quiet"
            to={
              editing && medicationId
                ? `/app/${profileId}/medications/${medicationId}`
                : `/app/${profileId}/medications`
            }
          >
            Cancel
          </Link>
        }
      />

      <ol className="stepper" aria-label="Progress">
        {[
          { number: 1, label: 'Medicine' },
          { number: 2, label: 'Schedule' },
          { number: 3, label: 'Review and save' },
        ].map((item) => (
          <li
            key={item.number}
            className={`step ${step === item.number ? 'step-current' : ''} ${step > item.number ? 'step-done' : ''}`}
            aria-current={step === item.number ? 'step' : undefined}
          >
            <span className="step-number">{step > item.number ? '✓' : item.number}</span>
            <span className="step-label">{item.label}</span>
          </li>
        ))}
      </ol>

      {serverError ? (
        <Banner tone="danger" title="The medicine was not saved">
          {serverError}
        </Banner>
      ) : null}

      {step === 1 ? (
        <Card className="form-card">
          <div className="form-grid">
            <Field id="med-name" label="Medicine name" required error={errors.name}>
              <TextInput
                id="med-name"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                autoComplete="off"
                placeholder="Exactly as written on the prescription"
              />
            </Field>
            <Field id="med-strength" label="Strength" hint="For example 5 mg. Leave blank if not supplied.">
              <TextInput
                id="med-strength"
                value={form.strength}
                onChange={(event) => update('strength', event.target.value)}
                placeholder="5 mg"
              />
            </Field>
            <Field id="med-form" label="Form">
              <Select id="med-form" value={form.form} onChange={(event) => update('form', event.target.value)}>
                <option value="">Not recorded</option>
                {FORM_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            id="med-instructions"
            label="Prescribed instructions"
            required
            error={errors.prescribedInstructions}
            hint="Copy the instruction word for word. Do not rewrite it, add a dose or guess a missing part."
          >
            <Textarea
              id="med-instructions"
              rows={4}
              value={form.prescribedInstructions}
              onChange={(event) => update('prescribedInstructions', event.target.value)}
              placeholder="For example: Take ONE tablet by mouth each morning."
              maxLength={2000}
            />
          </Field>

          <Field
            id="med-source"
            label="Source or verification note"
            hint="Optional. For example: entered from the pharmacy label dated 12 November."
          >
            <TextInput
              id="med-source"
              value={form.sourceNote}
              onChange={(event) => update('sourceNote', event.target.value)}
              maxLength={500}
            />
          </Field>

          <div className="form-grid">
            <Field id="med-start" label="Start date" required>
              <TextInput
                id="med-start"
                type="date"
                value={form.startDate}
                onChange={(event) => update('startDate', event.target.value)}
              />
            </Field>
            <Field id="med-end" label="End date" hint="Leave blank if the medicine is ongoing." error={errors.dates}>
              <TextInput
                id="med-end"
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(event) => update('endDate', event.target.value)}
              />
            </Field>
          </div>

          <Banner tone="info" title="Safety boundary">
            If any part of the instruction is missing or conflicting, stop and ask the prescriber or
            pharmacist to confirm it. CareNest will not fill in the gap.
          </Banner>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="form-card">
          <fieldset className="fieldset">
            <legend className="field-label">How is this medicine scheduled?</legend>
            <div className="option-cards">
              {(
                [
                  { value: 'daily', title: 'Every day', copy: 'One or more times each day.' },
                  {
                    value: 'weekly',
                    title: 'Certain days',
                    copy: 'For example Monday, Wednesday and Friday.',
                  },
                  {
                    value: 'as_needed',
                    title: 'Only when needed',
                    copy: 'No scheduled doses. The instruction still applies.',
                  },
                ] as Array<{ value: Recurrence; title: string; copy: string }>
              ).map((option) => (
                <label
                  key={option.value}
                  className={`option-card ${form.recurrence === option.value ? 'option-card-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="recurrence"
                    value={option.value}
                    checked={form.recurrence === option.value}
                    onChange={() => {
                      update('recurrence', option.value)
                      if (option.value === 'as_needed') update('times', [])
                      if (option.value === 'weekly' && form.weekdays.length === 0) {
                        update('weekdays', [1, 2, 3, 4, 5])
                      }
                    }}
                  />
                  <span className="option-title">{option.title}</span>
                  <span className="option-copy">{option.copy}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {form.recurrence !== 'as_needed' ? (
            <>
              <div className="form-block">
                <h2 className="form-block-title">Times of day</h2>
                <p className="field-hint">Local times in {timezone}. Add each time exactly as instructed.</p>
                {form.times.length > 0 ? (
                  <ul className="time-list">
                    {form.times.map((time) => (
                      <li key={time} className="time-chip">
                        <span>{time}</span>
                        <button
                          type="button"
                          className="chip-remove"
                          onClick={() => update('times', form.times.filter((entry) => entry !== time))}
                          aria-label={`Remove ${time}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No times added yet.</p>
                )}
                <div className="time-adder">
                  <label className="sr-only" htmlFor="time-draft">
                    New dose time
                  </label>
                  <TextInput
                    id="time-draft"
                    type="time"
                    value={timeDraft}
                    onChange={(event) => setTimeDraft(event.target.value)}
                  />
                  <Button variant="secondary" onClick={addTime}>
                    Add time
                  </Button>
                </div>
                {errors.times ? (
                  <p className="field-message" role="alert">
                    {errors.times}
                  </p>
                ) : null}
              </div>

              {form.recurrence === 'weekly' ? (
                <fieldset className="fieldset">
                  <legend className="field-label">Days of the week</legend>
                  <div className="weekday-grid">
                    {WEEKDAYS.map((day) => {
                      const selected = form.weekdays.includes(day.value)
                      return (
                        <label
                          key={day.value}
                          className={`weekday-toggle ${selected ? 'weekday-toggle-on' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              update(
                                'weekdays',
                                selected
                                  ? form.weekdays.filter((value) => value !== day.value)
                                  : [...form.weekdays, day.value],
                              )
                            }
                          />
                          <span className="weekday-long">{day.long}</span>
                          <span className="weekday-short" aria-hidden="true">
                            {day.short}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  {errors.weekdays ? (
                    <p className="field-message" role="alert">
                      {errors.weekdays}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
            </>
          ) : (
            <Banner tone="info" title="As-needed medicine">
              No scheduled doses will be created. The prescribed instruction is still stored and visible to
              the care circle with the correct permissions.
            </Banner>
          )}

          <div className="schedule-preview">
            <span className="schedule-preview-label">Schedule summary</span>
            <strong>{schedulePreview}</strong>
            <span className="muted-note">
              From {formatDateWithYear(form.startDate)}
              {form.endDate ? ` until ${formatDateWithYear(form.endDate)}` : ', ongoing'}
            </span>
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="form-card">
          <h2 className="form-block-title">Review before saving</h2>
          <dl className="review-list">
            <div>
              <dt>Medicine</dt>
              <dd>
                {form.name} {form.strength} {form.form ? `· ${form.form}` : ''}
              </dd>
            </div>
            <div>
              <dt>Prescribed instructions</dt>
              <dd className="review-instructions">{form.prescribedInstructions}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{schedulePreview}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>
                {formatDateWithYear(form.startDate)}
                {form.endDate ? ` → ${formatDateWithYear(form.endDate)}` : ' · ongoing'}
              </dd>
            </div>
            {form.sourceNote ? (
              <div>
                <dt>Source note</dt>
                <dd>{form.sourceNote}</dd>
              </div>
            ) : null}
            <div>
              <dt>Time zone</dt>
              <dd>{timezone}</dd>
            </div>
          </dl>

          <div className="verify-box">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.verified}
                onChange={(event) => update('verified', event.target.checked)}
              />
              <span>
                I entered these details exactly as they appear on the prescription or the instruction from
                the prescriber, pharmacist or clinic. I understand CareNest does not check or calculate doses.
              </span>
            </label>
            {errors.verified ? (
              <p className="field-message" role="alert">
                {errors.verified}
              </p>
            ) : null}
          </div>

          <Field id="change-note" label="Change note" hint="Optional. Shown in the medication history.">
            <TextInput
              id="change-note"
              value={form.changeNote}
              onChange={(event) => update('changeNote', event.target.value)}
              maxLength={300}
            />
          </Field>

          {editing ? (
            <Banner tone="warn" title="This changes future doses">
              Recorded doses stay in the history. Future unconfirmed doses will be rebuilt from the new
              schedule. Everyone with access will see who made the change.
            </Banner>
          ) : null}
        </Card>
      ) : null}

      <div className="form-actions">
        {step > 1 ? (
          <Button variant="secondary" onClick={() => setStep((step - 1) as Step)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="button-row">
          {step < 3 ? (
            <Button onClick={goNext}>Continue</Button>
          ) : (
            <Button loading={saving} onClick={() => void submit()}>
              {editing ? 'Save changes' : 'Save medicine'}
            </Button>
          )}
        </div>
      </div>

      <p className="page-note">
        Need to correct a dose that was already recorded? Open the medicine detail or today’s timeline and
        use “Correct”, so the change is auditable.
      </p>
    </div>
  )
}
