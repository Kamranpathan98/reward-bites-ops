import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { DomainError } from '../../common/errors/domain-error';
import { recordAuditEvent } from '../audit/audit-writer';
import type {
  OrganizationPaymentSettings,
  PatchOrganizationPaymentSettingsRequest,
} from '@rewardbite/contracts';
import {
  SettingsRepository,
  type OrganizationPaymentSettingsRow,
  type OrganizationPaymentSettingsUpdate,
} from './settings.repository';

/**
 * Organization payment settings business logic.
 *
 * Locked rules:
 * 1. At least one payment method must be enabled (422 PAYMENT_METHOD_REQUIRED).
 * 2. If UPI is enabled, the UPI ID must be non-empty after trim (422 UPI_ID_REQUIRED).
 * 3. The UPI ID is preserved when UPI is disabled.
 * 4. Validation is applied to the FINAL merged state, not just the PATCH body.
 * 5. An audit event is written in the same transaction, only on an actual change.
 * 6. No optimistic concurrency; last writer wins. Writers are serialized by a
 *    row lock so each one validates against the state the previous one committed.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly settingsRepository: SettingsRepository) {}

  async getPaymentSettings(
    tx: TransactionContext,
    tenantId: string,
  ): Promise<OrganizationPaymentSettings> {
    const row = await this.settingsRepository.getPaymentSettings(tx, tenantId);
    return this.rowToResponse(row);
  }

  async updatePaymentSettings(
    tx: TransactionContext,
    tenantId: string,
    userId: string,
    patch: PatchOrganizationPaymentSettingsRequest,
  ): Promise<OrganizationPaymentSettings> {
    const current = await this.settingsRepository.lockPaymentSettings(tx, tenantId);
    const before = this.rowToResponse(current);

    const next: OrganizationPaymentSettings = {
      cashEnabled: patch.cashEnabled ?? current.cashEnabled,
      upiEnabled: patch.upiEnabled ?? current.upiEnabled,
      upiId: patch.upiId === undefined ? current.upiId : patch.upiId?.trim() || null,
      upiReferenceRequired: patch.upiReferenceRequired ?? current.upiReferenceRequired,
    };
    this.validate(next);

    const changes: OrganizationPaymentSettingsUpdate = {};
    if (next.cashEnabled !== current.cashEnabled) changes.cashEnabled = next.cashEnabled;
    if (next.upiEnabled !== current.upiEnabled) changes.upiEnabled = next.upiEnabled;
    if (next.upiId !== current.upiId) changes.upiId = next.upiId;
    if (next.upiReferenceRequired !== current.upiReferenceRequired) {
      changes.upiReferenceRequired = next.upiReferenceRequired;
    }
    if (Object.keys(changes).length === 0) return before;

    const updated = await this.settingsRepository.updatePaymentSettings(tx, tenantId, changes);
    const after = this.rowToResponse(updated);

    await recordAuditEvent(tx, {
      entityType: 'tenant_settings',
      entityId: tenantId,
      action: 'payment_settings_updated',
      actorKind: 'staff',
      actorId: userId,
      before,
      after,
    });

    return after;
  }

  private validate(settings: OrganizationPaymentSettings): void {
    if (!settings.cashEnabled && !settings.upiEnabled) {
      throw new DomainError(
        422,
        'PAYMENT_METHOD_REQUIRED',
        'At least one payment method must be enabled.',
      );
    }
    if (settings.upiEnabled && !settings.upiId) {
      throw new DomainError(
        422,
        'UPI_ID_REQUIRED',
        'Enter a UPI ID before turning UPI payments on.',
      );
    }
  }

  private rowToResponse(row: OrganizationPaymentSettingsRow): OrganizationPaymentSettings {
    return {
      cashEnabled: row.cashEnabled,
      upiEnabled: row.upiEnabled,
      upiId: row.upiId,
      upiReferenceRequired: row.upiReferenceRequired,
    };
  }
}
