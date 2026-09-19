import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  bearer,
  boot,
  completeOrder,
  createDraft,
  createOrder,
  describeIfDb,
  finalizeBill,
  provisionTenant,
  recordPayment,
  standardLines,
  warnIfSkipped,
  type Harness,
  type Tenant,
} from './gate8-harness';

warnIfSkipped('gate10-dashboard.integration.spec');

describeIfDb('Gate 10 — Dashboard & Reporting API (real API + real PostgreSQL)', () => {
  let h: Harness;
  let T: Tenant;
  let categoryId: string;

  beforeAll(async () => {
    h = await boot();
    T = await provisionTenant(h, 'dashboard');

    // Get an expense category
    const catRes = await request(h.app.getHttpServer())
      .get('/api/v1/expense-categories')
      .set(bearer(T.token));
    categoryId = catRes.body.data[0].id;
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  const http = (): ReturnType<Harness['app']['getHttpServer']> => h.app.getHttpServer();

  it('computes live summary with independent CTEs and operating result', async () => {
    // 1. Create and complete an order
    const o = await createOrder(h, T, { tableIndex: 0, lines: standardLines(T) });

    // Transition order to COMPLETED using completeOrder helper from gate8-harness
    await completeOrder(h, T, o.id, o.version);

    // 2. Draft and finalize bill
    const draft = await createDraft(h, T, { sessionId: o.sessionId, orderIds: [o.id] });
    const bill = await finalizeBill(h, T, draft);

    // 3. Record payment for full outstanding amount (V1 full settlement)
    const payRes = await recordPayment(h, T, {
      idempotencyKey: randomUUID(),
      billId: bill.id,
      amountPaise: bill.outstandingPaise,
      method: 'CASH',
      expectedBillVersion: bill.version,
    });
    expect(payRes.status).toBe(201);

    // 4. Create a second finalized bill left UNPAID to verify outstandingPaise > 0
    const o2 = await createOrder(h, T, { tableIndex: 1, lines: standardLines(T) });
    await completeOrder(h, T, o2.id, o2.version);
    const draft2 = await createDraft(h, T, { sessionId: o2.sessionId, orderIds: [o2.id] });
    const bill2 = await finalizeBill(h, T, draft2);
    expect(bill2.outstandingPaise).toBeGreaterThan(0);

    // 4. Record an expense (e.g. ₹50.00)
    await request(http())
      .post('/api/v1/expenses')
      .set(bearer(T.token))
      .send({
        idempotencyKey: randomUUID(),
        categoryId,
        amountPaise: 5000,
        expenseDate: new Date().toISOString().substring(0, 10),
        description: 'Cooking oil',
        paymentMethod: 'CASH',
      });

    // 5. Query dashboard summary
    const res = await request(http())
      .get('/api/v1/dashboard/summary?period=today')
      .set(bearer(T.token));

    expect(res.status).toBe(200);
    const summary = res.body.data;
    expect(summary.period).toBe('today');
    expect(summary.orders.completed).toBeGreaterThanOrEqual(2);
    expect(summary.revenuePaise).toBe(bill.grandTotalPaise + bill2.grandTotalPaise);
    expect(summary.collectedPaise).toBeGreaterThanOrEqual(10000);
    expect(summary.collectedByMethod.cashPaise).toBeGreaterThanOrEqual(10000);
    expect(summary.outstandingPaise).toBe(bill2.outstandingPaise);
    expect(summary.expensesPaise).toBeGreaterThanOrEqual(5000);
    expect(summary.operatingResultPaise).toBe(summary.revenuePaise - summary.expensesPaise);
    expect(summary.disclaimer).toBeDefined();
  });

  it('queries breakdowns by type, source, method, and expense_category', async () => {
    const resType = await request(http())
      .get('/api/v1/dashboard/breakdown?period=today&by=type')
      .set(bearer(T.token));
    expect(resType.status).toBe(200);
    expect(resType.body.data.by).toBe('type');
    expect(Array.isArray(resType.body.data.items)).toBe(true);

    const resSource = await request(http())
      .get('/api/v1/dashboard/breakdown?period=today&by=source')
      .set(bearer(T.token));
    expect(resSource.status).toBe(200);
    expect(resSource.body.data.by).toBe('source');

    const resMethod = await request(http())
      .get('/api/v1/dashboard/breakdown?period=today&by=method')
      .set(bearer(T.token));
    expect(resMethod.status).toBe(200);
    expect(resMethod.body.data.by).toBe('method');

    const resExpense = await request(http())
      .get('/api/v1/dashboard/breakdown?period=today&by=expense_category')
      .set(bearer(T.token));
    expect(resExpense.status).toBe(200);
    expect(resExpense.body.data.by).toBe('expense_category');
  });
});

