import { newId, nowIso, run } from './db.js'

export interface AuditInput {
  profileId: string
  actorId: string | null
  actorLabel: string
  action: string
  entity: string
  entityId?: string | null
  summary: string
}

export function recordAudit(input: AuditInput) {
  run(
    `INSERT INTO audit_events (id, profile_id, actor_id, actor_label, action, entity, entity_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    input.profileId,
    input.actorId,
    input.actorLabel,
    input.action,
    input.entity,
    input.entityId ?? null,
    input.summary,
    nowIso(),
  )
}
