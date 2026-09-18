import { z } from 'zod';

export const createTenantRequestSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens only'),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(10),
});
export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const createTenantResponseSchema = z.object({
  tenantId: z.string().uuid(),
});
export type CreateTenantResponse = z.infer<typeof createTenantResponseSchema>;
