# CareNest

CareNest is a fictional-demo care coordination app for older adults and the people who help them. It keeps a shared, human-entered record of medicines, dose confirmations, appointments and care-circle activity — and deliberately stays out of clinical decision-making.

> **Clinical boundary:** CareNest never diagnoses, prescribes, infers or calculates a dose, suggests a schedule, or advises catch-up dosing. Every instruction shown is text a person entered from a prescription, pharmacy label or clinician's note. Reminders are scheduling aids, not medical advice or emergency monitoring.

This repository is a complete MVP built from the CareNest product build guide: React client, Express API, SQLite persistence, role-based access, an idempotent email-reminder lifecycle, reports/audit and an accessibility-first interface.

---

## What is included

- **Today** — date-aware dose timeline (upcoming / due / snoozed / taken / skipped / missed / not recorded), "next dose" card, appointments and a care-circle handover summary.
- **Medicines** — medication list with search and status filters, three-step add/edit form, detail pages with recent dose history, pause/resume/complete actions.
- **Appointments** — list and month calendar views, explicit per-appointment time zones, reminder lead times, status handling (upcoming/completed/cancelled).
- **Care team** — invitations, role and permission changes, reinvite/revoke, member notification preferences, recent care-circle activity.
- **Reports** — adherence rates, handover summary, reminder delivery log, audit history, and a JSON data export.
- **Settings** — profile and sharing controls, reminder lead times and quiet hours, accessibility preferences (larger text, high contrast), PIN quick unlock, account sign-out.
- **Email reminder pipeline** — queued/sent/failed/retry states, duplicate-safe event keys, quiet hours and per-member opt-outs. `EMAIL_MODE=test` logs delivery locally instead of sending mail.
- **Security foundations** — real accounts with scrypt password hashes, hashed session tokens in HTTP-only cookies, server-enforced role capabilities, invitation tokens hashed at rest, rate limits, security headers and an audit trail.

Demo data is entirely fictional (`@carenest.example` addresses, invented medicines and clinics).

---

## Requirements

- **Node.js 24 or newer** (developed and tested on Node 26.8.1). The server uses the built-in `node:sqlite` module, so no native database dependency is needed.
- npm 10+ (workspaces are used).

## Quick start

```bash
npm install
npm run seed      # load fictional demo data into data/carenest.db
npm run dev       # API on http://localhost:8787, client on http://localhost:5173
```

Open <http://localhost:5173> and sign in with any demo account below. The client proxies `/api` to the API in development.

### Demo accounts

All demo accounts use the password **`CareNest#2026`**.

| Person | Email | Role | What to try |
| --- | --- | --- | --- |
| Margaret Ellis | `margaret@carenest.example` | Older adult (owner) | Record doses, edit medicines, manage the care circle |
| Daniel Ellis | `daniel@carenest.example` | Primary caregiver (authorised) | Day-to-day care plan, dose recording and editing |
| Sara Ellis | `sara@carenest.example` | Family viewer | Read-only: can see shared data, cannot change it |
| Priya Shah | `priya@carenest.example` | Care-team administrator | Manage membership and permissions; no clinical editing |

A fifth invitation is pending for Tom: open `/invite/demo-tom-invite-token` to see the invitation flow. Registering or signing in as `tom@carenest.example` accepts it. (The token is deliberately fixed and demo-only.)

Re-run `npm run seed` at any time to reset the database to pristine demo data.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and Vite client together |
| `npm run dev:server` / `npm run dev:client` | Run one side only |
| `npm run seed` | Reset and reload fictional demo data |
| `npm test` | Run the server test suite (time zones, permissions, API, reminders) |
| `npm run typecheck` | Type-check server and client |
| `npm run build` | Production builds (`client/dist`, `server/dist`) |
| `npm start` | Start the built API; it also serves `client/dist` when present |

The API can run without the Vite client: `npm run build && npm start`, then open <http://localhost:8787>.

---

## Configuration

