# Security notes

CareNest is a **fictional demonstration**, not a production clinical system. This document describes what is implemented, the reasoning behind it, and what must change before handling real personal or health data.

The guiding rule from the product guide: a short passcode is a convenience, never the security boundary. Access is enforced by real authentication, verified invitations and server-side permissions.

## Demo-specific warnings

- Demo accounts share the public password `CareNest#2026`, and `demo-tom-invite-token` is a fixed, published invitation token. **Never expose this build to the public internet or enter real data.**
- Email runs in `EMAIL_MODE=test` by default: messages are written to the local database instead of being sent.
- The SQLite file is unencrypted, and the app is normally served over plain HTTP in development.
- There is no git repository in this workspace. A real deployment must establish source control, review and secret management first.

## Authentication

| Control | Implementation |
| --- | --- |
| Password storage | `scrypt` with a random 16-byte salt per password, 64-byte key, stored as `scrypt$<salt>$<hash>`; verification uses `timingSafeEqual` |
| Password policy | Minimum 10 characters, maximum 200; no composition rules and no breach-list check |
| Sign-in | Email + password; generic “that email and password combination did not match” response to reduce account enumeration |
| Sessions | 256-bit random token in an HTTP-only cookie; only its SHA-256 digest is stored in `sessions` |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Path=/`, expiry aligned with the server session, `Secure` when `NODE_ENV=production` |
| Session lifetime | 30 days by default (`SESSION_DAYS`); expired rows are deleted when encountered |
| Sign-out | Deletes the current session row and clears the cookie |
| PIN quick unlock | 4–6 digits, stored with the same scrypt scheme; verification requires an existing authenticated session and is rate-limited (6 attempts / 5 minutes / user) |

The PIN is not a second factor and cannot create a session. It confirms presence on an already-authenticated device. A compromised session already has the user's full permissions; the PIN adds no escalation. Removing a PIN requires the account password.

### Gaps

No email verification, password reset, MFA, breached-password screening, login notifications, device/session management UI or forced re-authentication for sensitive actions. Sessions are not rotated on privilege changes and there is no “sign out everywhere” control.

## Authorization

Roles and capabilities are defined once in `server/src/permissions.ts`:

| Capability | Older adult (owner) | Caregiver | Family | Administrator |
| --- | --- | --- | --- | --- |
| View profile | Yes | Yes | Yes | Yes |
| Edit medicines | Yes | Explicit grant only | No | No |
| Edit appointments | Yes | Explicit grant only | No | No |
| Record/correct doses | Yes | Yes by default | No | No |
| Manage members | Yes | Explicit grant only | No | Yes |
| View audit/reminders | Yes | Yes | No | Yes |
| Export data | Yes | No | No | Yes |

Every profile-scoped route calls `requireProfileAccess(user, profileId, capability)`:

1. Loads the profile; missing profiles return 404.
2. Finds an **active, non-revoked** membership for the signed-in user; non-members also get 404 to avoid confirming that a profile exists.
3. Evaluates capabilities from the role plus explicit grants (the owner always has full access).
4. Returns 403 when the capability is missing, with a non-sensitive explanation.
5. Records `last_active_at`.

Client-side hiding of buttons is presentation only. Tests call the API directly as a family viewer and assert 403 responses for medicine creation, dose recording and appointment creation.

Sharing switches (`shareMedications`, `shareAppointments`) are checked separately from capabilities, so family members can be limited to appointments or have visibility withdrawn without revoking membership. Revocation sets `invite_status='revoked'` and `revoked_at`; the next request loses access.

### Gaps

There is no field-level redaction inside a shared profile (for example, hiding notes but showing schedules), no time-limited access grants, no emergency “break glass” audit trail and no per-action re-authentication. Administrators can see membership and audit data by design.

## Invitations

- Tokens are 192-bit random values (`randomBytes(24)` base64url).
- Only an unsalted SHA-256 digest is stored. Because the token has full entropy and is not user-chosen, a fast digest is appropriate for lookup and keeps the raw token out of the database. (Passwords use scrypt for the opposite reason: low entropy.)
- Invitations expire after 14 days. Status is `pending`, `active`, `revoked` or `expired`.
- The accepting account's email must match the invited address, case-insensitively.
- On acceptance the token hash is cleared, so the link cannot be reused to attach another account.
- Revocation is immediate; reinvite issues a new token.
- Acceptance is audited.

**Residual risk:** signing in or registering with an email that has a pending invitation automatically activates it (`acceptPendingInvitesFor`). This is convenient and still requires control of the invited mailbox in a real deployment with email verification, but this build has no email verification. A production design should require the token link plus a verified email before activation.

Invitation links are also written to the test delivery log in plaintext, which is acceptable only in this fictional demo.

## Input handling and injection

- Request bodies are validated with Zod at each route boundary: string length limits, email format, enum values, IANA time zones, `YYYY-MM-DD` dates and `HH:MM` times.
- JSON bodies are capped at 128 KB.
- SQL uses prepared statements with bound parameters throughout; there is no string-concatenated user input.
- React escapes rendered content by default; the app does not use `dangerouslySetInnerHTML`.
- API errors are normalised to `{ error: { message, code, details } }`; unexpected errors return a generic 500 message and are logged server-side.
- Static file serving only exposes `client/dist`; API routes are mounted first and unknown `/api` paths return JSON 404.

## CSRF, CORS and browser controls

- The client and API are same-origin in development through Vite's `/api` proxy, and in production the API serves the built client.
- No CORS headers are enabled, so browsers cannot read cross-origin API responses by default.
- Session cookies are `SameSite=Lax`, which blocks most cross-site state-changing requests, and state changes use non-simple JSON requests.
- **There is no anti-CSRF token.** `SameSite=Lax` is the primary defence. A production deployment should add an origin check or synchroniser token for defence in depth.

Response headers set by the API:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Powered-By` disabled

