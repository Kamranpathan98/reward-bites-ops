import type { ActorKind } from '../../common/db';

export interface ActingUser {
  userId: string;
  tenantId: string;
  membershipId?: string;
  actorKind: ActorKind;
}
