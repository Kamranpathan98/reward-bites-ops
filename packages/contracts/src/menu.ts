import { z } from 'zod';

// `veg_flag` values (VEG/NON_VEG/EGG) are an implementation-detail choice —
// architecture section 10 says only "nullable enum, useful in India"
// without naming the values.
export const vegFlagSchema = z.enum(['VEG', 'NON_VEG', 'EGG']);
export type VegFlag = z.infer<typeof vegFlagSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const menuAddonSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pricePaise: z.number().int(),
  isAvailable: z.boolean(),
});
export type MenuAddon = z.infer<typeof menuAddonSchema>;

export const menuVariantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pricePaise: z.number().int(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
});
export type MenuVariant = z.infer<typeof menuVariantSchema>;

// Denormalized view of a menu_item_addon row for the tree response — the
// addon's own current name/price/availability, plus this item's max_qty.
export const menuItemAddonViewSchema = z.object({
  addonId: z.string().uuid(),
  name: z.string(),
  pricePaise: z.number().int(),
  isAvailable: z.boolean(),
  maxQty: z.number().int(),
});
export type MenuItemAddonView = z.infer<typeof menuItemAddonViewSchema>;

export const menuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  imageKey: z.string().nullable(),
  basePricePaise: z.number().int().nullable(),
  isAvailable: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  vegFlag: vegFlagSchema.nullable(),
  variants: z.array(menuVariantSchema),
  addons: z.array(menuItemAddonViewSchema),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const menuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  items: z.array(menuItemSchema),
});
export type MenuCategory = z.infer<typeof menuCategorySchema>;

// GET /menu — "full tree incl. inactive" (architecture section 11). Addons
// are also listed flat at the top level (their own CRUD resource, reusable
// across items — not owned by any one category).
export const menuTreeResponseSchema = z.object({
  data: z.object({
    categories: z.array(menuCategorySchema),
    addons: z.array(menuAddonSchema),
  }),
});
export type MenuTreeResponse = z.infer<typeof menuTreeResponseSchema>;

// ---------------------------------------------------------------------------
// Category requests
// ---------------------------------------------------------------------------

export const createCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const patchCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });
export type PatchCategoryRequest = z.infer<typeof patchCategoryRequestSchema>;

// ---------------------------------------------------------------------------
// Item requests
// ---------------------------------------------------------------------------

// Item <-> addon assignment is managed as a field on the item itself — the
// architecture's endpoint catalog (section 11) lists exactly four
// independently-CRUDable menu resources (categories/items/variants/addons),
// not a fifth "item-addon" resource, so this is the narrowest place to put
// it. Providing `addons` fully replaces the item's current addon set.
const itemAddonAssignmentSchema = z.object({
  addonId: z.string().uuid(),
  maxQty: z.number().int().min(1).max(20),
});

export const createItemRequestSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  basePricePaise: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  vegFlag: vegFlagSchema.optional(),
  addons: z.array(itemAddonAssignmentSchema).max(50).optional(),
});
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;

export const patchItemRequestSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    basePricePaise: z.number().int().min(0).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    vegFlag: vegFlagSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    addons: z.array(itemAddonAssignmentSchema).max(50).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });
export type PatchItemRequest = z.infer<typeof patchItemRequestSchema>;

// ---------------------------------------------------------------------------
// Variant requests
// ---------------------------------------------------------------------------

export const createVariantRequestSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  pricePaise: z.number().int().min(0),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateVariantRequest = z.infer<typeof createVariantRequestSchema>;

export const patchVariantRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    pricePaise: z.number().int().min(0).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });
export type PatchVariantRequest = z.infer<typeof patchVariantRequestSchema>;

// ---------------------------------------------------------------------------
// Addon requests
// ---------------------------------------------------------------------------

export const createAddonRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  pricePaise: z.number().int().min(0),
});
export type CreateAddonRequest = z.infer<typeof createAddonRequestSchema>;

export const patchAddonRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    pricePaise: z.number().int().min(0).optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });
export type PatchAddonRequest = z.infer<typeof patchAddonRequestSchema>;

// ---------------------------------------------------------------------------
// Availability + reorder
// ---------------------------------------------------------------------------

export const updateAvailabilityRequestSchema = z.object({
  isAvailable: z.boolean(),
});
export type UpdateAvailabilityRequest = z.infer<typeof updateAvailabilityRequestSchema>;

// `POST /menu/reorder` — "{categoryIds[]} or {categoryId, itemIds[]}"
// (architecture section 11, verbatim).
export const reorderRequestSchema = z.union([
  z.object({ categoryIds: z.array(z.string().uuid()).min(1) }),
  z.object({ categoryId: z.string().uuid(), itemIds: z.array(z.string().uuid()).min(1) }),
]);
export type ReorderRequest = z.infer<typeof reorderRequestSchema>;
