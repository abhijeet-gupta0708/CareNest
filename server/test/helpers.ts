/**
 * Shared test harness.
 *
 * The environment is configured *before* any application module is imported so
 * the server's config and database modules pick up the in-memory settings. Test
 * files must import this module first and reach application code through the
 * dynamic helpers below (never with a static import).
 */
process.env.DATABASE_FILE = ':memory:'
process.env.EMAIL_MODE = 'test'
process.env.REMINDERS_ENABLED = 'false'
process.env.NODE_ENV = 'test'

import type { AddressInfo } from 'node:net'

export interface TestServer {
  url: string
  close: () => Promise<void>
}

export async function startTestServer(): Promise<TestServer> {
  const { createApp } = await import('../src/app.js')
  const app = createApp()
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export interface ApiResult<T = unknown> {
  status: number
  body: T
}

export interface TestClient {
  request: <T = unknown>(method: string, path: string, body?: unknown) => Promise<ApiResult<T>>
  get: <T = unknown>(path: string) => Promise<ApiResult<T>>
  post: <T = unknown>(path: string, body?: unknown) => Promise<ApiResult<T>>
  patch: <T = unknown>(path: string, body?: unknown) => Promise<ApiResult<T>>
  del: <T = unknown>(path: string, body?: unknown) => Promise<ApiResult<T>>
  cookies: Map<string, string>
}

export function createTestClient(baseUrl: string): TestClient {
  const cookies = new Map<string, string>()

  async function request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (cookies.size > 0) {
      headers.cookie = [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';')
      const index = pair.indexOf('=')
      if (index === -1) continue
      cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: response.status, body: parsed as T }
  }

  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path, body) => request('DELETE', path, body),
    cookies,
  }
}

export interface SessionPayload {
  user: { id: string; email: string; displayName: string }
  profiles: Array<{ profileId: string; role: string; preferredName: string }>
}

let accountSequence = 0

/** Register a fresh account and return its client, session payload and profile id. */
export async function registerAccount(
  baseUrl: string,
  options: { displayName?: string; email?: string; password?: string } = {},
) {
  accountSequence += 1
  const email = options.email ?? `person${accountSequence}-${Date.now()}@carenest.test`
  const password = options.password ?? 'CareNest#Test2026'
  const client = createTestClient(baseUrl)
  const result = await client.post<SessionPayload>('/api/auth/register', {
    displayName: options.displayName ?? 'Test Person',
    email,
    password,
    timezone: 'Europe/London',
  })
  if (result.status !== 201) {
    throw new Error(`Registration failed (${result.status}): ${JSON.stringify(result.body)}`)
  }
  return {
    client,
    email,
    password,
    session: result.body,
    profileId: result.body.profiles[0]?.profileId ?? '',
  }
}

export interface MedicationPayloadOptions {
  name?: string
  localTimes?: string[]
  recurrence?: 'daily' | 'weekly' | 'as_needed'
  weekdays?: number[]
  startDate?: string
  status?: 'active' | 'paused' | 'completed'
}

export function medicationPayload(options: MedicationPayloadOptions = {}) {
  return {
    name: options.name ?? 'Test Medicine',
    strength: '10 mg',
    form: 'Tablet',
    prescribedInstructions: 'Take ONE tablet by mouth each morning, exactly as prescribed.',
    sourceNote: 'Entered from a fictional test prescription.',
    startDate: options.startDate ?? '2024-01-01',
    endDate: null,
    status: options.status ?? 'active',
    schedule: {
      localTimes: options.localTimes ?? ['09:00'],
      recurrence: options.recurrence ?? 'daily',
      weekdays: options.weekdays ?? [],
      activeTo: null,
      pausedFrom: null,
      pausedUntil: null,
    },
    verified: true,
  }
}
