import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import { TIMEZONES, timezoneLabel, todayInZone } from '../lib/format'
import type { CareProfile } from '../lib/types'
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Chip,
  Field,
  PageHeader,
  Select,
  TextInput,
  Toggle,
  useToast,
} from '../components/ui'

const GRACE_OPTIONS = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 720, label: '12 hours' },
]

const DOSE_LEAD_OPTIONS = [0, 5, 10, 15, 30, 60]
const APPOINTMENT_LEAD_OPTIONS = [0, 60, 180, 1440, 2880, 10080]

export function SettingsPage() {
  const { profileId, profile, capabilities, setProfile } = useProfile()
  const { user, signOut, largeText, highContrast, setLargeText, setHighContrast, markPinEnabled } =
    useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [form, setForm] = useState<CareProfile>(profile)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  const [exportBusy, setExportBusy] = useState(false)

  useEffect(() => {
    setForm(profile)
  }, [profile])

  const update = <Key extends keyof CareProfile>(key: Key, value: CareProfile[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setProfileError(null)
  }

  const saveProfile = useCallback(async () => {
    setSavingProfile(true)
    setProfileError(null)
    try {
      const result = await api.patch<{ profile: CareProfile }>(
        `/api/profiles/${profileId}`,
        {
          preferredName: form.preferredName.trim(),
          timezone: form.timezone,
          graceMinutes: form.graceMinutes,
          missedTracking: form.missedTracking,
          shareMedications: form.shareMedications,
          shareAppointments: form.shareAppointments,
          doseReminderLeadMinutes: form.doseReminderLeadMinutes,
          appointmentReminderLeadMinutes: form.appointmentReminderLeadMinutes,
        },
      )
      setProfile(result.profile)
      toast.push('Care settings saved.')
    } catch (caught) {
      setProfileError(errorMessage(caught))
    } finally {
      setSavingProfile(false)
    }
  }, [form, profileId, setProfile, toast])

  const savePin = async () => {
    if (!/^\d{4,6}$/.test(pin)) {
      setPinError('Choose a PIN of 4 to 6 digits.')
      return
    }
    if (pin !== pinConfirm) {
      setPinError('The two PIN entries do not match.')
      return
    }
    setPinBusy(true)
    setPinError(null)
    try {
      await api.post('/api/auth/pin', { pin })
      markPinEnabled(true)
      setPin('')
      setPinConfirm('')
      toast.push('Quick-unlock PIN saved. Your password is still required to sign in.')
    } catch (caught) {
      setPinError(errorMessage(caught))
    } finally {
      setPinBusy(false)
    }
  }

  const removePin = async () => {
    if (!password) {
      setPinError('Enter your account password to remove the PIN.')
      return
    }
    setPinBusy(true)
    setPinError(null)
    try {
      await api.del('/api/auth/pin', { password })
      markPinEnabled(false)
      setPassword('')
      toast.push('Quick-unlock PIN removed.')
    } catch (caught) {
      setPinError(errorMessage(caught))
    } finally {
      setPinBusy(false)
    }
  }

  const downloadExport = async () => {
    setExportBusy(true)
    try {
      const response = await fetch(`/api/profiles/${profileId}/export`, { credentials: 'include' })
      if (!response.ok) throw new Error('The export could not be created.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `carenest-${profile.preferredName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayInZone(profile.timezone)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.push('Your data export was downloaded.')
    } catch (caught) {
      toast.push(errorMessage(caught), 'error')
    } finally {
      setExportBusy(false)
    }
  }

  if (!capabilities.manageMembers && !capabilities.editMedications) {
    return (
      <div className="page">
        <PageHeader eyebrow="Care settings" title="Settings are not available" />
        <Banner tone="info" title="Read-only access">
          Only the older adult or a care-team administrator can change care settings. Your reminder
          preferences are available from the care circle page.
        </Banner>
        <Link className="btn btn-secondary" to="../care-circle">
          Go to the care circle
        </Link>
      </div>
    )
  }

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Care settings"
        title="Settings for this care space"
        description="Check the time zone, reminder timing and sharing choices. CareNest never calculates or changes a prescribed dose."
      />

      <div className="settings-grid">
        <div className="settings-main">
          <Card>
            <CardHeader
              title="Care profile"
              description="The preferred name is what the care circle sees throughout CareNest."
            />
            {profileError ? (
              <Banner tone="danger" title="Settings were not saved">
                {profileError}
              </Banner>
            ) : null}
            <div className="form-grid">
              <Field id="settings-name" label="Preferred name" required>
                <TextInput
                  id="settings-name"
                  value={form.preferredName}
                  maxLength={60}
                  onChange={(event) => update('preferredName', event.target.value)}
                />
              </Field>
              <Field
                id="settings-timezone"
                label="Time zone"
                hint="Schedules and today's date are interpreted in this zone."
              >
                <Select
                  id="settings-timezone"
                  value={form.timezone}
                  onChange={(event) => update('timezone', event.target.value)}
                >
                  {[...new Set([form.timezone, ...TIMEZONES])].map((zone) => (
                    <option key={zone} value={zone}>
                      {timezoneLabel(zone)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="muted-note">
              Changing the time zone rebuilds future unconfirmed doses. Recorded doses keep their original
              times.
            </p>
          </Card>

          <Card>
            <CardHeader
              title="Dose tracking"
              description="Decide how long to wait before a dose with no confirmation is labelled missed."
            />
            <Toggle
              id="settings-missed"
              checked={form.missedTracking}
              onChange={(checked) => update('missedTracking', checked)}
              label="Apply the missed rule"
              description="When off, doses with no confirmation stay “not recorded” instead of being labelled missed."
            />
            <Field
              id="settings-grace"
              label="Grace period"
              hint="Time after the scheduled dose (or a snooze) before the missed rule applies."
            >
              <Select
                id="settings-grace"
                value={form.graceMinutes}
                disabled={!form.missedTracking}
                onChange={(event) => update('graceMinutes', Number(event.target.value))}
              >
                {GRACE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="definition-callout">
              <p>
                <strong>Missed</strong> means the grace period passed with no confirmation.
              </p>
              <p>
                <strong>Not recorded</strong> means CareNest has no confirmation and did not apply the missed
                rule. They are never treated as the same thing.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Sharing with family viewers"
              description="Applies to every family viewer on this care profile."
            />
            <Toggle
              id="settings-share-meds"
              checked={form.shareMedications}
              onChange={(checked) => update('shareMedications', checked)}
              label="Share medicines and dose history"
              description="Family viewers can read the medicine list and dose records, but cannot change them."
            />
            <Toggle
              id="settings-share-appointments"
              checked={form.shareAppointments}
              onChange={(checked) => update('shareAppointments', checked)}
              label="Share appointments"
              description="Family viewers can read appointment details and reminders shown here."
            />
          </Card>

          <Card>
            <CardHeader
              title="Email reminder timing"
              description="These are defaults for scheduling reminders. Each member can still choose what they receive."
            />
            <div className="form-grid">
              <Field id="settings-dose-lead" label="Before a scheduled dose">
                <Select
                  id="settings-dose-lead"
                  value={form.doseReminderLeadMinutes}
                  onChange={(event) => update('doseReminderLeadMinutes', Number(event.target.value))}
                >
                  {DOSE_LEAD_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes === 0 ? 'At the scheduled time' : `${minutes} minutes before`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="settings-appointment-lead" label="Before an appointment">
                <Select
                  id="settings-appointment-lead"
                  value={form.appointmentReminderLeadMinutes}
                  onChange={(event) =>
                    update('appointmentReminderLeadMinutes', Number(event.target.value))
                  }
                >
                  {APPOINTMENT_LEAD_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes === 0
                        ? 'At the start time'
                        : minutes < 1440
                          ? `${Math.round(minutes / 60)} hour${minutes === 60 ? '' : 's'} before`
                          : `${Math.round(minutes / 1440)} day${minutes === 1440 ? '' : 's'} before`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Banner tone="info" title="Reminders can be delayed or fail">
              CareNest email is scheduling support, not emergency monitoring. Keep the arrangements agreed
              with your care team for urgent needs.
            </Banner>
          </Card>

          <div className="settings-save">
            <Button loading={savingProfile} onClick={() => void saveProfile()}>
              Save care settings
            </Button>
            <Button variant="quiet" onClick={() => setForm(profile)} disabled={savingProfile}>
              Reset changes
            </Button>
          </div>
        </div>

        <aside className="settings-side">
          <Card tone="mint">
            <CardHeader title="Display and accessibility" level={3} />
            <Toggle
              id="settings-large-text"
              checked={largeText}
              onChange={setLargeText}
              label="Larger text"
              description="Increase text and control sizes across CareNest."
            />
            <Toggle
              id="settings-contrast"
              checked={highContrast}
              onChange={setHighContrast}
              label="High contrast"
              description="Stronger borders and colour contrast."
            />
            <p className="muted-note">
              These preferences are stored on this device. CareNest never relies on colour alone to show a
              status.
            </p>
          </Card>

          <Card>
            <CardHeader title="Quick-unlock PIN" level={3} />
            <p className="muted-note">
              A PIN only unlocks a session that is already signed in. It never replaces your password or
              grants extra access.
            </p>
            {user?.pinEnabled ? (
              <div className="modal-form">
                <Chip tone="success">PIN is set</Chip>
                <Field
                  id="settings-password"
                  label="Account password"
                  hint="Required to remove the PIN."
                >
                  <TextInput
                    id="settings-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                {pinError ? (
                  <p className="field-message" role="alert">
                    {pinError}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  loading={pinBusy}
                  onClick={() => void removePin()}
                >
                  Remove PIN
                </Button>
              </div>
            ) : (
              <div className="modal-form">
                <Field
                  id="settings-pin"
                  label="New PIN"
                  hint="4 to 6 digits. Do not reuse a bank or door PIN."
                >
                  <TextInput
                    id="settings-pin"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                <Field id="settings-pin-confirm" label="Confirm PIN">
                  <TextInput
                    id="settings-pin-confirm"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={pinConfirm}
                    onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                {pinError ? (
                  <p className="field-message" role="alert">
                    {pinError}
                  </p>
                ) : null}
                <Button loading={pinBusy} onClick={() => void savePin()}>
                  Save PIN
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Your data" level={3} />
            {capabilities.exportData ? (
              <>
                <p className="muted-note">
                  Download a JSON copy of this care profile, including medicines, appointments and dose
                  records.
                </p>
                <Button variant="secondary" loading={exportBusy} onClick={() => void downloadExport()}>
                  Download data export
                </Button>
              </>
            ) : (
              <p className="muted-note">
                Only the older adult or a care-team administrator can export the care record.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Account" level={3} />
            <p className="muted-note">
              Signed in as {user?.displayName} ({user?.email}).
            </p>
            <Button
              variant="quiet"
              onClick={() => {
                void signOut().then(() => navigate('/signin'))
              }}
            >
              Sign out
            </Button>
          </Card>
        </aside>
      </div>

      <Banner tone="warn" title="Safety boundaries">
        CareNest stores the instructions entered by an authorised person. It does not diagnose, prescribe,
        calculate doses, advise catch-up dosing or monitor for emergencies. If you are worried about a
        medicine or someone’s health, contact the prescriber, pharmacist or local emergency services.
      </Banner>
    </div>
  )
}
