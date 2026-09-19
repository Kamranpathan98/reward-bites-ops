/**
 * Gate 8 — billing API behaviour (real NestJS app + real PostgreSQL):
 * draft / discount / finalize / void / discard, billed-order protection,
 * session-close blockers, live table counts, permissions and audit.
 *
 * DB-level invariants are attacked directly in gate8-db-guards; races live in
 * gate8-concurrency. This file proves the endpoints do what the plan says.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ADDON_PRICE,
  ITEM_PRICE,
  STANDARD_SUBTOTAL,
  auditActions,
  auditRows,
  bearer,
  billAction,
  boot,
  closeSession,
  completeOrder,
  countRows,
  createDraft,
  createOrder,
  describeIfDb,
  finalizeBill,
  getBill,
  inviteUser,
  liveTables,
  orderRow,
  patchDiscount,
  provisionTenant,
  recordPayment,
  setSetting,
  standardLines,
  warnIfSkipped,
  type BillView,
  type Harness,
  type Tenant,
} from './gate8-harness';

warnIfSkipped('gate8-billing.integration.spec');

describeIfDb('Gate 8 — billing API (real API + real Postgres)', () => {
  let h: Harness;
  let T: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    h = await boot();
    T = await provisionTenant(h, 'billing');
    other = await provisionTenant(h, 'billingother');
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  const http = (): ReturnType<Harness['app']['getHttpServer']> => h.app.getHttpServer();

  async function newOrder(
    tableIndex: number,
    t: Tenant = T,
  ): Promise<{ id: string; sessionId: string; version: number; subtotalPaise: number }> {
    return createOrder(h, t, { tableIndex, lines: standardLines(t) });
  }

  // ==========================================================================
  describe('draft creation', () => {
    it('builds one draft over several orders with an itemised snapshot and totals', async () => {
      const o1 = await newOrder(0);
      const o2 = await createOrder(h, T, {
        tableIndex: 0,
        lines: [{ itemId: T.cheapItemId, variantId: T.cheapVariantId, qty: 2 }],
      });
      expect(o2.sessionId).toBe(o1.sessionId);

      const res = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({
          idempotencyKey: randomUUID(),
          sessionId: o1.sessionId,
          orderIds: [o2.id, o1.id],
          customerName: 'Rahul',
        });
      expect(res.status).toBe(201);
      const bill = res.body.data as BillView & { customerName: string; tableSessionId: string };
      expect(bill.status).toBe('DRAFT');
      expect(bill.billNumber).toBeNull();
      expect(bill.customerName).toBe('Rahul');
      expect(bill.tableSessionId).toBe(o1.sessionId);
      expect([...bill.orderIds].sort()).toEqual([o1.id, o2.id].sort());
      // 49000 + 2 * 12000
      expect(bill.subtotalPaise).toBe(STANDARD_SUBTOTAL + 24000);
      expect(bill.discountPaise).toBe(0);
      expect(bill.roundingPaise).toBe(0);
      expect(bill.grandTotalPaise).toBe(73000);
      expect(bill.paidPaise).toBe(0);
      expect(bill.outstandingPaise).toBe(73000);
      // ITEM + ADDON rows for order 1 (2 lines + 1 add-on), ITEM for order 2
      expect(bill.lines.filter((l) => l.lineKind === 'ITEM')).toHaveLength(3);
      expect(bill.lines.filter((l) => l.lineKind === 'ADDON')).toHaveLength(1);
      expect(bill.lines.reduce((s, l) => s + l.lineTotalPaise, 0)).toBe(bill.subtotalPaise);
    });

    it('does NOT link orders or change the session at draft time', async () => {
      const o = await newOrder(0);
      await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      expect((await orderRow(h, T, o.id)).bill_id).toBeNull();
      const s = await countRows(
        h,
        T,
        `SELECT count(*) AS n FROM table_session WHERE id = $1 AND status = 'OPEN'`,
        [o.sessionId],
      );
      expect(s).toBe(1);
    });

    it('allows several drafts per session, even over the same order', async () => {
      const o = await newOrder(1);
      const a = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const b = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      expect(a.id).not.toBe(b.id);
      expect(a.status).toBe('DRAFT');
      expect(b.status).toBe('DRAFT');
    });

    it('is idempotent: replay returns the original with Idempotent-Replay, a different body is IDEMPOTENT_MISMATCH', async () => {
      const o = await newOrder(1);
      const key = randomUUID();
      const body = { idempotencyKey: key, sessionId: o.sessionId, orderIds: [o.id] };
      const first = await request(http()).post('/api/v1/bills').set(bearer(T)).send(body);
      expect(first.status).toBe(201);
      const replay = await request(http()).post('/api/v1/bills').set(bearer(T)).send(body);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replay']).toBe('true');
      expect(replay.body.data.id).toBe(first.body.data.id);

      const mismatch = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ ...body, customerName: 'Someone else' });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.error.code).toBe('IDEMPOTENT_MISMATCH');
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM bill WHERE idempotency_key = $1', [key]),
      ).toBe(1);
    });

    it('still replays the ORIGINAL draft after its orders were billed', async () => {
      const o = await newOrder(1);
      const key = randomUUID();
      const draft = await createDraft(h, T, {
        sessionId: o.sessionId,
        orderIds: [o.id],
        idempotencyKey: key,
      });
      await finalizeBill(h, T, draft);
      const replay = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: key, sessionId: o.sessionId, orderIds: [o.id] });
      expect(replay.status).toBe(200);
      expect(replay.body.data.id).toBe(draft.id);
    });

    it('fingerprints orderIds in sorted order (same set, different order = same request)', async () => {
      const a = await newOrder(1);
      const b = await newOrder(1);
      const key = randomUUID();
      const first = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: key, sessionId: a.sessionId, orderIds: [a.id, b.id] });
      const second = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: key, sessionId: a.sessionId, orderIds: [b.id, a.id] });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
    });

    it('rejects invalid drafts with the specific error codes', async () => {
      const o = await newOrder(2);
      const otherSession = await newOrder(3);
      const mixed = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({
          idempotencyKey: randomUUID(),
          sessionId: o.sessionId,
          orderIds: [o.id, otherSession.id],
        });
      expect(mixed.status).toBe(422);
      expect(mixed.body.error.code).toBe('ORDER_NOT_BILLABLE');

      const cancelled = await newOrder(2);
      await request(http())
        .post(`/api/v1/orders/${cancelled.id}/cancel`)
        .set(bearer(T))
        .send({ expectedVersion: cancelled.version, reason: 'Guest left' });
      const c = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({
          idempotencyKey: randomUUID(),
          sessionId: cancelled.sessionId,
          orderIds: [cancelled.id],
        });
      expect(c.status).toBe(422);
      expect(c.body.error.code).toBe('ORDER_NOT_BILLABLE');

      const billed = await newOrder(2);
      await finalizeBill(
        h,
        T,
        await createDraft(h, T, { sessionId: billed.sessionId, orderIds: [billed.id] }),
      );
      const again = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: randomUUID(), sessionId: billed.sessionId, orderIds: [billed.id] });
      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe('ORDER_ALREADY_BILLED');

      const missing = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [randomUUID()] });
      expect(missing.status).toBe(404);

      const dup = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [o.id, o.id] });
      expect(dup.status).toBe(400);
      const empty = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [] });
      expect(empty.status).toBe(400);
    });

    it("cannot bill another tenant's orders or sessions (404)", async () => {
      const foreign = await newOrder(0, other);
      const res = await request(http())
        .post('/api/v1/bills')
        .set(bearer(T))
        .send({
          idempotencyKey: randomUUID(),
          sessionId: foreign.sessionId,
          orderIds: [foreign.id],
        });
      expect(res.status).toBe(404);
    });

    it('refuses to draft on a closed session (SESSION_CLOSED)', async () => {
      const S = await provisionTenant(h, 'closedsession'); // its own tenant: a clean, closable session
      const o = await newOrder(0, S);
      await completeOrder(h, S, o.id, o.version);
      expect((await closeSession(h, S, o.sessionId)).status).toBe(200);
      const res = await request(http())
        .post('/api/v1/bills')
        .set(bearer(S))
        .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [o.id] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SESSION_CLOSED');
    });
  });

  // ==========================================================================
  describe('discounts', () => {
    async function draft(tableIndex = 1): Promise<BillView> {
      const o = await newOrder(tableIndex);
      return createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
    }

    it('applies a percent discount half-up to the paise and rounds the total to the rupee', async () => {
      const d = await draft();
      // 12.34% of 49000 = 6046.6 -> 6047; P = 42953; remainder 53 -> +47 -> grand 43000
      const res = await patchDiscount(h, T, d.id, {
        expectedVersion: d.version,
        discount: { kind: 'PERCENT', value: 1234, reason: 'Regular' },
      });
      expect(res.status).toBe(200);
      const b = res.body.data as BillView;
      expect(b.discountPaise).toBe(6047);
      expect(b.roundingPaise).toBe(47);
      expect(b.grandTotalPaise).toBe(43000);
      expect(b.outstandingPaise).toBe(43000);
      expect(b.version).toBe(d.version + 1);
      expect(b.adjustments).toHaveLength(1);
      expect(b.adjustments[0]).toMatchObject({
        kind: 'DISCOUNT_PERCENT',
        basisBp: 1234,
        amountPaise: 6047,
      });
    });

    it('applies a fixed discount and replaces it in place (still one adjustment)', async () => {
      const d = await draft();
      const one = await patchDiscount(h, T, d.id, {
        expectedVersion: d.version,
        discount: { kind: 'FIXED', value: 5000 },
      });
      expect(one.status).toBe(200);
      const two = await patchDiscount(h, T, d.id, {
        expectedVersion: one.body.data.version,
        discount: { kind: 'PERCENT', value: 1000 },
      });
      const b = two.body.data as BillView;
      expect(b.adjustments).toHaveLength(1);
      expect(b.adjustments[0]?.kind).toBe('DISCOUNT_PERCENT');
      expect(b.discountPaise).toBe(4900);
      const audits = await auditRows(h, T, d.id, 'discount_applied');
      expect(audits).toHaveLength(2);
      expect(audits[1]?.before).toMatchObject({ kind: 'DISCOUNT_FIXED', amountPaise: 5000 }); // the replaced discount is preserved in the audit trail
    });

    it('removes a discount by deleting the DRAFT adjustment and audits discount_removed', async () => {
      const d = await draft();
      const applied = await patchDiscount(h, T, d.id, {
        expectedVersion: d.version,
        discount: { kind: 'FIXED', value: 4900 },
      });
      const removed = await patchDiscount(h, T, d.id, {
        expectedVersion: applied.body.data.version,
        discount: null,
      });
      expect(removed.status).toBe(200);
      const b = removed.body.data as BillView;
      expect(b.adjustments).toHaveLength(0);
      expect(b.discountPaise).toBe(0);
      expect(b.grandTotalPaise).toBe(STANDARD_SUBTOTAL);
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM bill_adjustment WHERE bill_id = $1', [
          d.id,
        ]),
      ).toBe(0);
      const rows = await auditRows(h, T, d.id, 'discount_removed');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.before).toMatchObject({ kind: 'DISCOUNT_FIXED', amountPaise: 4900 });
      expect(rows[0]?.after).toMatchObject({ discountPaise: 0 });
    });

    it('enforces max_discount_bp exactly at the boundary (DISCOUNT_EXCEEDS_CAP)', async () => {
      const d = await draft();
      const ok = await patchDiscount(h, T, d.id, {
        expectedVersion: d.version,
        discount: { kind: 'PERCENT', value: 5000 },
      });
      expect(ok.status).toBe(200);
      const over = await patchDiscount(h, T, d.id, {
        expectedVersion: ok.body.data.version,
        discount: { kind: 'PERCENT', value: 5001 },
      });
      expect(over.status).toBe(422);
      expect(over.body.error.code).toBe('DISCOUNT_EXCEEDS_CAP');
      // fixed: 50% of 49000 = 24500 allowed, 24501 not
      const fixedOk = await patchDiscount(h, T, d.id, {
        expectedVersion: ok.body.data.version,
        discount: { kind: 'FIXED', value: 24500 },
      });
      expect(fixedOk.status).toBe(200);
      const fixedOver = await patchDiscount(h, T, d.id, {
        expectedVersion: fixedOk.body.data.version,
        discount: { kind: 'FIXED', value: 24501 },
      });
      expect(fixedOver.status).toBe(422);
      expect(fixedOver.body.error.code).toBe('DISCOUNT_EXCEEDS_CAP');
    });

    it('is version-guarded and DRAFT-only', async () => {
      const d = await draft();
      const stale = await patchDiscount(h, T, d.id, {
        expectedVersion: d.version + 5,
        discount: { kind: 'FIXED', value: 100 },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      const fin = await finalizeBill(h, T, d);
      const late = await patchDiscount(h, T, d.id, {
        expectedVersion: fin.version,
        discount: { kind: 'FIXED', value: 100 },
      });
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('BILL_NOT_DRAFT');
      // a stale client retrying after finalize sees the version conflict, not silent success
      const retry = await patchDiscount(h, T, d.id, {
        expectedVersion: d.version,
        discount: { kind: 'FIXED', value: 100 },
      });
      expect(retry.status).toBe(409);
    });

    it('validates the request shape and needs bills.discount', async () => {
      const d = await draft();
      expect(
        (
          await patchDiscount(h, T, d.id, {
            expectedVersion: d.version,
            discount: { kind: 'BOGO', value: 1 },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await patchDiscount(h, T, d.id, {
            expectedVersion: d.version,
            discount: { kind: 'PERCENT', value: 0 },
          })
        ).status,
      ).toBe(400);
      const kitchen = await inviteUser(h, T, 'Kitchen Staff');
      expect(
        (
          await patchDiscount(h, kitchen.token, d.id, {
            expectedVersion: d.version,
            discount: null,
          })
        ).status,
      ).toBe(403);
    });
  });

  // ==========================================================================
  describe('finalize', () => {
    it('freezes the bill: number, snapshot, order links, version bump', async () => {
      const o = await newOrder(2);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const f = await finalizeBill(h, T, d);
      expect(f.status).toBe('FINALIZED');
      expect(f.billNumber).toBeGreaterThan(0);
      expect(f.grandTotalPaise).toBe(d.grandTotalPaise);
      expect(f.version).toBe(d.version + 1);
      const row = await orderRow(h, T, o.id);
      expect(row.bill_id).toBe(f.id);
      expect(row.version).toBe(o.version + 1);
      // bill_order is the historical association and stays
      expect(
        await countRows(
          h,
          T,
          'SELECT count(*) AS n FROM bill_order WHERE bill_id = $1 AND order_id = $2',
          [f.id, o.id],
        ),
      ).toBe(1);
      expect(await auditActions(h, T, f.id)).toEqual(['created', 'finalized']);
    });

    it('assigns bill numbers monotonically increasing per tenant (gaps are acceptable)', async () => {
      const numbers: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const o = await newOrder(2);
        numbers.push(
          (
            await finalizeBill(
              h,
              T,
              await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] }),
            )
          ).billNumber as number,
        );
      }
      for (let i = 1; i < numbers.length; i += 1)
        expect(numbers[i] as number).toBeGreaterThan(numbers[i - 1] as number);
      // A different tenant has its own sequence (per-tenant counter).
      const o = await newOrder(0, other);
      const first = await finalizeBill(
        h,
        other,
        await createDraft(h, other, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      expect(first.billNumber).toBe(1);
    });

    it('rejects a stale total (BILL_TOTALS_CHANGED) and a stale version', async () => {
      const o = await newOrder(2);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const wrongTotal = await billAction(h, T, d.id, 'finalize', {
        expectedVersion: d.version,
        expectedGrandTotalPaise: d.grandTotalPaise + 100,
      });
      expect(wrongTotal.status).toBe(409);
      expect(wrongTotal.body.error.code).toBe('BILL_TOTALS_CHANGED');
      const wrongVersion = await billAction(h, T, d.id, 'finalize', {
        expectedVersion: d.version + 3,
        expectedGrandTotalPaise: d.grandTotalPaise,
      });
      expect(wrongVersion.status).toBe(409);
      expect(wrongVersion.body.error.code).toBe('VERSION_CONFLICT');
      expect((await getBill(h, T, d.id)).status).toBe('DRAFT'); // nothing was written
    });

    it('re-copies the lines from the CURRENT order at finalize (a stale draft is caught, then fixed)', async () => {
      const o = await newOrder(2);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      // the order is still editable: an unbilled order is not locked by a draft
      const edit = await request(http())
        .patch(`/api/v1/orders/${o.id}/lines`)
        .set(bearer(T))
        .send({
          expectedVersion: o.version,
          add: [{ itemId: T.cheapItemId, variantId: T.cheapVariantId, qty: 1 }],
        });
      expect(edit.status).toBe(200);

      const stale = await billAction(h, T, d.id, 'finalize', {
        expectedVersion: d.version,
        expectedGrandTotalPaise: d.grandTotalPaise,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('BILL_TOTALS_CHANGED');
      expect(stale.body.error.details).toBeUndefined(); // (details are field errors only; the message carries the rest)

      const fresh = await finalizeBill(h, T, { ...d, grandTotalPaise: d.grandTotalPaise + 12000 });
      expect(fresh.subtotalPaise).toBe(d.subtotalPaise + 12000);
      expect(fresh.lines.reduce((s, l) => s + l.lineTotalPaise, 0)).toBe(fresh.subtotalPaise);
    });

    it('re-derives a percent discount on the rebuilt subtotal', async () => {
      const o = await newOrder(2);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const withDiscount = (
        await patchDiscount(h, T, d.id, {
          expectedVersion: d.version,
          discount: { kind: 'PERCENT', value: 1000 },
        })
      ).body.data as BillView;
      expect(withDiscount.discountPaise).toBe(4900);
      const f = await finalizeBill(h, T, withDiscount);
      expect(f.discountPaise).toBe(4900);
      expect(f.adjustments[0]?.amountPaise).toBe(4900);
      expect(f.grandTotalPaise).toBe(44100);
    });

    it('rejects a zero-total bill (BILL_TOTAL_NOT_POSITIVE) — zero bills are unsupported in V1', async () => {
      const t = await provisionTenant(h, 'zerototal');
      await setSetting(h, t, 'max_discount_bp', 10000);
      const o = await createOrder(h, t, { tableIndex: 0, lines: standardLines(t) });
      const d = await createDraft(h, t, { sessionId: o.sessionId, orderIds: [o.id] });
      const full = (
        await patchDiscount(h, t, d.id, {
          expectedVersion: d.version,
          discount: { kind: 'PERCENT', value: 10000 },
        })
      ).body.data as BillView;
      expect(full.grandTotalPaise).toBe(0);
      const res = await billAction(h, t, d.id, 'finalize', {
        expectedVersion: full.version,
        expectedGrandTotalPaise: 0,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BILL_TOTAL_NOT_POSITIVE');
    });

    it('does not round when round_to_rupee is off (the setting is honoured)', async () => {
      const t = await provisionTenant(h, 'noround');
      await setSetting(h, t, 'round_to_rupee', false);
      const o = await createOrder(h, t, { tableIndex: 0, lines: standardLines(t) });
      const d = await createDraft(h, t, { sessionId: o.sessionId, orderIds: [o.id] });
      const applied = (
        await patchDiscount(h, t, d.id, {
          expectedVersion: d.version,
          discount: { kind: 'PERCENT', value: 1234 },
        })
      ).body.data as BillView;
      expect(applied.roundingPaise).toBe(0);
      expect(applied.grandTotalPaise).toBe(49000 - 6047);
    });

    it('defaults round_to_rupee to true for new tenants (canonical V1 default)', async () => {
      const v = await countRows(
        h,
        T,
        'SELECT count(*) AS n FROM tenant_settings WHERE tenant_id = $1 AND round_to_rupee = true',
        [T.tenantId],
      );
      expect(v).toBe(1);
    });
  });

  // ==========================================================================
  describe('billed-order protection (service level)', () => {
    it('rejects edit, cancel and reopen of a billed order with 422 ORDER_ALREADY_BILLED — even with a stale version', async () => {
      const o = await newOrder(2);
      const v = await completeOrder(h, T, o.id, o.version);
      const f = await finalizeBill(
        h,
        T,
        await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      expect(f.status).toBe('FINALIZED');

      const stale = await request(http())
        .patch(`/api/v1/orders/${o.id}/lines`)
        .set(bearer(T))
        .send({
          expectedVersion: 0,
          add: [{ itemId: T.cheapItemId, variantId: T.cheapVariantId, qty: 1 }],
        });
      expect(stale.status).toBe(422);
      expect(stale.body.error.code).toBe('ORDER_ALREADY_BILLED'); // not VERSION_CONFLICT: billed is checked first

      const cancel = await request(http())
        .post(`/api/v1/orders/${o.id}/cancel`)
        .set(bearer(T))
        .send({ expectedVersion: v + 1, reason: 'x' });
      expect(cancel.status).toBe(422);
      expect(cancel.body.error.code).toBe('ORDER_ALREADY_BILLED');

      const reopen = await request(http())
        .post(`/api/v1/orders/${o.id}/reopen`)
        .set(bearer(T))
        .send({ expectedVersion: v + 1 });
      expect(reopen.status).toBe(422);
      expect(reopen.body.error.code).toBe('ORDER_ALREADY_BILLED');
    });

    it('exposes the bill link on the order and keeps forward transitions working', async () => {
      const o = await newOrder(2);
      const f = await finalizeBill(
        h,
        T,
        await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      const detail = await request(http()).get(`/api/v1/orders/${o.id}`).set(bearer(T));
      expect(detail.body.data.billId).toBe(f.id);
      const list = await request(http()).get('/api/v1/orders').set(bearer(T));
      expect(
        (list.body.data as Array<{ id: string; billId: string | null }>).find((x) => x.id === o.id)
          ?.billId,
      ).toBe(f.id);
      const moved = await request(http())
        .post(`/api/v1/orders/${o.id}/transition`)
        .set(bearer(T))
        .send({ to: 'ACCEPTED', expectedVersion: detail.body.data.version });
      expect(moved.status).toBe(200);
    });
  });

  // ==========================================================================
  describe('void and discard', () => {
    it('voids a FINALIZED bill: unlinks orders, keeps bill_order history, freezes the snapshot', async () => {
      const o = await newOrder(3);
      const f = await finalizeBill(
        h,
        T,
        await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      const res = await billAction(h, T, f.id, 'void', {
        expectedVersion: f.version,
        reason: 'Wrong table billed',
      });
      expect(res.status).toBe(200);
      const v = res.body.data as BillView & { voidReason: string };
      expect(v.status).toBe('VOID');
      expect(v.billNumber).toBe(f.billNumber); // a voided bill keeps its number
      expect(v.grandTotalPaise).toBe(f.grandTotalPaise);
      expect(v.voidReason).toBe('Wrong table billed');
      const row = await orderRow(h, T, o.id);
      expect(row.bill_id).toBeNull();
      expect(row.version).toBe(o.version + 2); // link (+1) and unlink (+1)
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM bill_order WHERE bill_id = $1', [f.id]),
      ).toBe(1); // history retained
      expect(await auditActions(h, T, f.id)).toEqual(['created', 'finalized', 'voided']);
    });

    it('lets the same order be re-billed after a void: one order, several bill_order rows, one current bill', async () => {
      const o = await newOrder(3);
      const first = await finalizeBill(
        h,
        T,
        await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      await billAction(h, T, first.id, 'void', { expectedVersion: first.version, reason: 'Redo' });
      const edit = await request(http())
        .patch(`/api/v1/orders/${o.id}/lines`)
        .set(bearer(T))
        .send({
          expectedVersion: o.version + 2,
          add: [{ itemId: T.cheapItemId, variantId: T.cheapVariantId, qty: 1 }],
        });
      expect(edit.status).toBe(200); // editable again once unbilled
      const second = await finalizeBill(
        h,
        T,
        await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      expect(second.billNumber).toBeGreaterThan(first.billNumber as number);
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM bill_order WHERE order_id = $1', [o.id]),
      ).toBe(2);
      expect((await orderRow(h, T, o.id)).bill_id).toBe(second.id); // orders.bill_id is the current link
      // the voided bill's snapshot is untouched by the re-bill
      expect((await getBill(h, T, first.id)).grandTotalPaise).toBe(first.grandTotalPaise);
    });

    it('refuses to void a DRAFT, a PAID or an already VOID bill, and needs a reason', async () => {
      const o = await newOrder(3);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const onDraft = await billAction(h, T, d.id, 'void', {
        expectedVersion: d.version,
        reason: 'x',
      });
      expect(onDraft.status).toBe(409);
      expect(onDraft.body.error.code).toBe('BILL_NOT_VOIDABLE');

      const f = await finalizeBill(h, T, d);
      const noReason = await billAction(h, T, f.id, 'void', { expectedVersion: f.version });
      expect(noReason.status).toBe(400);
      const blank = await billAction(h, T, f.id, 'void', {
        expectedVersion: f.version,
        reason: '   ',
      });
      expect(blank.status).toBe(400);

      const paid = await recordPayment(h, T, {
        idempotencyKey: randomUUID(),
        billId: f.id,
        method: 'CASH',
        amountPaise: f.grandTotalPaise,
        expectedBillVersion: f.version,
      });
      expect(paid.status).toBe(201);
      const onPaid = await billAction(h, T, f.id, 'void', {
        expectedVersion: paid.body.data.bill.version,
        reason: 'x',
      });
      expect(onPaid.status).toBe(409);
      expect(onPaid.body.error.code).toBe('BILL_NOT_VOIDABLE');
    });

    it('discards a DRAFT without touching its orders, and the orders can be drafted again', async () => {
      const o = await newOrder(3);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      const res = await billAction(h, T, d.id, 'discard', { expectedVersion: d.version });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DISCARDED');
      expect(res.body.data.billNumber).toBeNull();
      expect((await orderRow(h, T, o.id)).bill_id).toBeNull();
      expect(
        await countRows(h, T, 'SELECT count(*) AS n FROM bill_order WHERE bill_id = $1', [d.id]),
      ).toBe(1); // history retained
      const again = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
      expect(again.status).toBe('DRAFT');
      expect(await auditActions(h, T, d.id)).toEqual(['created', 'discarded']);
      // terminal: cannot be discarded twice, finalized or discounted
      expect(
        (await billAction(h, T, d.id, 'discard', { expectedVersion: d.version + 1 })).status,
      ).toBe(409);
    });
  });

  // ==========================================================================
  describe('reads', () => {
    it('lists with filters and cursor pagination, and returns detail with lines', async () => {
      const t = await provisionTenant(h, 'listing');
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const o = await createOrder(h, t, { tableIndex: i % 4, lines: standardLines(t) });
        created.push((await createDraft(h, t, { sessionId: o.sessionId, orderIds: [o.id] })).id);
      }
      const first = await request(http()).get('/api/v1/bills?limit=2').set(bearer(t));
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.meta.nextCursor).toBeTruthy();
      const seen = new Set<string>(first.body.data.map((b: { id: string }) => b.id));
      let cursor = first.body.meta.nextCursor as string | null;
      while (cursor) {
        const page = await request(http())
          .get(`/api/v1/bills?limit=2&cursor=${encodeURIComponent(cursor)}`)
          .set(bearer(t));
        for (const b of page.body.data as Array<{ id: string }>) {
          expect(seen.has(b.id)).toBe(false); // no duplicates across pages
          seen.add(b.id);
        }
        cursor = page.body.meta.nextCursor;
      }
      expect([...seen].sort()).toEqual([...created].sort());

      const drafts = await request(http()).get('/api/v1/bills?status=DRAFT').set(bearer(t));
      expect(drafts.body.data.length).toBe(5);
      const paidOnly = await request(http()).get('/api/v1/bills?status=PAID').set(bearer(t));
      expect(paidOnly.body.data).toHaveLength(0);
      const detail = await request(http()).get(`/api/v1/bills/${created[0]}`).set(bearer(t));
      expect(detail.body.data.lines.length).toBeGreaterThan(0);
      expect((await request(http()).get('/api/v1/bills/not-a-uuid').set(bearer(t))).status).toBe(
        400,
      );
      expect(
        (await request(http()).get(`/api/v1/bills/${randomUUID()}`).set(bearer(t))).status,
      ).toBe(404);
    });
  });

  // ==========================================================================
  describe('session close and live table counts', () => {
    // Each test gets its own tenant: a session is per table, so reusing the shared
    // tenant's tables would leave earlier tests' open orders / drafts blocking the close.
    let S: Tenant;
    beforeEach(async () => {
      S = await provisionTenant(h, 'sessclose');
    }, 30000);

    it('blocks a normal close on open orders, DRAFT bills and unpaid bills, and allows it once settled', async () => {
      const o = await newOrder(0, S);
      const open = await closeSession(h, S, o.sessionId);
      expect(open.status).toBe(409);
      expect(open.body.error.code).toBe('SESSION_HAS_OPEN_ORDERS');

      await completeOrder(h, S, o.id, o.version);
      const draft = await createDraft(h, S, { sessionId: o.sessionId, orderIds: [o.id] });
      const withDraft = await closeSession(h, S, o.sessionId);
      expect(withDraft.status).toBe(409);
      expect(withDraft.body.error.code).toBe('SESSION_HAS_DRAFT_BILLS');

      const fin = await finalizeBill(h, S, draft);
      const unpaid = await closeSession(h, S, o.sessionId);
      expect(unpaid.status).toBe(409);
      expect(unpaid.body.error.code).toBe('SESSION_HAS_UNPAID_BILLS');

      const paid = await recordPayment(h, S, {
        idempotencyKey: randomUUID(),
        billId: fin.id,
        method: 'CASH',
        amountPaise: fin.grandTotalPaise,
        expectedBillVersion: fin.version,
      });
      expect(paid.status).toBe(201);
      // payment never auto-closes the session
      expect(
        await countRows(
          h,
          S,
          `SELECT count(*) AS n FROM table_session WHERE id = $1 AND status = 'OPEN'`,
          [o.sessionId],
        ),
      ).toBe(1);
      expect((await closeSession(h, S, o.sessionId)).status).toBe(200);
    });

    it('does not block on DISCARDED and VOID bills or terminal orders', async () => {
      const o = await newOrder(0, S);
      await completeOrder(h, S, o.id, o.version);
      const d1 = await createDraft(h, S, { sessionId: o.sessionId, orderIds: [o.id] });
      await billAction(h, S, d1.id, 'discard', { expectedVersion: d1.version });
      const d2 = await finalizeBill(
        h,
        S,
        await createDraft(h, S, { sessionId: o.sessionId, orderIds: [o.id] }),
      );
      await billAction(h, S, d2.id, 'void', { expectedVersion: d2.version, reason: 'Wrong table' });
      expect((await closeSession(h, S, o.sessionId)).status).toBe(200);
    });

    it('force-close bypasses the blockers, DISCARDs draft bills (audited) and leaves FINALIZED bills payable', async () => {
      const o = await newOrder(0, S);
      const draft = await createDraft(h, S, { sessionId: o.sessionId, orderIds: [o.id] });
      const o2 = await newOrder(0, S);
      const fin = await finalizeBill(
        h,
        S,
        await createDraft(h, S, { sessionId: o2.sessionId, orderIds: [o2.id] }),
      );

      const forced = await closeSession(h, S, o.sessionId, 'Guests left');
      expect(forced.status).toBe(200);
      expect((await getBill(h, S, draft.id)).status).toBe('DISCARDED');
      expect((await getBill(h, S, fin.id)).status).toBe('FINALIZED'); // untouched
      expect(await auditActions(h, S, draft.id)).toContain('discarded');
      expect(
        await countRows(
          h,
          S,
          `SELECT count(*) AS n FROM table_session WHERE id = $1 AND status = 'CLOSED' AND force_closed`,
          [o.sessionId],
        ),
      ).toBe(1);

      // money owed on a closed session can still be collected (payment needs no OPEN session)
      const paid = await recordPayment(h, S, {
        idempotencyKey: randomUUID(),
        billId: fin.id,
        method: 'CASH',
        amountPaise: fin.grandTotalPaise,
        expectedBillVersion: fin.version,
      });
      expect(paid.status).toBe(201);
      // ...but nothing new can be drafted on it
      const late = await request(http())
        .post('/api/v1/bills')
        .set(bearer(S))
        .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [o.id] });
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('SESSION_CLOSED');
    });

    it('wires GET /tables/live: active orders (billed or not) and the outstanding of FINALIZED bills only', async () => {
      const t = await provisionTenant(h, 'live');
      const tableId = t.tableIds[0] as string;
      const find = async () => (await liveTables(h, t)).find((x) => x.id === tableId)?.openSession;
      expect(await find()).toBeNull();

      const a = await createOrder(h, t, { tableIndex: 0, lines: standardLines(t) }); // NEW
      const b = await createOrder(h, t, {
        tableIndex: 0,
        lines: [{ itemId: t.cheapItemId, variantId: t.cheapVariantId, qty: 1 }],
      });
      expect(await find()).toMatchObject({ openOrderCount: 2, unpaidBillTotalPaise: 0 });

      await completeOrder(h, t, b.id, b.version); // terminal orders do not count
      expect(await find()).toMatchObject({ openOrderCount: 1, unpaidBillTotalPaise: 0 });

      const draft = await createDraft(h, t, { sessionId: a.sessionId, orderIds: [a.id] });
      expect(await find()).toMatchObject({ openOrderCount: 1, unpaidBillTotalPaise: 0 }); // DRAFT is not receivable

      const fin = await finalizeBill(h, t, draft);
      // billed but still operationally active (NEW): still counts as open
      expect(await find()).toMatchObject({
        openOrderCount: 1,
        unpaidBillTotalPaise: fin.grandTotalPaise,
      });

      await recordPayment(h, t, {
        idempotencyKey: randomUUID(),
        billId: fin.id,
        method: 'CASH',
        amountPaise: fin.grandTotalPaise,
        expectedBillVersion: fin.version,
      });
      expect(await find()).toMatchObject({ openOrderCount: 1, unpaidBillTotalPaise: 0 });
    });
  });

  // ==========================================================================
  describe('permissions', () => {
    it('gives Kitchen Staff no access to bills or payments, and Cashier full access', async () => {
      const kitchen = await inviteUser(h, T, 'Kitchen Staff');
      const cashier = await inviteUser(h, T, 'Cashier');
      const o = await newOrder(3);
      const d = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });

      const denied = [
        request(http()).get('/api/v1/bills').set(bearer(kitchen.token)),
        request(http()).get(`/api/v1/bills/${d.id}`).set(bearer(kitchen.token)),
        request(http())
          .post('/api/v1/bills')
          .set(bearer(kitchen.token))
          .send({ idempotencyKey: randomUUID(), sessionId: o.sessionId, orderIds: [o.id] }),
        request(http())
          .post(`/api/v1/bills/${d.id}/finalize`)
          .set(bearer(kitchen.token))
          .send({ expectedVersion: 0, expectedGrandTotalPaise: 1 }),
        request(http())
          .post(`/api/v1/bills/${d.id}/discard`)
          .set(bearer(kitchen.token))
          .send({ expectedVersion: 0 }),
        request(http())
          .post(`/api/v1/bills/${d.id}/void`)
          .set(bearer(kitchen.token))
          .send({ expectedVersion: 0, reason: 'x' }),
        request(http()).get(`/api/v1/bills/${d.id}/payments`).set(bearer(kitchen.token)),
        request(http()).post('/api/v1/payments').set(bearer(kitchen.token)).send({
          idempotencyKey: randomUUID(),
          billId: d.id,
          method: 'CASH',
          amountPaise: 1,
          expectedBillVersion: 0,
        }),
      ];
      for (const res of await Promise.all(denied)) expect(res.status).toBe(403);

      const f = await request(http())
        .post(`/api/v1/bills/${d.id}/finalize`)
        .set(bearer(cashier.token))
        .send({ expectedVersion: d.version, expectedGrandTotalPaise: d.grandTotalPaise });
      expect(f.status).toBe(200);
      const paid = await recordPayment(h, cashier.token, {
        idempotencyKey: randomUUID(),
        billId: d.id,
        method: 'CASH',
        amountPaise: d.grandTotalPaise,
        expectedBillVersion: f.body.data.version,
      });
      expect(paid.status).toBe(201);
    });

    it('requires authentication', async () => {
      expect((await request(http()).get('/api/v1/bills')).status).toBe(401);
      expect((await request(http()).post('/api/v1/payments').send({})).status).toBe(401);
    });
  });

  it('keeps the standard fixture consistent with the price constants', () => {
    expect(STANDARD_SUBTOTAL).toBe(2 * ITEM_PRICE + ADDON_PRICE + 12000);
  });
});
