# AGENTS.md

Guidance for agents and contributors working in this repository.

## What this project is

CareNest is a fictional-demo care coordination app: a React 19 + Vite client and an Express 5 + SQLite API in an npm-workspaces monorepo. It records medicines, schedules, dose confirmations, appointments, care-circle membership, reminders and audit history.

Read `README.md` first for setup and user-facing behaviour. Product intent, the data model and security posture live in `docs/`.

## Commands

Run from the repository root:

```bash
npm install
npm run seed        # reset data/carenest.db to fictional demo fixtures
npm run dev         # API :8787 + Vite :5173 (client proxies /api)
npm test            # server test suite (in-memory DB, test email mode)
npm run typecheck   # server then client
npm run build       # client bundle + server tsc
npm start           # built server; serves client/dist when built
```

Useful during development:

```bash
npm run dev -w server
npm run dev -w client
npm run typecheck -w server
npm run typecheck -w client
node --import tsx --test server/test/reminders.test.ts
```

## Repository map

- `client/src/App.tsx` — routing and auth/profile gates.
- `client/src/components/` — `Shell`, shared UI primitives, `DoseActions`.
- `client/src/pages/` — one file per screen.
- `client/src/lib/` — API wrapper, formatting/time helpers, shared types.
- `client/src/styles.css` — the entire design system, including accessibility overrides.
- `server/src/routes/` — HTTP handlers only; keep domain logic in the modules below.
- `server/src/permissions.ts` — roles, capabilities and `requireProfileAccess` (the server-side authority).
- `server/src/medications.ts`, `doses.ts` — schedule expansion, dose generation, status derivation, recording/correction.
- `server/src/reminders.ts` — reminder queue, idempotency keys, quiet hours, dispatch/retry.
- `server/src/time.ts` — all local-date, wall-clock and DST handling.
- `server/src/db.ts` — schema and repository helpers.
- `server/src/seed.ts` — demo fixtures.
- `server/test/` — isolated tests; import `./helpers.js` first.

## Invariants — do not break these

1. **Clinical boundary.** Never diagnose, prescribe, infer a dose, calculate a dose, generate a schedule, or advise catch-up dosing. Display only what a person entered. Do not add "smart" defaults, dosage calculations or interaction checks. Copy that discusses a missed dose must point back to the prescriber/pharmacist.
2. **Server-side authorization.** Every profile route must call `requireProfileAccess` with the narrowest capability. Client-side hiding is cosmetic. Family viewers stay read-only; administrators manage access, not clinical content.
3. **Time zones.** Use `server/src/time.ts` for local dates, midnight boundaries and schedule expansion. Never use `toISOString().slice(0, 10)` for a profile-local date. Dose schedules are stored as local wall-clock times plus an IANA zone.
4. **Idempotency.** Dose recording must tolerate double taps (`alreadyApplied`), and reminder inserts rely on unique `event_key` values. Keep both properties when adding flows.
5. **Audit trail.** Editing, correcting, pausing, inviting, revoking and permission changes should call `recordAudit`. Corrections require a reason.
6. **No secrets in code.** Credentials come from `.env` placeholders; `data/`, `.env` and build outputs are ignored. Demo data must stay fictional (`.example` domains).
7. **Minimal email.** Reminder bodies contain only what is due, when, a generic sign-in link and the non-clinical disclaimer. Do not add medication instructions or patient details.
8. **Accessibility.** Preserve semantic landmarks, labels, 44px+ controls, visible focus, non-colour status cues and the large-text/high-contrast themes. Do not introduce custom widgets without keyboard and screen-reader behaviour.

## Conventions

- TypeScript strict mode; ESM with `.js` extensions in server imports (NodeNext).
- Client `tsconfig` enables `noUnusedLocals`/`noUnusedParameters`; unused imports fail `npm run build`.
- Zod schemas validate request bodies at the route boundary; shared parsing lives in `validation.ts`.
- Return errors as `HttpError` (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`) so the central handler formats `{ error: { message, code, details } }`.
- Prefer absolute `/app/:profileId/...` links in the client; relative links inside nested routes are easy to get wrong.
- Keep CSS in `styles.css` and reuse existing tokens/classes instead of inline styles.
- Dates sent to the API are ISO instants; calendar dates are `YYYY-MM-DD`.
- Keep demo state resettable with `npm run seed`.

## Testing notes

- `server/test/helpers.ts` sets `DATABASE_FILE=:memory:`, `EMAIL_MODE=test`, `REMINDERS_ENABLED=false` **before** importing app modules. Import it first in every test file, then load application code dynamically.
- Tests share one process and one in-memory DB; use unique emails/IDs and clean tables when state matters.
- `server/tsconfig.json` only includes `src/**/*.ts`, so tests are not type-checked by `npm run typecheck`; still keep them type-correct for `tsx`.
- Reminder tests use fixed timestamps (`2026-05-01T10:00:00Z`) and assert deduplication, quiet hours and grace periods.

## Known pitfalls

- `dateInZone` must produce `YYYY-MM-DD`; `Intl` with `en-GB` otherwise yields `DD/MM/YYYY` and breaks date parsing.
- Express route order matters: profile-scoped routers are all mounted at `/api/profiles`.
- SQLite is opened once at module load; tests must set `DATABASE_FILE` before any dynamic import.
- The in-process reminder scheduler runs only in the server process; tests call the queue/dispatch functions directly.
- Demo data changes on every seed (new IDs), so never hard-code demo profile or medication IDs in code or docs.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
