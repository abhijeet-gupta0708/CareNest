# CareNest product brief

## The problem

Managing medicines and appointments across a family is usually spread over paper lists, group chats, phone calls and memory. The older adult wants to stay in control; relatives want to help without taking over; caregivers need to know what has actually been confirmed, not what someone assumed.

CareNest turns that into one shared, permission-based care timeline: **what is due, what was confirmed, what was missed, and what is coming next** — without making healthcare decisions for anyone.

## Product promise

> A calmer way to stay on top of care.

The older adult stays at the centre. Everything in the product is a record of human-entered information plus a scheduling aid. CareNest is not a clinician, a diagnostic tool or an emergency monitor.

### Hard clinical boundary

CareNest must never:

- diagnose, prescribe, recommend a medicine or suggest stopping one;
- infer a dose, frequency or timing from a medicine name;
- calculate or adjust a dose;
- advise doubling up or taking a catch-up dose after a missed reminder;
- claim that a reminder was delivered or that someone is safe.

When information is incomplete or conflicting, the product asks an authorised person to check the prescription, pharmacy label or clinician's instructions. Missed-dose copy is neutral and routes people back to the prescriber or pharmacist.

## Primary users

| Role | What they need | Default access |
| --- | --- | --- |
| **Older adult / care recipient** | A simple "Today" view, one clear action to confirm a dose, and final control over who can see or change things | Profile owner; full access |
| **Primary caregiver** | Day-to-day coordination: help record doses, keep the medicine list and appointments current | View + record doses by default; editing only when explicitly granted |
| **Family viewer** | Stay informed without accidentally changing clinical records | Read-only; sees only data the owner shares |
| **Care-team administrator** | Manage invitations, roles, permissions and access history | Membership management + reports/export; no clinical editing |

A short PIN is an optional quick-unlock convenience on top of a real signed-in session. It never grants more access than that session already has.

## Core journeys

### 1. Join a care circle

An owner or administrator sends an invitation to an email address. The recipient opens the link, sees who invited them and what the role means, then accepts while signed in with the matching account. Membership becomes active only after acceptance; revoked members lose access immediately. Reinvite and revocation are audited.

**Acceptance criteria**

- No profile access before acceptance.
- An invitation cannot be accepted by a different signed-in account.
- Role and capabilities are explained before acceptance.
- Revocation removes access on the next request; pending/revoked invitations are visible to managers.

### 2. Add a medicine

An authorised person enters the name, strength, form, the exact prescribed instructions, a source/verification note, start/end dates and the schedule (daily, selected weekdays, or as needed). They review the entry before saving. The app never pre-fills or derives a dose.

**Acceptance criteria**

- Free-text instructions are copied, not rewritten by the app.
- At least one local time is required unless the medicine is as-needed.
- Invalid times, dates and missing verification are rejected server-side.
- Creating, editing, pausing, resuming and completing are audited.

### 3. Confirm a dose

Today shows the next dose and the full timeline in the profile's time zone. A permitted user taps **Taken** or **Skipped**, optionally adds a note, and confirms in a dialog. The timeline immediately shows the outcome, who recorded it and when.

**Acceptance criteria**

- Double-tapping cannot create two outcomes (idempotent).
- A conflicting second outcome returns an explicit conflict rather than silently overwriting.
- Read-only viewers see the status but no action controls.
- Network failure never shows a false confirmation.
- Corrections require a reason and remain auditable.

### 4. Handle a missed reminder

When no confirmation is recorded within the grace period, the dose becomes **Missed**. The UI explains that no confirmation was received and tells the person to follow the prescriber or pharmacist instructions; CareNest does not advise catch-up dosing. A missed-dose reminder may be queued for opted-in members outside quiet hours.

Older doses with no record stay **Not recorded** rather than being retroactively labelled missed.

### 5. Manage appointments

Authorised users add appointments with title, provider, location/video link, notes, start time, an explicit time zone, duration and reminder lead time. Upcoming, past and all views plus a month calendar make the schedule legible. Completion and cancellation are recorded; appointment reminders follow the same delivery pipeline.

### 6. Handover

