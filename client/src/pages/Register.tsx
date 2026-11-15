import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { errorMessage } from '../lib/api'
import { Banner, Button, Field, TextInput } from '../components/ui'

export function RegisterPage() {
  const { user, ready, register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready && user) return <Navigate to={next ?? '/'} replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await register(displayName, email, password)
      const destination = next ?? `/app/${session.profiles[0]?.profileId ?? ''}/today`
      navigate(destination, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layout auth-layout-simple">
      <section className="auth-panel" aria-labelledby="register-title">
        <div className="auth-card">
          <Link className="auth-wordmark auth-wordmark-ink" to="/signin">
            <span className="wordmark-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
                <path
                  d="M16 27c-6-4.5-9-8-9-12a5.5 5.5 0 019-4 5.5 5.5 0 019 4c0 4-3 7.5-9 12z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            CareNest
          </Link>
          <p className="eyebrow">Start a care space</p>
          <h1 id="register-title">Create your account</h1>
          <p className="auth-subtitle">
            This creates your own care profile. You can invite family or caregivers afterwards, and you
            decide what each person can see or change.
          </p>

          {error ? (
            <Banner tone="danger" title="We could not create the account">
              {error}
            </Banner>
          ) : null}

          <form className="auth-form" onSubmit={submit} noValidate>
            <Field id="name" label="Your name" required hint="This is shown to people you invite.">
              <TextInput
                id="name"
                name="name"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                aria-required="true"
              />
            </Field>
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
            <Field
              id="password"
              label="Password"
              required
              hint="Use at least 10 characters. Do not reuse a password from another service."
            >
              <TextInput
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                aria-required="true"
                aria-describedby="password-hint"
              />
            </Field>
            <Button type="submit" size="lg" full loading={busy} disabled={password.length < 10}>
              Create account
            </Button>
          </form>

          <p className="auth-switch">
            Already have an account? <Link to={`/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link>
          </p>
          <p className="auth-consent">
            By continuing you confirm this is a demo environment and that you will use fictional information
            only. CareNest does not provide medical advice.
          </p>
        </div>
      </section>
    </div>
  )
}
