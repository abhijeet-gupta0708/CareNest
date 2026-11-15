import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { api, errorMessage } from '../lib/api'
import { formatDateWithYear } from '../lib/format'
import type { Role } from '../lib/types'
import { Banner, Button, Card, Chip, Loading } from '../components/ui'

interface InviteInfo {
  profileName: string
  role: Role
  invitedBy: string
  email: string
  status: 'pending' | 'active' | 'revoked' | 'expired'
  expiresAt: string | null
  emailMatches: boolean | null
  signedInEmail: string | null
}

const ROLE_COPY: Record<Role, { title: string; description: string }> = {
  older_adult: { title: 'Older adult', description: 'Owns the care profile and controls sharing.' },
  caregiver: {
    title: 'Primary caregiver',
    description: 'Helps coordinate the care plan. Medication or appointment editing only if the older adult allows it.',
  },
  family: {
    title: 'Family viewer',
    description: 'Can follow shared updates and summaries, without changing care records.',
  },
  admin: {
    title: 'Care-team administrator',
    description: 'Can invite people and manage access for this care profile. No automatic clinical editing.',
  },
}

export function InvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<InviteInfo>(`/api/invites/${token}`, { suppressAuthEvent: true })
      .then((data) => {
        if (!cancelled) setInvite(data)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) {
    return (
      <div className="gate">
        <Loading label="Checking this invitation…" />
      </div>
    )
  }

  if (error || !invite) {
    return (
      <div className="gate">
        <Card className="gate-card">
          <p className="eyebrow">Invitation</p>
          <h1>This invitation is not available</h1>
          <p>{error ?? 'The link may be incomplete or out of date.'}</p>
          <div className="button-row">
            <Link className="btn btn-primary" to="/">
              Go to CareNest
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  const role = ROLE_COPY[invite.role]
  const next = `/invite/${token}`

  const accept = async () => {
    setBusy(true)
    setAcceptError(null)
    try {
      const result = await api.post<{ profileId: string }>(`/api/invites/${token}/accept`, {})
      navigate(`/app/${result.profileId}/today`, { replace: true })
    } catch (caught) {
      setAcceptError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate gate-invite">
      <Card className="invite-card">
        <p className="eyebrow">Care-circle invitation</p>
        <h1>
          {invite.status === 'active'
            ? `You are already part of ${invite.profileName}’s care circle`
            : `Join ${invite.profileName}’s care circle`}
        </h1>
        <p className="invite-from">
          {invite.invitedBy} invited <strong>{invite.email}</strong> to help coordinate care.
        </p>

        <div className="invite-role">
          <Chip tone="teal">{role.title}</Chip>
          <p>{role.description}</p>
        </div>

        {invite.expiresAt ? (
          <p className="invite-expiry">
            Invitation sent for this email address. Link expires {formatDateWithYear(invite.expiresAt.slice(0, 10))}.
          </p>
        ) : null}

        {invite.status === 'expired' ? (
          <Banner tone="warn" title="This invitation has expired">
            Ask the care-team administrator to send a new invitation. Expired links cannot be reused.
          </Banner>
        ) : null}

        {invite.status === 'revoked' ? (
          <Banner tone="danger" title="This invitation was revoked">
            Access is no longer available. If this is unexpected, contact the person who invited you.
          </Banner>
        ) : null}

        {acceptError ? (
          <Banner tone="danger" title="We could not accept the invitation">
            {acceptError}
          </Banner>
        ) : null}

        {!user ? (
          <div className="invite-actions">
            <p className="invite-note">
              Sign in with <strong>{invite.email}</strong> or create an account using that email address.
              Access starts only after you accept.
            </p>
            <div className="button-row">
              <Link
                className="btn btn-primary btn-lg"
                to={`/signin?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.email)}`}
              >
                Sign in to accept
              </Link>
              <Link
                className="btn btn-secondary btn-lg"
                to={`/register?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.email)}`}
              >
                Create an account
              </Link>
            </div>
          </div>
        ) : invite.emailMatches ? (
          <div className="invite-actions">
            <p className="invite-note">
              {invite.status === 'active'
                ? 'Your access is active.'
                : 'Accepting will add this care profile to your account. You can leave the care circle at any time.'}
            </p>
            <div className="button-row">
              <Button size="lg" onClick={() => void accept()} loading={busy}>
                {invite.status === 'active' ? 'Open care space' : 'Accept invitation'}
              </Button>
              <Link className="btn btn-secondary btn-lg" to="/">
                Not now
              </Link>
            </div>
          </div>
        ) : (
          <div className="invite-actions">
            <Banner tone="warn" title="This invitation is for a different email address">
              You are signed in as {invite.signedInEmail}. Sign in with {invite.email} to accept this
              invitation.
            </Banner>
            <div className="button-row">
              <Button
                variant="secondary"
                onClick={() => {
                  void signOut().then(() =>
                    navigate(`/signin?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.email)}`),
                  )
                }}
              >
                Sign in with a different account
              </Button>
            </div>
          </div>
        )}

        <p className="invite-safety">
          Invitations never grant more access than the role shown above. For safety, links expire and can be
          revoked by the care-team administrator.
        </p>
      </Card>
    </div>
  )
}
