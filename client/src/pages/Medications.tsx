import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../context/ProfileProvider'
import { api, errorMessage } from '../lib/api'
import type { Medication } from '../lib/types'
import {
  formatDateWithYear,
  medicationScheduleLabel,
  relativeTime,
} from '../lib/format'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  TextInput,
} from '../components/ui'

type Filter = 'all' | 'active' | 'paused' | 'completed'

const STATUS_LABEL: Record<Medication['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
}

const STATUS_TONE: Record<Medication['status'], 'success' | 'warn' | 'neutral'> = {
  active: 'success',
  paused: 'warn',
  completed: 'neutral',
}

export function MedicationsPage() {
  const { profileId, capabilities, profile } = useProfile()
  const [medications, setMedications] = useState<Medication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ medications: Medication[] }>(`/api/profiles/${profileId}/medications`)
      setMedications(data.medications)
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(
    () => ({
      all: medications.length,
      active: medications.filter((medication) => medication.status === 'active').length,
      paused: medications.filter((medication) => medication.status === 'paused').length,
      completed: medications.filter((medication) => medication.status === 'completed').length,
    }),
    [medications],
  )

  const visible = medications.filter((medication) => {
    if (filter !== 'all' && medication.status !== filter) return false
    if (!query.trim()) return true
    const needle = query.trim().toLowerCase()
    return (
      medication.name.toLowerCase().includes(needle) ||
      medication.prescribedInstructions.toLowerCase().includes(needle) ||
      (medication.strength ?? '').toLowerCase().includes(needle)
    )
  })

  if (loading) return <Loading label="Loading medicines…" />

  return (
    <div className="page">
      <PageHeader
        eyebrow="Medicines"
        title="Medication list"
        description="Exactly what was supplied by the prescriber or pharmacist. CareNest never fills in a dose or schedule by itself."
        actions={
          capabilities.editMedications ? (
            <Link className="btn btn-primary" to="new">
              Add a medicine
            </Link>
          ) : (
            <Chip tone="info">Read-only access</Chip>
          )
        }
      />

      {error ? <ErrorPanel message={error} onRetry={() => void load()} /> : null}

      {medications.length > 0 ? (
        <div className="list-toolbar">
          <div className="filter-chips" role="group" aria-label="Filter medicines by status">
            {(['active', 'paused', 'completed', 'all'] as Filter[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : STATUS_LABEL[value]}
                <span className="filter-count">{counts[value]}</span>
              </button>
            ))}
          </div>
          <div className="search-field">
            <label className="sr-only" htmlFor="med-search">
              Search medicines
            </label>
            <TextInput
              id="med-search"
              type="search"
              placeholder="Search medicines or instructions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      {medications.length === 0 ? (
        <Card>
          <EmptyState
            icon="◌"
            title="No medicines recorded yet"
            description="Add a medicine using the exact instructions supplied by the prescriber, pharmacist or clinic."
            action={
              capabilities.editMedications ? (
                <Link className="btn btn-primary" to="new">
                  Add the first medicine
                </Link>
              ) : null
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="⌕"
            title="No medicines match this view"
            description="Try another status filter or clear the search."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter('all')
                  setQuery('')
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="medication-grid">
          {visible.map((medication) => (
            <li key={medication.id}>
              <Card className="medication-card">
                <div className="medication-head">
                  <div>
                    <h2 className="medication-name">
                      <Link to={medication.id}>{medication.name}</Link>
                    </h2>
                    <p className="medication-strength">
                      {[medication.strength, medication.form].filter(Boolean).join(' · ') ||
                        'Strength not recorded'}
                    </p>
                  </div>
                  <Chip tone={STATUS_TONE[medication.status]}>{STATUS_LABEL[medication.status]}</Chip>
                </div>
                <p className="medication-instruction">{medication.prescribedInstructions}</p>
                <dl className="medication-facts">
                  <div>
                    <dt>Schedule</dt>
                    <dd>{medicationScheduleLabel(medication)}</dd>
                  </div>
                  <div>
                    <dt>Dates</dt>
                    <dd>
                      {formatDateWithYear(medication.startDate)}
                      {medication.endDate ? ` → ${formatDateWithYear(medication.endDate)}` : ' · ongoing'}
                    </dd>
                  </div>
                  <div>
                    <dt>Last updated</dt>
                    <dd>{relativeTime(medication.updatedAt)}</dd>
                  </div>
                </dl>
                <div className="medication-footer">
                  <Link className="text-link" to={medication.id}>
                    View details
                  </Link>
                  {capabilities.editMedications ? (
                    <Link className="text-link" to={`${medication.id}/edit`}>
                      Edit
                    </Link>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="page-note">
        Times are shown in {profile.timezone}. A schedule change applies to future unconfirmed doses; recorded
        doses stay in the history.
      </p>
    </div>
  )
}
