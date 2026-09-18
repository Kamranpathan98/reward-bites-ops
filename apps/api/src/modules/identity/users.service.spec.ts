import type { TransactionContext } from '../../common/db';
import type { MembershipRepository } from './membership.repository';
import type { RefreshTokenRepository } from './refresh-token.repository';
import type { RoleRepository } from './role.repository';
import type { UserRepository } from './user.repository';
import type { PermissionResolutionService } from '../../common/security/permission-resolution.service';

// `withTenantTx` normally opens a real pg transaction. Mocking it to just
// invoke the callback with a fake TransactionContext lets this test prove
// the service's own logic (what it calls, in what order, with what
// arguments) without a database — the DB-level proof (that a revoked
// user's live access token is actually rejected by AuthGuard) is a
// separate, real-Postgres test in test/db/gate2-vertical-journey.integration.spec.ts.
jest.mock('../../common/db', () => {
  const actual = jest.requireActual('../../common/db');
  return {
    ...actual,
    withTenantTx: jest.fn(
      async (_pool: unknown, _input: unknown, fn: (tx: TransactionContext) => unknown) =>
        fn(fakeTx),
    ),
  };
});

import { UsersService } from './users.service';

const fakeTx: TransactionContext = {
  tenantId: 'tenant-a',
  userId: 'actor-user-id',
  actorKind: 'staff',
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

function makeService(overrides?: { membershipRepository?: Partial<MembershipRepository> }) {
  const membershipRepository = {
    findRawById: jest.fn(),
    ...overrides?.membershipRepository,
  } as unknown as MembershipRepository;

  const refreshTokenRepository = {
    revokeAllForMembership: jest.fn().mockResolvedValue(undefined),
  } as unknown as RefreshTokenRepository;

  const userRepository = {
    bumpSecurityVersion: jest.fn().mockResolvedValue(undefined),
  } as unknown as UserRepository;

  const roleRepository = {} as unknown as RoleRepository;

  const permissions = {
    invalidateSecurityVersion: jest.fn(),
    invalidatePermissions: jest.fn(),
  } as unknown as PermissionResolutionService;

  const service = new UsersService(
    {} as never, // DB_POOL — never touched, since withTenantTx is mocked
    userRepository,
    membershipRepository,
    roleRepository,
    refreshTokenRepository,
    permissions,
  );

  return { service, membershipRepository, refreshTokenRepository, userRepository, permissions };
}

describe('UsersService.revokeSessions (Gate 2 red-team fix: security_version bump)', () => {
  beforeEach(() => {
    (fakeTx.query as jest.Mock).mockClear();
  });

  const actor = { userId: 'owner-1', tenantId: 'tenant-a', actorKind: 'staff' as const };
  const membershipId = 'membership-target';

  it("revokes refresh tokens AND bumps the target user's security_version, in the same transaction", async () => {
    const { service, membershipRepository, refreshTokenRepository, userRepository, permissions } =
      makeService({
        membershipRepository: {
          findRawById: jest.fn().mockResolvedValue({
            id: membershipId,
            userId: 'target-user',
            roleId: 'role-1',
            status: 'ACTIVE',
          }),
        },
      });

    await service.revokeSessions(actor, membershipId);

    // Tenant-scoped lookup preserved — this is what makes cross-tenant
    // revocation impossible (a foreign membershipId resolves to null, see
    // the next test).
    expect(membershipRepository.findRawById).toHaveBeenCalledWith(
      fakeTx,
      actor.tenantId,
      membershipId,
    );

    expect(refreshTokenRepository.revokeAllForMembership).toHaveBeenCalledWith(
      fakeTx,
      membershipId,
    );
    // The fix: security_version is bumped for the target, inside the same
    // withTenantTx call (fakeTx), not as an afterthought.
    expect(userRepository.bumpSecurityVersion).toHaveBeenCalledWith(fakeTx, 'target-user');

    // Ordering: bump must happen inside the transaction, i.e. before this
    // function returns — both mocks were invoked, so assert relative order
    // via mock invocation order.
    const revokeOrder = (refreshTokenRepository.revokeAllForMembership as jest.Mock).mock
      .invocationCallOrder[0] as number;
    const bumpOrder = (userRepository.bumpSecurityVersion as jest.Mock).mock
      .invocationCallOrder[0] as number;
    expect(bumpOrder).toBeGreaterThan(revokeOrder);

    // The audit write happened too (recordAuditEvent runs for real against fakeTx.query).
    expect(fakeTx.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_event'),
      expect.any(Array),
    );

    // After the transaction commits, the in-memory rv cache for the
    // TARGET user is invalidated, so AuthGuard's next check re-reads the
    // just-bumped value instead of serving a up-to-60s-stale cache entry.
    expect(permissions.invalidateSecurityVersion).toHaveBeenCalledWith('target-user');
  });

  it('throws NotFoundException for a foreign/cross-tenant membershipId and touches nothing', async () => {
    const { service, refreshTokenRepository, userRepository, permissions } = makeService({
      membershipRepository: { findRawById: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.revokeSessions(actor, 'someone-elses-membership')).rejects.toThrow(
      'Membership not found.',
    );

    expect(refreshTokenRepository.revokeAllForMembership).not.toHaveBeenCalled();
    expect(userRepository.bumpSecurityVersion).not.toHaveBeenCalled();
    expect(permissions.invalidateSecurityVersion).not.toHaveBeenCalled();
  });
});
