import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderSourceSchema = z.enum(['QR_DINE_IN', 'COUNTER']);
export type OrderSource = z.infer<typeof orderSourceSchema>;

export const orderTypeSchema = z.enum(['DINE_IN', 'TAKEAWAY']);
export type OrderType = z.infer<typeof orderTypeSchema>;

// The transition endpoint never accepts CANCELLED — that's the dedicated
// `POST /orders/:id/cancel` endpoint, with its own permission and a
// mandatory reason (architecture section 8's endpoint catalog lists them
// as two separate rows with two separate permissions).
export const orderTransitionTargetSchema = z.enum(['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']);
export type OrderTransitionTarget = z.infer<typeof orderTransitionTargetSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const orderLineAddonViewSchema = z.object({
  addonId: z.string().uuid(),
  nameSnapshot: z.string(),
  unitPricePaise: z.number().int(),
  qty: z.number().int(),
});
export type OrderLineAddonView = z.infer<typeof orderLineAddonViewSchema>;

export const orderLineViewSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  menuVariantId: z.string().uuid().nullable(),
  itemNameSnapshot: z.string(),
  variantNameSnapshot: z.string().nullable(),
  unitPricePaise: z.number().int(),
  qty: z.number().int(),
  lineTotalPaise: z.number().int(),
  notes: z.string().nullable(),
  status: z.enum(['ACTIVE', 'REMOVED']),
  sortOrder: z.number().int(),
  addons: z.array(orderLineAddonViewSchema),
});
export type OrderLineView = z.infer<typeof orderLineViewSchema>;

export const orderStatusHistoryViewSchema = z.object({
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema,
  actorKind: z.enum(['staff', 'customer', 'system', 'platform']),
  actorId: z.string().uuid().nullable(),
  at: z.string(),
  reason: z.string().nullable(),
});
export type OrderStatusHistoryView = z.infer<typeof orderStatusHistoryViewSchema>;

export const orderSummarySchema = z.object({
  id: z.string().uuid(),
  tableSessionId: z.string().uuid(),
  orderNumber: z.string(),
  source: orderSourceSchema,
  type: orderTypeSchema,
  customerName: z.string().nullable(),
  status: orderStatusSchema,
  version: z.number().int(),
  placedAt: z.string(),
  acceptedAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  subtotalPaise: z.number().int(),
  lineCount: z.number().int(),
  /** The CURRENT bill (orders.bill_id); NULL = unbilled. Set at finalize, cleared at void. */
  billId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderDetailSchema = orderSummarySchema.extend({
  lines: z.array(orderLineViewSchema),
  history: z.array(orderStatusHistoryViewSchema),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const ordersListResponseSchema = z.object({
  data: z.array(orderSummarySchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
export type OrdersListResponse = z.infer<typeof ordersListResponseSchema>;

export const orderDetailResponseSchema = z.object({
  data: orderDetailSchema,
});
export type OrderDetailResponse = z.infer<typeof orderDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const orderLineAddonInputSchema = z.object({
  addonId: z.string().uuid(),
  qty: z.number().int().min(1).max(20),
});

const orderLineInputSchema = z.object({
  itemId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  qty: z.number().int().min(1).max(50),
  addons: z.array(orderLineAddonInputSchema).max(50).optional(),
  notes: z.string().trim().max(500).optional(),
});

// `POST /orders` — architecture section 11, verbatim body shape. `tableId`
// is optional (DINE_IN with a table vs TAKEAWAY with none); `source` is
// never client-supplied — the server always sets it (`COUNTER` for this
// authenticated staff endpoint; `QR_DINE_IN` is the public endpoint, Gate
// 11, out of scope here).
export const createOrderRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  type: orderTypeSchema,
  tableId: z.string().uuid().optional(),
  customerName: z.string().trim().min(1).max(200).optional(),
  lines: z.array(orderLineInputSchema).min(1).max(100),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

// `PATCH /orders/:id/lines` — architecture section 11, verbatim shape.
// `reason` is not in the architecture's literal body example but is
// required by the edit-permission rule for PREPARING/READY (section 8);
// validated conditionally in the service, not the schema, since whether
// it's required depends on the order's current status, which the schema
// cannot see.
export const patchOrderLinesRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    add: z.array(orderLineInputSchema).max(50).optional(),
    update: z
      .array(
        z.object({
          lineId: z.string().uuid(),
          qty: z.number().int().min(1).max(50).optional(),
          variantId: z.string().uuid().nullable().optional(),
        }),
      )
      .max(50)
      .optional(),
    remove: z.array(z.string().uuid()).max(50).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (body) =>
      (body.add && body.add.length > 0) ||
      (body.update && body.update.length > 0) ||
      (body.remove && body.remove.length > 0),
    { message: 'At least one of add, update, or remove must be provided' },
  );
export type PatchOrderLinesRequest = z.infer<typeof patchOrderLinesRequestSchema>;

export const transitionOrderRequestSchema = z.object({
  to: orderTransitionTargetSchema,
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type TransitionOrderRequest = z.infer<typeof transitionOrderRequestSchema>;

export const cancelOrderRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(1).max(500),
});
export type CancelOrderRequest = z.infer<typeof cancelOrderRequestSchema>;

export const reopenOrderRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
});
export type ReopenOrderRequest = z.infer<typeof reopenOrderRequestSchema>;

// Express's query parser (`qs`) returns a bare string for a single
// repeated param (`?status=NEW`) and only an array for two or more
// (`?status=NEW&status=ACCEPTED`) — normalize both shapes before
// validating each element.
const statusArraySchema = z
  .union([orderStatusSchema, z.array(orderStatusSchema)])
  .transform((v) => (Array.isArray(v) ? v : [v]));

export const listOrdersQuerySchema = z.object({
  status: statusArraySchema.optional(),
  type: orderTypeSchema.optional(),
  source: orderSourceSchema.optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
