import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@rewardbite/contracts';

export const REQUIRE_ANY_PERMISSION_KEY = 'requireAnyPermission';

/**
 * `@RequireAnyPermission('orders.transition.front', 'orders.transition.kitchen')`
 * — OR semantics, unlike `@RequirePermission`'s AND. Architecture section
 * 11's own endpoint catalog states `POST /orders/:id/transition` needs
 * "orders.transition.front **or** .kitchen" (the only endpoint across
 * Gates 1-5 phrased that way) — which target status is actually being
 * requested (ACCEPTED/COMPLETED vs PREPARING/READY) determines which one
 * is the *correct* permission, but that's only knowable from the request
 * body, not from route metadata, so this guard-level check is
 * deliberately the broad "holds at least one of the two" gate; the
 * precise per-transition permission is enforced in the service (the same
 * "guards check permission (broadly); services check business rules"
 * split as every other layered check in this codebase — architecture
 * section 7).
 */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRE_ANY_PERMISSION_KEY, permissions);
