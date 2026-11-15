import path from 'node:path'
import fs from 'node:fs'

const rootDir = path.resolve(process.cwd())

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

// Works both from the repo root (npm run dev) and from server/ (workspace script).
loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(rootDir, '..', '.env'))

function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function int(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: int(process.env.PORT, 8787),
  isProduction: process.env.NODE_ENV === 'production',
  databaseFile: path.resolve(
    rootDir,
    process.env.DATABASE_FILE ?? './data/carenest.db',
  ),
  sessionDays: int(process.env.SESSION_DAYS, 30),
  remindersEnabled: bool(process.env.REMINDERS_ENABLED, true),
  reminderTickSeconds: Math.max(10, int(process.env.REMINDER_TICK_SECONDS, 30)),
  emailMode: (process.env.EMAIL_MODE ?? 'test').toLowerCase() === 'smtp' ? 'smtp' : 'test',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5173',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'CareNest <no-reply@example.com>',
  },
  demoAdminEmails: (process.env.DEMO_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
} as const

export const isSmtpConfigured = () =>
  config.emailMode === 'smtp' && Boolean(config.smtp.host && config.smtp.from)

export { rootDir }
