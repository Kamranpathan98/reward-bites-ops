import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionDetail } from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { recordAuditEvent } from '../audit/audit-writer';
import { TableSessionRepository, type TableSessionRow } from './table-session.repository';
import type { ActingUser } from './tables.types';

function toDetail(row: TableSessionRow): SessionDetail {
  return {
    id: row.id,
    tableId: row.tableId,
    status: row.status,
    sessionToken: row.sessionToken,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    openedByUserId: row.openedByUserId,
    forceClosed: row.forceClosed,
  };
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly sessionRepository: TableSessionRepository,
  ) {}

  async getById(tenantId: string, id: string): Promise<SessionDetail> {
    const session = await withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, (tx) =>
      this.sessionRepository.findById(tx, tenantId, id),
    );
    if (!session) throw new NotFoundException('Session not found.');
    return toDetail(session);
  }

  /**
   * Closes a session. Architecture section 10 ("Close session"): every
   * order COMPLETED/CANCELLED and every bill PAID/VOID/DISCARDED, or a
   * force-close reason present, else 409. Gate 4 has neither `orders` nor
   * `bill` tables yet (Gates 6/8) — every close is therefore unconditional
   * for now, which is also the factually correct outcome today (a session
   * with no orders/bills has nothing that could block it). The
   * force-close-with-reason path is wired end to end (accepted, recorded,
   * `force_closed` set) so Gate 8 only has to add the actual blocking
   * check, not build this path from scratch.
   */
  async close(actor: ActingUser, id: string, reason?: string): Promise<void> {
    await withTenantTx(
      this.pool,
      { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
      async (tx) => {
        const session = await this.sessionRepository.lockById(tx, actor.tenantId, id);
        if (!session) throw new NotFoundException('Session not found.');
        if (session.status === 'CLOSED') {
          throw new ConflictException('This session is already closed.');
        }

        await this.sessionRepository.close(tx, actor.tenantId, id, reason !== undefined);

        await recordAuditEvent(tx, {
          entityType: 'table_session',
          entityId: id,
          action: 'session.closed',
          actorKind: actor.actorKind,
          actorId: actor.userId,
          ...(reason !== undefined ? { reason } : {}),
        });
      },
    );
  }
}
