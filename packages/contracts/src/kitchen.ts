import { z } from 'zod';
import { orderSourceSchema, orderTypeSchema } from './orders';

export const kitchenOrderStatusSchema = z.enum(['NEW', 'ACCEPTED', 'PREPARING', 'READY']);
export type KitchenOrderStatus = z.infer<typeof kitchenOrderStatusSchema>;

export const kitchenOrderLineAddonViewSchema = z.object({
  addonId: z.string().uuid(),
  nameSnapshot: z.string(),
  qty: z.number().int().min(1),
});
export type KitchenOrderLineAddonView = z.infer<typeof kitchenOrderLineAddonViewSchema>;

export const kitchenOrderLineViewSchema = z.object({
  id: z.string().uuid(),
  itemName: z.string(),
  variantName: z.string().nullable(),
  qty: z.number().int().min(1),
  notes: z.string().nullable(),
  status: z.enum(['ACTIVE', 'REMOVED']),
  addons: z.array(kitchenOrderLineAddonViewSchema),
});
export type KitchenOrderLineView = z.infer<typeof kitchenOrderLineViewSchema>;

export const kitchenOrderTicketViewSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  tableName: z.string(),
  customerName: z.string().nullable(),
  source: orderSourceSchema,
  type: orderTypeSchema,
  status: kitchenOrderStatusSchema,
  version: z.number().int().min(0),
  placedAt: z.string(),
  acceptedAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  notes: z.string().nullable(),
  isEdited: z.boolean(),
  editReason: z.string().nullable(),
  lines: z.array(kitchenOrderLineViewSchema),
});
export type KitchenOrderTicketView = z.infer<typeof kitchenOrderTicketViewSchema>;

export const kitchenOrdersResponseSchema = z.object({
  data: z.array(kitchenOrderTicketViewSchema),
  meta: z.object({
    serverTime: z.string(),
  }),
});
export type KitchenOrdersResponse = z.infer<typeof kitchenOrdersResponseSchema>;

export const kitchenOrdersQuerySchema = z.object({
  status: z
    .union([kitchenOrderStatusSchema, z.array(kitchenOrderStatusSchema)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});
export type KitchenOrdersQuery = z.infer<typeof kitchenOrdersQuerySchema>;

