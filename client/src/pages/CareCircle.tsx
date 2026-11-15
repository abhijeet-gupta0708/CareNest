import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../context/ProfileProvider'
import { useAuth } from '../context/AuthProvider'
import { api, errorMessage } from '../lib/api'
import type { AuditEvent, Membership, Role } from '../lib/types'
import { relativeTime } from '../lib/format'
import {
  Avatar,
  Banner,
  Button,
  Card,
  CardHeader,
  Chip,
  Dialog,
  ErrorPanel,
  Field,
  Loading,
  PageHeader,
  Select,
  TextInput,
  Toggle,
  useToast,
} from '../components/ui'

const ROLE_OPTIONS: Array<{ value: Exclude<Role, 'older_adult'>; title: string; description: string }> = [
  {
    value: 'caregiver',
    title: 'Primary caregiver',
    description: 'Helps with the day-to-day plan. Can record doses by default; medicine editing only if you allow it.',
  },
  {
    value: 'family',
    title: 'Family viewer',
    description: 'Follows shared updates and summaries. Read-only, with no editing or dose recording.',
  },
  {
    value: 'admin',
    title: 'Care-team administrator',
    description: 'Manages invitations and access. No automatic access to medicines or appointments editing.',
  },
]

const PERMISSION_LABELS: Array<{ key: keyof Membership['permissions']; label: string; description: string }> = [
  {
    key: 'editMedications',
    label: 'Add or edit medicines',
    description: 'Enter prescription details, schedules and changes.',
  },
  {
    key: 'editAppointments',
    label: 'Add or edit appointments',
    description: 'Create, reschedule, cancel and complete appointments.',
  },
  {
    key: 'recordDoses',
    label: 'Record dose outcomes',
    description: 'Confirm taken, skipped or snoozed doses.',
  },
  {
    key: 'manageMembers',
    label: 'Manage access',
    description: 'Invite people, change roles and revoke access.',
  },
]

const STATUS_TONE: Record<Membership['inviteStatus'], 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success',
  pending: 'warn',
  expired: 'danger',
  revoked: 'neutral',
}

