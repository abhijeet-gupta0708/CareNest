import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { errorMessage } from '../lib/api'
import { Banner, Button, Field, TextInput } from '../components/ui'

const DEMO_ACCOUNTS = [
  { name: 'Margaret Ellis', role: 'Older adult', email: 'margaret@carenest.example' },
  { name: 'Daniel Ellis', role: 'Authorised caregiver', email: 'daniel@carenest.example' },
  { name: 'Sara Ellis', role: 'Family viewer (read-only)', email: 'sara@carenest.example' },
  { name: 'Priya Shah', role: 'Care-team administrator', email: 'priya@carenest.example' },
]

export function SignInPage() {
  const { user, ready, signIn, profiles } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready && user) {
    const destination = next ?? (profiles[0] ? `/app/${profiles[0].profileId}/today` : '/')
    return <Navigate to={destination} replace />
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await signIn(email, password)
      const destination = next ?? `/app/${session.profiles[0]?.profileId ?? ''}/today`
      navigate(destination, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-brand" aria-labelledby="brand-title">
        <Link className="auth-wordmark" to="/">
          <span className="wordmark-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
              <path
                d="M16 27c-6-4.5-9-8-9-12a5.5 5.5 0 019-4 5.5 5.5 0 019 4c0 4-3 7.5-9 12z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M12.5 15.5h2l1.2-2.5 1.6 5 1.2-2.5h2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          CareNest
        </Link>
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Shared care, calmly coordinated</p>
          <h1 id="brand-title">A calmer way to stay on top of care.</h1>
          <p>
            One clear daily timeline for medicines and appointments — shared with the people you choose,
            with the older adult in control.
          </p>
          <ul className="auth-points">
            <li>See what is due, confirmed and still outstanding.</li>
            <li>Give family and caregivers only the access they need.</li>
            <li>Large controls, plain language and no clinical guesswork.</li>
          </ul>
        </div>
        <p className="auth-brand-note">
          Fictional demo environment. CareNest stores clinician-provided instructions and never diagnoses,
          prescribes or advises catch-up dosing.
        </p>
      </section>

      <section className="auth-panel" aria-labelledby="signin-title">
        <div className="auth-card">
          <p className="eyebrow">Welcome back</p>
          <h2 id="signin-title">Sign in to CareNest</h2>
          <p className="auth-subtitle">Use your own account. Access is limited to the care circles you belong to.</p>

          {error ? (
            <Banner tone="danger" title="We could not sign you in">
              {error}
            </Banner>
          ) : null}

          <form className="auth-form" onSubmit={submit} noValidate>
            <Field id="email" label="Email address" required>
              <TextInput
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                aria-required="true"
              />
            </Field>
            <Field id="password" label="Password" required>
              <div className="password-wrap">
                <TextInput
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  aria-required="true"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <Button type="submit" size="lg" full loading={busy} disabled={!email || !password}>
              Sign in
            </Button>
          </form>

          <p className="auth-switch">
            New to CareNest? <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link>
          </p>

          <div className="demo-accounts">
            <div className="demo-accounts-head">
              <p className="demo-title">Demo accounts</p>
              <p className="demo-hint">
                Password <code>CareNest#2026</code> for all. Choose a role to try the different access levels.
              </p>
            </div>
            <div className="demo-grid">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="demo-account"
                  onClick={() => {
                    setEmail(account.email)
                    setPassword('CareNest#2026')
                    setError(null)
                  }}
                >
                  <span className="demo-account-name">{account.name}</span>
                  <span className="demo-account-role">{account.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
