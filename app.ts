import path from 'node:path'
import express from 'express'

// Vercel Functions have a writable /tmp directory, but no persistent disk.
// This deployment is a demo: each cold start gets a freshly seeded SQLite file.
process.env.DATABASE_FILE ||= '/tmp/carenest.db'
process.env.EMAIL_MODE ||= 'test'
process.env.REMINDERS_ENABLED ||= 'false'
process.env.APP_BASE_URL ||=
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

const { createApp } = await import('./server/dist/app.js')
const { seedDemoData } = await import('./server/dist/seed.js')
const { one } = await import('./server/dist/db.js')
const { runReminderTick } = await import('./server/dist/reminders.js')

const userCount = one<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0
if (userCount === 0) {
  seedDemoData({ reset: true })
  try {
    runReminderTick()
  } catch (error) {
    console.error('[vercel] reminder bootstrap failed', error)
  }
}

const app = createApp()

// Vercel serves the built client from public/**; this fallback is only used
// when running the Express app directly with a public directory present.
const indexPath = path.join(process.cwd(), 'public', 'index.html')
app.get(/^(?!\/api).*/, (_req, res, next) => {
  res.sendFile(indexPath, (error) => {
    if (error) next()
  })
})

export default app