Copy `.env.example` to `.env` and adjust as needed. Nothing secret is committed; `data/` and `.env` are ignored by git.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8787` | API port |
| `NODE_ENV` | `development` | Production sets `Secure` cookies |
| `DATABASE_FILE` | `./data/carenest.db` | SQLite file; `:memory:` is used by tests |
| `SESSION_DAYS` | `30` | Session lifetime |
| `SESSION_SECRET` | placeholder | Reserved for deployment-level signing; sessions are random tokens stored hashed |
| `REMINDERS_ENABLED` | `true` | Start the in-process reminder scheduler |
| `REMINDER_TICK_SECONDS` | `30` | Scheduler interval (minimum 10) |
| `EMAIL_MODE` | `test` | `test` logs to `email_delivery_log`; `smtp` sends real mail |
| `SMTP_*` | empty | Only used when `EMAIL_MODE=smtp` |
| `APP_BASE_URL` | `http://localhost:5173` | Used in invitation and reminder links |
| `DEMO_ADMIN_EMAILS` | empty | Comma-separated accounts allowed to reset demo data (reserved) |

---

## Architecture

```
client/                 React 19 + TypeScript + Vite
  src/pages/            Today, Medicines, Appointments, Care team, Reports, Settings, auth
  src/components/       Shell, UI primitives, dose action dialogs
  src/context/          Auth and active-profile providers
  src/lib/              API client, formatting, shared types
  src/styles.css        Design tokens, layout and accessibility overrides
server/
  src/routes/           Express routers (auth, profiles, medications, doses, appointments, reports)
  src/permissions.ts    Role → capability model and profile access checks
  src/doses.ts          Dose generation, effective status, recording/correction, missed classification
  src/reminders.ts      Queueing, idempotency keys, quiet hours, dispatch and retry
  src/time.ts           Time-zone/DST-safe local-date helpers
  src/db.ts             SQLite schema and tiny repository helpers
  src/seed.ts           Fictional demo fixtures
  test/                 Isolated node:test suite
docs/                   Product brief, data model and security notes
```

- The client is a single-page app; routes under `/app/:profileId/...` keep the active care profile explicit.
- Each API request resolves a session from an HTTP-only cookie and re-checks membership and capabilities on the server. Client-side hiding of controls is presentation only.
- SQLite runs in WAL mode with foreign keys enforced. Tables mirror the product guide's collections: profiles, members, medicines, schedules, dose events, appointments, reminder events, delivery log and audit events.
- Dose rows are generated from human-entered schedules in the profile's time zone. Local calendar dates and wall-clock times are computed with `Intl`, so daylight-saving transitions do not shift a 08:00 dose to 07:00 or 09:00.

More detail: [product brief](docs/product-brief.md) · [data model](docs/data-model.md) · [security notes](docs/security-notes.md).

---

## Roles and permissions

| Capability | Older adult | Caregiver | Family viewer | Administrator |
| --- | --- | --- | --- | --- |
| View shared profile | Yes | Yes | Yes | Yes |
| Edit medicines | Yes | Only if granted | No | No |
| Edit appointments | Yes | Only if granted | No | No |
| Record/correct doses | Yes | Yes (default) | No | No |
| Invite/revoke members | Yes | Only if granted | No | Yes |
| View audit and reminders | Yes | Yes | No | Yes |
| Export data | Yes | No | No | Yes |

Notes:

- The older adult is the profile owner and always keeps full access.
- A family viewer stays read-only even if notification preferences are enabled.
- Administrators manage access, not clinical content: they cannot edit medicines, appointments or dose records.
- Sharing switches (`shareMedications`, `shareAppointments`) can withdraw family visibility without revoking membership.
- Revoked members immediately lose access; the API returns 404 for profiles they no longer belong to.

---

## Reminder lifecycle

1. The scheduler tick (every 30 s by default) classifies genuinely overdue doses as **missed** after the profile's grace period (default 120 minutes).
2. It queues:
   - `dose-upcoming:<doseId>:<userId>` before a dose,
   - `dose-missed:<doseId>:<userId>` after classification,
   - `appointment:<appointmentId>:<startAt>:<userId>` at the appointment's lead time.
