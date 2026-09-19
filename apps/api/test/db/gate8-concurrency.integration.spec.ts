/**
 * Gate 8 — concurrency (real NestJS app + real PostgreSQL, real parallel
 * connections). Each race is repeated over fresh fixtures; the assertions are
 * on INVARIANTS that must hold for every interleaving, not on one lucky order.
 *
 * Lock order under test: session -> bill -> orders (ascending id) -> counter,
 * READ COMMITTED, the settlement trigger's lock-then-sum, and the child-row
 * guards that protect writers which bypass the service's parent lock.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  asTenant,
  bearer,
  boot,
  closeSession,
  completeOrder,
  countRows,
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

warnIfSkipped('gate8-concurrency.integration.spec');

describeIfDb('Gate 8 — concurrency (real parallel requests, real Postgres)', () => {
  let h: Harness;
  let T: Tenant;

  beforeAll(async () => {
    h = await boot();
    T = await provisionTenant(h, 'conc');
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  const http = (): ReturnType<Harness['app']['getHttpServer']> => h.app.getHttpServer();
  const statuses = (rs: request.Response[]): number[] => rs.map((r) => r.status).sort();
  const count = (rs: request.Response[], status: number): number =>
    rs.filter((r) => r.status === status).length;
  const codes = (rs: request.Response[], status: number): string[] =>
    rs.filter((r) => r.status === status).map((r) => r.body.error?.code as string);

  async function newOrder(
    tableIndex = 0,
    t: Tenant = T,
  ): Promise<{ id: string; sessionId: string; version: number }> {
    return createOrder(h, t, { tableIndex, lines: standardLines(t) });
  }
  async function draftOf(orderIds: string[], sessionId: string, t: Tenant = T): Promise<BillView> {
    return createDraft(h, t, { sessionId, orderIds });
  }
  const finalizeReq = (bill: BillView, t: Tenant = T): Promise<request.Response> =>
    request(http())
      .post(`/api/v1/bills/${bill.id}/finalize`)
      .set(bearer(t))
      .send({ expectedVersion: bill.version, expectedGrandTotalPaise: bill.grandTotalPaise });
  const payReq = (
    bill: BillView,
    over: Record<string, unknown> = {},
    t: Tenant = T,
  ): Promise<request.Response> =>
    recordPayment(h, t, {
      idempotencyKey: randomUUID(),
      billId: bill.id,
      method: 'CASH',
      amountPaise: bill.grandTotalPaise,
      expectedBillVersion: bill.version,
      ...over,
    });

  // ==========================================================================
  describe('finalize', () => {
    it('double finalize: exactly one wins, the rest conflict, one bill number is allocated', async () => {
      const o = await newOrder();
      const d = await draftOf([o.id], o.sessionId);
      const rs = await Promise.all(Array.from({ length: 6 }, () => finalizeReq(d)));
      expect(count(rs, 200)).toBe(1);
      expect(count(rs, 409)).toBe(5);
      for (const c of codes(rs, 409)) expect(['VERSION_CONFLICT', 'BILL_NOT_DRAFT']).toContain(c);
      const bill = await getBill(h, T, d.id);
      expect(bill.status).toBe('FINALIZED');
      expect(bill.billNumber).toBeGreaterThan(0);
      expect((await orderRow(h, T, o.id)).bill_id).toBe(d.id);
      expect(
        await countRows(
          h,
          T,
          'SELECT count(*) AS n FROM bill WHERE id = $1 AND bill_number IS NOT NULL',
          [d.id],
        ),
      ).toBe(1);
    });

    it('two drafts over the same order finalized concurrently: one wins, the loser stays DRAFT (ORDER_ALREADY_BILLED)', async () => {
      for (let round = 0; round < 4; round += 1) {
        const o = await newOrder(round % 4);
        const a = await draftOf([o.id], o.sessionId);
        const b = await draftOf([o.id], o.sessionId);
        const rs = await Promise.all([finalizeReq(a), finalizeReq(b)]);
        expect(statuses(rs)).toEqual([200, 422]);
        expect(codes(rs, 422)).toEqual(['ORDER_ALREADY_BILLED']);
        const winner = rs.find((r) => r.status === 200)?.body.data.id as string;
        expect((await orderRow(h, T, o.id)).bill_id).toBe(winner);
        const loserId = winner === a.id ? b.id : a.id;
        expect((await getBill(h, T, loserId)).status).toBe('DRAFT'); // stays for the cashier to discard
        expect(
          await countRows(h, T, 'SELECT count(*) AS n FROM bill_order WHERE order_id = $1', [o.id]),
        ).toBe(2);
      }
    }, 60000);

    it('overlapping finalizes over shared orders never deadlock (ascending lock order)', async () => {
      for (let round = 0; round < 6; round += 1) {
        const t = round % 4;
        const o1 = await newOrder(t);
        const o2 = await newOrder(t);
        const o3 = await newOrder(t);
        // {o1,o2} and {o3,o2}: share o2. Listed in opposite orders on purpose.
        const a = await draftOf([o1.id, o2.id], o1.sessionId);
        const b = await draftOf([o3.id, o2.id], o1.sessionId);
        const rs = await Promise.all([
          finalizeReq(a),
          finalizeReq(b),
          finalizeReq(a),
          finalizeReq(b),
        ]);
        expect(rs.some((r) => r.status >= 500)).toBe(false); // no deadlock (40P01), no internal error
        expect(count(rs, 200)).toBe(1);
        const winnerBill = rs.find((r) => r.status === 200)?.body.data as BillView;
        const rows = await Promise.all(winnerBill.orderIds.map((id) => orderRow(h, T, id)));
        for (const r of rows) expect(r.bill_id).toBe(winnerBill.id);
      }
    }, 90000);

    it('finalize vs order edit: never both succeed; a finalized bill never misses an edit', async () => {
      for (let round = 0; round < 8; round += 1) {
        const o = await newOrder(round % 4);
        const d = await draftOf([o.id], o.sessionId);
        const edit = request(http())
          .patch(`/api/v1/orders/${o.id}/lines`)
          .set(bearer(T))
          .send({
            expectedVersion: o.version,
            add: [{ itemId: T.cheapItemId, variantId: T.cheapVariantId, qty: 1 }],
          });
        const [fin, ed] = await Promise.all([finalizeReq(d), edit]);
        expect(fin.status).toBeLessThan(500);
        expect(ed.status).toBeLessThan(500);
        if (fin.status === 200) {
          // finalize won: the edit must have been refused as billed, and the snapshot is the pre-edit order
          expect(ed.status).toBe(422);
          expect(ed.body.error.code).toBe('ORDER_ALREADY_BILLED');
          expect(fin.body.data.subtotalPaise).toBe(d.subtotalPaise);
          expect(
            await countRows(
              h,
              T,
              `SELECT count(*) AS n FROM order_line WHERE order_id = $1 AND status = 'ACTIVE'`,
              [o.id],
            ),
          ).toBe(2);
        } else {
          // the edit won: finalize saw the new total (or version) and refused
          expect(ed.status).toBe(200);
          expect(fin.status).toBe(409);
          expect(['BILL_TOTALS_CHANGED', 'VERSION_CONFLICT']).toContain(fin.body.error.code);
          expect((await orderRow(h, T, o.id)).bill_id).toBeNull();
        }
      }
    }, 90000);

    it('finalize vs cancel: exactly one succeeds', async () => {
      for (let round = 0; round < 8; round += 1) {
        const o = await newOrder(round % 4);
        const d = await draftOf([o.id], o.sessionId);
        const cancel = request(http())
          .post(`/api/v1/orders/${o.id}/cancel`)
          .set(bearer(T))
          .send({ expectedVersion: o.version, reason: 'Guest left' });
        const [fin, can] = await Promise.all([finalizeReq(d), cancel]);
        expect(fin.status).toBeLessThan(500);
        expect(can.status).toBeLessThan(500);
        if (fin.status === 200) {
          expect(can.status).toBe(422);
          expect(can.body.error.code).toBe('ORDER_ALREADY_BILLED');
          expect((await orderRow(h, T, o.id)).status).not.toBe('CANCELLED');
        } else {
          expect(can.status).toBe(200);
          expect(fin.status).toBe(422);
          expect(fin.body.error.code).toBe('ORDER_NOT_BILLABLE');
        }
      }
    }, 90000);

    it('finalize vs reopen: a billed order is never reopened after it was linked', async () => {
      for (let round = 0; round < 6; round += 1) {
        const o = await newOrder(round % 4);
        const v = await completeOrder(h, T, o.id, o.version);
        const d = await draftOf([o.id], o.sessionId);
        const reopen = request(http())
          .post(`/api/v1/orders/${o.id}/reopen`)
          .set(bearer(T))
          .send({ expectedVersion: v });
        const [fin, re] = await Promise.all([finalizeReq(d), reopen]);
        expect(fin.status).toBe(200); // reopening does not change lines or the total
        const row = await orderRow(h, T, o.id);
        expect(row.bill_id).toBe(d.id);
        if (re.status === 200) {
          expect(row.status).toBe('ACCEPTED'); // it was reopened BEFORE the link
        } else {
          expect(re.status).toBe(422);
          expect(re.body.error.code).toBe('ORDER_ALREADY_BILLED');
          expect(row.status).toBe('COMPLETED');
        }
      }
    }, 90000);

    it('a child writer that BYPASSES the parent lock still cannot mutate a billed order (FOR SHARE guard)', async () => {
      // A raw UPDATE of an existing order_line takes no parent lock at all, so
      // the service-level `orders FOR UPDATE` alone would not stop it.
      for (let round = 0; round < 8; round += 1) {
        const o = await newOrder(round % 4);
        const d = await draftOf([o.id], o.sessionId);
        const rawWrite = sqlError(h, T.tenantId, (tx) =>
          tx.query(
            `UPDATE order_line SET qty = qty + 1 WHERE order_id = $1 AND status = 'ACTIVE' AND id = (SELECT id FROM order_line WHERE order_id = $1 ORDER BY id LIMIT 1)`,
            [o.id],
          ),
        );
        const [fin, raw] = await Promise.all([finalizeReq(d), rawWrite]);
        expect(fin.status).toBeLessThan(500);
        const bill = await getBill(h, T, d.id);
        const live = await countRows(
          h,
          T,
          `SELECT COALESCE(SUM(line_total_paise), 0) AS n FROM order_line WHERE order_id = $1 AND status = 'ACTIVE'`,
          [o.id],
        );
        if (fin.status === 200) {
          // finalize won, or the raw write committed first and finalize re-read it: in both
          // cases the frozen snapshot equals the live order, and if the write lost it was RB001.
          expect(bill.subtotalPaise).toBe(live);
          if (raw) expect(raw.code).toBe('RB001');
        } else {
          expect(fin.status).toBe(409); // the raw write committed first -> total changed
          expect(raw).toBeNull();
          expect(bill.status).toBe('DRAFT');
        }
      }
    }, 90000);

    it('finalizes many bills of one tenant concurrently: every bill number is unique and positive', async () => {
      const drafts: BillView[] = [];
      for (let i = 0; i < 8; i += 1) {
        const o = await newOrder(i % 4);
        drafts.push(await draftOf([o.id], o.sessionId));
      }
      const rs = await Promise.all(drafts.map((d) => finalizeReq(d)));
      expect(statuses(rs)).toEqual(Array(8).fill(200));
      const numbers = rs.map((r) => r.body.data.billNumber as number);
      expect(new Set(numbers).size).toBe(8);
      for (const n of numbers) expect(n).toBeGreaterThan(0);
      // (only monotonic + unique are promised; the transactional counter happens not to gap)
    }, 60000);

    it('POST /bills with one idempotency key fired concurrently creates exactly one draft', async () => {
      const o = await newOrder(0);
      const key = randomUUID();
      const send = (): Promise<request.Response> =>
        request(http())
          .post('/api/v1/bills')
          .set(bearer(T))
          .send({ idempotencyKey: key, sessionId: o.sessionId, orderIds: [o.id] });
      const rs = await Promise.all(Array.from({ length: 6 }, send));
      expect(rs.some((r) => r.status >= 500)).toBe(false);
      expect(count(rs, 201)).toBe(1);
      expect(count(rs, 200)).toBe(5);
      expect(new Set(rs.map((r) => r.body.data.id)).size).toBe(1);
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM bill WHERE idempotency_key = $1', [key]),
      ).toBe(1);
    });
  });

  // ==========================================================================
  describe('payments', () => {
    async function fin(t: Tenant = T, tableIndex = 0): Promise<BillView> {
      const o = await newOrder(tableIndex, t);
      return finalizeBill(h, t, await draftOf([o.id], o.sessionId, t));
    }

    it('different idempotency keys, same bill: exactly one settlement, the rest BILL_NOT_PAYABLE', async () => {
      const bill = await fin();
      const rs = await Promise.all(Array.from({ length: 6 }, () => payReq(bill)));
      expect(rs.some((r) => r.status >= 500)).toBe(false);
      expect(count(rs, 201)).toBe(1);
      expect(count(rs, 409)).toBe(5);
      for (const c of codes(rs, 409)) expect(c).toBe('BILL_NOT_PAYABLE');
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM payment WHERE bill_id = $1', [bill.id]),
      ).toBe(1);
      const settled = await getBill(h, T, bill.id);
      expect(settled).toMatchObject({
        status: 'PAID',
        paidPaise: bill.grandTotalPaise,
        outstandingPaise: 0,
      });
    });

    it('the SAME key fired concurrently: one payment, everyone else replays it', async () => {
      const bill = await fin();
      const key = randomUUID();
      const rs = await Promise.all(
        Array.from({ length: 6 }, () => payReq(bill, { idempotencyKey: key })),
      );
      expect(rs.some((r) => r.status >= 500)).toBe(false);
      expect(count(rs, 201)).toBe(1);
      expect(count(rs, 200)).toBe(5);
      expect(new Set(rs.map((r) => r.body.data.payment.id)).size).toBe(1);
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM payment WHERE idempotency_key = $1', [
          key,
        ]),
      ).toBe(1);
    });

    it('the same key against TWO bills concurrently: one payment, the other IDEMPOTENT_MISMATCH', async () => {
      for (let round = 0; round < 3; round += 1) {
        const a = await fin(T, round);
        const b = await fin(T, round);
        const key = randomUUID();
        const rs = await Promise.all([
          payReq(a, { idempotencyKey: key }),
          payReq(b, { idempotencyKey: key }),
        ]);
        expect(rs.some((r) => r.status >= 500)).toBe(false);
        expect(statuses(rs)).toEqual([201, 409]);
        expect(codes(rs, 409)).toEqual(['IDEMPOTENT_MISMATCH']);
        expect(
          await countRows(h, T, 'SELECT count(*) AS n FROM payment WHERE idempotency_key = $1', [
            key,
          ]),
        ).toBe(1);
      }
    }, 60000);

    it('payment vs void: never both succeed', async () => {
      for (let round = 0; round < 8; round += 1) {
        const bill = await fin(T, round % 4);
        const voidReq = request(http())
          .post(`/api/v1/bills/${bill.id}/void`)
          .set(bearer(T))
          .send({ expectedVersion: bill.version, reason: 'Wrong table' });
        const [pay, vd] = await Promise.all([payReq(bill), voidReq]);
        expect(pay.status).toBeLessThan(500);
        expect(vd.status).toBeLessThan(500);
        const after = await getBill(h, T, bill.id);
        if (pay.status === 201) {
          expect(vd.status).toBe(409); // BILL_NOT_VOIDABLE (PAID) or VERSION_CONFLICT
          expect(after.status).toBe('PAID');
        } else {
          expect(vd.status).toBe(200);
          expect(pay.status).toBe(409);
          expect(after.status).toBe('VOID');
          expect(after.paidPaise).toBe(0);
        }
        expect(
          await countRows(h, T, 'SELECT count(*) AS n FROM payment WHERE bill_id = $1', [bill.id]),
        ).toBe(after.status === 'PAID' ? 1 : 0);
      }
    }, 90000);
  });

  // ==========================================================================
  describe('settlement trigger with no service lock (raw parallel INSERTs)', () => {
    async function finBill(): Promise<BillView> {
      const o = await newOrder(1);
      return finalizeBill(h, T, await draftOf([o.id], o.sessionId));
    }
    const rawInsert = async (
      bill: BillView,
      amount: number,
      by: string,
    ): Promise<{ code?: string } | null> => {
      const err = await sqlError(h, T.tenantId, (tx) =>
        tx.query(
          `INSERT INTO payment (id, tenant_id, bill_id, amount_paise, method, received_by, idempotency_key, idempotency_fingerprint)
           VALUES ($1, $2, $3, $4, 'CASH', $5, $6, 'fp')`,
          [randomUUID(), T.tenantId, bill.id, amount, by, randomUUID()],
        ),
      );
      return err;
    };
    const userId = async (billId: string): Promise<string> =>
      asTenant(
        h,
        T.tenantId,
        async (tx) =>
          (
            await tx.query<{ finalized_by: string }>(
              'SELECT finalized_by FROM bill WHERE id = $1',
              [billId],
            )
          ).rows[0]?.finalized_by as string,
      );

    it('six parallel full-amount inserts: one settles, the rest are rejected, paid == grand (no drift)', async () => {
      const bill = await finBill();
      const by = await userId(bill.id);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => rawInsert(bill, bill.grandTotalPaise, by)),
      );
      expect(results.filter((r) => r === null)).toHaveLength(1);
      for (const r of results.filter((x) => x !== null))
        expect(['RB020', 'RB021']).toContain(r?.code);
      const after = await getBill(h, T, bill.id);
      expect(after).toMatchObject({
        status: 'PAID',
        paidPaise: bill.grandTotalPaise,
        outstandingPaise: 0,
      });
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM payment WHERE bill_id = $1', [bill.id]),
      ).toBe(1);
    });

    it('double-spend: two parallel 60% inserts — the second is an OVERPAYMENT (lock first, then sum)', async () => {
      // If the trigger summed under the statement snapshot taken BEFORE waiting for the
      // bill lock, both inserts would commit (each seeing only itself) and paid_paise
      // would silently lag the ledger. Lock-then-sum makes the second one see the first.
      for (let round = 0; round < 6; round += 1) {
        const bill = await finBill();
        const by = await userId(bill.id);
        const part = Math.ceil(bill.grandTotalPaise * 0.6);
        const results = await Promise.all([rawInsert(bill, part, by), rawInsert(bill, part, by)]);
        expect(results.filter((r) => r === null)).toHaveLength(1);
        expect(results.find((r) => r !== null)?.code).toBe('RB021');
        const after = await getBill(h, T, bill.id);
        expect(after.paidPaise).toBe(part);
        const ledger = await countRows(
          h,
          T,
          'SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment WHERE bill_id = $1',
          [bill.id],
        );
        expect(ledger).toBe(after.paidPaise); // paid_paise == SUM(SUCCEEDED) under concurrency
      }
    }, 90000);

    it('N parallel partial inserts that exactly complete the bill: paid == SUM and the bill ends PAID', async () => {
      const bill = await finBill();
      const by = await userId(bill.id);
      const third = Math.floor(bill.grandTotalPaise / 3);
      const amounts = [third, third, bill.grandTotalPaise - 2 * third];
      const results = await Promise.all(amounts.map((a) => rawInsert(bill, a, by)));
      expect(results.every((r) => r === null)).toBe(true);
      const after = await getBill(h, T, bill.id);
      expect(after).toMatchObject({
        status: 'PAID',
        paidPaise: bill.grandTotalPaise,
        outstandingPaise: 0,
      });
      expect(
        await countRows(
          h,
          T,
          'SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment WHERE bill_id = $1',
          [bill.id],
        ),
      ).toBe(bill.grandTotalPaise);
    });
  });

  // ==========================================================================
  describe('sessions', () => {
    it('create draft vs session close: a closed session never holds a DRAFT (FOR SHARE vs FOR UPDATE)', async () => {
      const t = await provisionTenant(h, 'sesscloserace');
      for (let round = 0; round < 4; round += 1) {
        const o = await createOrder(h, t, { tableIndex: round, lines: standardLines(t) });
        await completeOrder(h, t, o.id, o.version); // nothing blocks a normal close
        const draft = request(http())
          .post('/api/v1/bills')
          .set(bearer(t))
          .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [o.id] });
        const [d, c] = await Promise.all([draft, closeSession(h, t, o.sessionId)]);
        expect(d.status).toBeLessThan(500);
        expect(c.status).toBeLessThan(500);
        const drafts = await countRows(
          h,
          t,
          `SELECT count(*) AS n FROM bill WHERE table_session_id = $1 AND status = 'DRAFT'`,
          [o.sessionId],
        );
        const closed = await countRows(
          h,
          t,
          `SELECT count(*) AS n FROM table_session WHERE id = $1 AND status = 'CLOSED'`,
          [o.sessionId],
        );
        if (c.status === 200) {
          expect(closed).toBe(1);
          expect(drafts).toBe(0); // the draft lost: SESSION_CLOSED
          expect(d.status).toBe(409);
          expect(d.body.error.code).toBe('SESSION_CLOSED');
        } else {
          expect(c.status).toBe(409);
          expect(c.body.error.code).toBe('SESSION_HAS_DRAFT_BILLS');
          expect(d.status).toBe(201);
          expect(closed).toBe(0);
        }
      }
    }, 90000);

    it('create draft vs FORCE close: no DRAFT survives on the closed session', async () => {
      const t = await provisionTenant(h, 'forcecloserace');
      for (let round = 0; round < 4; round += 1) {
        const o = await createOrder(h, t, { tableIndex: round, lines: standardLines(t) });
        const draft = request(http())
          .post('/api/v1/bills')
          .set(bearer(t))
          .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [o.id] });
        const [d, c] = await Promise.all([draft, closeSession(h, t, o.sessionId, 'Guests left')]);
        expect(c.status).toBe(200);
        expect(d.status).toBeLessThan(500);
        expect(
          await countRows(
            h,
            t,
            `SELECT count(*) AS n FROM bill WHERE table_session_id = $1 AND status = 'DRAFT'`,
            [o.sessionId],
          ),
        ).toBe(0);
        expect([201, 409]).toContain(d.status);
      }
    }, 90000);
  });
});
