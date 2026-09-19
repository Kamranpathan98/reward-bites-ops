import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  bearer,
  boot,
  describeIfDb,
  provisionTenant,
  warnIfSkipped,
  type Harness,
  type Tenant,
} from './gate8-harness';

warnIfSkipped('gate10-expenses.integration.spec');

describeIfDb('Gate 10 — Expenses & Categories API (real API + real PostgreSQL)', () => {
  let h: Harness;
  let T: Tenant;

  beforeAll(async () => {
    h = await boot();
    T = await provisionTenant(h, 'expenses');
  }, 60000);

  afterAll(async () => {
    await h.close();
  });

  const http = (): ReturnType<Harness['app']['getHttpServer']> => h.app.getHttpServer();

  describe('Default Expense Categories Seeding', () => {
    it('seeds the 9 canonical categories on tenant provisioning', async () => {
      const res = await request(http())
        .get('/api/v1/expense-categories')
        .set(bearer(T.token));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(9);

      const names = res.body.data.map((c: { name: string }) => c.name);
      expect(names).toContain('Ingredients & Groceries');
      expect(names).toContain('Dairy & Produce');
      expect(names).toContain('Utilities (Gas, Water, Electricity)');
      expect(names).toContain('Rent & Maintenance');
    });
  });

  describe('Expense Categories CRUD', () => {
    it('creates a custom category and rejects duplicate name within tenant', async () => {
      const createRes = await request(http())
        .post('/api/v1/expense-categories')
        .set(bearer(T.token))
        .send({
          name: 'Marketing & Ads',
          sortOrder: 15,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.name).toBe('Marketing & Ads');
      expect(createRes.body.data.sortOrder).toBe(15);
      expect(createRes.body.data.isActive).toBe(true);

      // Duplicate should return 409
      const dupRes = await request(http())
        .post('/api/v1/expense-categories')
        .set(bearer(T.token))
        .send({
          name: 'Marketing & Ads',
        });
      expect(dupRes.status).toBe(409);
    });

    it('updates category name and isActive flag', async () => {
      const cat = await request(http())
        .post('/api/v1/expense-categories')
        .set(bearer(T.token))
        .send({ name: 'Temp Category' });

      const catId = cat.body.data.id;

      const updateRes = await request(http())
        .patch(`/api/v1/expense-categories/${catId}`)
        .set(bearer(T.token))
        .send({
          name: 'Renamed Category',
          isActive: false,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Renamed Category');
      expect(updateRes.body.data.isActive).toBe(false);
    });

    it('soft deletes category without associated expenses', async () => {
      const cat = await request(http())
        .post('/api/v1/expense-categories')
        .set(bearer(T.token))
        .send({ name: 'To Be Deleted' });
      const catId = cat.body.data.id;

      const delRes = await request(http())
        .delete(`/api/v1/expense-categories/${catId}`)
        .set(bearer(T.token));
      expect(delRes.status).toBe(204);

      // Should not be found now
      const getRes = await request(http())
        .get(`/api/v1/expense-categories/${catId}`)
        .set(bearer(T.token));
      expect(getRes.status).toBe(404);
    });
  });

  describe('Expenses CRUD & Financial Invariants', () => {
    let categoryId: string;

    beforeAll(async () => {
      const res = await request(http())
        .get('/api/v1/expense-categories')
        .set(bearer(T.token));
      categoryId = res.body.data[0].id;
    });

    it('creates an expense with integer paise amount', async () => {
      const key = randomUUID();
      const res = await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send({
          idempotencyKey: key,
          categoryId,
          amountPaise: 45000, // ₹450.00
          expenseDate: '2026-09-19',
          description: 'Fresh vegetables supply',
          paymentMethod: 'CASH',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.amountPaise).toBe(45000);
      expect(res.body.data.description).toBe('Fresh vegetables supply');
      expect(res.body.data.version).toBe(0);
      expect(res.body.data.paymentMethod).toBe('CASH');
    });

    it('handles idempotency replay (same key + same body -> 200 OK)', async () => {
      const key = randomUUID();
      const payload = {
        idempotencyKey: key,
        categoryId,
        amountPaise: 25000,
        expenseDate: '2026-09-19',
        description: 'Gas refill',
        paymentMethod: 'UPI',
      };

      const first = await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send(payload);
      expect(first.status).toBe(201);

      const replay = await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send(payload);
      expect(replay.status).toBe(200);
      expect(replay.body.data.id).toBe(first.body.data.id);
    });

    it('rejects idempotency conflict (same key + different body -> 409 IDEMPOTENT_MISMATCH)', async () => {
      const key = randomUUID();
      await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send({
          idempotencyKey: key,
          categoryId,
          amountPaise: 10000,
          expenseDate: '2026-09-19',
          description: 'Paper towels',
          paymentMethod: 'CASH',
        });

      const conflict = await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send({
          idempotencyKey: key,
          categoryId,
          amountPaise: 12000, // changed amount!
          expenseDate: '2026-09-19',
          description: 'Paper towels',
          paymentMethod: 'CASH',
        });

      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENT_MISMATCH');
    });

    it('updates expense with optimistic concurrency locking (expectedVersion)', async () => {
      const key = randomUUID();
      const created = await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send({
          idempotencyKey: key,
          categoryId,
          amountPaise: 15000,
          expenseDate: '2026-09-19',
          description: 'Initial description',
          paymentMethod: 'CASH',
        });

      const expenseId = created.body.data.id;

      // Update with matching expectedVersion 0
      const updated = await request(http())
        .patch(`/api/v1/expenses/${expenseId}`)
        .set(bearer(T.token))
        .send({
          expectedVersion: 0,
          description: 'Updated description',
          amountPaise: 16000,
        });

      expect(updated.status).toBe(200);
      expect(updated.body.data.description).toBe('Updated description');
      expect(updated.body.data.amountPaise).toBe(16000);
      expect(updated.body.data.version).toBe(1);

      // Stale update with old expectedVersion 0 -> 409 VERSION_CONFLICT
      const stale = await request(http())
        .patch(`/api/v1/expenses/${expenseId}`)
        .set(bearer(T.token))
        .send({
          expectedVersion: 0,
          description: 'Stale description',
        });

      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('prevents deleting a category that has active expenses', async () => {
      const cat = await request(http())
        .post('/api/v1/expense-categories')
        .set(bearer(T.token))
        .send({ name: 'Category With Expenses' });
      const catId = cat.body.data.id;

      // Add expense to this category
      await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send({
          idempotencyKey: randomUUID(),
          categoryId: catId,
          amountPaise: 5000,
          expenseDate: '2026-09-19',
          description: 'Active expense',
          paymentMethod: 'CASH',
        });

      // Attempt deletion -> should fail with 400 CATEGORY_IN_USE
      const del = await request(http())
        .delete(`/api/v1/expense-categories/${catId}`)
        .set(bearer(T.token));

      expect(del.status).toBe(400);
      expect(del.body.error.code).toBe('CATEGORY_IN_USE');
    });

    it('prevents adding expense to inactive or deleted category via database trigger', async () => {
      const cat = await request(http())
        .post('/api/v1/expense-categories')
        .set(bearer(T.token))
        .send({ name: 'Inactive Cat', sortOrder: 50 });
      const catId = cat.body.data.id;

      // Deactivate
      await request(http())
        .patch(`/api/v1/expense-categories/${catId}`)
        .set(bearer(T.token))
        .send({ isActive: false });

      // Create expense referencing inactive category -> 400
      const expRes = await request(http())
        .post('/api/v1/expenses')
        .set(bearer(T.token))
        .send({
          idempotencyKey: randomUUID(),
          categoryId: catId,
          amountPaise: 3000,
          expenseDate: '2026-09-19',
          description: 'Attempt inactive',
          paymentMethod: 'CASH',
        });

      expect(expRes.status).toBe(400);
    });

    it('lists expenses with cursor pagination', async () => {
      const listRes = await request(http())
        .get('/api/v1/expenses?limit=5')
        .set(bearer(T.token));

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThan(0);
      expect(listRes.body.meta).toBeDefined();
    });
  });
});

