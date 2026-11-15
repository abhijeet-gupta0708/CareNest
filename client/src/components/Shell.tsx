import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useProfile } from '../context/ProfileProvider'
import { Avatar, Banner, Button, Chip, Dialog, Toggle } from './ui'
import { useToast } from './ui'

function Icon({ name }: { name: 'today' | 'medicine' | 'calendar' | 'people' | 'chart' | 'settings' | 'lock' | 'exit' | 'help' }) {
  const paths: Record<string, ReactElement> = {
    today: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    medicine: (
      <>
        <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-40 12 12)" />
        <path d="M9.5 8.5l5 7" />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
        <path d="M16 5.5a3 3 0 010 5.6M17.5 15c2 .6 3.5 2.4 3.5 5" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 018 0v3" />
      </>
    ),
    exit: (
      <>
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
      </>
    ),
  }
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}

const NAV_ITEMS = [
  { to: 'today', label: 'Today', mobile: 'Today', icon: 'today' as const },
  { to: 'medications', label: 'Medications', mobile: 'Medicines', icon: 'medicine' as const },
  { to: 'appointments', label: 'Appointments', mobile: 'Appts', icon: 'calendar' as const },
  { to: 'care-circle', label: 'Care circle', mobile: 'Care team', icon: 'people' as const },
  { to: 'reports', label: 'Reports', mobile: 'Reports', icon: 'chart' as const },
]

export function Shell({ children }: { children: ReactNode }) {
  const { user, profiles, signOut, largeText, highContrast, setLargeText, setHighContrast, lock } = useAuth()
  const { profile, membership, capabilities } = useProfile()
  const navigate = useNavigate()
  const toast = useToast()
  const [helpOpen, setHelpOpen] = useState(false)

  const roleHint = membership.role === 'family'
    ? 'Read-only access'
    : membership.role === 'admin'
      ? 'Manages access'
      : membership.role === 'older_adult'
        ? 'Your care space'
        : 'Caregiver access'

  const otherProfiles = profiles.filter((entry) => entry.profileId !== profile.id)

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="sidebar" aria-label="Main navigation">
        <Link className="wordmark" to={`/app/${profile.id}/today`}>
          <span className="wordmark-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30" fill="none">
              <path
                d="M16 27c-6-4.5-9-8-9-12a5.5 5.5 0 019-4 5.5 5.5 0 019 4c0 4-3 7.5-9 12z"
                fill="currentColor"
                opacity=".16"
              />
              <path
                d="M16 27c-6-4.5-9-8-9-12a5.5 5.5 0 019-4 5.5 5.5 0 019 4c0 4-3 7.5-9 12z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12.5 15.5h2l1.2-2.5 1.6 5 1.2-2.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="wordmark-text">
            CareNest
            <span className="wordmark-tag">A calmer way</span>
          </span>
        </Link>

        <div className="care-context">
          <p className="care-context-label">Caring for</p>
          <div className="care-context-person">
            <Avatar name={profile.preferredName} />
            <div>
              <p className="care-context-name">{profile.preferredName}</p>
              <p className="care-context-role">{roleHint}</p>
            </div>
          </div>
          {otherProfiles.length > 0 ? (
            <label className="profile-switcher">
              <span className="sr-only">Switch care profile</span>
              <select
                value={profile.id}
                onChange={(event) => {
                  navigate(`/app/${event.target.value}/today`)
                  toast.push('Switched care profile', 'info')
                }}
              >
                <option value={profile.id}>{profile.preferredName} (current)</option>
                {otherProfiles.map((entry) => (
                  <option key={entry.profileId} value={entry.profileId}>
                    {entry.preferredName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          {capabilities.manageMembers || capabilities.editMedications || capabilities.editAppointments ? (
            <NavLink
              to="settings"
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
            >
              <Icon name="settings" />
              <span>Care settings</span>
            </NavLink>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <Button variant="quiet" size="sm" icon={<Icon name="help" />} onClick={() => setHelpOpen(true)}>
            Need help?
          </Button>
          <p className="demo-note">
            Fictional demo data only. Not for real patient use. Reminders can be delayed or fail.
          </p>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-profile">
              <span className="topbar-label">Care space</span>
              <strong>{profile.preferredName}</strong>
            </span>
            <Chip tone={membership.role === 'family' ? 'info' : 'teal'}>{membership.roleLabel}</Chip>
          </div>
          <div className="topbar-right">
            <Link className="topbar-link" to="reports">
              <span className={`dot ${capabilities.viewReminders ? 'dot-on' : 'dot-off'}`} aria-hidden="true" />
              Reminders
            </Link>
            <details className="account-menu">
              <summary className="account-summary">
                <Avatar name={user?.displayName ?? 'You'} size="sm" />
                <span className="account-name">{user?.displayName}</span>
                <span aria-hidden="true" className="chevron">
                  ▾
                </span>
              </summary>
              <div className="menu-popover">
                <div className="menu-identity">
                  <p className="menu-name">{user?.displayName}</p>
                  <p className="menu-email">{user?.email}</p>
                </div>
                <div className="menu-section">
                  <p className="menu-heading">Display</p>
                  <Toggle
                    id="pref-large-text"
                    checked={largeText}
                    onChange={setLargeText}
                    label="Larger text"
                    description="Increase text size across CareNest"
                  />
                  <Toggle
                    id="pref-contrast"
                    checked={highContrast}
                    onChange={setHighContrast}
                    label="High contrast"
                    description="Stronger borders and colours"
                  />
                </div>
                <div className="menu-actions">
                  {user?.pinEnabled ? (
                    <button type="button" className="menu-item" onClick={lock}>
                      <Icon name="lock" /> Lock CareNest
                    </button>
                  ) : null}
                  {capabilities.manageMembers || capabilities.editMedications ? (
                    <Link className="menu-item" to="settings">
                      <Icon name="settings" /> Care settings
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      void signOut().then(() => navigate('/signin'))
                    }}
                  >
                    <Icon name="exit" /> Sign out
                  </button>
                </div>
              </div>
            </details>
          </div>
        </header>

        <main id="main" className="main" tabIndex={-1}>
          {!capabilities.viewReminders && membership.role === 'family' ? (
            <Banner tone="info" title="Family view">
              You can see the care plan and summaries shared with you. Medicine and appointment changes are
              made by the older adult or an authorised caregiver.
            </Banner>
          ) : null}
          {children}
        </main>

        <footer className="page-footer">
          <p>
            CareNest is a scheduling and coordination tool. It does not diagnose, prescribe or advise on
            medication. If you need urgent help, contact your local emergency services.
          </p>
        </footer>
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `bottom-link ${isActive ? 'bottom-link-active' : ''}`}
          >
            <Icon name={item.icon} />
            <span>{item.mobile}</span>
          </NavLink>
        ))}
      </nav>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Getting help with CareNest"
        description="CareNest keeps a shared record. It does not give medical advice."
        footer={
          <Button variant="secondary" onClick={() => setHelpOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="prose">
          <p>
            <strong>If someone is seriously unwell or you think it is an emergency</strong>, call your local
            emergency number. CareNest reminders are not emergency monitoring and can be delayed or fail.
          </p>
          <p>
            <strong>For questions about a medicine</strong>, contact the prescriber, pharmacist or the care
            team. CareNest only stores the instructions that were entered for you.
          </p>
          <p>
            <strong>If a reminder looks wrong</strong>, ask a caregiver or the care-team administrator to
            check the care profile and the medication record.
          </p>
          <p>
            Demo sign-in details are in the project README. This environment uses fictional data only.
          </p>
        </div>
      </Dialog>
    </div>
  )
}
