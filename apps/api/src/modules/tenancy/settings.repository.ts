import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';

export interface OrganizationPaymentSettingsRow {
  tenantId: string;
  cashEnabled: boolean;
  upiEnabled: boolean;
  upiId: string | null;
  upiReferenceRequired: boolean;
  updatedAt: Date;
}

interface TenantSettingsSqlRow {
  tenant_id: string;
  cash_enabled: boolean;
  upi_enabled: boolean;
  upi_id: string | null;
  upi_reference_required: boolean;
  updated_at: Date;
}

function mapPaymentSettingsRow(row: TenantSettingsSqlRow): OrganizationPaymentSettingsRow {
  return {
    tenantId: row.tenant_id,
    cashEnabled: row.cash_enabled,
    upiEnabled: row.upi_enabled,
    upiId: row.upi_id,
    upiReferenceRequired: row.upi_reference_required,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class SettingsRepository {
  async getPaymentSettings(
    tx: TransactionContext,
    tenantId: string,
  ): Promise<OrganizationPaymentSettingsRow> {
    const result = await tx.query<TenantSettingsSqlRow>(
      `SELECT tenant_id, cash_enabled, upi_enabled, upi_id, upi_reference_required, updated_at
       FROM tenant_settings
       WHERE tenant_id = $1`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) throw new Error(`Settings not found for tenant ${tenantId}`);
    return mapPaymentSettingsRow(row);
  }

  async updatePaymentSettings(
    tx: TransactionContext,
    tenantId: string,
    update: {
      cashEnabled?: boolean;
      upiEnabled?: boolean;
      upiId?: string | null;
      upiReferenceRequired?: boolean;
    },
  ): Promise<OrganizationPaymentSettingsRow> {
    // Build dynamic UPDATE clause
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId];
    let paramIndex = 2;

    if (update.cashEnabled !== undefined) {
      setClauses.push(`cash_enabled = $${paramIndex++}`);
      values.push(update.cashEnabled);
    }

    if (update.upiEnabled !== undefined) {
      setClauses.push(`upi_enabled = $${paramIndex++}`);
      values.push(update.upiEnabled);
    }

    if (update.upiId !== undefined) {
      setClauses.push(`upi_id = $${paramIndex++}`);
      values.push(update.upiId);
    }

    if (update.upiReferenceRequired !== undefined) {
      setClauses.push(`upi_reference_required = $${paramIndex++}`);
      values.push(update.upiReferenceRequired);
    }

    // Always update updated_at
    setClauses.push(`updated_at = now()`);

    if (setClauses.length === 1) {
      // No actual changes, just return current state
      return this.getPaymentSettings(tx, tenantId);
    }

    const sql = `UPDATE tenant_settings
                 SET ${setClauses.join(', ')}
                 WHERE tenant_id = $1
                 RETURNING tenant_id, cash_enabled, upi_enabled, upi_id, upi_reference_required, updated_at`;

    const result = await tx.query<TenantSettingsSqlRow>(sql, values);

    const row = result.rows[0];
    if (!row) throw new Error(`Update failed for tenant ${tenantId}`);
    return mapPaymentSettingsRow(row);
  }
}
