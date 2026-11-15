import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { config, rootDir } from './config.js'
import { HttpError } from './errors.js'
import { parseCookies, resolveSession } from './auth.js'
import { authRouter, inviteRouter } from './routes/auth.js'
import { profilesRouter } from './routes/profiles.js'
import { medicationsRouter } from './routes/medications.js'
import { dosesRouter } from './routes/doses.js'
import { appointmentsRouter } from './routes/appointments.js'
import { reportsRouter } from './routes/reports.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '128kb' }))

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    next()
  })

  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie)
    res.locals.cookies = cookies
    const session = resolveSession(cookies.carenest_session ?? null)
    if (session) res.locals.user = session.user
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'carenest-api',
      time: new Date().toISOString(),
      emailMode: config.emailMode,
      remindersEnabled: config.remindersEnabled,
    })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/invites', inviteRouter)
  app.use('/api/profiles', profilesRouter)
  app.use('/api/profiles', medicationsRouter)
  app.use('/api/profiles', dosesRouter)
  app.use('/api/profiles', appointmentsRouter)
  app.use('/api/profiles', reportsRouter)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'That endpoint does not exist.', code: 'not_found' } })
  })

  const candidates = [
    path.join(rootDir, 'client', 'dist'),
    path.join(rootDir, '..', 'client', 'dist'),
  ]
  const clientDist = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')))
  if (clientDist) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'))
    })
  }

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: { message: error.message, code: error.code, details: error.details ?? undefined },
      })
      return
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: { message: 'That request was not valid JSON.', code: 'bad_request' } })
      return
    }
    console.error(`[api] ${req.method} ${req.originalUrl} failed`, error)
    res.status(500).json({
      error: { message: 'Something went wrong on our side. Please try again.', code: 'server_error' },
    })
  })

  return app
}
