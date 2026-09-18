import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@rewardbite/contracts';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * `@RequirePermission('users.manage')` — architecture section 7/12.
 * Multiple keys means the caller must hold all of them.
 */
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
