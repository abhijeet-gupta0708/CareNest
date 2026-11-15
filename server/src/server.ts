import { createApp } from './app.js'
import { config } from './config.js'
import { db, one } from './db.js'
import { seedDemoData } from './seed.js'
import { startReminderScheduler, stopReminderScheduler } from './reminders.js'

const app = createApp()

const userCount = one<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0
if (userCount === 0 && !config.isProduction) {
  console.log('[seed] empty database detected - loading fictional demo data')
  seedDemoData()
}

const server = app.listen(config.port, () => {
  console.log(`[api] CareNest server listening on http://localhost:${config.port}`)
  startReminderScheduler()
})

function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`)
  stopReminderScheduler()
  server.close(() => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
