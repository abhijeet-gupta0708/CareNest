# CareNest

A shared, permission-based record of human-entered care information: what is due, what was confirmed, what was missed and what is coming next. CareNest is a scheduling and recording aid, never a clinical decision-maker.

## Language

### The clinical boundary

**Clinical boundary**:
The rule that CareNest displays only what a person entered and never diagnoses, prescribes, infers, calculates or advises. Missed-dose copy routes people back to the prescriber or pharmacist.
_Avoid_: medical advice, recommendation, guidance

**Prescribed instructions**:
The exact dose text a person copied from a prescription, pharmacy label or clinician's note. Stored and shown verbatim; the app never rewrites or derives it.
_Avoid_: dose calculation, auto-filled dose, suggested dose

### People and access

**Care profile**:
The person being cared for and the record everything else belongs to. Has a preferred name, an IANA time zone and sharing switches.
_Avoid_: patient, account, user record

**Older adult**:
The person at the centre of the care profile. Owns the profile and bypasses the per-member capability grants.
_Avoid_: patient, service user, elderly person

**Care circle**:
The set of members with access to one care profile.
_Avoid_: care team, group, family

**Caregiver**:
A member who helps day to day: views the plan and records doses by default, and edits medicines or appointments only when granted.
_Avoid_: carer, primary user

**Family viewer**:
A member with read-only access to the parts of the profile the older adult shares.
_Avoid_: observer, guest

**Care-team administrator**:
A member who manages invitations, roles, permissions and reports, but not clinical content.
_Avoid_: owner, superuser

**Capability**:
One explicit permission grant on a membership (edit medicines, edit appointments, record doses, manage members). Every server route checks the narrowest capability it needs.
_Avoid_: scope, permission level, role

**Membership**:
The link between a person and a care profile, carrying role, capabilities, notification preferences and invitation state.
_Avoid_: user, member account

**Invitation**:
A pending offer of membership sent to an email address. Access begins only after the matching signed-in account accepts it; revoking ends access immediately.
_Avoid_: request, signup link

### Medicines and doses

**Medicine**:
A named entry in the care profile's list, with optional strength and form, verbatim prescribed instructions, a source note, a date range and a status (active, paused or completed).
_Avoid_: medication (in new prose), prescription, drug, script

**Schedule**:
The times a medicine is due: daily, selected weekdays, or as needed. Stored as local wall-clock times plus an IANA zone, never as a fixed UTC offset.
_Avoid_: regimen, dosing plan

**Dose**:
One scheduled occurrence of a medicine at a specific local time on a specific day.
_Avoid_: intake, administration, pill

**Dose record**:
What a person confirmed about a dose: taken or skipped, by whom, when, with an optional note. Corrections carry a reason and stay in the audit history.
_Avoid_: log entry, check-in, mark

**Taken** / **Skipped**:
The two outcomes a person can confirm. Nothing else is inferred from them.

**Missed**:
A dose with no confirmation after its grace period has elapsed. Shown neutrally, with no catch-up advice.

**Not recorded**:
A blank dose from before the recent classification window. It is never retroactively called missed, so the record stays honest.

**Due** / **Upcoming**:
A pending dose at or after its scheduled time (due), or before it (upcoming).

**Snoozed**:
A pending dose whose snooze timer has not yet expired. A snooze is a delay, not an outcome.

**Grace period**:
How long after a dose's scheduled time a blank record stays blank before being classified missed.

**Handover**:
A short summary of the last confirmed dose, the next appointment and anything without a record, so someone arriving for a shift can orient quickly.
_Avoid_: shift report, status update

### Reminders

**Reminder**:
A scheduling aid sent to an opted-in member about an upcoming dose, a missed dose or an appointment. Carries only what is due, when, a sign-in link and a non-clinical disclaimer.
_Avoid_: alert, notification, nudge

**Quiet hours**:
A member's daily window (evaluated in the care profile's zone, overnight ranges allowed) in which reminders are not sent.

**Delivery state**:
Where a reminder stands: queued, sent, failed or skipped, with retries bounded and visible in the reminder log.
_Avoid_: notification status, send flag

**Audit event**:
An attributed, human-readable entry for a sensitive change (medicine edited, dose corrected, member invited or revoked, permission changed).
_Avoid_: activity log, history entry
