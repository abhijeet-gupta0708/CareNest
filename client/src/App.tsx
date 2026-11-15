import { useEffect, useId, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { useAuth } from './context/AuthProvider'
import { ProfileProvider } from './context/ProfileProvider'
import { Shell } from './components/Shell'
import { Button, Card, ToastProvider } from './components/ui'
import { SignInPage } from './pages/SignIn'
import { RegisterPage } from './pages/Register'
import { InvitePage } from './pages/Invite'
import { TodayPage } from './pages/Today'
import { MedicationsPage } from './pages/Medications'
import { MedicationFormPage } from './pages/MedicationForm'
import { MedicationDetailPage } from './pages/MedicationDetail'
import { AppointmentsPage } from './pages/Appointments'
import { CareCirclePage } from './pages/CareCircle'
import { ReportsPage } from './pages/Reports'
import { SettingsPage } from './pages/Settings'

function Splash({ message = 'Preparing your care space…' }: { message?: string }) {
  return (
    <div className="gate" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return <Splash />
  if (!user) return <Navigate to="/signin" replace />
  return <>{children}</>
}

function HomeRedirect() {
  const { user, profiles, ready } = useAuth()
  if (!ready) return <Splash />
  if (!user) return <Navigate to="/signin" replace />
  const first = profiles[0]
  if (!first) {
    return (
      <div className="gate">
        <Card className="gate-card">
          <h1>No care circle yet</h1>
          <p>Your account is signed in, but there is no care profile to open.</p>
          <Link className="btn btn-primary" to="/signin">
            Sign in again
          </Link>
        </Card>
      </div>
    )
  }
  return <Navigate to={`/app/${first.profileId}/today`} replace />
}

function ProfileLayout() {
  const { profileId } = useParams()
  if (!profileId) return <Navigate to="/" replace />
  return (
    <ProfileProvider key={profileId} profileId={profileId}>
      <Shell>
        <Outlet />
      </Shell>
    </ProfileProvider>
  )
}

function LockScreen() {
  const { locked, unlock, signOut, user } = useAuth()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  useEffect(() => {
    if (!locked) {
      setPin('')
      setError(null)
    }
  }, [locked])

  if (!locked) return null

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <form
        className="lock-card"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          setError(null)
          unlock(pin)
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : 'That PIN did not match.'),
            )
            .finally(() => setBusy(false))
        }}
      >
        <div className="lock-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="40" height="40" fill="none">
            <path
              d="M16 27c-6-4.5-9-8-9-12a5.5 5.5 0 019-4 5.5 5.5 0 019 4c0 4-3 7.5-9 12z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 id="lock-title">CareNest is locked</h1>
        <p className="lock-copy">
          Welcome back{user ? `, ${user.displayName.split(' ')[0]}` : ''}. Enter your quick-unlock PIN to
          continue.
        </p>
        <label className="field-label" htmlFor={inputId}>
          Quick-unlock PIN
        </label>
        <input
          id={inputId}
          className="input pin-input"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          autoFocus
          aria-describedby={error ? 'lock-error' : undefined}
        />
        {error ? (
          <p className="field-message" id="lock-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" full loading={busy} disabled={pin.length < 4}>
          Unlock
        </Button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            void signOut().then(() => navigate('/signin'))
          }}
        >
          Sign out instead
        </button>
        <p className="lock-note">
          A PIN is only a quick unlock. It never grants access the signed-in account does not already have.
        </p>
      </form>
    </div>
  )
}

function NotFoundPage() {
  return (
    <div className="gate">
      <Card className="gate-card">
        <p className="eyebrow">Page not found</p>
        <h1>We could not find that page</h1>
        <p>The link may be old, or the page may have moved.</p>
        <Link className="btn btn-primary" to="/">
          Go to your care space
        </Link>
      </Card>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route
          path="/app/:profileId"
          element={
            <RequireAuth>
              <ProfileLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="today" replace />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="medications" element={<MedicationsPage />} />
          <Route path="medications/new" element={<MedicationFormPage />} />
          <Route path="medications/:medicationId" element={<MedicationDetailPage />} />
          <Route path="medications/:medicationId/edit" element={<MedicationFormPage />} />
          <Route path="appointments" element={<AppointmentsPage />} />
          <Route path="care-circle" element={<CareCirclePage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <LockScreen />
    </ToastProvider>
  )
}
