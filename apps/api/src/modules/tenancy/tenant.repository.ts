import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED';
  logoKey: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
}

interface TenantSqlRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED';
  logo_key: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
}

function mapRow(row: TenantSqlRow): TenantRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    logoKey: row.logo_key,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    address: row.address,
  };
}

/**
 * `tenant` has its own RLS policy (own id, or platform) rather than the
 * generic tenant_id policy — see R__rls_policies.sql.
 */
@Injectable()
export class TenantRepository {
  async findById(tx: TransactionContext, tenantId: string): Promise<TenantRow | null> {
    const result = await tx.query<TenantSqlRow>(`SELECT * FROM tenant WHERE id = $1`, [tenantId]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findBySlug(tx: TransactionContext, slug: string): Promise<TenantRow | null> {
    const result = await tx.query<TenantSqlRow>(`SELECT * FROM tenant WHERE slug = $1`, [slug]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /** Used only by platform tenant-provisioning. */
  async create(
    tx: TransactionContext,
    input: {
      id: string;
      name: string;
      slug: string;
      contactEmail?: string | null;
      contactPhone?: string | null;
    },
  ): Promise<TenantRow> {
    const result = await tx.query<TenantSqlRow>(
      `INSERT INTO tenant (id, name, slug, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.id, input.name, input.slug, input.contactEmail ?? null, input.contactPhone ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSERT into tenant returned no row');
    return mapRow(row);
  }

  /** Used only by platform tenant-provisioning: the default settings row. */
  async createDefaultSettings(tx: TransactionContext, tenantId: string): Promise<void> {
    await tx.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenantId]);
  }
}
