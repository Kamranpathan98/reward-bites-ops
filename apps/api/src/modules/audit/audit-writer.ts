import type { ActorKind, TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

/**
 * `AuditWriter.record({entityType, entityId, action, before, after,
 * reason})` (architecture section 14) — written inside the same
 * transaction as the change it records, so it cannot be lost (task
 * instruction: "the audit event must be persisted before the business
 * transaction commits," not an eventual/background mechanism).
 *
 * Only entities the architecture's audit table actually lists get called
 * here in Gate 2: Users (invited, role_changed, status_changed,
 * sessions_revoked) and Tenant (created). Login/refresh/logout/
 * change-password are deliberately not audited via `audit_event` — the
 * architecture's own audit table (section 14) does not list them; login
 * failure tracking is `login_attempt`, a separate mechanism.
 */
export interface RecordAuditEventInput {
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly action: string;
  readonly actorKind: ActorKind;
  readonly actorId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string;
  readonly requestId?: string | null;
}

export async function recordAuditEvent(
  tx: TransactionContext,
  input: RecordAuditEventInput,
): Promise<void> {
  if (!tx.tenantId) {
    throw new Error('recordAuditEvent requires a tenant-scoped TransactionContext (withTenantTx)');
  }

  const after =
    input.reason !== undefined
      ? {
          ...(typeof input.after === 'object' && input.after !== null ? input.after : {}),
          reason: input.reason,
        }
      : input.after;

  await tx.query(
    `INSERT INTO audit_event
       (id, tenant_id, entity_type, entity_id, action, actor_kind, actor_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      newId(),
      tx.tenantId,
      input.entityType,
      input.entityId ?? null,
      input.action,
      input.actorKind,
      input.actorId ?? null,
      input.before !== undefined ? JSON.stringify(input.before) : null,
      after !== undefined ? JSON.stringify(after) : null,
      input.requestId ?? null,
    ],
  );
}
