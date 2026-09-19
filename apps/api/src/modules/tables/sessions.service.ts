import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionDetail } from '@rewardbite/contracts';
import { DB_POOL, withTenantTx, type Pool } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
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
   * Closes a session (architecture section 10, "Close session").
   *
   * NORMAL close (no reason) is rejected with 409 while the session still has
   *   - non-terminal orders (NEW / ACCEPTED / PREPARING / READY) -> SESSION_HAS_OPEN_ORDERS
   *   - DRAFT bills                                              -> SESSION_HAS_DRAFT_BILLS
   *   - FINALIZED (unpaid) bills                                 -> SESSION_HAS_UNPAID_BILLS
   * Terminal bill states are DISCARDED, PAID and VOID; a DRAFT is released by
   * discarding it.
   *
   * FORCE close (reason present) bypasses those blockers. Any DRAFT bill of the
   * session is DISCARDED (audited) so a closed session never holds a draft;
   * FINALIZED bills are left untouched and stay payable / voidable (payment and
   * void do not require an OPEN session). Sessions are never auto-closed.
   *
   * Lock order: this takes the session `FOR UPDATE` first; bill-draft creation
   * takes it `FOR SHARE`, so the two serialize.
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

        if (reason === undefined) {
          const blockers = await this.sessionRepository.countClosureBlockers(
            tx,
            actor.tenantId,
            id,
          );
          if (blockers.openOrders > 0) {
            throw new DomainError(
              409,
              'SESSION_HAS_OPEN_ORDERS',
              'This session still has orders that are not completed or cancelled.',
              { ...blockers },
            );
          }
          if (blockers.draftBills > 0) {
            throw new DomainError(
              409,
              'SESSION_HAS_DRAFT_BILLS',
              'This session still has draft bills. Finalize or discard them first.',
              { ...blockers },
            );
          }
          if (blockers.unpaidBills > 0) {
            throw new DomainError(
              409,
              'SESSION_HAS_UNPAID_BILLS',
              'This session still has unpaid bills. Record the payment or void them first.',
              { ...blockers },
            );
          }
        } else {
          const discarded = await this.sessionRepository.discardDraftBills(tx, actor.tenantId, id);
          for (const billId of discarded) {
            await recordAuditEvent(tx, {
              entityType: 'bill',
              entityId: billId,
              action: 'discarded',
              actorKind: actor.actorKind,
              actorId: actor.userId,
              reason: `Session force-closed: ${reason}`,
            });
          }
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
