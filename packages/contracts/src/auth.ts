import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const membershipSummarySchema = z.object({
  membershipId: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  roleName: z.string(),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  memberships: z.array(membershipSummarySchema),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const selectTenantRequestSchema = z.object({
  membershipId: z.string().uuid(),
});
export type SelectTenantRequest = z.infer<typeof selectTenantRequestSchema>;

export const selectTenantResponseSchema = z.object({
  accessToken: z.string(),
});
export type SelectTenantResponse = z.infer<typeof selectTenantResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
  }),
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  }),
  membership: z.object({
    id: z.string().uuid(),
    roleId: z.string().uuid(),
    roleName: z.string(),
  }),
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
