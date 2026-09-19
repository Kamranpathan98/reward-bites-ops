import type { TransactionContext } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';

jest.mock('../audit/audit-writer', () => ({ recordAuditEvent: jest.fn() }));

import { recordAuditEvent } from '../audit/audit-writer';
import type { OrganizationPaymentSettingsRow, SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-0000000000aa';
const tx = {
  tenantId: TENANT,
  userId: USER,
  actorKind: 'staff',
  query: jest.fn(),
} as never as TransactionContext;
const auditMock = jest.mocked(recordAuditEvent);

function row(over: Partial<OrganizationPaymentSettingsRow> = {}): OrganizationPaymentSettingsRow {
  return {
    tenantId: TENANT,
    cashEnabled: true,
    upiEnabled: false,
    upiId: null,
    upiReferenceRequired: true,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

async function codeOf(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    const err = e as DomainError;
    return { status: err.getStatus(), code: (err.getResponse() as { code: string }).code };
  }
  throw new Error('expected a DomainError, but the call resolved');
}

describe('SettingsService.updatePaymentSettings', () => {
  let repo: jest.Mocked<SettingsRepository>;
  let service: SettingsService;

  function given(current: OrganizationPaymentSettingsRow): void {
    repo.lockPaymentSettings.mockResolvedValue(current);
    repo.updatePaymentSettings.mockImplementation(async (_tx, _t, update) => ({
      ...current,
      ...update,
    }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    repo = {
      getPaymentSettings: jest.fn(),
      lockPaymentSettings: jest.fn(),
      updatePaymentSettings: jest.fn(),
    } as unknown as jest.Mocked<SettingsRepository>;
    service = new SettingsService(repo);
  });

  it('takes the row lock before reading, so concurrent writers are serialized (never the unlocked read)', async () => {
    given(row());
    await service.updatePaymentSettings(tx, TENANT, USER, { upiReferenceRequired: false });
    expect(repo.lockPaymentSettings).toHaveBeenCalledWith(tx, TENANT);
    expect(repo.getPaymentSettings).not.toHaveBeenCalled();
  });

  describe('locked rule 1 — at least one payment method stays enabled (422 PAYMENT_METHOD_REQUIRED)', () => {
    it('rejects disabling both in one PATCH', async () => {
      given(row({ cashEnabled: true, upiEnabled: true, upiId: 'a@b' }));
      expect(
        await codeOf(
          service.updatePaymentSettings(tx, TENANT, USER, {
            cashEnabled: false,
            upiEnabled: false,
          }),
        ),
      ).toEqual({ status: 422, code: 'PAYMENT_METHOD_REQUIRED' });
      expect(repo.updatePaymentSettings).not.toHaveBeenCalled();
      expect(auditMock).not.toHaveBeenCalled();
    });

    it('validates the FINAL merged state: turning off the only enabled method is rejected', async () => {
      given(row({ cashEnabled: true, upiEnabled: false }));
      expect(
        await codeOf(service.updatePaymentSettings(tx, TENANT, USER, { cashEnabled: false })),
      ).toEqual({ status: 422, code: 'PAYMENT_METHOD_REQUIRED' });

      given(row({ cashEnabled: false, upiEnabled: true, upiId: 'a@b' }));
      expect(
        await codeOf(service.updatePaymentSettings(tx, TENANT, USER, { upiEnabled: false })),
      ).toEqual({ status: 422, code: 'PAYMENT_METHOD_REQUIRED' });
    });

    it('allows cash off when UPI is on (with an ID)', async () => {
      given(row());
      const out = await service.updatePaymentSettings(tx, TENANT, USER, {
        cashEnabled: false,
        upiEnabled: true,
        upiId: 'shop@upi',
      });
      expect(out).toMatchObject({ cashEnabled: false, upiEnabled: true, upiId: 'shop@upi' });
    });
  });

  describe('locked rule 2 — UPI enabled needs a non-empty ID (422 UPI_ID_REQUIRED)', () => {
    it.each([
      ['no ID supplied and none stored', { upiEnabled: true }],
      ['explicit null', { upiEnabled: true, upiId: null }],
      ['empty string', { upiEnabled: true, upiId: '' }],
    ])('rejects: %s', async (_name, patch) => {
      given(row());
      expect(await codeOf(service.updatePaymentSettings(tx, TENANT, USER, patch))).toEqual({
        status: 422,
        code: 'UPI_ID_REQUIRED',
      });
      expect(repo.updatePaymentSettings).not.toHaveBeenCalled();
    });

    it('rejects clearing the stored ID while UPI stays enabled (merged state)', async () => {
      given(row({ upiEnabled: true, upiId: 'shop@upi' }));
      expect(
        await codeOf(service.updatePaymentSettings(tx, TENANT, USER, { upiId: null })),
      ).toEqual({ status: 422, code: 'UPI_ID_REQUIRED' });
    });

    it('accepts enabling UPI when an ID is already stored (uses the stored ID)', async () => {
      given(row({ upiEnabled: false, upiId: 'shop@upi' }));
      await service.updatePaymentSettings(tx, TENANT, USER, { upiEnabled: true });
      expect(repo.updatePaymentSettings).toHaveBeenCalledWith(tx, TENANT, { upiEnabled: true });
    });
  });

  describe('locked rule 3 — the UPI ID is preserved when UPI is disabled', () => {
    it('disabling UPI writes ONLY upi_enabled, never the ID', async () => {
      given(row({ cashEnabled: true, upiEnabled: true, upiId: 'shop@upi' }));
      const out = await service.updatePaymentSettings(tx, TENANT, USER, { upiEnabled: false });
      expect(repo.updatePaymentSettings).toHaveBeenCalledWith(tx, TENANT, { upiEnabled: false });
      expect(out.upiId).toBe('shop@upi');
    });

    it('an explicit empty/null ID while UPI is off is a deliberate clear', async () => {
      given(row({ upiEnabled: false, upiId: 'shop@upi' }));
      await service.updatePaymentSettings(tx, TENANT, USER, { upiId: '' });
      expect(repo.updatePaymentSettings).toHaveBeenCalledWith(tx, TENANT, { upiId: null });
    });
  });

  describe('PATCH writes and audit', () => {
    it('writes only the fields that actually changed (no stale overwrite of untouched columns)', async () => {
      given(row({ cashEnabled: true, upiEnabled: true, upiId: 'a@b', upiReferenceRequired: true }));
      await service.updatePaymentSettings(tx, TENANT, USER, {
        cashEnabled: true, // unchanged
        upiId: 'c@d', // changed
      });
      expect(repo.updatePaymentSettings).toHaveBeenCalledWith(tx, TENANT, { upiId: 'c@d' });
    });

    it.each([
      ['empty PATCH', {}],
      ['no-op PATCH (same values)', { cashEnabled: true, upiEnabled: false }],
    ])('%s: no UPDATE and no audit event', async (_name, patch) => {
      given(row());
      const out = await service.updatePaymentSettings(tx, TENANT, USER, patch);
      expect(out).toEqual({
        cashEnabled: true,
        upiEnabled: false,
        upiId: null,
        upiReferenceRequired: true,
      });
      expect(repo.updatePaymentSettings).not.toHaveBeenCalled();
      expect(auditMock).not.toHaveBeenCalled();
    });

    it('an actual change records exactly one audit event with before/after, in the same tx', async () => {
      given(row());
      await service.updatePaymentSettings(tx, TENANT, USER, { upiReferenceRequired: false });
      expect(auditMock).toHaveBeenCalledTimes(1);
      expect(auditMock).toHaveBeenCalledWith(tx, {
        entityType: 'tenant_settings',
        entityId: TENANT,
        action: 'payment_settings_updated',
        actorKind: 'staff',
        actorId: USER,
        before: { cashEnabled: true, upiEnabled: false, upiId: null, upiReferenceRequired: true },
        after: { cashEnabled: true, upiEnabled: false, upiId: null, upiReferenceRequired: false },
      });
    });

    it('propagates an audit failure so the caller transaction rolls the UPDATE back', async () => {
      given(row());
      auditMock.mockRejectedValueOnce(new Error('audit insert failed'));
      await expect(
        service.updatePaymentSettings(tx, TENANT, USER, { upiReferenceRequired: false }),
      ).rejects.toThrow('audit insert failed');
    });
  });
});
