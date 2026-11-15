# CareNest data model

CareNest uses SQLite through Node's built-in `node:sqlite`. The schema is defined in `server/src/db.ts` and created with `CREATE TABLE IF NOT EXISTS` at startup. It mirrors the product guide's collections: users, care profiles, care-team membership, medicines, schedules, dose events, appointments, reminder events, delivery logs and audit events.

All timestamps are stored as ISO 8601 UTC strings. Calendar dates are `YYYY-MM-DD` strings in the care profile's time zone. Schedule clock times are `HH:MM` wall-clock strings stored with an IANA time zone — never converted to a fixed UTC offset.

## Relationships

```
users 1 ─── * sessions
  │
  │ 1
  ├──< care_team_members >── 1 care_profiles
  │                                │
  │                                ├──< medications ──< medication_schedules
  │                                │         │
  │                                │         └──< dose_events >── schedules
  │                                │
  │                                ├──< appointments
  │                                ├──< reminder_events
  │                                ├──< email_delivery_log
  │                                └──< audit_events
  │
  └── created_by / recorded_by / actor references
```

A user can belong to more than one care profile. The owner (older adult) creates the profile; other users join through invitations.

## Tables

### `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `email` | TEXT unique, NOCASE | Sign-in identifier; lower-cased on write |
| `display_name` | TEXT | Shown in UI and audit labels |
| `password_hash` | TEXT | `scrypt$<saltHex>$<hashHex>` |
| `locale` | TEXT | `en-GB` |
| `pin_hash` | TEXT nullable | Optional quick-unlock PIN, scrypt-hashed |
| `created_at` | TEXT | ISO instant |

### `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `user_id` | TEXT FK → users, cascade | |
| `token_hash` | TEXT unique | SHA-256 of the random cookie token; raw token never stored |
| `created_at`, `expires_at`, `last_seen_at` | TEXT | Expired sessions are deleted on use |

### `care_profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `preferred_name`, `full_name` | TEXT | Preferred name leads in the UI |
| `timezone` | TEXT | IANA zone, validated on write |
| `date_of_birth` | TEXT nullable | Optional |
| `created_by` | TEXT FK → users | |
| `share_medications`, `share_appointments` | INTEGER bool | Family visibility switches |
| `missed_tracking` | INTEGER bool | Enables missed classification |
| `grace_minutes` | INTEGER | Default 120; how long after the scheduled time a blank dose becomes missed |
| `dose_reminder_lead_minutes` | INTEGER | Default 15 |
| `appointment_reminder_lead_minutes` | INTEGER | Profile default; appointments can override |
| `created_at` | TEXT | |

### `care_team_members`

One row per user/profile membership, including pending and revoked invitations.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `profile_id` | TEXT FK → care_profiles, cascade | |
| `user_id` | TEXT nullable FK → users | Null until an invitation is accepted/registered |
| `invited_email` | TEXT NOCASE | Must match the accepting account's email |
| `role` | TEXT | `older_adult`, `caregiver`, `family`, `admin` |
| `can_edit_medications`, `can_edit_appointments`, `can_record_doses`, `can_manage_members` | INTEGER bool | Explicit grants; the owner bypasses these |
| `invite_status` | TEXT | `pending`, `active`, `revoked` |
| `invite_token_hash` | TEXT nullable | SHA-256 of a 192-bit random token |
| `invite_expires_at` | TEXT nullable | Demo invitations last 14 days |
| `invited_by` | TEXT FK → users | |
| `accepted_at`, `revoked_at`, `last_active_at` | TEXT nullable | |
| `notify_upcoming_doses`, `notify_missed_doses`, `notify_appointments` | INTEGER bool | Per-member email preferences |
| `quiet_hours_start`, `quiet_hours_end` | TEXT nullable `HH:MM` | Evaluated in profile zone; overnight ranges supported |
| `created_at`, `updated_at` | TEXT | |

Indexes: `profile_id`, `user_id`.

### `medications`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `profile_id` | TEXT FK → care_profiles, cascade | |
| `name`, `strength`, `form` | TEXT | Strength/form optional |
| `prescribed_instructions` | TEXT | Verbatim human-entered instruction; the only source of dose text |
| `source_note` | TEXT nullable | Where the entry came from (prescription, label, clinic note) |
| `start_date`, `end_date` | TEXT / nullable | Local dates |
| `status` | TEXT | `active`, `paused`, `completed` |
| `created_by`, `updated_by` | TEXT FK → users | |
| `created_at`, `updated_at` | TEXT | |

Index: `profile_id`.

### `medication_schedules`

Current model supports one schedule row per medicine. Past dose rows remain even if the schedule later changes.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `medication_id` | TEXT FK → medications, cascade | |
| `local_times` | TEXT JSON array | e.g. `["08:00","20:00"]`; empty for as-needed |
| `recurrence` | TEXT | `daily`, `weekly`, `as_needed` |
| `weekdays` | TEXT JSON array | `0`=Sunday … `6`=Saturday; used for weekly |
| `timezone` | TEXT | IANA zone of the schedule |
| `active_from`, `active_to` | TEXT / nullable | Local dates |
| `paused_from`, `paused_until` | TEXT / nullable | Reserved for pause windows |
| `created_at` | TEXT | |

Index: `medication_id`.

### `dose_events`