3. `event_key` is unique, so repeated ticks and multiple server instances cannot duplicate a reminder.
4. Recipients are filtered by role-seeded notification preferences, explicit opt-outs and quiet hours in the profile time zone.
5. Delivery moves `queued → sent` or `queued → failed` with up to three attempts and a retry time. In test mode every message is written to `email_delivery_log` with `mode = 'test'` and no external email is sent.
6. Reminder bodies are intentionally minimal: what is due, when, a sign-in link and a plain statement that this is not medical advice.

Missed-dose copy never suggests taking a late dose; it points people back to the prescriber or pharmacist.

---

## Accessibility

- Base body text is 18px; interactive controls are 44–48px minimum.
- WCAG 2.2 AA colour contrast in the default and high-contrast themes; status is always paired with text and an icon, never colour alone.
- Semantic landmarks, a skip link, visible focus rings, labelled form fields with hints and inline errors, dialogs with focus handling, and live-region toasts.
- Settings offers **Larger text** (21px root) and **High contrast**; preferences persist in `localStorage` and are applied before paint.
- Layout reflows to a bottom navigation on narrow screens and respects reduced-motion preferences.

Lighthouse on the Today screen scored **100 Accessibility** and **100 Best Practices** in development.

---

## Tests

```bash
npm test
```

The suite runs against an in-memory SQLite database with reminders disabled and email in test mode. It covers:

- time-zone and DST conversion, local-midnight rollover, weekly recurrence and quiet-hours boundaries;
- role capabilities, read-only family access, revocation and profile access errors;
- registration/login, invitation acceptance rules, dose double-tap idempotency, explicit conflicts and audited corrections;
- reminder deduplication, quiet hours, opt-outs, grace-period missed classification and the combined scheduler tick.

Tests are not part of the server TypeScript project (`server/tsconfig.json` includes only `src`), but they run through `tsx`.

---

## Known limitations

- **Demo authentication only.** There is no email verification, password reset, MFA, account deletion or breach-password check. PIN unlock is a convenience check on an already-authenticated session, not a second factor.
- **Single-process scheduler.** Reminders run on a timer inside the API process. For production, move the tick to a durable job runner and use a real transactional email provider with bounce handling.
- **Email is plain text** and intentionally minimal. There is no unsubscribe link beyond per-member preferences in the app.
- **SQLite is local.** It suits a single-instance demo; a production deployment would use a managed database with backups, encryption at rest and migration tooling.
- **No real-time sync.** Other users' changes appear on reload/navigation rather than via push.
- **No offline mode, native apps, SMS/voice reminders, pharmacy integrations or device notifications.** The roadmap intentionally defers these.
- **Clinical data is whatever a human entered.** There is no drug-interaction checking, dosage validation, import from health records or clinical decision support — by design.
- **No git repository** is initialised in this workspace; history and review are therefore not available.
- **Accessibility is validated by automated checks and manual review**, not by testing with assistive-technology users. A production release needs moderated usability testing with older adults and screen-reader users.
- **Timezone display uses the care profile's zone**, with per-appointment zones shown explicitly; a viewer in another country sees the profile's local time, not their own.

---

## Safety and privacy notes

- Fictional data only. Do not enter real patient, medication or appointment information into this demo.
- Never commit `.env`, database files, SMTP credentials or invitation tokens. The example environment file contains placeholders only.
- In production, serve over HTTPS, set `NODE_ENV=production` (Secure cookies), replace the placeholder secret material, restrict CORS/proxy origins, add a Content-Security-Policy at the edge, and configure retention/backups.
- Audit events record who changed what and when, including correction reasons.

See [docs/security-notes.md](docs/security-notes.md) for the threat model and a production checklist.

---

## Disclaimer

CareNest is a demonstration product, not a medical device or clinical service. It does not diagnose, prescribe, calculate doses or provide emergency monitoring. If someone needs urgent help, contact local emergency services. Always follow the instructions supplied by the prescriber or pharmacist.
