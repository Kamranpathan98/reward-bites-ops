import { z } from 'zod';

export const tableSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayOrder: z.number().int(),
  capacity: z.number().int().nullable(),
  isActive: z.boolean(),
  hasActiveQr: z.boolean(),
});
export type TableSummary = z.infer<typeof tableSummarySchema>;

export const tablesListResponseSchema = z.object({
  data: z.array(tableSummarySchema),
});
export type TablesListResponse = z.infer<typeof tablesListResponseSchema>;

export const createTableRequestSchema = z.object({
  name: z.string().min(1),
  displayOrder: z.number().int().min(0).optional(),
  capacity: z.number().int().min(1).optional(),
});
export type CreateTableRequest = z.infer<typeof createTableRequestSchema>;

export const patchTableRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    displayOrder: z.number().int().min(0).optional(),
    capacity: z.number().int().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });
export type PatchTableRequest = z.infer<typeof patchTableRequestSchema>;

export const regenerateQrResponseSchema = z.object({
  data: z.object({
    token: z.string(),
    qrSvgUrl: z.string(),
  }),
});
export type RegenerateQrResponse = z.infer<typeof regenerateQrResponseSchema>;

// GET /tables/live — the cashier floor view (architecture section 11):
// every table with its OPEN session (if any), open order count, and unpaid
// bill total. `openOrderCount` counts the session's non-terminal orders (NEW,
// ACCEPTED, PREPARING, READY — billed-but-active orders still count);
// `unpaidBillTotalPaise` is the sum of outstanding_paise over the session's
// FINALIZED bills (DRAFT bills are not receivable, PAID/VOID/DISCARDED owe nothing).
export const liveTableItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayOrder: z.number().int(),
  capacity: z.number().int().nullable(),
  isActive: z.boolean(),
  openSession: z
    .object({
      id: z.string().uuid(),
      openedAt: z.string(),
      openOrderCount: z.number().int(),
      unpaidBillTotalPaise: z.number().int(),
    })
    .nullable(),
});
export type LiveTableItem = z.infer<typeof liveTableItemSchema>;

export const tablesLiveResponseSchema = z.object({
  data: z.array(liveTableItemSchema),
});
export type TablesLiveResponse = z.infer<typeof tablesLiveResponseSchema>;

// GET /sessions/:id — gains `orders`/`bills` arrays once those modules
// exist (Gates 6/8, architecture section 11's "orders + bills of one
// session"); a session has neither yet, so they are omitted rather than
// hardcoded to an always-empty array that would just be a breaking change
// to fill in later.
export const sessionDetailSchema = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  status: z.enum(['OPEN', 'CLOSED']),
  sessionToken: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  openedByUserId: z.string().uuid().nullable(),
  forceClosed: z.boolean(),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export const sessionResponseSchema = z.object({
  data: sessionDetailSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// Reason is optional at the schema level but the service requires it
// whenever the close would otherwise be blocked — moot for Gate 4 itself
// (no `orders`/`bill` tables exist yet to block on), enforced for real once
// Gate 8 (billing) lands.
export const closeSessionRequestSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type CloseSessionRequest = z.infer<typeof closeSessionRequestSchema>;
