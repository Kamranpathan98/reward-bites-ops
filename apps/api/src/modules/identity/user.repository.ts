import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../common/db';
import { newId } from '../../common/security/id';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  securityVersion: number;
  status: 'ACTIVE' | 'DISABLED';
}

interface UserSqlRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  security_version: number;
  status: 'ACTIVE' | 'DISABLED';
}

function mapRow(row: UserSqlRow): UserRow {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    phone: row.phone,
    securityVersion: row.security_version,
    status: row.status,
  };
}

/**
 * `user` is a global table (no tenant_id, no RLS) — see
 * R__rls_policies.sql. Every method here works identically whether called
 * inside `withGlobalTx` (login, before a tenant is known) or
 * `withTenantTx` (invite, called from inside a tenant-scoped transaction).
 */
@Injectable()
export class UserRepository {
  async findByEmail(tx: TransactionContext, email: string): Promise<UserRow | null> {
    const result = await tx.query<UserSqlRow>(
      `SELECT * FROM "user" WHERE lower(email) = lower($1)`,
      [email],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findById(tx: TransactionContext, id: string): Promise<UserRow | null> {
    const result = await tx.query<UserSqlRow>(`SELECT * FROM "user" WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(
    tx: TransactionContext,
    input: { email: string; passwordHash: string; fullName: string; phone?: string | null },
  ): Promise<UserRow> {
    const id = newId();
    const result = await tx.query<UserSqlRow>(
      `INSERT INTO "user" (id, email, password_hash, full_name, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, input.email, input.passwordHash, input.fullName, input.phone ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSERT into "user" returned no row');
    return mapRow(row);
  }

  async updatePasswordHash(
    tx: TransactionContext,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE "user" SET password_hash = $2, security_version = security_version + 1 WHERE id = $1`,
      [userId, passwordHash],
    );
  }

  async bumpSecurityVersion(tx: TransactionContext, userId: string): Promise<void> {
    await tx.query(`UPDATE "user" SET security_version = security_version + 1 WHERE id = $1`, [
      userId,
    ]);
  }
}