One row per scheduled occurrence. Generated forward from the schedule for the visible/relevant window; `UNIQUE (schedule_id, scheduled_for)` prevents duplicates.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `profile_id`, `medication_id`, `schedule_id` | FKs, cascade | |
| `scheduled_for` | TEXT | UTC instant of the local wall-clock occurrence |
| `local_date` | TEXT | Profile-local `YYYY-MM-DD`, used for day queries |
| `status` | TEXT | Stored outcome: `pending`, `taken`, `skipped`, `missed` |
| `recorded_at`, `recorded_by` | TEXT / FK nullable | Who confirmed and when |
| `note` | TEXT nullable | Optional human note |
| `snoozed_until` | TEXT nullable | Snooze is a pending-dose timer, not an outcome |
| `missed_at` | TEXT nullable | When the scheduler classified it missed |
| `correction_of` | TEXT nullable | Reserved link to an earlier event |
| `created_at`, `updated_at` | TEXT | |

Indexes: `(profile_id, local_date)`, `(profile_id, status)`.

#### Effective status

The API derives a display status rather than mutating rows for every state:

| Derived status | Rule |
| --- | --- |
| `taken` | Stored `taken` |
| `skipped` | Stored `skipped` |
| `missed` | Stored `missed` (set after grace period) |
| `not_recorded` | Blank dose older than the 7-day classification window |
| `snoozed` | `pending` with `snoozed_until` in the future |
| `due` | `pending` at or after its scheduled time |
| `upcoming` | `pending` before its scheduled time |

An older blank dose is never retroactively called missed; that distinction keeps the record honest.

### `appointments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `profile_id` | TEXT FK → care_profiles, cascade | |
| `title`, `provider` | TEXT | Required |
| `location`, `video_link`, `notes` | TEXT nullable | |
| `start_at` | TEXT | UTC instant |
| `timezone` | TEXT | Zone the appointment time is expressed in |
| `duration_minutes` | INTEGER | Default 30 |
| `status` | TEXT | `upcoming`, `completed`, `cancelled` |
| `reminder_lead_minutes` | INTEGER | Default 1440 |
| `created_by`, `updated_by` | TEXT FK → users | |
| `created_at`, `updated_at` | TEXT | |

Index: `(profile_id, start_at)`.

### `reminder_events`

The durable outbox. `event_key` is globally unique, which makes queueing idempotent across ticks and processes.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | |
| `event_key` | TEXT unique | e.g. `dose-upcoming:<doseId>:<userId>` |
| `profile_id` | TEXT FK → care_profiles, cascade | |
| `recipient_user_id` | TEXT nullable FK → users, set null on delete | |
| `recipient_email` | TEXT | Snapshot of the address used |
| `channel` | TEXT | `email` |
| `reminder_type` | TEXT | `upcoming_dose`, `missed_dose`, `appointment`, `test` |
| `subject`, `body` | TEXT | Minimal content; no clinical instructions |
| `status` | TEXT | `queued`, `sent`, `failed`, `skipped` |
| `attempt_count` | INTEGER | Up to 3 delivery attempts |
| `last_error`, `next_attempt_at` | TEXT nullable | Retry bookkeeping |
| `scheduled_for`, `sent_at` | TEXT nullable | |
| `created_at`, `updated_at` | TEXT | |

Index: `(profile_id, status)`.

**Event keys in use**

- `dose-upcoming:<doseId>:<recipientUserId>`
- `dose-missed:<doseId>:<recipientUserId>`
- `appointment:<appointmentId>:<startAt>:<recipientUserId>`
- test reminders use their own generated key

Including the recipient prevents one member's opt-out or retry from affecting another's message.

### `email_delivery_log`

Append-only record of delivery attempts and test-mode sends.

| Column | Notes |
| --- | --- |
| `id` | TEXT PK |
| `reminder_id` | Nullable link to `reminder_events` |
| `profile_id` | Nullable |
| `to_email`, `subject`, `body` | Snapshot |
| `mode` | `test` or `smtp` |
| `ok` | INTEGER bool |
| `error` | Nullable |
| `created_at` | ISO instant |

When `EMAIL_MODE=test` (the default), every "send" writes here and no external email leaves the machine.

### `audit_events`

Human-readable history for sensitive changes.

| Column | Notes |
| --- | --- |
| `id` | TEXT PK |
| `profile_id` | FK → care_profiles, cascade |
| `actor_id` | Nullable user id |
| `actor_label` | Display name snapshot |
| `action` | e.g. `medication.created`, `dose.corrected`, `member.invited`, `member.revoked` |
| `entity`, `entity_id` | What changed |
| `summary` | Readable sentence, including correction reasons |
| `created_at` | ISO instant |

Index: `(profile_id, created_at)`.

## Data lifecycle

- **Dose generation.** `ensureDoseRows` expands active schedules into `dose_events` for the requested window using `occurrencesBetween` in `server/src/time.ts`. Re-running is safe because of the unique constraint.
- **Dose history.** The demo seed builds three weeks of history, including skipped, missed and deliberately unrecorded doses, plus one open evening dose so Today has an action.
- **Missed classification.** A scheduler step marks blank doses missed after `grace_minutes`, within a bounded recent window. Older blanks remain `not_recorded`.
- **Schedule edits.** Changing a schedule clears future pending doses and regenerates them; past recorded outcomes are preserved.
- **Member removal.** Revoking sets `invite_status='revoked'` and `revoked_at`; access checks ignore the row. Audit history remains.
- **No hard deletion UI.** Medicines can be completed/paused; profiles and members are revoked rather than deleted. Account deletion is a known limitation.
- **Reset.** `npm run seed` deletes rows from all tables and recreates fictional fixtures; never run it against real data.

## Integrity and concurrency notes

- SQLite runs with `foreign_keys=ON`, `journal_mode=WAL` and a 5 s busy timeout.
- `transaction()` uses `BEGIN IMMEDIATE` for write batches.
- Sessions and invitation tokens are looked up by hash, so raw secrets are not stored.
- Tests use `DATABASE_FILE=:memory:`; the database is opened once at module load, so the variable must be set before importing application code.
- There is no migration framework yet. Schema changes require either a fresh seed or a hand-written migration.
