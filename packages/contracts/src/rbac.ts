import { z } from 'zod';

export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isSystem: z.boolean(),
});
export type Role = z.infer<typeof roleSchema>;

export const rolesListResponseSchema = z.object({
  data: z.array(roleSchema),
});
export type RolesListResponse = z.infer<typeof rolesListResponseSchema>;

export const permissionSchema = z.object({
  key: z.string(),
  description: z.string(),
});
export type Permission = z.infer<typeof permissionSchema>;

export const permissionsListResponseSchema = z.object({
  data: z.array(permissionSchema),
});
export type PermissionsListResponse = z.infer<typeof permissionsListResponseSchema>;
