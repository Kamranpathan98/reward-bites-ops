import { z } from 'zod';
import { billSummarySchema, positivePaiseSchema } from './bills';

/** V1: cash and static UPI only. Cards / gateways are not supported. */
export const paymentMethodSchema = z.enum(['CASH', 'UPI_STATIC']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * V1 only ever records SUCCEEDED payments (the cashier's verification is the
 * confirmation). PENDING / FAILED / REVERSED are reserved in the database for
 * the future gateway / refund flow and have no V1 code path.
 */
export const paymentStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentSummarySchema = z.object({
  id: z.string().uuid(),
  billId: z.string().uuid(),
  amountPaise: positivePaiseSchema,
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  provider: z.string(),
  /** UPI: the UTR the cashier typed. */
  providerReference: z.string().nullable(),
  referenceNote: z.string().nullable(),
  receivedBy: z.string().uuid(),
  receivedAt: z.string(),
  verifiedBy: z.string().uuid().nullable(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;

export const paymentsListResponseSchema = z.object({ data: z.array(paymentSummarySchema) });
export type PaymentsListResponse = z.infer<typeof paymentsListResponseSchema>;

/** `POST /payments` response: the payment plus the bill as settled. */
export const recordPaymentResponseSchema = z.object({
  data: z.object({ payment: paymentSummarySchema, bill: billSummarySchema }),
});
export type RecordPaymentResponse = z.infer<typeof recordPaymentResponseSchema>;

/**
 * There is deliberately NO `cashTenderedPaise`: change-giving is a UI
 * calculation, not a payment (architecture section 9). Payment idempotency
 * fingerprints `{billId, method, amountPaise, providerReference, referenceNote}`.
 */
export const recordPaymentRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  billId: z.string().uuid(),
  method: paymentMethodSchema,
  amountPaise: positivePaiseSchema,
  providerReference: z.string().trim().max(100).optional(),
  /** Stored as `reference_note`. */
  note: z.string().trim().max(255).optional(),
  expectedBillVersion: z.number().int().min(0),
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;
