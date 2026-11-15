import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError } from '../lib/api'
import type { ProfileSummary, User } from '../lib/types'

interface SessionPayload {
  user: User
  profiles: ProfileSummary[]
}

interface AuthContextValue {
  user: User | null
  profiles: ProfileSummary[]
  ready: boolean
  locked: boolean
  largeText: boolean
  highContrast: boolean
  setLargeText: (value: boolean) => void
  setHighContrast: (value: boolean) => void
  signIn: (email: string, password: string) => Promise<SessionPayload>
  register: (displayName: string, email: string, password: string) => Promise<SessionPayload>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  lock: () => void
  unlock: (pin: string) => Promise<void>
  markPinEnabled: (enabled: boolean) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface Preferences {
  largeText: boolean
  highContrast: boolean
}

function readPreferences(): Preferences {
  try {
    const raw = localStorage.getItem('carenest:preferences')
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Preferences>
      return { largeText: Boolean(parsed.largeText), highContrast: Boolean(parsed.highContrast) }
    }
  } catch {
    /* ignore unavailable storage */
  }
  return { largeText: false, highContrast: false }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)
  const [preferences, setPreferences] = useState<Preferences>(readPreferences)
  const inactivityTimer = useRef<number | null>(null)

  const applyPreferences = useCallback((next: Preferences) => {
    setPreferences(next)
    document.documentElement.dataset.text = next.largeText ? 'large' : 'normal'
    document.documentElement.dataset.contrast = next.highContrast ? 'high' : 'normal'
    try {
      localStorage.setItem('carenest:preferences', JSON.stringify(next))
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.text = preferences.largeText ? 'large' : 'normal'
    document.documentElement.dataset.contrast = preferences.highContrast ? 'high' : 'normal'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(async () => {
    try {
      const session = await api.get<SessionPayload>('/api/auth/me', { suppressAuthEvent: true })
      setUser(session.user)
      setProfiles(session.profiles)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null)
        setProfiles([])
      }
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const handler = () => {
      setUser(null)
      setProfiles([])
      setLocked(false)
    }
    window.addEventListener('carenest:unauthorized', handler)
    return () => window.removeEventListener('carenest:unauthorized', handler)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await api.post<SessionPayload>('/api/auth/login', { email, password })
    setUser(session.user)
    setProfiles(session.profiles)
    setLocked(false)
    return session
  }, [])

  const register = useCallback(async (displayName: string, email: string, password: string) => {
    const session = await api.post<SessionPayload>('/api/auth/register', {
      displayName,
      email,
      password,
    })
    setUser(session.user)
    setProfiles(session.profiles)
    setLocked(false)
    return session
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      /* the local session is cleared either way */
    }
    setUser(null)
    setProfiles([])
    setLocked(false)
  }, [])

  const lock = useCallback(() => {
    setLocked((current) => (user?.pinEnabled ? true : current))
  }, [user])

  const unlock = useCallback(async (pin: string) => {
    await api.post('/api/auth/pin/verify', { pin })
    setLocked(false)
  }, [])

  const markPinEnabled = useCallback((enabled: boolean) => {
    setUser((current) => (current ? { ...current, pinEnabled: enabled } : current))
  }, [])

  // Auto-lock after 10 minutes of inactivity when a quick-unlock PIN is set.
  useEffect(() => {
    if (!user?.pinEnabled) return
    const reset = () => {
      if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current)
      inactivityTimer.current = window.setTimeout(() => setLocked(true), 10 * 60 * 1000)
    }
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'visibilitychange']
    events.forEach((event) => document.addEventListener(event, reset))
    reset()
    return () => {
      events.forEach((event) => document.removeEventListener(event, reset))
      if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current)
    }
  }, [user?.pinEnabled])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profiles,
      ready,
      locked,
      largeText: preferences.largeText,
      highContrast: preferences.highContrast,
      setLargeText: (value: boolean) => applyPreferences({ ...preferences, largeText: value }),
      setHighContrast: (value: boolean) => applyPreferences({ ...preferences, highContrast: value }),
      signIn,
      register,
      signOut,
      refresh,
      lock,
      unlock,
      markPinEnabled,
    }),
    [
      user,
      profiles,
      ready,
      locked,
      preferences,
      applyPreferences,
      signIn,
      register,
      signOut,
      refresh,
      lock,
      unlock,
      markPinEnabled,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
