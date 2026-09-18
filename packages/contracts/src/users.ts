import { z } from 'zod';

export const membershipListItemSchema = z.object({
  membershipId: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  roleId: z.string().uuid(),
  roleName: z.string(),
  joinedAt: z.string(),
});
export type MembershipListItem = z.infer<typeof membershipListItemSchema>;

export const usersListResponseSchema = z.object({
  data: z.array(membershipListItemSchema),
});
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;

export const inviteUserRequestSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  roleId: z.string().uuid(),
  tempPassword: z.string().min(10),
});
export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;

export const patchMembershipRequestSchema = z
  .object({
    roleId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .refine((body) => body.roleId !== undefined || body.status !== undefined, {
    message: 'At least one of roleId or status must be provided',
  });
export type PatchMembershipRequest = z.infer<typeof patchMembershipRequestSchema>;