export function CareCirclePage() {
  const { profileId, profile, membership, capabilities } = useProfile()
  const { user } = useAuth()
  const toast = useToast()
  const [members, setMembers] = useState<Membership[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'older_adult'>>('caregiver')
  const [invitePermissions, setInvitePermissions] = useState({
    editMedications: false,
    editAppointments: false,
    recordDoses: true,
    manageMembers: false,
  })
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<Membership | null>(null)
  const [editRole, setEditRole] = useState<Exclude<Role, 'older_adult'>>('caregiver')
  const [editPermissions, setEditPermissions] = useState({
    editMedications: false,
    editAppointments: false,
    recordDoses: false,
    manageMembers: false,
  })
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<Membership | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ members: Membership[] }>(`/api/profiles/${profileId}/members`)
      setMembers(data.members)
      setError(null)
      if (capabilities.viewAudit) {
        const auditData = await api.get<{ events: AuditEvent[] }>(`/api/profiles/${profileId}/audit?limit=40`)
        setAudit(auditData.events)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [capabilities.viewAudit, profileId])

  useEffect(() => {
    void load()
  }, [load])

  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.push('Invitation link copied.')
    } catch {
      toast.push('Copy the link from the box below.', 'info')
    }
  }

  const sendInvite = async () => {
    if (!inviteEmail.trim()) {
      setInviteError('Enter the email address of the person you want to invite.')
      return
    }
    setInviteBusy(true)
    setInviteError(null)
    try {
      const result = await api.post<{ inviteUrl: string }>(
        `/api/profiles/${profileId}/members/invite`,
        {
          email: inviteEmail.trim(),
          role: inviteRole,
          permissions: invitePermissions,
        },
      )
      setInviteLink(result.inviteUrl)
      setInviteEmail('')
      toast.push('Invitation created. The person gets access only after accepting.')
      await load()
    } catch (caught) {
      setInviteError(errorMessage(caught))
    } finally {
      setInviteBusy(false)
    }
  }

  const openEdit = (member: Membership) => {
    setEditTarget(member)
    setEditRole(member.role === 'older_adult' ? 'caregiver' : member.role)
    setEditPermissions(member.permissions)
    setEditError(null)
  }

  const savePermissions = async () => {
    if (!editTarget) return
    setEditBusy(true)
    setEditError(null)
    try {
      await api.patch(`/api/profiles/${profileId}/members/${editTarget.id}`, {
        role: editTarget.role === 'older_adult' ? undefined : editRole,
        permissions: editTarget.role === 'older_adult' ? undefined : editPermissions,
      })
      toast.push('Access updated. The change is in the audit history.')
      setEditTarget(null)
      await load()
    } catch (caught) {
      setEditError(errorMessage(caught))
    } finally {
      setEditBusy(false)
    }
  }

  const revoke = async () => {
    if (!revokeTarget) return
    setEditBusy(true)
    setRevokeError(null)
    try {
      await api.post(`/api/profiles/${profileId}/members/${revokeTarget.id}/revoke`, {})
      toast.push('Access revoked immediately.')
      setRevokeTarget(null)
      await load()
    } catch (caught) {
      setRevokeError(errorMessage(caught))
    } finally {
      setEditBusy(false)
    }
  }

  const reinvite = async (member: Membership) => {
    try {
      const result = await api.post<{ inviteUrl: string }>(
        `/api/profiles/${profileId}/members/${member.id}/reinvite`,
        {},
      )
      setInviteLink(result.inviteUrl)
      setInviteOpen(true)
      toast.push('A fresh invitation link was created.')
      await load()
    } catch (caught) {
      toast.push(errorMessage(caught), 'error')
    }
  }

  if (loading) return <Loading label="Loading the care circle…" />

  const active = members.filter((member) => member.inviteStatus === 'active')
  const pending = members.filter((member) => member.inviteStatus === 'pending' || member.inviteStatus === 'expired')
  const revoked = members.filter((member) => member.inviteStatus === 'revoked')

  return (
    <div className="page">
      <PageHeader
        eyebrow="Care circle"
        title="Who can see and do what"
        description={`Access is scoped to ${profile.preferredName}’s care profile only. Every change is recorded and can be reviewed.`}
        actions={
          capabilities.manageMembers ? (
            <Button
              onClick={() => {
                setInviteOpen(true)
                setInviteLink(null)
                setInviteError(null)
                setInviteRole('caregiver')
                setInvitePermissions({ editMedications: false, editAppointments: false, recordDoses: true, manageMembers: false })
              }}
            >
              Invite someone
            </Button>
          ) : (
            <Chip tone="info">Only an administrator can invite</Chip>
          )
        }
      />

      {error ? <ErrorPanel message={error} onRetry={() => void load()} /> : null}

      <div className="circle-grid">
        <div className="circle-main">
          <Card>
            <CardHeader
              title={`Members with access (${active.length})`}
              description="Roles and permissions are enforced on the server, not just hidden in the interface."
            />
            <ul className="member-list">
              {active.map((member) => (
                <li key={member.id} className="member-row">
                  <Avatar name={member.email} />
                  <div className="member-main">
                    <div className="member-head">
                      <p className="member-email">
                        {member.email}
                        {member.email === user?.email ? <span className="you-tag"> (you)</span> : null}
                      </p>
                      <Chip tone={member.role === 'family' ? 'info' : 'teal'}>{member.roleLabel}</Chip>
                    </div>
                    <div className="member-permissions">
                      {member.permissions.editMedications ? <Chip tone="neutral">Edits medicines</Chip> : null}
                      {member.permissions.editAppointments ? <Chip tone="neutral">Edits appointments</Chip> : null}
                      {member.permissions.recordDoses ? <Chip tone="neutral">Records doses</Chip> : null}
                      {member.permissions.manageMembers ? <Chip tone="neutral">Manages access</Chip> : null}
                      {!member.permissions.editMedications &&
                      !member.permissions.editAppointments &&
                      !member.permissions.recordDoses &&
                      !member.permissions.manageMembers ? (
                        <Chip tone="neutral">Read-only</Chip>
                      ) : null}
                    </div>
                    <p className="member-meta">
                      {member.isOwner ? 'Care profile owner' : 'Joined'} {relativeTime(member.acceptedAt ?? member.invitedAt)}
                      {member.lastActiveAt ? ` · Last active ${relativeTime(member.lastActiveAt)}` : ''}
                    </p>
                  </div>
                  <div className="member-actions">
                    {capabilities.manageMembers && !member.isOwner ? (
                      <Button variant="quiet" size="sm" onClick={() => openEdit(member)}>
                        Access
                      </Button>
                    ) : null}
                    {!member.isOwner && (capabilities.manageMembers || member.email === user?.email) ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => {
                          setRevokeTarget(member)
                          setRevokeError(null)
                        }}
                      >
                        {member.email === user?.email ? 'Leave' : 'Revoke'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {pending.length > 0 ? (
            <Card>
              <CardHeader
                title={`Invitations (${pending.length})`}
                description="Access begins only after the invited person accepts with the matching email address."
              />
              <ul className="member-list">
                {pending.map((member) => (
                  <li key={member.id} className="member-row member-row-muted">
                    <Avatar name={member.email} />
                    <div className="member-main">
                      <div className="member-head">
                        <p className="member-email">{member.email}</p>
                        <Chip tone={STATUS_TONE[member.inviteStatus]}>{member.inviteStatus}</Chip>
                      </div>
                      <p className="member-meta">
                        {member.roleLabel} · invited {relativeTime(member.invitedAt)}
                        {member.inviteExpiresAt
                          ? ` · expires ${new Date(member.inviteExpiresAt).toLocaleDateString('en-GB')}`
                          : ''}
                      </p>
                    </div>
                    {capabilities.manageMembers ? (
                      <div className="member-actions">
                        <Button variant="quiet" size="sm" onClick={() => void reinvite(member)}>
                          {member.inviteStatus === 'expired' ? 'Send new link' : 'Reset link'}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {capabilities.viewAudit ? (
            <Card>
              <CardHeader
                title="Access and care history"
                description="A readable record of changes, including access changes."
                action={
                  <Link className="text-link" to="../reports">
                    Full report
                  </Link>
                }
              />
              {audit.length === 0 ? (
                <p className="muted-note">No activity recorded yet.</p>
              ) : (
                <ul className="history-list">
                  {audit.slice(0, 12).map((event) => (
                    <li key={event.id}>
                      <span className="history-dot" aria-hidden="true" />
                      <div>
                        <p className="history-summary">{event.summary}</p>
                        <p className="history-meta">
                          {event.actorLabel} · {relativeTime(event.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {revoked.length > 0 && capabilities.manageMembers ? (
            <Card>
              <CardHeader title="Previous access" description="Revoked access stops future reads and writes immediately." />
              <ul className="member-list">
                {revoked.map((member) => (
                  <li key={member.id} className="member-row member-row-muted">
                    <Avatar name={member.email} />
                    <div className="member-main">
                      <p className="member-email">{member.email}</p>
                      <p className="member-meta">
                        {member.roleLabel} · revoked {relativeTime(member.revokedAt ?? member.invitedAt)}
                      </p>
                    </div>
                    <Chip tone="neutral">Revoked</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="circle-side">
          <Card tone="mint">
            <CardHeader title="What family viewers see" level={3} />
            <dl className="fact-list">
              <div>
                <dt>Medicines and doses</dt>
                <dd>{profile.shareMedications ? 'Shared (read-only)' : 'Not shared'}</dd>
              </div>
              <div>
                <dt>Appointments</dt>
                <dd>{profile.shareAppointments ? 'Shared (read-only)' : 'Not shared'}</dd>
              </div>
              <div>
                <dt>Care updates</dt>
                <dd>Appointment and membership updates only</dd>
              </div>
            </dl>
            {capabilities.manageMembers ? (
              <Link className="text-link" to="../settings">
                Change sharing in care settings
              </Link>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Your reminder preferences" level={3} />
            <SelfPreferences membership={membership} onSaved={() => void load()} />
          </Card>

          <Card>
            <CardHeader title="Access rules" level={3} />
            <ul className="rule-list">
              <li>Every membership is scoped to one care profile.</li>
              <li>Invitations grant nothing until accepted.</li>
              <li>Revoking access takes effect immediately.</li>
              <li>Family viewers are read-only by default.</li>
              <li>Only the older adult or an administrator can change access.</li>
            </ul>
          </Card>
        </aside>
      </div>

      <Dialog
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false)
          setInviteLink(null)
        }}
        size="lg"
        title="Invite someone to the care circle"
        description="They receive a link by email. Access starts only after they accept using the same email address."
        footer={
          inviteLink ? (
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button loading={inviteBusy} onClick={() => void sendInvite()}>
                Send invitation
              </Button>
            </>
          )
        }
      >
        {inviteLink ? (
          <div className="prose">
            <Banner tone="success" title="Invitation created">
              Share this link with the person you invited. It expires in 14 days and is shown only once.
            </Banner>
            <div className="invite-link-box">
              <code>{inviteLink}</code>
              <Button size="sm" variant="secondary" onClick={() => void copyLink(inviteLink)}>
                Copy link
              </Button>
            </div>
            <p className="muted-note">
              In this demo, email delivery is written to the local delivery log instead of being sent. The
              invitation is visible in Reports → Reminders.
            </p>
          </div>
        ) : (
          <div className="modal-form">
            {inviteError ? (
              <Banner tone="danger" title="The invitation was not created">
                {inviteError}
              </Banner>
            ) : null}
            <Field id="invite-email" label="Email address" required>
              <TextInput
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="name@example.com"
              />
            </Field>
            <fieldset className="fieldset">
              <legend className="field-label">Role</legend>
              <div className="option-cards option-cards-stack">
                {ROLE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`option-card ${inviteRole === option.value ? 'option-card-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="invite-role"
                      value={option.value}
                      checked={inviteRole === option.value}
                      onChange={() => {
                        setInviteRole(option.value)
                        setInvitePermissions({
                          editMedications: false,
                          editAppointments: false,
                          recordDoses: option.value === 'caregiver',
                          manageMembers: option.value === 'admin',
                        })
                      }}
                    />
                    <span className="option-title">{option.title}</span>
                    <span className="option-copy">{option.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="fieldset">
              <legend className="field-label">Specific permissions</legend>
              <p className="field-hint">
                Everyone with access can view the care plan. Choose anything extra this person may do.
              </p>
              {PERMISSION_LABELS.map((permission) => (
                <Toggle
                  key={permission.key}
                  id={`invite-${permission.key}`}
                  checked={invitePermissions[permission.key]}
                  onChange={(checked) =>
                    setInvitePermissions({ ...invitePermissions, [permission.key]: checked })
                  }
                  label={permission.label}
                  description={permission.description}
                />
              ))}
            </fieldset>
          </div>
        )}
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Change access"
        description={editTarget ? `Update what ${editTarget.email} can do in this care circle.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button loading={editBusy} onClick={() => void savePermissions()}>
              Save access
            </Button>
          </>
        }
      >
        {editTarget?.role === 'older_adult' ? (
          <div className="prose">
            <Banner tone="info" title="The older adult’s access is protected">
              The care profile owner keeps full access. They can change their own sharing settings in care
              settings.
            </Banner>
          </div>
        ) : (
          <div className="modal-form">
            {editError ? (
              <Banner tone="danger" title="Access was not changed">
                {editError}
              </Banner>
            ) : null}
            <Field id="edit-role" label="Role">
              <Select
                id="edit-role"
                value={editRole}
                onChange={(event) => setEditRole(event.target.value as Exclude<Role, 'older_adult'>)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.title}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="fieldset">
              <legend className="field-label">Permissions</legend>
              {PERMISSION_LABELS.map((permission) => (
                <Toggle
                  key={permission.key}
                  id={`edit-${permission.key}`}
                  checked={editPermissions[permission.key]}
                  onChange={(checked) =>
                    setEditPermissions({ ...editPermissions, [permission.key]: checked })
                  }
                  label={permission.label}
                  description={permission.description}
                />
              ))}
            </fieldset>
            <p className="muted-note">
              Changes apply immediately. The person’s next request is checked against the new permissions.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title={revokeTarget?.email === user?.email ? 'Leave this care circle?' : 'Revoke this access?'}
        description={
          revokeTarget
            ? `${revokeTarget.email} will immediately lose access to ${profile.preferredName}’s care profile. Recorded history stays with the care profile.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Keep access
            </Button>
            <Button variant="danger" loading={editBusy} onClick={() => void revoke()}>
              Revoke access
            </Button>
          </>
        }
      >
        {revokeError ? (
          <Banner tone="danger" title="Access was not revoked">
            {revokeError}
          </Banner>
        ) : (
          <p className="prose">
            This action is recorded in the audit history with your name and the time.
          </p>
        )}
      </Dialog>
    </div>
  )
}

function SelfPreferences({ membership, onSaved }: { membership: Membership; onSaved: () => void }) {
  const { profileId } = useProfile()
  const toast = useToast()
  const [notifications, setNotifications] = useState(membership.notifications)
  const [quiet, setQuiet] = useState(membership.quietHours)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setNotifications(membership.notifications)
    setQuiet(membership.quietHours)
  }, [membership])

  const save = async () => {
    setBusy(true)
    try {
      await api.patch(`/api/profiles/${profileId}/members/${membership.id}`, {
        notifications,
        quietHours: quiet,
      })
      toast.push('Your reminder preferences were saved.')
      onSaved()
    } catch (caught) {
      toast.push(errorMessage(caught), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-form">
      <Toggle
        id="self-upcoming"
        checked={notifications.upcomingDoses}
        onChange={(checked) => setNotifications({ ...notifications, upcomingDoses: checked })}
        label="Upcoming doses"
        description="Email shortly before a scheduled dose."
      />
      <Toggle
        id="self-missed"
        checked={notifications.missedDoses}
        onChange={(checked) => setNotifications({ ...notifications, missedDoses: checked })}
        label="Missed doses"
        description="Neutral email when no confirmation was recorded."
      />
      <Toggle
        id="self-appointments"
        checked={notifications.appointments}
        onChange={(checked) => setNotifications({ ...notifications, appointments: checked })}
        label="Appointments"
        description="Email before an appointment."
      />
      <div className="quiet-hours">
        <Field id="quiet-start" label="Quiet hours start">
          <TextInput
            id="quiet-start"
            type="time"
            value={quiet.start ?? ''}
            onChange={(event) => setQuiet({ ...quiet, start: event.target.value || null })}
          />
        </Field>
        <Field id="quiet-end" label="Quiet hours end">
          <TextInput
            id="quiet-end"
            type="time"
            value={quiet.end ?? ''}
            onChange={(event) => setQuiet({ ...quiet, end: event.target.value || null })}
          />
        </Field>
      </div>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void save()}>
        Save my preferences
      </Button>
    </div>
  )
}
