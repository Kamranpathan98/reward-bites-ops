/**
 * Organization payment settings — GET/PATCH /api/v1/organization/settings
 * (real NestJS app + real PostgreSQL, Jest, same harness as the other Gate 8
 * suites). SKIPPED — loudly, never faked as passing — without
 * TEST_DATABASE_URL and TEST_PLATFORM_DATABASE_URL (see docs/DEVELOPMENT.md).
 *
 * Covers: RBAC matrix, the locked business rules against the FINAL merged
 * state, audit (only on change, atomic with the UPDATE), RLS at the SQL layer,
 * real concurrent writers, and that the settings really drive Gate 8 payments.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import * as auditWriter from '../../src/modules/audit/audit-writer';
import {
  TEST_PLATFORM_DATABASE_URL,
  asTenant,
  bearer,
  boot,
  countRows,
  createDraft,
  createOrder,
  describeIfDb,
  finalizeBill,
  getBill,
  inviteUser,
  provisionTenant,
  recordPayment,
  standardLines,
  warnIfSkipped,
  type BillView,
  type Harness,
  type Tenant,
} from './gate8-harness';

warnIfSkipped('gate8-organization-settings.integration.spec');

const ROUTE = '/api/v1/organization/settings';
const AUDIT_ACTION = 'payment_settings_updated';

interface Settings {
  cashEnabled: boolean;
  upiEnabled: boolean;
  upiId: string | null;
  upiReferenceRequired: boolean;
}

const DEFAULTS: Settings = {
  cashEnabled: true,
  upiEnabled: false,
  upiId: null,
  upiReferenceRequired: true,
};

describeIfDb('Organization payment settings (real API + real Postgres)', () => {
  let h: Harness;
  let platform: Pool;
  let T: Tenant; // owner of the tenant under test
  let U: Tenant; // a second, unrelated tenant
  let manager: { token: string };
  let cashier: { token: string };
  let kitchen: { token: string };

  beforeAll(async () => {
    h = await boot();
    platform = new Pool({ connectionString: TEST_PLATFORM_DATABASE_URL, max: 2 });
    T = await provisionTenant(h, 'org-settings');
    U = await provisionTenant(h, 'org-settings-other');
    manager = await inviteUser(h, T, 'Manager');
    cashier = await inviteUser(h, T, 'Cashier');
    kitchen = await inviteUser(h, T, 'Kitchen Staff');
  }, 180000);

  afterAll(async () => {
    await platform.end();
    await h.close();
  });

  const http = (): ReturnType<Harness['app']['getHttpServer']> => h.app.getHttpServer();
  const get = (who: Tenant | { token: string }): request.Test =>
    request(http()).get(ROUTE).set(bearer(who.token));
  const patch = (who: Tenant | { token: string }, body: unknown): request.Test =>
    request(http())
      .patch(ROUTE)
      .set(bearer(who.token))
      .send(body as object);

  async function reset(t: Tenant): Promise<void> {
    await asTenant(h, t.tenantId, (tx) =>
      tx.query(
        `UPDATE tenant_settings
            SET cash_enabled = true, upi_enabled = false, upi_id = NULL, upi_reference_required = true
          WHERE tenant_id = $1`,
        [t.tenantId],
      ),
    );
  }

  async function stored(t: Tenant): Promise<Settings & { updatedAt: string }> {
    return asTenant(h, t.tenantId, async (tx) => {
      const r = await tx.query<{
        cash_enabled: boolean;
        upi_enabled: boolean;
        upi_id: string | null;
        upi_reference_required: boolean;
        updated_at: Date;
      }>(
        `SELECT cash_enabled, upi_enabled, upi_id, upi_reference_required, updated_at
           FROM tenant_settings WHERE tenant_id = $1`,
        [t.tenantId],
      );
      const row = r.rows[0];
      if (!row) throw new Error('tenant_settings row missing');
      return {
        cashEnabled: row.cash_enabled,
        upiEnabled: row.upi_enabled,
        upiId: row.upi_id,
        upiReferenceRequired: row.upi_reference_required,
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  const storedSettings = async (t: Tenant): Promise<Settings> => {
    const { updatedAt: _ignored, ...settings } = await stored(t);
    return settings;
  };

  const auditCount = (t: Tenant): Promise<number> =>
    countRows(h, t, `SELECT count(*) AS n FROM audit_event WHERE entity_id = $1 AND action = $2`, [
      t.tenantId,
      AUDIT_ACTION,
    ]);

  beforeEach(async () => {
    await reset(T);
    await reset(U);
  });

  // ==========================================================================
  describe('authorization matrix (backend is authoritative)', () => {
    it('Owner: GET 200 with the documented shape, PATCH 200', async () => {
      const res = await get(T).expect(200);
      expect(res.body).toEqual({ data: DEFAULTS });
      const patched = await patch(T, { upiReferenceRequired: false }).expect(200);
      expect(patched.body.data.upiReferenceRequired).toBe(false);
    });

    it('Manager: GET 200 (settings.read) but PATCH 403 PERMISSION_DENIED, nothing changed, nothing audited', async () => {
      expect((await get(manager).expect(200)).body).toEqual({ data: DEFAULTS });
      const before = await auditCount(T);
      const res = await patch(manager, { cashEnabled: false, upiEnabled: true, upiId: 'x@y' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
      expect(await storedSettings(T)).toEqual(DEFAULTS);
      expect(await auditCount(T)).toBe(before);
    });

    it('Manager is refused by the permission guard before body validation (invalid body -> 403, not 400)', async () => {
      expect((await patch(manager, { nonsense: true })).status).toBe(403);
    });

    it.each([
      ['Cashier', () => cashier],
      ['Kitchen Staff', () => kitchen],
    ])(
      '%s: GET 403 and PATCH 403 (no settings.read / settings.payments.manage)',
      async (_n, who) => {
        const g = await get(who());
        expect(g.status).toBe(403);
        expect(g.body.error.code).toBe('PERMISSION_DENIED');
        const p = await patch(who(), { upiReferenceRequired: false });
        expect(p.status).toBe(403);
        expect(await storedSettings(T)).toEqual(DEFAULTS);
      },
    );

    it('unauthenticated (and garbage-token) requests -> 401 on both verbs', async () => {
      expect((await request(http()).get(ROUTE)).status).toBe(401);
      expect((await request(http()).patch(ROUTE).send({})).status).toBe(401);
      expect((await request(http()).get(ROUTE).set(bearer('not-a-jwt'))).status).toBe(401);
      expect((await request(http()).patch(ROUTE).set(bearer('not-a-jwt')).send({})).status).toBe(
        401,
      );
    });

    it('platform admins get no tenant payment-settings API (bootstrap secret alone is not a session; no platform route exists)', async () => {
      const secret = 'test-only-bootstrap-secret-1234';
      const viaSecret = await request(http()).get(ROUTE).set('x-platform-bootstrap-secret', secret);
      expect(viaSecret.status).toBe(401);
      const platformRoute = await request(http())
        .get(`/api/v1/platform/tenants/${T.tenantId}/settings`)
        .set('x-platform-bootstrap-secret', secret);
      expect(platformRoute.status).toBe(404);
    });
  });

  // ==========================================================================
  describe('business rules (validated against the FINAL merged state)', () => {
    it('A. cash on / UPI off is the default and is valid', async () => {
      expect((await get(T).expect(200)).body.data).toEqual(DEFAULTS);
    });

    it('B. cash off + UPI on with a valid ID is accepted', async () => {
      const res = await patch(T, { cashEnabled: false, upiEnabled: true, upiId: 'shop@upi' });
      expect(res.status).toBe(200);
      expect(await storedSettings(T)).toMatchObject({
        cashEnabled: false,
        upiEnabled: true,
        upiId: 'shop@upi',
      });
    });

    it('C. both methods off -> 422 PAYMENT_METHOD_REQUIRED, including via the merged state', async () => {
      const both = await patch(T, { cashEnabled: false, upiEnabled: false });
      expect(both.status).toBe(422);
      expect(both.body.error.code).toBe('PAYMENT_METHOD_REQUIRED');

      // default is cash-only, so switching cash off alone leaves nothing enabled
      const cashOnly = await patch(T, { cashEnabled: false });
      expect(cashOnly.status).toBe(422);
      expect(cashOnly.body.error.code).toBe('PAYMENT_METHOD_REQUIRED');

      await patch(T, { cashEnabled: false, upiEnabled: true, upiId: 'shop@upi' }).expect(200);
      const upiOnly = await patch(T, { upiEnabled: false });
      expect(upiOnly.status).toBe(422);
      expect(upiOnly.body.error.code).toBe('PAYMENT_METHOD_REQUIRED');
      expect(await storedSettings(T)).toMatchObject({ cashEnabled: false, upiEnabled: true });
    });

    it.each([
      ['D. null ID', { upiEnabled: true, upiId: null }],
      ['E. empty ID', { upiEnabled: true, upiId: '' }],
      ['F. whitespace-only ID', { upiEnabled: true, upiId: '   ' }],
      ['UPI on with no ID supplied and none stored', { upiEnabled: true }],
    ])('%s -> 422 UPI_ID_REQUIRED and nothing is written', async (_n, body) => {
      const before = await auditCount(T);
      const res = await patch(T, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UPI_ID_REQUIRED');
      expect(await storedSettings(T)).toEqual(DEFAULTS);
      expect(await auditCount(T)).toBe(before);
    });

    it('clearing the stored ID while UPI stays on is rejected (merged state); enabling UPI reuses a stored ID', async () => {
      await patch(T, { upiId: 'shop@upi' }).expect(200); // stored while UPI is off
      await patch(T, { upiEnabled: true }).expect(200); // reuses it, no ID re-sent
      const clear = await patch(T, { upiId: null });
      expect(clear.status).toBe(422);
      expect(clear.body.error.code).toBe('UPI_ID_REQUIRED');
      expect((await storedSettings(T)).upiId).toBe('shop@upi');
    });

    it('G/H. exactly 100 characters is accepted (also with surrounding spaces, stored trimmed); 101 is rejected', async () => {
      const id100 = 'a'.repeat(100);
      await patch(T, { upiEnabled: true, upiId: id100 }).expect(200);
      expect((await storedSettings(T)).upiId).toBe(id100);

      await patch(T, { upiId: `  ${'b'.repeat(100)}  ` }).expect(200);
      expect((await storedSettings(T)).upiId).toBe('b'.repeat(100));

      // A length limit is a request-shape rule, so it is 400 VALIDATION_FAILED like every other
      // contract violation in this API (business-rule conflicts are the 422s above).
      const tooLong = await patch(T, { upiId: 'c'.repeat(101) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
      expect((await storedSettings(T)).upiId).toBe('b'.repeat(100));
    });

    it('I. turning UPI off preserves the stored ID', async () => {
      await patch(T, { upiEnabled: true, upiId: 'shop@upi' }).expect(200);
      const res = await patch(T, { upiEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ upiEnabled: false, upiId: 'shop@upi' });
      expect((await storedSettings(T)).upiId).toBe('shop@upi');
    });

    it.each([
      ['J. only cashEnabled', { cashEnabled: false }],
      ['L. only upiReferenceRequired', { upiReferenceRequired: false }],
      ['M. only upiId', { upiId: 'new@upi' }],
    ])('%s: only that field changes, every other field is untouched', async (_n, body) => {
      // Start from a known non-default state so "untouched" is observable for every field.
      await patch(T, { cashEnabled: true, upiEnabled: true, upiId: 'base@upi' }).expect(200);
      const base = await storedSettings(T);
      await patch(T, body).expect(200);
      expect(await storedSettings(T)).toEqual({ ...base, ...body });
    });

    it('K. only upiEnabled (with a stored ID) turns UPI on and changes nothing else', async () => {
      await patch(T, { upiId: 'base@upi' }).expect(200);
      const base = await storedSettings(T);
      await patch(T, { upiEnabled: true }).expect(200);
      expect(await storedSettings(T)).toEqual({ ...base, upiEnabled: true });
    });

    it('N/O. empty PATCH and no-op PATCH return the current state, write nothing (updated_at unchanged) and audit nothing', async () => {
      await patch(T, { upiEnabled: true, upiId: 'shop@upi' }).expect(200);
      const snapshot = await stored(T);
      const auditBefore = await auditCount(T);

      const empty = await patch(T, {});
      expect(empty.status).toBe(200);
      expect(empty.body.data).toEqual(await storedSettings(T));

      const noop = await patch(T, { cashEnabled: true, upiEnabled: true, upiId: 'shop@upi' });
      expect(noop.status).toBe(200);

      expect(await stored(T)).toEqual(snapshot);
      expect(await auditCount(T)).toBe(auditBefore);
    });

    it('P. an actual change writes exactly one audit event with before/after and a staff actor', async () => {
      const before = await auditCount(T);
      await patch(T, { upiReferenceRequired: false }).expect(200);
      expect(await auditCount(T)).toBe(before + 1);

      const rows = await asTenant(h, T.tenantId, (tx) =>
        tx.query<{
          actor_kind: string;
          actor_id: string | null;
          before: Settings;
          after: Settings;
        }>(
          `SELECT actor_kind, actor_id, before, after FROM audit_event
            WHERE entity_id = $1 AND action = $2 ORDER BY at DESC, id DESC LIMIT 1`,
          [T.tenantId, AUDIT_ACTION],
        ),
      );
      const row = rows.rows[0];
      expect(row?.actor_kind).toBe('staff');
      expect(row?.actor_id).toEqual(expect.any(String));
      expect(row?.before).toEqual({ ...DEFAULTS });
      expect(row?.after).toEqual({ ...DEFAULTS, upiReferenceRequired: false });
    });

    it('Q. if the audit insert fails, the settings UPDATE is rolled back (same transaction)', async () => {
      const before = await auditCount(T);
      const spy = jest
        .spyOn(auditWriter, 'recordAuditEvent')
        .mockRejectedValueOnce(new Error('simulated audit failure'));
      let res: request.Response | undefined;
      try {
        res = await patch(T, { upiReferenceRequired: false });
      } finally {
        spy.mockRestore();
      }
      expect(res?.status).toBe(500);
      expect(await storedSettings(T)).toEqual(DEFAULTS); // the UPDATE ran first, then was rolled back
      expect(await auditCount(T)).toBe(before);
    });

    it.each([
      ['unknown field', { surprise: 1 }],
      ['tenantId in the body', { tenantId: randomUUID() }],
      ['string where a boolean is expected', { cashEnabled: 'yes' }],
      ['numeric upiId', { upiId: 123 }],
      ['object upiId', { upiId: { $ne: null } }],
      ['NUL in upiId (PostgreSQL TEXT cannot hold it)', { upiEnabled: true, upiId: 'a\u0000b' }],
      ['newline in upiId', { upiEnabled: true, upiId: 'a\nb' }],
      ['array body', []],
    ])(
      'R. malformed input (%s) -> 400 VALIDATION_FAILED, never a 500, nothing written',
      async (_n, body) => {
        const res = await patch(T, body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(await storedSettings(T)).toEqual(DEFAULTS);
      },
    );

    it('S. SQL-injection text is stored and returned literally; the table is intact', async () => {
      const payload = "shop@upi'; DROP TABLE tenant_settings; --";
      await patch(T, { upiEnabled: true, upiId: payload }).expect(200);
      expect((await get(T).expect(200)).body.data.upiId).toBe(payload);
      expect((await storedSettings(T)).upiId).toBe(payload);
    });

    it('T. XSS text is stored and returned as inert JSON data (no VPA grammar is imposed)', async () => {
      const payload = '<img src=x onerror=alert(1)>@upi';
      const res = await patch(T, { upiEnabled: true, upiId: payload }).expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.data.upiId).toBe(payload);
    });
  });

  // ==========================================================================
  describe('RLS and tenant isolation (SQL layer, as app_rw / app_platform)', () => {
    it('tenant A context cannot SELECT tenant B settings, and sees only its own row', async () => {
      const own = await asTenant(h, T.tenantId, (tx) =>
        tx.query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_settings`),
      );
      expect(own.rows.map((r) => r.tenant_id)).toEqual([T.tenantId]);
      const other = await asTenant(h, T.tenantId, (tx) =>
        tx.query(`SELECT 1 FROM tenant_settings WHERE tenant_id = $1`, [U.tenantId]),
      );
      expect(other.rows).toHaveLength(0);
    });

    it('tenant A context cannot UPDATE tenant B settings (0 rows) and B is unchanged', async () => {
      const upd = await asTenant(h, T.tenantId, (tx) =>
        tx.query(`UPDATE tenant_settings SET cash_enabled = false WHERE tenant_id = $1`, [
          U.tenantId,
        ]),
      );
      expect(upd.rowCount).toBe(0);
      expect(await storedSettings(U)).toEqual(DEFAULTS);
    });

    it('no tenant context is fail-closed: zero rows visible, zero rows updatable', async () => {
      const sel = await h.rw.query<{ n: string }>(`SELECT count(*) AS n FROM tenant_settings`);
      expect(sel.rows[0]?.n).toBe('0');
      const upd = await h.rw.query(`UPDATE tenant_settings SET cash_enabled = false`);
      expect(upd.rowCount).toBe(0);
      expect(await storedSettings(T)).toEqual(DEFAULTS);
    });

    it('a malformed tenant context is rejected by Postgres rather than treated as "no filter"', async () => {
      const client = await h.rw.connect();
      try {
        await client.query('BEGIN');
        await client.query(`select set_config('app.tenant_id', 'not-a-uuid', true)`);
        await expect(client.query(`SELECT * FROM tenant_settings`)).rejects.toThrow(
          /invalid input syntax for type uuid/,
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('app_rw cannot bypass RLS (NOBYPASSRLS, and switching row_security off is refused)', async () => {
      const client = await h.rw.connect();
      try {
        const role = await client.query<{ rolbypassrls: boolean }>(
          `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        expect(role.rows[0]?.rolbypassrls).toBe(false);
        await client.query('BEGIN');
        await client.query('SET row_security = off');
        await expect(client.query(`SELECT * FROM tenant_settings`)).rejects.toThrow(
          /row-level security/,
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('app_platform, with no tenant context, cannot modify tenant settings through SQL either', async () => {
      const upd = await platform.query(
        `UPDATE tenant_settings SET cash_enabled = false WHERE tenant_id = $1`,
        [T.tenantId],
      );
      expect(upd.rowCount).toBe(0);
      expect(await storedSettings(T)).toEqual(DEFAULTS);
    });

    it('a client cannot choose the tenant: header / query / body tenant ids are ignored or rejected', async () => {
      await patch(U, { cashEnabled: false, upiEnabled: true, upiId: 'other@upi' }).expect(200);

      const read = await request(http())
        .get(`${ROUTE}?tenantId=${U.tenantId}`)
        .set(bearer(T.token))
        .set('x-tenant-id', U.tenantId);
      expect(read.status).toBe(200);
      expect(read.body.data).toEqual(DEFAULTS); // T's own values, not U's

      const write = await request(http())
        .patch(`${ROUTE}?tenantId=${U.tenantId}`)
        .set(bearer(T.token))
        .set('x-tenant-id', U.tenantId)
        .send({ upiReferenceRequired: false });
      expect(write.status).toBe(200);
      expect((await storedSettings(T)).upiReferenceRequired).toBe(false);
      expect(await storedSettings(U)).toEqual({
        cashEnabled: false,
        upiEnabled: true,
        upiId: 'other@upi',
        upiReferenceRequired: true,
      });

      expect((await patch(T, { tenantId: U.tenantId })).status).toBe(400);
    });

    it('audit rows are tenant-isolated: visible to their tenant, invisible to others and to no-context sessions', async () => {
      await patch(T, { upiReferenceRequired: false }).expect(200);
      const q = `SELECT count(*) AS n FROM audit_event WHERE entity_id = $1 AND action = $2`;
      expect(await auditCount(T)).toBeGreaterThanOrEqual(1);
      expect(await countRows(h, U, q, [T.tenantId, AUDIT_ACTION])).toBe(0);
      const noContext = await h.rw.query<{ n: string }>(q, [T.tenantId, AUDIT_ACTION]);
      expect(noContext.rows[0]?.n).toBe('0');
    });
  });

  // ==========================================================================
  describe('concurrency (real parallel requests on separate connections)', () => {
    it('two concurrent PATCHes can never leave both methods off: one wins, one gets 422 (row lock + merged-state validation)', async () => {
      for (let round = 0; round < 8; round += 1) {
        await reset(T);
        await patch(T, { upiEnabled: true, upiId: 'shop@upi' }).expect(200);
        const auditBefore = await auditCount(T);

        const [a, b] = await Promise.all([
          patch(T, { cashEnabled: false }),
          patch(T, { upiEnabled: false }),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 422]); // no 500 / deadlock
        const loser = a.status === 422 ? a : b;
        expect(loser.body.error.code).toBe('PAYMENT_METHOD_REQUIRED');
        const s = await storedSettings(T);
        expect(s.cashEnabled || s.upiEnabled).toBe(true);
        expect((await auditCount(T)) - auditBefore).toBe(1);
      }
    }, 90000);

    it('concurrent PATCHes to different fields both land (no lost update, no stale overwrite)', async () => {
      for (let round = 0; round < 5; round += 1) {
        await reset(T);
        const auditBefore = await auditCount(T);
        const [a, b] = await Promise.all([
          patch(T, { upiReferenceRequired: false }),
          patch(T, { upiId: `new-${round}@upi` }),
        ]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(await storedSettings(T)).toEqual({
          ...DEFAULTS,
          upiReferenceRequired: false,
          upiId: `new-${round}@upi`,
        });
        expect((await auditCount(T)) - auditBefore).toBe(2);
      }
    }, 60000);

    it('ten concurrent writers to the SAME field: all succeed, last writer wins, and the audit trail is one serialized chain', async () => {
      await patch(T, { upiEnabled: true, upiId: 'v-initial@upi' }).expect(200);
      const values = Array.from({ length: 10 }, (_v, i) => `v${i}@upi`);

      const responses = await Promise.all(values.map((v) => patch(T, { upiId: v })));
      expect(responses.map((r) => r.status)).toEqual(Array<number>(10).fill(200));

      const final = (await storedSettings(T)).upiId as string;
      expect(values).toContain(final);
      expect(await storedSettings(T)).toMatchObject({ upiEnabled: true, cashEnabled: true });

      const chain = await asTenant(h, T.tenantId, (tx) =>
        tx.query<{ b: string; a: string }>(
          `SELECT before->>'upiId' AS b, after->>'upiId' AS a
             FROM audit_event
            WHERE entity_id = $1 AND action = $2 AND after->>'upiId' = ANY($3::text[])`,
          [T.tenantId, AUDIT_ACTION, values],
        ),
      );
      expect(chain.rows).toHaveLength(10);
      const befores = chain.rows.map((r) => r.b);
      const afters = chain.rows.map((r) => r.a);
      // Serialized writers each overwrite a distinct committed state: no two saw the same "before".
      expect(new Set(befores).size).toBe(10);
      expect(befores).toContain('v-initial@upi');
      // Exactly one value is never overwritten, and it is what is persisted.
      expect(afters.filter((x) => !befores.includes(x))).toEqual([final]);
    }, 90000);
  });

  // ==========================================================================
  describe('Gate 8 payment integration — the settings really drive payments', () => {
    let P: Tenant;
    const UTR = '123456789012';

    beforeAll(async () => {
      P = await provisionTenant(h, 'org-settings-pay');
    }, 90000);

    async function finalized(tableIndex: number): Promise<BillView> {
      const o = await createOrder(h, P, { tableIndex, lines: standardLines(P) });
      return finalizeBill(
        h,
        P,
        await createDraft(h, P, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
    }

    const pay = (bill: BillView, method: 'CASH' | 'UPI_STATIC'): Promise<request.Response> =>
      recordPayment(h, P, {
        idempotencyKey: randomUUID(),
        billId: bill.id,
        method,
        amountPaise: bill.grandTotalPaise,
        expectedBillVersion: bill.version,
        ...(method === 'UPI_STATIC' ? { providerReference: UTR } : {}),
      });

    const paymentRows = (bill: BillView): Promise<unknown[]> =>
      asTenant(h, P.tenantId, async (tx) => {
        const r = await tx.query(
          `SELECT id, method, amount_paise, status, provider_reference
             FROM payment WHERE bill_id = $1 ORDER BY id`,
          [bill.id],
        );
        return r.rows;
      });

    it('UPI off -> UPI payment rejected; UPI on (via the settings API) -> accepted; UPI off again -> rejected', async () => {
      await reset(P);
      const bill = await finalized(0);
      const off = await pay(bill, 'UPI_STATIC');
      expect(off.status).toBe(422);
      expect(off.body.error.code).toBe('PAYMENT_METHOD_DISABLED');

      await patch(P, { upiEnabled: true, upiId: 'shop@upi' }).expect(200);
      const on = await pay(bill, 'UPI_STATIC');
      expect(on.status).toBe(201);
      expect(on.body.data.payment).toMatchObject({ method: 'UPI_STATIC', status: 'SUCCEEDED' });

      await patch(P, { upiEnabled: false }).expect(200);
      const second = await finalized(1);
      const again = await pay(second, 'UPI_STATIC');
      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe('PAYMENT_METHOD_DISABLED');
    }, 90000);

    it('cash off -> CASH rejected (bill stays unpaid); cash on -> CASH accepted', async () => {
      await reset(P);
      await patch(P, { cashEnabled: false, upiEnabled: true, upiId: 'shop@upi' }).expect(200);
      const bill = await finalized(2);
      const off = await pay(bill, 'CASH');
      expect(off.status).toBe(422);
      expect(off.body.error.code).toBe('PAYMENT_METHOD_DISABLED');
      expect((await getBill(h, P, bill.id)).status).toBe('FINALIZED');
      expect(await paymentRows(bill)).toHaveLength(0);

      await patch(P, { cashEnabled: true }).expect(200);
      const on = await pay(bill, 'CASH');
      expect(on.status).toBe(201);
      expect((await getBill(h, P, bill.id)).status).toBe('PAID');
    }, 90000);

    it('changing settings affects future payments only: paid bills and their payment rows are untouched', async () => {
      await reset(P);
      await patch(P, { upiEnabled: true, upiId: 'shop@upi' }).expect(200);
      const bill = await finalized(3);
      expect((await pay(bill, 'UPI_STATIC')).status).toBe(201);
      const billBefore = await getBill(h, P, bill.id);
      const paymentsBefore = await paymentRows(bill);
      expect(billBefore.status).toBe('PAID');
      expect(paymentsBefore).toHaveLength(1);

      await patch(P, { upiEnabled: false, upiReferenceRequired: false, upiId: null }).expect(200);
      await patch(P, { cashEnabled: false, upiEnabled: true, upiId: 'other@upi' }).expect(200);

      expect(await getBill(h, P, bill.id)).toEqual(billBefore);
      expect(await paymentRows(bill)).toEqual(paymentsBefore);
    }, 90000);
  });
});
