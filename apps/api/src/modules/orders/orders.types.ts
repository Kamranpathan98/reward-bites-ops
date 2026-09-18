import type { ActorKind } from '../../common/db';

export interface ActingUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly actorKind: ActorKind;
}
