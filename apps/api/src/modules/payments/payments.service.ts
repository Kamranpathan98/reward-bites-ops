import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  PaymentSummary,
  RecordPaymentRequest,
  RecordPaymentResponse,
} from '@rewardbite/contracts';
import {
  DB_POOL,
  isUniqueViolation,
  withTenantTx,
  type Pool,
  type TransactionContext,
} from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { canonicalJsonFingerprint } from '../../common/security/idempotency-fingerprint';
import { recordAuditEvent } from '../audit/audit-writer';
import { BillRepository, type BillRow } from '../billing/bill.repository';
import { toBillSummary } from '../billing/bills.service';
import { PaymentRepository, type PaymentRow } from './payment.repository';
import type { ActingUser } from './payments.types';

const IDEMPOTENCY_CONSTRAINT = 'payment_tenant_idempotency_key_unique';
/** A UPI transaction reference (UTR) is 12 digits (architecture section 9). */
const UTR_PATTERN = /^\d{12}$/;

function toPaymentSummary(p: PaymentRow): PaymentSummary {
  return {
    id: p.id,
    billId: p.billId,
    amountPaise: p.amountPaise,
    method: p.method,
    status: p.status,
    provider: p.provider,
    providerReference: p.providerReference,
    referenceNote: p.referenceNote,
    receivedBy: p.receivedBy,
    receivedAt: p.receivedAt.toISOString(),
    verifiedBy: p.verifiedBy,
    verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly paymentRepository: PaymentRepository,
    private readonly billRepository: BillRepository,
  ) {}

  async listForBill(tenantId: string, billId: string): Promise<PaymentSummary[]> {
    return withTenantTx(this.pool, { tenantId, actorKind: 'staff' }, async (tx) => {
      const bill = await this.billRepository.findById(tx, tenantId, billId);
      if (!bill) throw new NotFoundException('Bill not found.');
      const rows = await this.paymentRepository.listForBill(tx, tenantId, billId);
      return rows.map(toPaymentSummary);
    });
  }

  /**
   * `POST /payments` — V1 full settlement of a FINALIZED bill, in this exact order:
   *
   *  1. BEGIN, 2. `SELECT bill FOR UPDATE`,
   *  3. idempotency lookup INSIDE the transaction (after the bill lock): a match
   *     with the same fingerprint replays the original result, a different one
   *     is IDEMPOTENT_MISMATCH,
   *  4. validate status FINALIZED, expectedBillVersion, method, UPI reference,
   *     amount == outstanding,
   *  5. INSERT the payment (SUCCEEDED),
   *  6. the payment_settle trigger locks the bill again, sums the ledger in a
   *     separate statement, updates paid/outstanding and flips the bill to PAID,
   *  7. audit, COMMIT.
   *
   * Why the lookup is not a "just insert and catch 23505" like POST /orders: a
   * same-key retry after success finds the bill PAID and would fail step 4 before
   * ever reaching the insert, so it must be resolved as a replay first. The unique
   * constraint remains the last-resort net (e.g. the same key used concurrently
   * against two different bills, which take different bill locks).
   *
   * There is no `cashTenderedPaise`: change-giving is a UI calculation.
   */
  async record(
    actor: ActingUser,
    input: RecordPaymentRequest,
  ): Promise<{ result: RecordPaymentResponse['data']; replay: boolean }> {
    const { idempotencyKey } = input;
    const fingerprint = canonicalJsonFingerprint({
      billId: input.billId,
      method: input.method,
      amountPaise: input.amountPaise,
      providerReference: normalize(input.providerReference),
      referenceNote: normalize(input.note),
    });

    try {
      return await withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, userId: actor.userId, actorKind: actor.actorKind },
        async (tx) => {
          const bill = await this.billRepository.lockById(tx, actor.tenantId, input.billId);
          if (!bill) throw new NotFoundException('Bill not found.');

          const existing = await this.paymentRepository.findByIdempotencyKey(
            tx,
            actor.tenantId,
            idempotencyKey,
          );
          if (existing)
            return this.replayOrMismatch(tx, actor.tenantId, existing, fingerprint, input);

          if (bill.status !== 'FINALIZED') {
            throw new DomainError(
              409,
              'BILL_NOT_PAYABLE',
              `A ${bill.status.toLowerCase()} bill cannot take payments.`,
              { currentStatus: bill.status },
            );
          }
          if (bill.version !== input.expectedBillVersion) {
            throw new DomainError(
              409,
              'VERSION_CONFLICT',
              'This bill was changed by someone else.',
              {
                currentStatus: bill.status,
                currentVersion: bill.version,
              },
            );
          }

          await this.validateMethod(tx, actor.tenantId, input);

          if (input.amountPaise < bill.outstandingPaise) {
            throw new DomainError(
              422,
              'PARTIAL_PAYMENT_NOT_ENABLED',
              'Partial payments are not supported. Enter the full outstanding amount.',
              { outstandingPaise: bill.outstandingPaise },
            );
          }
          if (input.amountPaise > bill.outstandingPaise) {
            throw new DomainError(
              422,
              'OVERPAYMENT',
              'The amount is more than the outstanding balance.',
              { outstandingPaise: bill.outstandingPaise },
            );
          }

          const payment = await this.paymentRepository.insertSucceeded(tx, {
            tenantId: actor.tenantId,
            billId: bill.id,
            amountPaise: input.amountPaise,
            method: input.method,
            providerReference: normalize(input.providerReference),
            referenceNote: normalize(input.note),
            receivedBy: actor.userId,
            idempotencyKey,
            idempotencyFingerprint: fingerprint,
          });

          await recordAuditEvent(tx, {
            entityType: 'payment',
            entityId: payment.id,
            action: 'recorded',
            actorKind: actor.actorKind,
            actorId: actor.userId,
            after: toPaymentSummary(payment),
          });

          const settled = (await this.billRepository.findById(
            tx,
            actor.tenantId,
            bill.id,
          )) as BillRow;
          return {
            result: { payment: toPaymentSummary(payment), bill: toBillSummary(settled) },
            replay: false,
          };
        },
      );
    } catch (err) {
      if (!isUniqueViolation(err, IDEMPOTENCY_CONSTRAINT)) throw err;
      // Lost a same-key race that the bill lock could not serialize (different
      // bills). Re-read the winner in a fresh transaction.
      return withTenantTx(
        this.pool,
        { tenantId: actor.tenantId, actorKind: actor.actorKind },
        async (tx) => {
          const winner = await this.paymentRepository.findByIdempotencyKey(
            tx,
            actor.tenantId,
            idempotencyKey,
          );
          if (!winner) throw err;
          return this.replayOrMismatch(tx, actor.tenantId, winner, fingerprint, input);
        },
      );
    }
  }

  private async replayOrMismatch(
    tx: TransactionContext,
    tenantId: string,
    existing: PaymentRow,
    fingerprint: string,
    input: RecordPaymentRequest,
  ): Promise<{ result: RecordPaymentResponse['data']; replay: boolean }> {
    if (existing.idempotencyFingerprint !== fingerprint || existing.billId !== input.billId) {
      throw new DomainError(
        409,
        'IDEMPOTENT_MISMATCH',
        'This idempotency key was already used for a different request.',
      );
    }
    const bill = (await this.billRepository.findById(tx, tenantId, existing.billId)) as BillRow;
    return {
      result: { payment: toPaymentSummary(existing), bill: toBillSummary(bill) },
      replay: true,
    };
  }

  private async validateMethod(
    tx: TransactionContext,
    tenantId: string,
    input: RecordPaymentRequest,
  ): Promise<void> {
    const settings = await this.billRepository.getBillingSettings(tx, tenantId);
    const reference = normalize(input.providerReference);

    if (input.method === 'CASH') {
      if (!settings.cashEnabled) {
        throw new DomainError(422, 'PAYMENT_METHOD_DISABLED', 'Cash payments are turned off.');
      }
      if (reference) {
        throw new DomainError(
          422,
          'VALIDATION_FAILED',
          'A transaction reference is only used for UPI payments.',
        );
      }
      return;
    }

    if (!settings.upiEnabled) {
      throw new DomainError(422, 'PAYMENT_METHOD_DISABLED', 'UPI payments are turned off.');
    }
    if (!reference) {
      if (settings.upiReferenceRequired) {
        throw new DomainError(
          422,
          'PAYMENT_REFERENCE_REQUIRED',
          'Enter the 12-digit UPI transaction reference (UTR).',
        );
      }
      return;
    }
    if (!UTR_PATTERN.test(reference)) {
      throw new DomainError(
        422,
        'VALIDATION_FAILED',
        'The UPI transaction reference (UTR) must be 12 digits.',
      );
    }
  }
}
