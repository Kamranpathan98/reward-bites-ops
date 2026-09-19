import { BadRequestException, Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { recordAuditEvent } from '../audit/audit-writer';
import type {
  OrganizationPaymentSettings,
  PatchOrganizationPaymentSettingsRequest,
} from '@rewardbite/contracts';
import { SettingsRepository, type OrganizationPaymentSettingsRow } from './settings.repository';

/**
 * Organization payment settings business logic.
 *
 * Locked rules:
 * 1. At least one payment method must be enabled (PAYMENT_METHOD_REQUIRED on both disabled).
 * 2. If UPI enabled, upiId must be non-empty after trim (UPI_ID_REQUIRED).
 * 3. UPI ID is preserved when UPI is disabled.
 * 4. Validation applied to FINAL merged state, not just PATCH body.
 * 5. Audit events created transactionally on actual changes.
 * 6. No optimistic concurrency; last-writer-wins.
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
    // Step 1: Read current state
    const current = await this.settingsRepository.getPaymentSettings(tx, tenantId);
    const before = this.rowToResponse(current);

    // Step 2: Merge patch into current state
    const merged = {
      cashEnabled: patch.cashEnabled !== undefined ? patch.cashEnabled : current.cashEnabled,
      upiEnabled: patch.upiEnabled !== undefined ? patch.upiEnabled : current.upiEnabled,
      upiId:
        patch.upiId !== undefined
          ? patch.upiId === '' || patch.upiId === null
            ? null
            : patch.upiId.trim() || null
          : current.upiId,
      upiReferenceRequired:
        patch.upiReferenceRequired !== undefined
          ? patch.upiReferenceRequired
          : current.upiReferenceRequired,
    };

    // Step 3: Validate merged state
    this.validatePaymentSettings(merged);

    // Step 4: Check for actual changes
    const hasChanges =
      merged.cashEnabled !== current.cashEnabled ||
      merged.upiEnabled !== current.upiEnabled ||
      merged.upiId !== current.upiId ||
      merged.upiReferenceRequired !== current.upiReferenceRequired;

    // Step 5: Update database
    const updated = await this.settingsRepository.updatePaymentSettings(tx, tenantId, merged);
    const after = this.rowToResponse(updated);

    // Step 6: Audit if there were actual changes
    if (hasChanges) {
      await recordAuditEvent(tx, {
        entityType: 'tenant_settings',
        entityId: tenantId,
        action: 'payment_settings_updated',
        actorKind: 'staff',
        actorId: userId,
        before,
        after,
      });
    }

    return after;
  }

  private validatePaymentSettings(settings: {
    cashEnabled: boolean;
    upiEnabled: boolean;
    upiId: string | null;
  }): void {
    // Rule 1: At least one payment method must be enabled
    if (!settings.cashEnabled && !settings.upiEnabled) {
      throw new BadRequestException({
        error: {
          code: 'PAYMENT_METHOD_REQUIRED',
          message: 'At least one payment method must be enabled.',
          requestId: 'unknown',
          retryable: false,
        },
      });
    }

    // Rule 2: If UPI enabled, upiId must be non-empty
    if (settings.upiEnabled && (!settings.upiId || settings.upiId.trim() === '')) {
      throw new BadRequestException({
        error: {
          code: 'UPI_ID_REQUIRED',
          message: 'UPI ID is required when UPI payments are enabled.',
          requestId: 'unknown',
          retryable: false,
        },
      });
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