The Today screen and Reports → Handover summarise the last confirmed dose, the next appointment and anything without a recorded outcome, so a caregiver arriving for a shift can orient quickly without reading the whole history.

## Scope

### Built in this MVP

- Account registration, sign-in/out, session handling and PIN quick unlock.
- Care profile with preferred name, time zone, sharing toggles, reminder leads and quiet hours.
- Care circle invitations, role/capability changes, reinvite, revoke, notification preferences and activity history.
- Medicines with human-entered instructions, scheduling, status changes and per-medicine history.
- Today timeline, dose recording, snooze, skip, correction with reason, and derived statuses.
- Appointments with list/calendar views and reminder configuration.
- Reminder queue with unique event keys, quiet hours, opt-outs, delivery states, retries and a safe test mode.
- Adherence/handover reports, reminder log, audit history and JSON export.
- Accessibility settings: larger text and high contrast, persistent across reloads.
- Automated tests for time zones, permissions, API behaviour and reminder idempotency.

### Deliberately deferred

- OCR of prescriptions, automatic medicine identification, interaction checking or any clinical decision support.
- AI-generated medical recommendations or schedules.
- Real-time push, SMS/voice/device notifications, offline mode and native apps.
- Email verification, password reset, MFA, account deletion and full consent/retention workflows.
- Multilingual interface and voice navigation.
- Integrations with pharmacies, GPs or health records.

## Success measures

- **Task completion:** a first-time older adult can find today's next dose and record a status without help in a short usability test.
- **Permission correctness:** a family viewer cannot edit medicines, appointments or doses even when calling the API directly.
- **Reminder reliability:** every reminder has a unique event key and a visible queued/sent/failed state; retries never duplicate a message.
- **Trust:** every sensitive change is attributed in the audit history, and missed-dose copy never gives clinical advice.
- **Accessibility:** keyboard-only use reaches all actions; 200% text remains usable; automated checks score 100 for accessibility on core screens.

These have been partially validated through automated tests, a browser walkthrough and Lighthouse, but **not** through moderated testing with older adults or assistive-technology users.

## Design principles

1. **One-screen rule.** The most important action comes first; no dense dashboards or icon-only controls.
2. **Calm, legible visual system.** Teal/ink/ivory palette, 18px+ body text, 44–48px controls, generous spacing.
3. **Never colour alone.** Every status has a word and an icon as well as a tone.
4. **Explicit time zones.** Times are labelled with the zone in which they are meant; appointments carry their own zone.
5. **Reversible with a trail.** Corrections are allowed but require a reason and are audited.
6. **Consent by default.** Family visibility is controlled by sharing switches, and permissions are visible before accepting an invite.

## Risks and mitigations

| Risk | Mitigation in this MVP |
| --- | --- |
| Product appears to give medical advice | Explicit boundary copy on every relevant screen and in emails; no dose inference; neutral missed-dose wording |
| Family member accidentally changes records | Read-only family role enforced at the API, not just hidden in the UI |
| Duplicate reminder emails | Unique `event_key`, `INSERT OR IGNORE`, delivery states and tests |
| Reminder arrives at an unsafe hour | Per-member quiet hours evaluated in the profile time zone |
| Dose recorded twice by a double tap | Idempotent record endpoint returning `alreadyApplied` |
| Wrong local time around DST | All schedule expansion uses `Intl`-based zone conversion with DST tests |
| Sensitive data in email previews | Minimal subject/body; details require sign-in |
| Older users struggle with small UI | 18px base, large-text mode, 44px controls, high contrast, semantic labels |
| Demo data mistaken for real guidance | Fictional names/medicines, `.example` emails, persistent demo disclaimer |

## Demo script (90 seconds)

1. Sign in as Margaret and show Today: next dose, status summary, timeline with actor and timestamp.
2. Record a dose; show the confirmation dialog and updated timeline.
3. Point at a missed dose and read the neutral copy.
4. Open Medicines → a medicine detail to show instructions, schedule and recent history.
5. Switch to Sara (family viewer) and show the same data without action controls.
6. Open Care team → show roles, permissions and the pending invitation.
7. Finish on Reports → Handover and the audit trail.
