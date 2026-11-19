import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const source = path.join(root, 'client', 'dist')
const target = path.join(root, 'public')

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
console.log('[vercel] copied client/dist to public')
