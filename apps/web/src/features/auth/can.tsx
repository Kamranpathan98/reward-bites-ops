import type { ReactNode } from 'react';
import type { PermissionKey } from '@rewardbite/contracts';
import { useMe } from './use-auth';

/**
 * `<Can permission="bills.void">` (architecture section 13). This is UX
 * only — hiding a control the backend would reject anyway. The backend's
 * `PermissionGuard` is the actual authority; nothing here is trusted for
 * security (task instruction section 12).
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}): JSX.Element {
  const { data } = useMe();
  const allowed = data?.permissions.includes(permission) ?? false;
  return <>{allowed ? children : fallback}</>;
}
