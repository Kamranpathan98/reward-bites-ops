import { z } from 'zod';

/**
 * Money is BIGINT paise in PostgreSQL and a plain `number` in TypeScript
 * (architecture section 9/11, ADR-011). It is only safe while it fits a JS
 * safe integer, so every Gate 8 money field is bounded to MAX_PAISE — the same
 * bound the database CHECK constraints enforce.
 */
export const MAX_PAISE = Number.MAX_SAFE_INTEGER;
export const paiseSchema = z.number().int().min(0).max(MAX_PAISE);
export const positivePaiseSchema = z.number().int().min(1).max(MAX_PAISE);
export const signedPaiseSchema = z.number().int().min(-MAX_PAISE).max(MAX_PAISE);
/** Percentages are basis points: 1050 = 10.50%. */
export const basisPointsSchema = z.number().int().min(1).max(10000);

/**
 * DRAFT -> FINALIZED, DRAFT -> DISCARDED, FINALIZED -> PAID, FINALIZED -> VOID.
 * PAID / VOID / DISCARDED are terminal.
 */
export const billStatusSchema = z.enum(['DRAFT', 'FINALIZED', 'PAID', 'DISCARDED', 'VOID']);
export type BillStatus = z.infer<typeof billStatusSchema>;

export const billLineKindSchema = z.enum(['ITEM', 'ADDON']);
export type BillLineKind = z.infer<typeof billLineKindSchema>;

/** V1 supports discounts only (architecture section 9). */
export const billAdjustmentKindSchema = z.enum(['DISCOUNT_PERCENT', 'DISCOUNT_FIXED']);
export type BillAdjustmentKind = z.infer<typeof billAdjustmentKindSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const billLineViewSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderLineId: z.string().uuid(),
  lineKind: billLineKindSchema,
  addonId: z.string().uuid().nullable(),
  description: z.string(),
  qty: z.number().int().min(1),
  unitPricePaise: paiseSchema,
  lineTotalPaise: paiseSchema,
  sortOrder: z.number().int(),
});
export type BillLineView = z.infer<typeof billLineViewSchema>;

export const billAdjustmentViewSchema = z.object({
  id: z.string().uuid(),
  kind: billAdjustmentKindSchema,
  label: z.string(),
  basisBp: basisPointsSchema.nullable(),
  amountPaise: paiseSchema,
  reason: z.string().nullable(),
  appliedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type BillAdjustmentView = z.infer<typeof billAdjustmentViewSchema>;

export const billSummarySchema = z.object({
  id: z.string().uuid(),
  tableSessionId: z.string().uuid(),
  /** Monotonically increasing per tenant; gaps are acceptable. NULL until finalized. */
  billNumber: z.number().int().positive().nullable(),
  status: billStatusSchema,
  subtotalPaise: paiseSchema,
  discountPaise: paiseSchema,
  /** Signed: round-to-rupee moves the total by -49..+50 paise. */
  roundingPaise: signedPaiseSchema,
  grandTotalPaise: paiseSchema,
  paidPaise: paiseSchema,
  outstandingPaise: paiseSchema,
  version: z.number().int(),
  customerName: z.string().nullable(),
  notes: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  finalizedBy: z.string().uuid().nullable(),
  voidedAt: z.string().nullable(),
  voidedBy: z.string().uuid().nullable(),
  voidReason: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BillSummary = z.infer<typeof billSummarySchema>;

export const billDetailSchema = billSummarySchema.extend({
  /** The orders this bill covers (historical association, see bill_order). */
  orderIds: z.array(z.string().uuid()),
  lines: z.array(billLineViewSchema),
  adjustments: z.array(billAdjustmentViewSchema),
});
export type BillDetail = z.infer<typeof billDetailSchema>;

export const billsListResponseSchema = z.object({
  data: z.array(billSummarySchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
export type BillsListResponse = z.infer<typeof billsListResponseSchema>;

export const billDetailResponseSchema = z.object({ data: billDetailSchema });
export type BillDetailResponse = z.infer<typeof billDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const listBillsQuerySchema = z.object({
  status: billStatusSchema.optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListBillsQuery = z.infer<typeof listBillsQuerySchema>;

export const createBillRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sessionId: z.string().uuid(),
  orderIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'orderIds must be unique' }),
  customerName: z.string().trim().min(1).max(120).optional(),
});
export type CreateBillRequest = z.infer<typeof createBillRequestSchema>;

export const discountInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('PERCENT'),
    /** Basis points, 1..10000. */
    value: basisPointsSchema,
    reason: z.string().trim().min(1).max(255).optional(),
  }),
  z.object({
    kind: z.literal('FIXED'),
    /** Paise. */
    value: positivePaiseSchema,
    reason: z.string().trim().min(1).max(255).optional(),
  }),
]);
export type DiscountInput = z.infer<typeof discountInputSchema>;

/** `discount: null` removes the DRAFT discount. */
export const applyDiscountRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  discount: discountInputSchema.nullable(),
});
export type ApplyDiscountRequest = z.infer<typeof applyDiscountRequestSchema>;

export const finalizeBillRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  expectedGrandTotalPaise: paiseSchema,
});
export type FinalizeBillRequest = z.infer<typeof finalizeBillRequestSchema>;

export const discardBillRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
});
export type DiscardBillRequest = z.infer<typeof discardBillRequestSchema>;

export const voidBillRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(1).max(500),
});
export type VoidBillRequest = z.infer<typeof voidBillRequestSchema>;