**Not yet set:** Content-Security-Policy, HSTS, COOP/COEP/CORP, certificate pinning or a trusted proxy configuration. Add CSP and HSTS at the reverse proxy/edge in production and serve only over HTTPS.

## Rate limiting and abuse resistance

In-memory fixed-window limits:

| Action | Limit |
| --- | --- |
| Registration per IP | 10 / hour |
| Sign-in per email + IP | 8 / 15 minutes |
| PIN verification per user | 6 / 5 minutes |
| Reminder test send | Existing authenticated access + capability check |

Limits are process-local, reset on restart and do not coordinate across instances. There is no CAPTCHA, IP reputation, account lockout, alerting or distributed store. A production system needs a shared rate-limit store and monitoring.

## Privacy of reminders and email

- Subjects are generic: `CareNest reminder: a medicine dose` / `an appointment` / `a care reminder`.
- Bodies contain the recipient's first name, what is due (time and profile preferred name), a sign-in link and a disclaimer. They do **not** contain medicine names, strengths, instructions, diagnoses or appointment providers.
- Per-member opt-outs and quiet hours are evaluated before queueing, in the profile's time zone.
- Revoked members are excluded because recipients are selected from active memberships at queue time. Already-queued messages to a since-revoked member are not automatically recalled — a production system should re-check membership at send time.
- Delivery failures are recorded with the provider error in `last_error` and `email_delivery_log`; avoid putting sensitive content in provider error strings.
- SMTP credentials come from environment variables and are never sent to the client.

**Gap:** no unsubscribe link or one-click preference centre in the email itself; preferences live behind sign-in.

## Auditability

`audit_events` records the actor (id and display-name snapshot), action, entity, summary and timestamp for sensitive operations: profile creation, medicine create/edit/status change, appointment changes, dose corrections, membership invite/join/permission change/revoke, and missed-dose classification (actor “CareNest”). Correction summaries include the required human reason.

Family viewers cannot read the audit log. There is no API to edit or delete audit rows, but the database itself is writable by anyone with file access, so this is **tamper-evident only by convention**, not cryptographically immutable. Production needs append-only storage, retention rules and export to a SIEM or immutable archive.

## Data at rest and operations

- SQLite file under `data/` (git-ignored), WAL mode, foreign keys enabled.
- No encryption at rest, no field-level encryption, no key management.
- No backup, restore, retention or deletion workflow; no account deletion.
- No structured access logs or metrics. Errors are logged to the console; request bodies and passwords are not intentionally logged.
- Demo reset deletes all rows and reseeds. It must never be pointed at real data.

## Threat model summary

| Threat | Current mitigation | Residual risk |
| --- | --- | --- |
| Credential stuffing / brute force | scrypt, generic errors, in-memory rate limits | No MFA, no shared limiter, no breach checks |
| Session theft | HTTP-only cookie, hashed server-side tokens, SameSite, Secure in production | No device management or rotation; XSS would still expose actions |
| IDOR / cross-profile access | Membership lookup on every route; 404 for non-members | Bugs in new routes that skip `requireProfileAccess` |
| Over-broad family access | Server-enforced read-only role and sharing switches | No field-level controls |
| Invitation interception | High-entropy token, hash at rest, expiry, email match | Email not verified; login auto-accepts pending invites |
| Sensitive email exposure | Minimal subject/body, sign-in required for details | Profile preferred name and timing still appear |
| Duplicate/spoofed reminders | Unique `event_key`, `INSERT OR IGNORE`, delivery states | Single-process scheduler; provider spoofing not addressed |
| SQL injection | Prepared statements, typed inputs | None known in current routes |
| XSS | React escaping, no raw HTML, JSON API | No CSP yet; dependency supply chain not audited |
| CSRF | SameSite=Lax, JSON requests, same-origin deployment | No token/origin check |
| Data loss | WAL, seed reset | No backups; single local file |
| Insider/database access | OS file permissions only | No encryption or tamper-proof audit |
| Lost shared device | Password/PIN required; sign-out available | PIN is a convenience; no remote revoke |

## Production readiness checklist

Before handling real users or health information:

1. Replace demo accounts, fixed invite token and demo password; disable public seeding.
2. Require email verification; add password reset, MFA and session/device management.
3. Serve only over HTTPS; enable HSTS, a strict CSP and secure cookie settings; configure a trusted proxy.
4. Add CSRF tokens/origin checks and a shared, monitored rate-limit store.
5. Move to a managed database with encryption at rest, backups, tested restore, migrations and least-privilege credentials.
6. Move reminders to a durable scheduler/queue with provider webhooks, bounce handling and membership re-checks at send time.
7. Define consent, retention, export and deletion policies; implement account and profile deletion.
8. Make audit storage append-only and monitored; add alerting for access changes and delivery failures.
9. Complete a privacy impact assessment and applicable legal review (for example UK GDPR / HIPAA-like regimes); do not claim clinical validation.
10. Run moderated accessibility testing with older adults and screen-reader users, plus penetration testing and dependency scanning.
11. Ensure no secrets, tokens, database files or real personal data enter source control or logs.

## Reporting

This is a fictional project with no production deployment. If you adapt it, add a private security contact and a coordinated disclosure policy before launch.
