import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Response } from 'express'
import { one, run, nowIso, newId } from './db.js'
import { config } from './config.js'

const COOKIE_NAME = 'carenest_session'
const SCRYPT_KEYLEN = 64

export interface UserRow {
  id: string
  email: string
  display_name: string
  password_hash: string
  locale: string
  pin_hash: string | null
  created_at: string
}

export interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  created_at: string
  expires_at: string
  last_seen_at: string
}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + config.sessionDays * 24 * 60 * 60 * 1000)
  run(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    userId,
    sha256(token),
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
  )
  return { token, expiresAt }
}

export function resolveSession(token: string | null): { user: UserRow; session: SessionRow } | null {
  if (!token) return null
  const session = one<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', sha256(token))
  if (!session) return null
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    run('DELETE FROM sessions WHERE id = ?', session.id)
    return null
  }
  const user = one<UserRow>('SELECT * FROM users WHERE id = ?', session.user_id)
  if (!user) return null
  run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), session.id)
  return { user, session }
}

export function deleteSession(token: string | null) {
  if (!token) return
  run('DELETE FROM sessions WHERE token_hash = ?', sha256(token))
}

export function deleteAllSessionsForUser(userId: string) {
  run('DELETE FROM sessions WHERE user_id = ?', userId)
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!key) continue
    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      cookies[key] = value
    }
  }
  return cookies
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

export function readSessionToken(cookies: Record<string, string>): string | null {
  return cookies[COOKIE_NAME] ?? null
}

export { COOKIE_NAME }
