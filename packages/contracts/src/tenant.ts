import { z } from 'zod';

export const tenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  currency: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  logoKey: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string().nullable(),
});
export type Tenant = z.infer<typeof tenantSchema>;
