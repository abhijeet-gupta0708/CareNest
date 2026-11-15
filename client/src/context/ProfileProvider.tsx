import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError, errorMessage } from '../lib/api'
import type { Capabilities, CareProfile, Membership } from '../lib/types'

interface ProfilePayload {
  profile: CareProfile
  membership: Membership
  capabilities: Capabilities
}

interface ProfileContextValue extends ProfilePayload {
  profileId: string
  loading: boolean
  error: string | null
  errorStatus: number | null
  refresh: () => Promise<void>
  setProfile: (profile: CareProfile) => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ profileId, children }: { profileId: string; children: ReactNode }) {
  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setErrorStatus(null)
    try {
      const data = await api.get<ProfilePayload>(`/api/profiles/${profileId}`)
      setPayload(data)
    } catch (caught) {
      setPayload(null)
      setError(errorMessage(caught))
      setErrorStatus(caught instanceof ApiError ? caught.status : null)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void load()
  }, [load])

  const setProfile = useCallback((profile: CareProfile) => {
    setPayload((current) => (current ? { ...current, profile } : current))
  }, [])

  const value = useMemo<ProfileContextValue | null>(
    () =>
      payload
        ? { ...payload, profileId, loading, error, errorStatus, refresh: load, setProfile }
        : null,
    [payload, profileId, loading, error, errorStatus, load, setProfile],
  )

  if (!value) {
    return (
      <ProfileGate loading={loading} error={error} errorStatus={errorStatus} onRetry={load}>
        {children}
      </ProfileGate>
    )
  }

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

function ProfileGate({
  loading,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  loading: boolean
  error: string | null
  errorStatus: number | null
  onRetry: () => Promise<void>
  children: ReactNode
}) {
  if (loading) {
    return (
      <div className="gate" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <p>Opening your care space…</p>
      </div>
    )
  }
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{errorStatus === 404 || errorStatus === 403 ? 'This care profile is not available' : 'We could not open this care space'}</h1>
        <p>{error ?? 'Please try again.'}</p>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => void onRetry()}>
            Try again
          </button>
          <a className="btn btn-secondary" href="/">
            Back to your care circles
          </a>
        </div>
      </div>
      {children}
    </div>
  )
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfile must be used inside ProfileProvider')
  return context
}
