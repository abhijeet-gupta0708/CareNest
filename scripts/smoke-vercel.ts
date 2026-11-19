import { rm } from 'node:fs/promises'

const dbFile = 'C:/Users/Acer/AppData/Local/Temp/opencode/carenest-smoke.db'
await rm(dbFile, { force: true })

process.env.DATABASE_FILE = dbFile
process.env.EMAIL_MODE = 'test'
process.env.REMINDERS_ENABLED = 'false'

const { default: app } = await import('../app.ts')

const server = app.listen(3999)

const base = 'http://127.0.0.1:3999'

const health = await fetch(`${base}/api/health`).then((r) => r.json())
console.log('health', health)

const rootRes = await fetch(`${base}/`)
const rootHtml = await rootRes.text()
console.log('root', rootRes.status, rootHtml.slice(0, 60).replace(/\n/g, ' '))

const spaRes = await fetch(`${base}/app/some-profile/today`)
console.log('spa-route', spaRes.status, (await spaRes.text()).includes('<div id="root"'))

const loginRes = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'margaret@carenest.example', password: 'CareNest#2026' }),
})
const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? ''
console.log('login', loginRes.status, cookie ? 'cookie-set' : 'no-cookie')

const profilesRes = await fetch(`${base}/api/profiles`, { headers: { cookie } })
const profiles = await profilesRes.json()
console.log('profiles', profilesRes.status, JSON.stringify(profiles).slice(0, 120))

server.close()
