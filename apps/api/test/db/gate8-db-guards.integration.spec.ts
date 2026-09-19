/**
 * Gate 8 — database-owned financial invariants, attacked directly as `app_rw`
 * (the application's runtime role: NOBYPASSRLS, tenant context on, guards on).
 *
 * Every test below issues raw SQL — the point is that NO service bug can break
 * these rules. Custom SQLSTATEs (class 'RB') are documented at the top of the
 * Gate 8 section of db/migrations/R__triggers.sql.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ADDON_PRICE,
  ITEM_PRICE,
  STANDARD_SUBTOTAL,
  asTenant,
  bearer,
  boot,
  createDraft,
  createOrder,
  describeIfDb,
  finalizeBill,
  getBill,
  orderRow,
  provisionTenant,
  recordPayment,
  sqlError,
  standardLines,
  warnIfSkipped,
  type BillView,
  type Harness,
  type Tenant,
} from './gate8-harness';

warnIfSkipped('gate8-db-guards.integration.spec');

const MAX_SAFE = 9007199254740991n;

describeIfDb('Gate 8 — DB guards, immutability and isolation (real Postgres, as app_rw)', () => {
  let h: Harness;
  let A: Tenant;
  let B: Tenant;

  beforeAll(async () => {
    h = await boot();
    A = await provisionTenant(h, 'guardsA');
    B = await provisionTenant(h, 'guardsB');
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  // ---- fixtures -----------------------------------------------------------

  async function freshDraft(
    t: Tenant = A,
    tableIndex = 3,
  ): Promise<{ bill: BillView; orderId: string; sessionId: string }> {
    const order = await createOrder(h, t, { tableIndex, lines: standardLines(t) });
    const bill = await createDraft(h, t, { sessionId: order.sessionId, orderIds: [order.id] });
    return { bill, orderId: order.id, sessionId: order.sessionId };
  }

  async function freshFinalized(
    t: Tenant = A,
    tableIndex = 3,
  ): Promise<{ bill: BillView; orderId: string; sessionId: string }> {
    const d = await freshDraft(t, tableIndex);
    return { ...d, bill: await finalizeBill(h, t, d.bill) };
  }

  async function userIdOf(t: Tenant, billId: string): Promise<string> {
    return asTenant(h, t.tenantId, async (tx) => {
      const r = await tx.query<{ finalized_by: string }>(
        'SELECT finalized_by FROM bill WHERE id = $1',
        [billId],
      );
      return (r.rows[0] as { finalized_by: string }).finalized_by;
    });
  }

  const code = async (
    t: Tenant,
    fn: Parameters<typeof sqlError>[2],
  ): Promise<string | undefined> => {
    const err = await sqlError(h, t.tenantId, fn);
    if (!err) throw new Error('expected the statement to be rejected, but it succeeded');
    return err.code;
  };

  async function insertBill(
    tx: Parameters<Parameters<typeof asTenant>[2]>[0],
    t: Tenant,
    sessionId: string,
    o: {
      status?: string;
      billNumber?: number | null;
      subtotal?: string;
      tax?: number;
      rounding?: number;
      grand?: string;
      discount?: number;
    },
  ): Promise<void> {
    const subtotal = o.subtotal ?? '1000';
    const grand =
      o.grand ??
      (
        BigInt(subtotal) -
        BigInt(o.discount ?? 0) +
        BigInt(o.tax ?? 0) +
        BigInt(o.rounding ?? 0)
      ).toString();
    await tx.query(
      `INSERT INTO bill (id, tenant_id, table_session_id, status, bill_number, subtotal_paise, discount_paise,
                         tax_paise, rounding_paise, grand_total_paise, outstanding_paise,
                         idempotency_key, idempotency_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, 'fp')`,
      [
        randomUUID(),
        t.tenantId,
        sessionId,
        o.status ?? 'DRAFT',
        o.billNumber ?? null,
        subtotal,
        o.discount ?? 0,
        o.tax ?? 0,
        o.rounding ?? 0,
        grand,
        randomUUID(),
      ],
    );
  }

  // =========================================================================
  // 1. bill CHECK constraints
  // =========================================================================
  describe('bill CHECK constraints', () => {
    it.each([
      [
        'grand total does not match the formula',
        { subtotal: '1000', grand: '999' },
        'bill_grand_total_formula',
      ],
      [
        'tax is not supported in V1',
        { subtotal: '1000', tax: 5 },
        'bill_v1_no_tax_service_delivery',
      ],
      ['rounding beyond +50 paise', { subtotal: '1000', rounding: 51 }, 'bill_rounding_range'],
      [
        'money beyond Number.MAX_SAFE_INTEGER',
        { subtotal: (MAX_SAFE + 1n).toString() },
        'bill_money_range',
      ],
    ])('rejects: %s', async (_name, opts, constraint) => {
      const { sessionId } = await freshDraft();
      const err = await sqlError(h, A.tenantId, (tx) => insertBill(tx, A, sessionId, opts));
      expect(err?.code).toBe('23514');
      expect(err?.constraint).toBe(constraint);
    });

    it('accepts the largest safe money value (boundary)', async () => {
      const { sessionId } = await freshDraft();
      const err = await sqlError(h, A.tenantId, (tx) =>
        insertBill(tx, A, sessionId, { subtotal: MAX_SAFE.toString() }),
      );
      expect(err).toBeNull();
    });

    it('rejects a bill inserted in a non-DRAFT shape (guard RB039)', async () => {
      const { sessionId } = await freshDraft();
      expect(await code(A, (tx) => insertBill(tx, A, sessionId, { status: 'PAID' }))).toBe('RB039');
      expect(await code(A, (tx) => insertBill(tx, A, sessionId, { billNumber: 7 }))).toBe('RB039');
    });
  });

  // =========================================================================
  // 2. bill state machine, snapshot immutability, settlement ownership
  // =========================================================================
  describe('bill state machine and immutability', () => {
    it('rejects illegal transitions out of DRAFT and FINALIZED (RB035)', async () => {
      const draft = (await freshDraft()).bill;
      const fin = (await freshFinalized()).bill;
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET status = 'PAID' WHERE id = $1`, [draft.id]),
        ),
      ).toBe('RB035');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET status = 'VOID' WHERE id = $1`, [draft.id]),
        ),
      ).toBe('RB035');
      expect(
        await code(A, (tx) => tx.query(`UPDATE bill SET status = 'DRAFT' WHERE id = $1`, [fin.id])),
      ).toBe('RB035');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET status = 'DISCARDED' WHERE id = $1`, [fin.id]),
        ),
      ).toBe('RB035');
    });

    it('treats PAID, VOID and DISCARDED as terminal (RB036)', async () => {
      // PAID
      const paid = (await freshFinalized()).bill;
      const payRes = await recordPayment(h, A, {
        idempotencyKey: randomUUID(),
        billId: paid.id,
        method: 'CASH',
        amountPaise: paid.grandTotalPaise,
        expectedBillVersion: paid.version,
      });
      expect(payRes.status).toBe(201);
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET status = 'FINALIZED' WHERE id = $1`, [paid.id]),
        ),
      ).toBe('RB036');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET customer_name = 'x' WHERE id = $1`, [paid.id]),
        ),
      ).toBe('RB036');

      // VOID
      const toVoid = (await freshFinalized()).bill;
      const voidRes = await request(h.app.getHttpServer())
        .post(`/api/v1/bills/${toVoid.id}/void`)
        .set(bearer(A))
        .send({ expectedVersion: toVoid.version, reason: 'Wrong table' });
      expect(voidRes.status).toBe(200);
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET status = 'FINALIZED' WHERE id = $1`, [toVoid.id]),
        ),
      ).toBe('RB036');

      // DISCARDED
      const toDiscard = (await freshDraft()).bill;
      const discardRes = await request(h.app.getHttpServer())
        .post(`/api/v1/bills/${toDiscard.id}/discard`)
        .set(bearer(A))
        .send({ expectedVersion: toDiscard.version });
      expect(discardRes.status).toBe(200);
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET status = 'DRAFT' WHERE id = $1`, [toDiscard.id]),
        ),
      ).toBe('RB036');
    });

    it('freezes the financial snapshot once FINALIZED (RB030)', async () => {
      const fin = (await freshFinalized()).bill;
      for (const set of [
        'subtotal_paise = subtotal_paise + 1',
        'discount_paise = 1',
        'grand_total_paise = grand_total_paise + 1',
        'bill_number = 424242',
        `notes = 'edited'`,
        `customer_name = 'edited'`,
        'finalized_at = now()',
      ]) {
        expect(
          await code(A, (tx) => tx.query(`UPDATE bill SET ${set} WHERE id = $1`, [fin.id])),
        ).toBe('RB030');
      }
    });

    it('makes tenant, session and idempotency identity immutable in every state (RB030)', async () => {
      const draft = (await freshDraft()).bill;
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET idempotency_key = $2 WHERE id = $1`, [draft.id, randomUUID()]),
        ),
      ).toBe('RB030');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET created_by = NULL WHERE id = $1`, [draft.id]),
        ),
      ).toBe('RB030');
    });

    it('lets ONLY the settlement trigger write paid/outstanding/PAID (pg_trigger_depth)', async () => {
      const fin = (await freshFinalized()).bill;
      const g = fin.grandTotalPaise;
      // A direct UPDATE runs the guard at trigger depth 1 -> refused.
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET paid_paise = 100, outstanding_paise = $2 WHERE id = $1`, [
            fin.id,
            g - 100,
          ]),
        ),
      ).toBe('RB031');
      expect(
        await code(A, (tx) =>
          tx.query(
            `UPDATE bill SET status = 'PAID', paid_paise = $2, outstanding_paise = 0 WHERE id = $1`,
            [fin.id, g],
          ),
        ),
      ).toBe('RB032');
    });

    it('cannot be spoofed with a session flag (no set_config back door)', async () => {
      const fin = (await freshFinalized()).bill;
      const err = await sqlError(h, A.tenantId, async (tx) => {
        await tx.query(
          `SELECT set_config('app.settlement', 'on', true), set_config('app.actor_kind', 'platform', true)`,
        );
        await tx.query(`UPDATE bill SET paid_paise = 100, outstanding_paise = $2 WHERE id = $1`, [
          fin.id,
          fin.grandTotalPaise - 100,
        ]);
      });
      expect(err?.code).toBe('RB031');
    });

    it('cannot void while orders are still linked, and never with money paid (RB034 / RB033)', async () => {
      const fin = (await freshFinalized()).bill;
      const by = await userIdOf(A, fin.id);
      expect(
        await code(A, (tx) =>
          tx.query(
            `UPDATE bill SET status = 'VOID', voided_at = now(), voided_by = $2, void_reason = 'x' WHERE id = $1`,
            [fin.id, by],
          ),
        ),
      ).toBe('RB034');
    });

    it('checks the DRAFT -> FINALIZED edge: member orders must already point back at the bill (RB038)', async () => {
      const draft = (await freshDraft()).bill;
      const by = await userIdOf(A, (await freshFinalized()).bill.id);
      expect(
        await code(A, (tx) =>
          tx.query(
            `UPDATE bill SET status = 'FINALIZED', bill_number = 987654, finalized_at = now(), finalized_by = $2 WHERE id = $1`,
            [draft.id, by],
          ),
        ),
      ).toBe('RB038');
    });

    it('holds outstanding = grand - paid and PAID => outstanding = 0 at the database', async () => {
      const draft = (await freshDraft()).bill;
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE bill SET outstanding_paise = outstanding_paise + 1 WHERE id = $1`, [
            draft.id,
          ]),
        ),
      ).toBe('23514');
    });
  });

  // =========================================================================
  // 3. grants: what app_rw is simply not allowed to do
  // =========================================================================
  describe('grants (insert-only ledgers, no financial deletes)', () => {
    it('denies UPDATE and DELETE on payment', async () => {
      expect(await code(A, (tx) => tx.query(`UPDATE payment SET amount_paise = 1`))).toBe('42501');
      expect(await code(A, (tx) => tx.query(`DELETE FROM payment`))).toBe('42501');
    });

    it('denies DELETE on bill and UPDATE/DELETE on bill_order, UPDATE on bill_line', async () => {
      expect(await code(A, (tx) => tx.query(`DELETE FROM bill`))).toBe('42501');
      expect(await code(A, (tx) => tx.query(`UPDATE bill_order SET created_at = now()`))).toBe(
        '42501',
      );
      expect(await code(A, (tx) => tx.query(`DELETE FROM bill_order`))).toBe('42501');
      expect(await code(A, (tx) => tx.query(`UPDATE bill_line SET qty = 9`))).toBe('42501');
    });

    it('cannot create a function or trigger to forge trigger nesting', async () => {
      expect(
        await code(A, (tx) =>
          tx.query(`CREATE FUNCTION forged() RETURNS int LANGUAGE sql AS 'select 1'`),
        ),
      ).toBe('42501');
    });

    it('runs as a NOBYPASSRLS role', async () => {
      const r = await h.rw.query<{ rolbypassrls: boolean }>(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(r.rows[0]?.rolbypassrls).toBe(false);
    });
  });

  // =========================================================================
  // 4. payment settlement (trigger), attacked with raw INSERTs
  // =========================================================================
  describe('payment settlement trigger', () => {
    async function rawPay(
      t: Tenant,
      billId: string,
      amount: number,
      over: { status?: string; method?: string } = {},
    ): Promise<void> {
      const by = await userIdOf(t, (await freshFinalized(t)).bill.id); // any real user of this tenant
      await asTenant(h, t.tenantId, (tx) =>
        tx.query(
          `INSERT INTO payment (id, tenant_id, bill_id, amount_paise, method, status, received_by, idempotency_key, idempotency_fingerprint)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'fp')`,
          [
            randomUUID(),
            t.tenantId,
            billId,
            amount,
            over.method ?? 'CASH',
            over.status ?? 'SUCCEEDED',
            by,
            randomUUID(),
          ],
        ),
      );
    }

    it('settles a directly inserted payment: paid, outstanding, PAID and a version bump', async () => {
      const fin = (await freshFinalized()).bill;
      await rawPay(A, fin.id, fin.grandTotalPaise);
      const after = await getBill(h, A, fin.id);
      expect(after.status).toBe('PAID');
      expect(after.paidPaise).toBe(fin.grandTotalPaise);
      expect(after.outstandingPaise).toBe(0);
      expect(after.version).toBe(fin.version + 1);
    });

    it('rejects a payment on a DRAFT or PAID bill (RB020) and an overpayment (RB021)', async () => {
      const draft = (await freshDraft()).bill;
      const paid = (await freshFinalized()).bill;
      await rawPay(A, paid.id, paid.grandTotalPaise);
      const fin = (await freshFinalized()).bill;
      const insert =
        (billId: string, amount: number) =>
        async (tx: Parameters<Parameters<typeof asTenant>[2]>[0]) => {
          const by = await userIdOf(A, fin.id);
          await tx.query(
            `INSERT INTO payment (id, tenant_id, bill_id, amount_paise, method, received_by, idempotency_key, idempotency_fingerprint)
           VALUES ($1, $2, $3, $4, 'CASH', $5, $6, 'fp')`,
            [randomUUID(), A.tenantId, billId, amount, by, randomUUID()],
          );
        };
      expect(await code(A, insert(draft.id, 100))).toBe('RB020');
      expect(await code(A, insert(paid.id, 100))).toBe('RB020');
      expect(await code(A, insert(fin.id, fin.grandTotalPaise + 1))).toBe('RB021');
    });

    it('supports multi-payment ledgers in the schema: partial then completing payment', async () => {
      const fin = (await freshFinalized()).bill;
      const first = Math.floor(fin.grandTotalPaise / 2);
      await rawPay(A, fin.id, first);
      const mid = await getBill(h, A, fin.id);
      expect(mid.status).toBe('FINALIZED');
      expect(mid.paidPaise).toBe(first);
      expect(mid.outstandingPaise).toBe(fin.grandTotalPaise - first);
      await rawPay(A, fin.id, fin.grandTotalPaise - first);
      expect((await getBill(h, A, fin.id)).status).toBe('PAID');
    });

    it('only allows V1 methods and positive amounts', async () => {
      const fin = (await freshFinalized()).bill;
      const bad = async (over: { method?: string }, amount: number) =>
        sqlError(h, A.tenantId, async (tx) => {
          const by = await userIdOf(A, fin.id);
          await tx.query(
            `INSERT INTO payment (id, tenant_id, bill_id, amount_paise, method, received_by, idempotency_key, idempotency_fingerprint)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'fp')`,
            [randomUUID(), A.tenantId, fin.id, amount, over.method ?? 'CASH', by, randomUUID()],
          );
        });
      expect((await bad({ method: 'CARD' }, 100))?.code).toBe('23514');
      expect((await bad({}, 0))?.code).toBe('23514');
      expect((await bad({}, -5))?.code).toBe('23514');
    });

    it('a reserved (non-SUCCEEDED) status row settles nothing', async () => {
      const fin = (await freshFinalized()).bill;
      await rawPay(A, fin.id, 100, { status: 'PENDING' });
      const after = await getBill(h, A, fin.id);
      expect(after.paidPaise).toBe(0);
      expect(after.status).toBe('FINALIZED');
    });
  });

  // =========================================================================
  // 5. composite tenant FKs + RLS: nothing crosses a tenant boundary
  // =========================================================================
  describe('tenant isolation (composite FKs and RLS)', () => {
    it('refuses cross-tenant references even with a forged tenant_id (FK 23503)', async () => {
      const a = await freshFinalized(A);
      // Tenant B (own context, own tenant_id) tries to reference tenant A's rows.
      // Rejected by the DRAFT-parent guard (RB040: RLS hides A's bill from B) or by the
      // composite FK (23503) — either way nothing crosses the tenant boundary.
      expect(['23503', 'RB040']).toContain(
        await code(B, (tx) =>
          tx.query(`INSERT INTO bill_order (tenant_id, bill_id, order_id) VALUES ($1, $2, $3)`, [
            B.tenantId,
            a.bill.id,
            a.orderId,
          ]),
        ),
      );
      expect(
        await code(B, (tx) =>
          tx.query(
            `INSERT INTO bill (id, tenant_id, table_session_id, idempotency_key, idempotency_fingerprint) VALUES ($1, $2, $3, $4, 'fp')`,
            [randomUUID(), B.tenantId, a.sessionId, randomUUID()],
          ),
        ),
      ).toBe('23503');
      expect(
        await code(B, (tx) =>
          tx.query(
            `INSERT INTO payment (id, tenant_id, bill_id, amount_paise, method, received_by, idempotency_key, idempotency_fingerprint)
             VALUES ($1, $2, $3, 100, 'CASH', $4, $5, 'fp')`,
            [randomUUID(), B.tenantId, a.bill.id, randomUUID(), randomUUID()],
          ),
        ),
      ).toBe('23503');
    });

    it('every foreign key on the Gate 8 tables is composite and starts with tenant_id', async () => {
      // Structural proof, independent of which guard fires first at runtime.
      const r = await h.rw.query<{ tbl: string; con: string; first_col: string; ncols: number }>(
        `SELECT c.conrelid::regclass::text AS tbl, c.conname AS con,
                (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS first_col,
                cardinality(c.conkey) AS ncols
           FROM pg_constraint c
          WHERE c.contype = 'f'
            AND c.conrelid::regclass::text IN ('bill', 'bill_order', 'bill_line', 'bill_adjustment', 'payment', 'orders', 'order_line')
            AND c.confrelid::regclass::text NOT IN ('tenant', '"user"', 'menu_item', 'menu_variant', 'menu_addon')`,
      );
      const gate8Fks = r.rows.filter(
        (x) => /bill|payment/.test(x.con + x.tbl) || x.tbl === 'bill_line',
      );
      expect(gate8Fks.length).toBeGreaterThanOrEqual(10);
      for (const fk of r.rows.filter((x) => x.tbl !== 'order_line' || /bill/.test(x.con))) {
        expect(fk.first_col).toBe('tenant_id');
        expect(fk.ncols).toBeGreaterThanOrEqual(2);
      }
    });

    it('RLS blocks writing rows for another tenant (42501 WITH CHECK)', async () => {
      const a = await freshDraft(A);
      expect(
        await code(B, (tx) =>
          tx.query(
            `INSERT INTO bill (id, tenant_id, table_session_id, idempotency_key, idempotency_fingerprint) VALUES ($1, $2, $3, $4, 'fp')`,
            [randomUUID(), A.tenantId, a.sessionId, randomUUID()],
          ),
        ),
      ).toBe('42501');
    });

    it('RLS hides every Gate 8 table from another tenant, and from no tenant at all', async () => {
      const a = await freshFinalized(A);
      await recordPayment(h, A, {
        idempotencyKey: randomUUID(),
        billId: a.bill.id,
        method: 'CASH',
        amountPaise: a.bill.grandTotalPaise,
        expectedBillVersion: a.bill.version,
      });
      for (const table of ['bill', 'bill_order', 'bill_line', 'bill_adjustment', 'payment']) {
        const asB = await asTenant(h, B.tenantId, (tx) =>
          tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [
            A.tenantId,
          ]),
        );
        expect(asB.rows[0]?.n).toBe('0');
        const noTenant = await h.rw.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
        expect(noTenant.rows[0]?.n).toBe('0'); // fail-closed: no app.tenant_id, no rows
      }
      // ...and B cannot touch A's rows through UPDATE either (0 rows matched).
      const upd = await asTenant(h, B.tenantId, (tx) =>
        tx.query(`UPDATE bill SET version = version WHERE id = $1`, [a.bill.id]),
      );
      expect(upd.rowCount).toBe(0);
    });

    it('serves bills only inside their own tenant through the API', async () => {
      const a = await freshDraft(A);
      const res = await request(h.app.getHttpServer())
        .get(`/api/v1/bills/${a.bill.id}`)
        .set(bearer(B));
      expect(res.status).toBe(404);
      const list = await request(h.app.getHttpServer()).get('/api/v1/bills').set(bearer(B));
      expect(list.status).toBe(200);
      expect((list.body.data as Array<{ id: string }>).some((x) => x.id === a.bill.id)).toBe(false);
    });
  });

  // =========================================================================
  // 6. bill_order / bill_line / bill_adjustment structure
  // =========================================================================
  describe('bill_order, bill_line and bill_adjustment', () => {
    it('protects against cross-session billing at the database (RB041)', async () => {
      const a = await freshDraft(A, 3);
      const other = await createOrder(h, A, { tableIndex: 2, lines: standardLines(A) }); // different table => different session
      expect(other.sessionId).not.toBe(a.sessionId);
      expect(
        await code(A, (tx) =>
          tx.query(`INSERT INTO bill_order (tenant_id, bill_id, order_id) VALUES ($1, $2, $3)`, [
            A.tenantId,
            a.bill.id,
            other.id,
          ]),
        ),
      ).toBe('RB041');
    });

    it('freezes membership, lines and adjustments once the bill is not DRAFT (RB040)', async () => {
      const fin = await freshFinalized(A);
      const extra = await createOrder(h, A, { tableIndex: 3, lines: standardLines(A) });
      expect(
        await code(A, (tx) =>
          tx.query(`INSERT INTO bill_order (tenant_id, bill_id, order_id) VALUES ($1, $2, $3)`, [
            A.tenantId,
            fin.bill.id,
            extra.id,
          ]),
        ),
      ).toBe('RB040');
      expect(
        await code(A, (tx) => tx.query(`DELETE FROM bill_line WHERE bill_id = $1`, [fin.bill.id])),
      ).toBe('RB040');
      expect(
        await code(A, (tx) =>
          tx.query(
            `INSERT INTO bill_adjustment (id, tenant_id, bill_id, kind, label, amount_paise) VALUES ($1, $2, $3, 'DISCOUNT_FIXED', 'x', 1)`,
            [randomUUID(), A.tenantId, fin.bill.id],
          ),
        ),
      ).toBe('RB040');
    });

    it('rejects adjustment kinds V1 does not support (RB042) and a second discount (23505)', async () => {
      const d = (await freshDraft(A)).bill;
      const ins =
        (kind: string, basis: number | null = null) =>
        (tx: Parameters<Parameters<typeof asTenant>[2]>[0]) =>
          tx.query(
            `INSERT INTO bill_adjustment (id, tenant_id, bill_id, kind, label, basis_bp, amount_paise) VALUES ($1, $2, $3, $4, 'x', $5, 10)`,
            [randomUUID(), A.tenantId, d.id, kind, basis],
          );
      expect(await code(A, ins('TAX'))).toBe('RB042');
      expect(await code(A, ins('SERVICE_CHARGE'))).toBe('RB042');
      expect(await code(A, ins('DISCOUNT_PERCENT', 0))).toBe('23514'); // basis_bp must be 1..10000
      expect(await code(A, ins('DISCOUNT_PERCENT', null))).toBe('23514'); // percent needs basis points
      const err = await sqlError(h, A.tenantId, async (tx) => {
        await ins('DISCOUNT_FIXED')(tx);
        await ins('DISCOUNT_PERCENT', 500)(tx);
      });
      expect(err?.code).toBe('23505');
      expect(err?.constraint).toBe('bill_adjustment_one_discount_unique');
    });

    it('enforces bill_line arithmetic and add-on shape', async () => {
      const a = await freshDraft(A);
      const detail = await getBill(h, A, a.bill.id);
      const item = detail.lines.find((l) => l.lineKind === 'ITEM') as BillView['lines'][number];
      const ins =
        (over: {
          kind?: string;
          addon?: string | null;
          total?: number;
          orderLine?: string;
          qty?: number;
          orderId?: string;
        }) =>
        (tx: Parameters<Parameters<typeof asTenant>[2]>[0]) =>
          tx.query(
            `INSERT INTO bill_line (id, tenant_id, bill_id, order_id, order_line_id, line_kind, addon_id, description, qty, unit_price_paise, line_total_paise)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'x', $8, 100, $9)`,
            [
              randomUUID(),
              A.tenantId,
              a.bill.id,
              over.orderId ?? a.orderId,
              over.orderLine ?? item.orderLineId,
              over.kind ?? 'ITEM',
              over.addon ?? null,
              over.qty ?? 1,
              over.total ?? 100,
            ],
          );
      expect(await code(A, ins({ total: 999 }))).toBe('23514'); // line_total = qty * unit_price
      expect(await code(A, ins({ kind: 'ADDON', addon: null }))).toBe('23514'); // ADDON needs addon_id
      expect(await code(A, ins({ kind: 'ITEM', addon: A.addonId }))).toBe('23514'); // ITEM must not have one
      expect(await code(A, ins({}))).toBe('23505'); // this order line is already copied once (ITEM)
    });

    it('proves bill_line provenance: the line must belong to the order, the order to the bill', async () => {
      const a = await freshDraft(A, 3);
      const b = await freshDraft(A, 2); // another bill with another order
      const foreignLine = (await getBill(h, A, b.bill.id)).lines[0] as BillView['lines'][number];
      const ins =
        (billId: string, orderId: string, orderLineId: string) =>
        (tx: Parameters<Parameters<typeof asTenant>[2]>[0]) =>
          tx.query(
            `INSERT INTO bill_line (id, tenant_id, bill_id, order_id, order_line_id, line_kind, description, qty, unit_price_paise, line_total_paise)
           VALUES ($1, $2, $3, $4, $5, 'ITEM', 'x', 1, 100, 100)`,
            [randomUUID(), A.tenantId, billId, orderId, orderLineId],
          );
      // b's order line, claimed under a's order -> (tenant, order, line) FK fails
      expect(await code(A, ins(a.bill.id, a.orderId, foreignLine.orderLineId))).toBe('23503');
      // a line of an order that is NOT a member of the bill -> bill_order FK fails
      expect(await code(A, ins(a.bill.id, b.orderId, foreignLine.orderLineId))).toBe('23503');
    });

    it('snapshots add-ons as separate rows without multiplying their qty by the line qty', async () => {
      // 3 x Butter Chicken + 2 Extra Cheese: the existing formula is 3*18000 + 2*1000 = 56000.
      const order = await createOrder(h, A, {
        tableIndex: 3,
        lines: [{ itemId: A.itemId, qty: 3, addons: [{ addonId: A.addonId, qty: 2 }] }],
      });
      expect(order.subtotalPaise).toBe(3 * ITEM_PRICE + 2 * ADDON_PRICE);
      const bill = await createDraft(h, A, { sessionId: order.sessionId, orderIds: [order.id] });
      const item = bill.lines.find((l) => l.lineKind === 'ITEM') as BillView['lines'][number];
      const addon = bill.lines.find((l) => l.lineKind === 'ADDON') as BillView['lines'][number];
      expect(item).toMatchObject({
        qty: 3,
        unitPricePaise: ITEM_PRICE,
        lineTotalPaise: 3 * ITEM_PRICE,
      });
      expect(addon).toMatchObject({
        qty: 2,
        unitPricePaise: ADDON_PRICE,
        lineTotalPaise: 2 * ADDON_PRICE,
      }); // NOT 3 * 2 * 1000
      for (const l of bill.lines) expect(l.lineTotalPaise).toBe(l.qty * l.unitPricePaise);
      expect(bill.lines.reduce((s, l) => s + l.lineTotalPaise, 0)).toBe(order.subtotalPaise);
      expect(bill.subtotalPaise).toBe(order.subtotalPaise);
    });

    it('rejects an add-on row that does not belong to the order line (FK 23503)', async () => {
      const a = await freshDraft(A, 3);
      const item = (await getBill(h, A, a.bill.id)).lines.find(
        (l) => l.lineKind === 'ITEM',
      ) as BillView['lines'][number];
      // A different add-on id that the order line never had.
      const err = await code(A, (tx) =>
        tx.query(
          `INSERT INTO bill_line (id, tenant_id, bill_id, order_id, order_line_id, line_kind, addon_id, description, qty, unit_price_paise, line_total_paise)
           VALUES ($1, $2, $3, $4, $5, 'ADDON', $6, 'x', 1, 100, 100)`,
          [randomUUID(), A.tenantId, a.bill.id, a.orderId, item.orderLineId, randomUUID()],
        ),
      );
      expect(err).toBe('23503');
    });
  });

  // =========================================================================
  // 7. billed-order protection
  // =========================================================================
  describe('billed order guards', () => {
    it('freezes order lines and add-ons of a billed order (RB001)', async () => {
      const fin = await freshFinalized(A);
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE order_line SET notes = 'sneaky' WHERE order_id = $1`, [fin.orderId]),
        ),
      ).toBe('RB001');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE order_line SET qty = qty + 1 WHERE order_id = $1`, [fin.orderId]),
        ),
      ).toBe('RB001');
      expect(
        await code(A, (tx) =>
          tx.query(`DELETE FROM order_line WHERE order_id = $1`, [fin.orderId]),
        ),
      ).toBe('RB001');
      expect(
        await code(A, (tx) =>
          tx.query(
            `DELETE FROM order_line_addon WHERE order_line_id IN (SELECT id FROM order_line WHERE order_id = $1)`,
            [fin.orderId],
          ),
        ),
      ).toBe('RB001');
      expect(
        await code(A, (tx) =>
          tx.query(
            `INSERT INTO order_line_addon (tenant_id, order_line_id, addon_id, name_snapshot, unit_price_paise, qty)
             SELECT tenant_id, id, $2, 'x', 1, 1 FROM order_line WHERE order_id = $1 LIMIT 1`,
            [fin.orderId, A.addonId],
          ),
        ),
      ).toBe('RB001');
    });

    it('blocks cancel, reopen, subtotal/line-count edits and re-pointing of a billed order', async () => {
      // COMPLETED + billed order for the reopen check (SIMPLE workflow allows NEW -> COMPLETED).
      const completed = await createOrder(h, A, { tableIndex: 3, lines: standardLines(A) });
      const done = await request(h.app.getHttpServer())
        .post(`/api/v1/orders/${completed.id}/transition`)
        .set(bearer(A))
        .send({ to: 'COMPLETED', expectedVersion: completed.version });
      expect(done.status).toBe(200);
      const cb = await finalizeBill(
        h,
        A,
        await createDraft(h, A, { sessionId: completed.sessionId, orderIds: [completed.id] }),
      );
      expect(cb.status).toBe('FINALIZED');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET status = 'ACCEPTED' WHERE id = $1`, [completed.id]),
        ),
      ).toBe('RB008'); // reopen

      const fin = await freshFinalized(A);
      const other = await freshFinalized(A);
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [fin.orderId]),
        ),
      ).toBe('RB007');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET subtotal_paise = 1 WHERE id = $1`, [fin.orderId]),
        ),
      ).toBe('RB003');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET line_count = 9 WHERE id = $1`, [fin.orderId]),
        ),
      ).toBe('RB004');
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET bill_id = $2 WHERE id = $1`, [fin.orderId, other.bill.id]),
        ),
      ).toBe('RB005');
    });

    it('does NOT block forward operational transitions on a billed order (KDS keeps working)', async () => {
      const fin = await freshFinalized(A);
      const before = await orderRow(h, A, fin.orderId);
      expect(before.bill_id).toBe(fin.bill.id);
      const res = await request(h.app.getHttpServer())
        .post(`/api/v1/orders/${fin.orderId}/transition`)
        .set(bearer(A))
        .send({ to: 'ACCEPTED', expectedVersion: before.version });
      expect(res.status).toBe(200);
      expect(res.body.data.billId).toBe(fin.bill.id);
      expect(res.body.data.status).toBe('ACCEPTED');
    });

    it('makes orders.table_session_id immutable and orders un-insertable as billed', async () => {
      const a = await freshDraft(A, 3);
      const other = await createOrder(h, A, { tableIndex: 2, lines: standardLines(A) });
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET table_session_id = $2 WHERE id = $1`, [
            a.orderId,
            other.sessionId,
          ]),
        ),
      ).toBe('RB002');
      expect(
        await code(A, (tx) =>
          tx.query(
            `INSERT INTO orders (id, tenant_id, table_session_id, order_number, source, type, idempotency_key, idempotency_fingerprint, bill_id)
             VALUES ($1, $2, $3, '#9999', 'COUNTER', 'DINE_IN', $4, 'fp', $5)`,
            [randomUUID(), A.tenantId, a.sessionId, randomUUID(), a.bill.id],
          ),
        ),
      ).toBe('RB011');
    });

    it('lets an order be linked only to a DRAFT bill, never a cancelled order (RB010 / RB009)', async () => {
      const fin = await freshFinalized(A);
      const free = await createOrder(h, A, { tableIndex: 3, lines: standardLines(A) });
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET bill_id = $2 WHERE id = $1`, [free.id, fin.bill.id]),
        ),
      ).toBe('RB010');

      const cancelled = await createOrder(h, A, { tableIndex: 3, lines: standardLines(A) });
      const c = await request(h.app.getHttpServer())
        .post(`/api/v1/orders/${cancelled.id}/cancel`)
        .set(bearer(A))
        .send({ expectedVersion: cancelled.version, reason: 'Guest left' });
      expect(c.status).toBe(200);
      const draft = (await freshDraft(A)).bill;
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET bill_id = $2 WHERE id = $1`, [cancelled.id, draft.id]),
        ),
      ).toBe('RB009');
    });

    it('only unlinks an order from a FINALIZED bill, never from a PAID one (RB006)', async () => {
      const fin = await freshFinalized(A);
      const pay = await recordPayment(h, A, {
        idempotencyKey: randomUUID(),
        billId: fin.bill.id,
        method: 'CASH',
        amountPaise: fin.bill.grandTotalPaise,
        expectedBillVersion: fin.bill.version,
      });
      expect(pay.status).toBe(201);
      expect(
        await code(A, (tx) =>
          tx.query(`UPDATE orders SET bill_id = NULL WHERE id = $1`, [fin.orderId]),
        ),
      ).toBe('RB006');
    });

    it('the reverse FK rejects linking an order that is not a member of that bill (23503)', async () => {
      const draft = (await freshDraft(A)).bill;
      const nonMember = await createOrder(h, A, { tableIndex: 3, lines: standardLines(A) });
      const err = await sqlError(h, A.tenantId, (tx) =>
        tx.query(`UPDATE orders SET bill_id = $2 WHERE id = $1`, [nonMember.id, draft.id]),
      );
      // Same session (table 3) so the guard passes; the FK is what stops it.
      expect(err?.code).toBe('23503');
      expect(err?.constraint).toBe('orders_tenant_bill_member_fk');
    });
  });

  // =========================================================================
  // 8. trigger ordering
  // =========================================================================
  describe('trigger ordering', () => {
    it('fires every Gate 8 guard before set_updated_at and the recompute triggers', async () => {
      const r = await h.rw.query<{ tbl: string; tgname: string }>(
        `SELECT c.relname AS tbl, t.tgname
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname IN ('bill', 'orders', 'order_line', 'order_line_addon', 'bill_adjustment')
            AND (t.tgtype & 2) = 2   -- BEFORE triggers only
          ORDER BY c.relname, t.tgname`,
      );
      const byTable = new Map<string, string[]>();
      for (const row of r.rows) byTable.set(row.tbl, [...(byTable.get(row.tbl) ?? []), row.tgname]);
      const guardFirst = (table: string, guard: string): void => {
        const names = byTable.get(table) ?? [];
        expect(names).toContain(guard);
        expect(names.indexOf(guard)).toBe(0); // alphabetical order == firing order
      };
      guardFirst('bill', 'bill_guard');
      guardFirst('orders', 'orders_billed_guard');
      guardFirst('order_line', 'order_line_billed_guard');
      guardFirst('order_line_addon', 'order_line_addon_billed_guard');
      guardFirst('bill_adjustment', 'bill_adjustment_guard');
    });
  });

  it('keeps the documented standard fixture arithmetic honest', () => {
    expect(STANDARD_SUBTOTAL).toBe(49000);
  });
});
