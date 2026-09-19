import { Injectable } from '@nestjs/common';
import type { PaymentMethod, PaymentStatus } from '@rewardbite/contracts';
import type { TransactionContext } from '../../common/db';
import { toPaise } from '../../common/money/paise';
import { newId } from '../../common/security/id';

export interface PaymentRow {
  id: string;
  tenantId: string;
  billId: string;
  amountPaise: number;
  method: PaymentMethod;
  status: PaymentStatus;
  provider: string;
  providerReference: string | null;
  referenceNote: string | null;
  receivedBy: string;
  receivedAt: Date;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  createdAt: Date;
}

interface RawPayment {
  id: string;
  tenant_id: string;
  bill_id: string;
  amount_paise: string;
  method: PaymentMethod;
  status: PaymentStatus;
  provider: string;
  provider_reference: string | null;
  reference_note: string | null;
  received_by: string;
  received_at: Date;
  verified_by: string | null;
  verified_at: Date | null;
  idempotency_key: string;
  idempotency_fingerprint: string;
  created_at: Date;
}

const COLUMNS = `id, tenant_id, bill_id, amount_paise, method, status, provider, provider_reference,
  reference_note, received_by, received_at, verified_by, verified_at, idempotency_key,
  idempotency_fingerprint, created_at`;

function mapRow(row: RawPayment): PaymentRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    billId: row.bill_id,
    amountPaise: toPaise(row.amount_paise, 'amount_paise'),
    method: row.method,
    status: row.status,
    provider: row.provider,
    providerReference: row.provider_reference,
    referenceNote: row.reference_note,
    receivedBy: row.received_by,
    receivedAt: row.received_at,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    idempotencyKey: row.idempotency_key,
    idempotencyFingerprint: row.idempotency_fingerprint,
    createdAt: row.created_at,
  };
}

/**
 * `payment` is an INSERT-only ledger (app_rw has no UPDATE/DELETE grant), so
 * this repository deliberately has no update or delete method.
 */
@Injectable()
export class PaymentRepository {
  async findByIdempotencyKey(
    tx: TransactionContext,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PaymentRow | null> {
    const result = await tx.query<RawPayment>(
      `SELECT ${COLUMNS} FROM payment WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async listForBill(
    tx: TransactionContext,
    tenantId: string,
    billId: string,
  ): Promise<PaymentRow[]> {
    const result = await tx.query<RawPayment>(
      `SELECT ${COLUMNS} FROM payment
        WHERE tenant_id = $1 AND bill_id = $2
        ORDER BY received_at ASC, id ASC`,
      [tenantId, billId],
    );
    return result.rows.map(mapRow);
  }

  /**
   * Inserts a SUCCEEDED payment (static UPI / cash: the cashier's verification is
   * the confirmation, so the cashier is both receiver and verifier). The
   * `payment_settle` AFTER INSERT trigger recomputes the bill's paid/outstanding
   * and flips it to PAID — this method never touches `bill`.
   */
  async insertSucceeded(
    tx: TransactionContext,
    input: {
      tenantId: string;
      billId: string;
      amountPaise: number;
      method: PaymentMethod;
      providerReference: string | null;
      referenceNote: string | null;
      receivedBy: string;
      idempotencyKey: string;
      idempotencyFingerprint: string;
    },
  ): Promise<PaymentRow> {
    const result = await tx.query<RawPayment>(
      `INSERT INTO payment
         (id, tenant_id, bill_id, amount_paise, method, status, provider, provider_reference,
          reference_note, received_by, verified_by, verified_at, idempotency_key,
          idempotency_fingerprint)
       VALUES ($1, $2, $3, $4, $5, 'SUCCEEDED', 'manual', $6, $7, $8, $8, now(), $9, $10)
       RETURNING ${COLUMNS}`,
      [
        newId(),
        input.tenantId,
        input.billId,
        input.amountPaise,
        input.method,
        input.providerReference,
        input.referenceNote,
        input.receivedBy,
        input.idempotencyKey,
        input.idempotencyFingerprint,
      ],
    );
    return mapRow(result.rows[0] as RawPayment);
  }
}
