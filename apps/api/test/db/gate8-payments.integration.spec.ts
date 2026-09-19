/**
 * Gate 8 — payment recording API (real NestJS app + real PostgreSQL): V1 full
 * settlement of FINALIZED bills, cash and static UPI only, idempotent on
 * (tenant, key, fingerprint), payments immutable.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  auditActions,
  bearer,
  boot,
  countRows,
  createDraft,
  createOrder,
  describeIfDb,
  enableUpi,
  finalizeBill,
  getBill,
  inviteUser,
  orderRow,
  provisionTenant,
  recordPayment,
  setSetting,
  standardLines,
  transitionOrder,
  warnIfSkipped,
  type BillView,
  type Harness,
  type Tenant,
} from './gate8-harness';

warnIfSkipped('gate8-payments.integration.spec');

describeIfDb('Gate 8 — payments API (real API + real Postgres)', () => {
  let h: Harness;
  let T: Tenant;

  beforeAll(async () => {
    h = await boot();
    T = await provisionTenant(h, 'payments');
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  const http = (): ReturnType<Harness['app']['getHttpServer']> => h.app.getHttpServer();

  async function finalized(
    t: Tenant = T,
    tableIndex = 0,
  ): Promise<{ bill: BillView; orderId: string; sessionId: string }> {
    const o = await createOrder(h, t, { tableIndex, lines: standardLines(t) });
    const bill = await finalizeBill(
      h,
      t,
      await createDraft(h, t, { sessionId: o.sessionId, orderIds: [o.id] }),
    );
    return { bill, orderId: o.id, sessionId: o.sessionId };
  }

  const pay = (
    t: Tenant | string,
    bill: BillView,
    over: Record<string, unknown> = {},
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
  describe('recording a payment', () => {
    it('settles a FINALIZED bill in cash: payment row, bill PAID, audit, no side effects on orders or the session', async () => {
      const { bill, orderId, sessionId } = await finalized();
      const before = await orderRow(h, T, orderId);
      const res = await pay(T, bill, { note: 'Paid at counter' });
      expect(res.status).toBe(201);
      const { payment, bill: settled } = res.body.data;
      expect(payment).toMatchObject({
        billId: bill.id,
        amountPaise: bill.grandTotalPaise,
        method: 'CASH',
        status: 'SUCCEEDED',
        provider: 'manual',
        providerReference: null,
        referenceNote: 'Paid at counter',
      });
      expect(payment.receivedBy).toBeTruthy();
      expect(payment.verifiedBy).toBe(payment.receivedBy); // cash: the cashier is receiver and verifier
      expect(settled).toMatchObject({
        status: 'PAID',
        paidPaise: bill.grandTotalPaise,
        outstandingPaise: 0,
        version: bill.version + 1,
      });
      expect(await auditActions(h, T, payment.id)).toEqual(['recorded']);

      // Payment never changes an order's status (ADR-025) and never closes the session.
      const after = await orderRow(h, T, orderId);
      expect(after.status).toBe(before.status);
      expect(after.version).toBe(before.version);
      expect(
        await countRows(
          h,
          T,
          `SELECT count(*) AS n FROM table_session WHERE id = $1 AND status = 'OPEN'`,
          [sessionId],
        ),
      ).toBe(1);

      const list = await request(http()).get(`/api/v1/bills/${bill.id}/payments`).set(bearer(T));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(payment.id);
    });

    it('never accepts or stores a cash-tendered amount (change-giving is UI-only)', async () => {
      const { bill } = await finalized();
      const res = await pay(T, bill, { cashTenderedPaise: 500000, changeReturnedPaise: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data.payment).not.toHaveProperty('cashTenderedPaise');
      const cols = await countRows(
        h,
        T,
        `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'payment' AND column_name IN ('cash_tendered_paise', 'change_returned_paise', 'updated_at')`,
        [],
      );
      expect(cols).toBe(0);
    });

    it('rejects partial payments, overpayments and non-positive amounts', async () => {
      const { bill } = await finalized();
      const partial = await pay(T, bill, { amountPaise: bill.grandTotalPaise - 100 });
      expect(partial.status).toBe(422);
      expect(partial.body.error.code).toBe('PARTIAL_PAYMENT_NOT_ENABLED');
      const over = await pay(T, bill, { amountPaise: bill.grandTotalPaise + 100 });
      expect(over.status).toBe(422);
      expect(over.body.error.code).toBe('OVERPAYMENT');
      for (const amountPaise of [0, -5, 1.5])
        expect((await pay(T, bill, { amountPaise })).status).toBe(400);
      expect((await getBill(h, T, bill.id)).paidPaise).toBe(0);
    });

    it('rejects unsupported methods (no CARD, no gateway) at the contract', async () => {
      const { bill } = await finalized();
      for (const method of ['CARD', 'UPI_GATEWAY', 'WALLET', 'cash']) {
        expect((await pay(T, bill, { method })).status).toBe(400);
      }
    });

    it('only pays a FINALIZED bill (BILL_NOT_PAYABLE) and checks expectedBillVersion (VERSION_CONFLICT)', async () => {
      const o = await createOrder(h, T, { tableIndex: 0, lines: standardLines(T) });
      const draft = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const onDraft = await pay(T, draft);
      expect(onDraft.status).toBe(409);
      expect(onDraft.body.error.code).toBe('BILL_NOT_PAYABLE');

      const { bill } = await finalized();
      const stale = await pay(T, bill, { expectedBillVersion: bill.version + 4 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');

      const paid = await pay(T, bill);
      expect(paid.status).toBe(201);
      const again = await pay(T, bill, { expectedBillVersion: paid.body.data.bill.version }); // a NEW key on a PAID bill
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('BILL_NOT_PAYABLE');

      const voided = await finalized();
      await request(http())
        .post(`/api/v1/bills/${voided.bill.id}/void`)
        .set(bearer(T))
        .send({ expectedVersion: voided.bill.version, reason: 'Wrong table' });
      const onVoid = await pay(T, voided.bill);
      expect(onVoid.status).toBe(409);
      expect(onVoid.body.error.code).toBe('BILL_NOT_PAYABLE');
    });

    it("404s another tenant's bill", async () => {
      const foreign = await provisionTenant(h, 'paymentsforeign');
      const f = await finalized(foreign);
      const res = await pay(T, f.bill);
      expect(res.status).toBe(404);
      expect(
        (await request(http()).get(`/api/v1/bills/${f.bill.id}/payments`).set(bearer(T))).status,
      ).toBe(404);
    });
  });

  // ==========================================================================
  describe('UPI (static) and the transaction reference', () => {
    it('is off by default (PAYMENT_METHOD_DISABLED) and requires a 12-digit UTR once on', async () => {
      const t = await provisionTenant(h, 'upi');
      const { bill } = await finalized(t);
      const off = await pay(t, bill, { method: 'UPI_STATIC', providerReference: '123456789012' });
      expect(off.status).toBe(422);
      expect(off.body.error.code).toBe('PAYMENT_METHOD_DISABLED');

      await enableUpi(h, t);
      const missing = await pay(t, bill, { method: 'UPI_STATIC' });
      expect(missing.status).toBe(422);
      expect(missing.body.error.code).toBe('PAYMENT_REFERENCE_REQUIRED');
      const blank = await pay(t, bill, { method: 'UPI_STATIC', providerReference: '   ' });
      expect(blank.body.error.code).toBe('PAYMENT_REFERENCE_REQUIRED');
      for (const bad of ['abc', '12345678901', '1234567890123', '12345678901a']) {
        const r = await pay(t, bill, { method: 'UPI_STATIC', providerReference: bad });
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('VALIDATION_FAILED');
      }
      const ok = await pay(t, bill, { method: 'UPI_STATIC', providerReference: '123456789012' });
      expect(ok.status).toBe(201);
      expect(ok.body.data.payment).toMatchObject({
        method: 'UPI_STATIC',
        providerReference: '123456789012',
      });
    });

    it('lets a tenant that turned the UTR requirement off pay without one', async () => {
      const t = await provisionTenant(h, 'upinoutr');
      await enableUpi(h, t);
      await setSetting(h, t, 'upi_reference_required', false);
      const { bill } = await finalized(t);
      expect((await pay(t, bill, { method: 'UPI_STATIC' })).status).toBe(201);
    });

    it('does not accept a transaction reference on a cash payment', async () => {
      const { bill } = await finalized();
      const res = await pay(T, bill, { method: 'CASH', providerReference: '123456789012' });
      expect(res.status).toBe(422);
    });

    it('honours cash_enabled = false', async () => {
      const t = await provisionTenant(h, 'nocash');
      await setSetting(h, t, 'cash_enabled', false);
      const { bill } = await finalized(t);
      const res = await pay(t, bill);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PAYMENT_METHOD_DISABLED');
    });
  });

  // ==========================================================================
  describe('idempotency (key + canonical fingerprint)', () => {
    it('replays the original payment with Idempotent-Replay and writes exactly one row', async () => {
      const { bill } = await finalized();
      const key = randomUUID();
      const first = await pay(T, bill, { idempotencyKey: key });
      expect(first.status).toBe(201);
      const replay = await pay(T, bill, { idempotencyKey: key });
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replay']).toBe('true');
      expect(replay.body.data.payment.id).toBe(first.body.data.payment.id);
      expect(replay.body.data.bill.status).toBe('PAID');
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM payment WHERE idempotency_key = $1', [
          key,
        ]),
      ).toBe(1);
    });

    it('replays a retry after success even though the bill is now PAID and the client still sends the old version', async () => {
      const { bill } = await finalized();
      const key = randomUUID();
      expect((await pay(T, bill, { idempotencyKey: key })).status).toBe(201);
      // A lost-response retry: same key, same body — must be a replay, not a 409/422.
      const retry = await pay(T, bill, { idempotencyKey: key, expectedBillVersion: bill.version });
      expect(retry.status).toBe(200);
      expect(retry.headers['idempotent-replay']).toBe('true');
    });

    it('rejects the same key with a different amount, method, reference or note (IDEMPOTENT_MISMATCH)', async () => {
      const t = await provisionTenant(h, 'idem');
      await enableUpi(h, t);
      const { bill } = await finalized(t);
      const key = randomUUID();
      expect((await pay(t, bill, { idempotencyKey: key, note: 'first' })).status).toBe(201);
      for (const change of [
        { note: 'second' },
        { note: undefined },
        { method: 'UPI_STATIC', providerReference: '123456789012' },
        { providerReference: '123456789012' },
      ]) {
        const r = await pay(t, bill, { idempotencyKey: key, note: 'first', ...change });
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('IDEMPOTENT_MISMATCH');
      }
    });

    it('rejects the same key against a different bill (IDEMPOTENT_MISMATCH)', async () => {
      const a = await finalized();
      const b = await finalized();
      const key = randomUUID();
      expect((await pay(T, a.bill, { idempotencyKey: key })).status).toBe(201);
      const r = await pay(T, b.bill, { idempotencyKey: key });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('IDEMPOTENT_MISMATCH');
      expect((await getBill(h, T, b.bill.id)).status).toBe('FINALIZED');
    });

    it('normalizes strings before fingerprinting (trim; empty = absent) and ignores expectedBillVersion', async () => {
      const t = await provisionTenant(h, 'norm');
      await enableUpi(h, t);
      const { bill } = await finalized(t);
      const key = randomUUID();
      const first = await pay(t, bill, {
        idempotencyKey: key,
        method: 'UPI_STATIC',
        providerReference: ' 123456789012 ',
        note: '  ',
      });
      expect(first.status).toBe(201);
      expect(first.body.data.payment.providerReference).toBe('123456789012'); // stored trimmed
      expect(first.body.data.payment.referenceNote).toBeNull();
      const replay = await pay(t, bill, {
        idempotencyKey: key,
        method: 'UPI_STATIC',
        providerReference: '123456789012',
        expectedBillVersion: bill.version + 99,
      });
      expect(replay.status).toBe(200);
    });

    it('scopes keys per tenant: another tenant may reuse the same key', async () => {
      const t2 = await provisionTenant(h, 'idemtwo');
      const a = await finalized();
      const b = await finalized(t2);
      const key = randomUUID();
      expect((await pay(T, a.bill, { idempotencyKey: key })).status).toBe(201);
      expect((await pay(t2, b.bill, { idempotencyKey: key })).status).toBe(201);
    });

    it('requires a UUID idempotency key', async () => {
      const { bill } = await finalized();
      expect((await pay(T, bill, { idempotencyKey: 'not-a-uuid' })).status).toBe(400);
      expect((await pay(T, bill, { idempotencyKey: undefined })).status).toBe(400);
    });
  });

  // ==========================================================================
  describe('immutability and permissions', () => {
    it('exposes no way to change or delete a payment', async () => {
      const { bill } = await finalized();
      const paid = await pay(T, bill);
      const id = paid.body.data.payment.id as string;
      for (const res of [
        await request(http())
          .patch(`/api/v1/payments/${id}`)
          .set(bearer(T))
          .send({ amountPaise: 1 }),
        await request(http()).put(`/api/v1/payments/${id}`).set(bearer(T)).send({ amountPaise: 1 }),
        await request(http()).delete(`/api/v1/payments/${id}`).set(bearer(T)),
        await request(http()).post(`/api/v1/payments/${id}/refund`).set(bearer(T)).send({}),
      ]) {
        expect([404, 405]).toContain(res.status);
      }
    });

    it('requires payments.record / payments.read', async () => {
      const kitchen = await inviteUser(h, T, 'Kitchen Staff');
      const cashier = await inviteUser(h, T, 'Cashier');
      const { bill } = await finalized();
      expect((await pay(kitchen.token, bill)).status).toBe(403);
      expect(
        (await request(http()).get(`/api/v1/bills/${bill.id}/payments`).set(bearer(kitchen.token)))
          .status,
      ).toBe(403);
      expect((await pay(cashier.token, bill)).status).toBe(201);
      expect(
        (await request(http()).get(`/api/v1/bills/${bill.id}/payments`).set(bearer(cashier.token)))
          .status,
      ).toBe(200);
    });

    it('lets the order keep moving after payment (KDS unaffected) and never auto-completes it', async () => {
      const { bill, orderId } = await finalized();
      await pay(T, bill);
      const row = await orderRow(h, T, orderId);
      expect(row.status).toBe('NEW');
      expect((await transitionOrder(h, T, orderId, 'ACCEPTED', row.version)).status).toBe(200);
    });
  });
});
