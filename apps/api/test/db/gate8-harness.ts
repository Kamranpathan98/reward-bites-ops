/**
 * Shared harness for the Gate 8 (billing + payments) DB integration suites.
 * Not a test file (jest only matches *.spec.ts / *.test.ts). Everything runs
 * against the real NestJS app and a real PostgreSQL database, exactly like the
 * Gate 6/7 suites — see docs/DEVELOPMENT.md for TEST_DATABASE_URL.
 */
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { withTenantTx, type TransactionContext } from '../../src/common/db';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
export const TEST_PLATFORM_DATABASE_URL = process.env['TEST_PLATFORM_DATABASE_URL'];
export const canRunDb = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
/** `describe` that is skipped (loudly, never faked as passing) without a database. */
export const describeIfDb = canRunDb ? describe : describe.skip;

export function warnIfSkipped(file: string): void {
  if (!canRunDb) {
    console.warn(
      `[${file}] SKIPPED — TEST_DATABASE_URL and/or TEST_PLATFORM_DATABASE_URL are not set. ` +
        'See docs/DEVELOPMENT.md. These are NOT passing tests.',
    );
  }
}

const BOOTSTRAP_SECRET = 'test-only-bootstrap-secret-1234';
const OWNER_PASSWORD = 'a-real-owner-password-123';
let counter = 0;

export interface Harness {
  app: INestApplication;
  rw: Pool;
  close: () => Promise<void>;
}

export async function boot(): Promise<Harness> {
  process.env['DATABASE_URL'] = TEST_DATABASE_URL;
  process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
  process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
  process.env['PLATFORM_BOOTSTRAP_SECRET'] = BOOTSTRAP_SECRET;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  await app.init();
  const rw = new Pool({ connectionString: TEST_DATABASE_URL, max: 20 });
  return {
    app,
    rw,
    close: async () => {
      await app.close();
      await rw.end();
    },
  };
}

export interface Tenant {
  tenantId: string;
  token: string;
  email: string;
  tableIds: string[];
  /** ₹180.00 item, one add-on (₹10.00) assignable to it. */
  itemId: string;
  addonId: string;
  /** ₹120.00 item (variant-only), for a second, add-on-free line. */
  cheapItemId: string;
  cheapVariantId: string;
}

export const ITEM_PRICE = 18000;
export const ADDON_PRICE = 1000;
export const CHEAP_PRICE = 12000;

export async function provisionTenant(h: Harness, label: string): Promise<Tenant> {
  const n = `${Date.now()}${counter++}`;
  const email = `${label}-${n}@example.com`;
  const http = h.app.getHttpServer();
  const provision = await request(http)
    .post('/api/v1/platform/tenants')
    .set('x-platform-bootstrap-secret', BOOTSTRAP_SECRET)
    .send({
      name: `Gate8 ${label}`,
      slug: `g8-${label.toLowerCase()}-${n}`,
      ownerEmail: email,
      ownerPassword: OWNER_PASSWORD,
    });
  if (provision.status !== 201) throw new Error(`provision failed: ${provision.status}`);
  const tenantId = provision.body.data.tenantId as string;

  const login = await request(http)
    .post('/api/v1/auth/login')
    .send({ email, password: OWNER_PASSWORD });
  const token = login.body.accessToken as string;
  const auth = { Authorization: `Bearer ${token}` };

  const tableIds: string[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const t = await request(http)
      .post('/api/v1/tables')
      .set(auth)
      .send({ name: `T${i}-${n}` });
    tableIds.push(t.body.data.id as string);
  }
  const category = await request(http)
    .post('/api/v1/menu/categories')
    .set(auth)
    .send({ name: `Mains ${n}` });
  const categoryId = category.body.data.id as string;
  const item = await request(http)
    .post('/api/v1/menu/items')
    .set(auth)
    .send({ categoryId, name: `Butter Chicken ${n}`, basePricePaise: ITEM_PRICE });
  const itemId = item.body.data.id as string;
  const addon = await request(http)
    .post('/api/v1/menu/addons')
    .set(auth)
    .send({ name: `Extra Cheese ${n}`, pricePaise: ADDON_PRICE });
  const addonId = addon.body.data.id as string;
  await request(http)
    .patch(`/api/v1/menu/items/${itemId}`)
    .set(auth)
    .send({ addons: [{ addonId, maxQty: 5 }] });
  const cheap = await request(http)
    .post('/api/v1/menu/items')
    .set(auth)
    .send({ categoryId, name: `Naan ${n}` });
  const cheapItemId = cheap.body.data.id as string;
  const variant = await request(http)
    .post('/api/v1/menu/variants')
    .set(auth)
    .send({ itemId: cheapItemId, name: 'Garlic', pricePaise: CHEAP_PRICE });
  return {
    tenantId,
    token,
    email,
    tableIds,
    itemId,
    addonId,
    cheapItemId,
    cheapVariantId: variant.body.data.id as string,
  };
}

export const bearer = (t: Tenant | string): { Authorization: string } => ({
  Authorization: `Bearer ${typeof t === 'string' ? t : t.token}`,
});

export interface OrderLineSpec {
  itemId: string;
  variantId?: string;
  qty: number;
  addons?: Array<{ addonId: string; qty: number }>;
}

export async function createOrder(
  h: Harness,
  t: Tenant,
  spec: { tableIndex?: number; lines: OrderLineSpec[]; type?: 'DINE_IN' | 'TAKEAWAY' },
): Promise<{ id: string; sessionId: string; subtotalPaise: number; version: number }> {
  const type = spec.type ?? 'DINE_IN';
  const res = await request(h.app.getHttpServer())
    .post('/api/v1/orders')
    .set(bearer(t))
    .send({
      idempotencyKey: randomUUID(),
      type,
      ...(type === 'DINE_IN' ? { tableId: t.tableIds[spec.tableIndex ?? 0] } : {}),
      lines: spec.lines,
    });
  if (res.status !== 201)
    throw new Error(`createOrder failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.data.id,
    sessionId: res.body.data.tableSessionId,
    subtotalPaise: res.body.data.subtotalPaise,
    version: res.body.data.version,
  };
}

/** A standard order: 2 x Butter Chicken (+1 Extra Cheese) = 37000, 1 x Garlic Naan = 12000 => 49000. */
export function standardLines(t: Tenant): OrderLineSpec[] {
  return [
    { itemId: t.itemId, qty: 2, addons: [{ addonId: t.addonId, qty: 1 }] },
    { itemId: t.cheapItemId, variantId: t.cheapVariantId, qty: 1 },
  ];
}
export const STANDARD_SUBTOTAL = 2 * ITEM_PRICE + ADDON_PRICE + CHEAP_PRICE; // 49000

export interface BillView {
  id: string;
  version: number;
  status: string;
  billNumber: number | null;
  subtotalPaise: number;
  discountPaise: number;
  roundingPaise: number;
  grandTotalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  orderIds: string[];
  lines: Array<{
    id: string;
    lineKind: string;
    lineTotalPaise: number;
    qty: number;
    unitPricePaise: number;
    orderId: string;
    orderLineId: string;
    description: string;
  }>;
  adjustments: Array<{ id: string; kind: string; amountPaise: number; basisBp: number | null }>;
}

export async function createDraft(
  h: Harness,
  t: Tenant,
  spec: { sessionId: string; orderIds: string[]; idempotencyKey?: string; customerName?: string },
): Promise<BillView> {
  const res = await request(h.app.getHttpServer())
    .post('/api/v1/bills')
    .set(bearer(t))
    .send({
      idempotencyKey: spec.idempotencyKey ?? randomUUID(),
      sessionId: spec.sessionId,
      orderIds: spec.orderIds,
      ...(spec.customerName ? { customerName: spec.customerName } : {}),
    });
  if (res.status !== 201)
    throw new Error(`createDraft failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as BillView;
}

export async function finalizeBill(h: Harness, t: Tenant, bill: BillView): Promise<BillView> {
  const res = await request(h.app.getHttpServer())
    .post(`/api/v1/bills/${bill.id}/finalize`)
    .set(bearer(t))
    .send({ expectedVersion: bill.version, expectedGrandTotalPaise: bill.grandTotalPaise });
  if (res.status !== 200)
    throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as BillView;
}

export async function getBill(h: Harness, t: Tenant, id: string): Promise<BillView> {
  const res = await request(h.app.getHttpServer()).get(`/api/v1/bills/${id}`).set(bearer(t));
  return res.body.data as BillView;
}

export async function orderRow(
  h: Harness,
  t: Tenant,
  id: string,
): Promise<{ bill_id: string | null; version: number; status: string }> {
  return withTenantTx(h.rw, { tenantId: t.tenantId, actorKind: 'staff' }, async (tx) => {
    const r = await tx.query<{ bill_id: string | null; version: number; status: string }>(
      'SELECT bill_id, version, status FROM orders WHERE tenant_id = $1 AND id = $2',
      [t.tenantId, id],
    );
    return r.rows[0] as { bill_id: string | null; version: number; status: string };
  });
}

/** Runs SQL as app_rw inside a tenant transaction (RLS on, guards on). Rolls back on error. */
export function asTenant<T>(
  h: Harness,
  tenantId: string,
  fn: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  return withTenantTx(h.rw, { tenantId, actorKind: 'staff' }, fn);
}

export interface SqlFailure {
  code: string | undefined;
  message: string;
  constraint?: string | undefined;
}

/** Runs `fn` and returns the PostgreSQL error it raised (or null). The transaction is rolled back. */
export async function sqlError(
  h: Harness,
  tenantId: string,
  fn: (tx: TransactionContext) => Promise<unknown>,
): Promise<SqlFailure | null> {
  try {
    await asTenant(h, tenantId, fn);
    return null;
  } catch (err) {
    const e = err as { code?: string; message?: string; constraint?: string };
    return { code: e.code, message: e.message ?? '', constraint: e.constraint };
  }
}

export async function inviteUser(
  h: Harness,
  owner: Tenant,
  roleName: string,
): Promise<{ token: string; email: string }> {
  const http = h.app.getHttpServer();
  const roles = await request(http).get('/api/v1/roles').set(bearer(owner));
  const role = (roles.body.data as Array<{ id: string; name: string }>).find(
    (r) => r.name === roleName,
  );
  if (!role) throw new Error(`role ${roleName} not found`);
  const email = `${roleName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}${counter++}@example.com`;
  await request(http)
    .post('/api/v1/users/invite')
    .set(bearer(owner))
    .send({
      email,
      fullName: `${roleName} User`,
      roleId: role.id,
      tempPassword: 'a-temp-password-1234',
    });
  const login = await request(http)
    .post('/api/v1/auth/login')
    .send({ email, password: 'a-temp-password-1234' });
  return { token: login.body.accessToken as string, email };
}

export async function recordPayment(
  h: Harness,
  t: Tenant | string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(h.app.getHttpServer()).post('/api/v1/payments').set(bearer(t)).send(body);
}

/** Enable UPI for a tenant (there is no settings API in V1; the column default is upi_enabled = false). */
export async function enableUpi(h: Harness, t: Tenant): Promise<void> {
  await asTenant(h, t.tenantId, (tx) =>
    tx.query('UPDATE tenant_settings SET upi_enabled = true WHERE tenant_id = $1', [t.tenantId]),
  );
}

// ---------------------------------------------------------------------------
// Extra helpers used by the API + concurrency suites
// ---------------------------------------------------------------------------

export async function transitionOrder(
  h: Harness,
  t: Tenant | string,
  orderId: string,
  to: string,
  expectedVersion: number,
): Promise<request.Response> {
  return request(h.app.getHttpServer())
    .post(`/api/v1/orders/${orderId}/transition`)
    .set(bearer(t))
    .send({ to, expectedVersion });
}

export async function completeOrder(
  h: Harness,
  t: Tenant,
  orderId: string,
  version: number,
): Promise<number> {
  const res = await transitionOrder(h, t, orderId, 'COMPLETED', version);
  if (res.status !== 200)
    throw new Error(`complete failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.version as number;
}

export async function closeSession(
  h: Harness,
  t: Tenant | string,
  sessionId: string,
  reason?: string,
): Promise<request.Response> {
  return request(h.app.getHttpServer())
    .post(`/api/v1/sessions/${sessionId}/close`)
    .set(bearer(t))
    .send(reason ? { reason } : {});
}

export async function liveTables(
  h: Harness,
  t: Tenant,
): Promise<
  Array<{
    id: string;
    openSession: null | { id: string; openOrderCount: number; unpaidBillTotalPaise: number };
  }>
> {
  const res = await request(h.app.getHttpServer()).get('/api/v1/tables/live').set(bearer(t));
  return res.body.data;
}

export async function auditActions(h: Harness, t: Tenant, entityId: string): Promise<string[]> {
  return asTenant(h, t.tenantId, async (tx) => {
    const r = await tx.query<{ action: string }>(
      'SELECT action FROM audit_event WHERE entity_id = $1 ORDER BY at ASC, id ASC',
      [entityId],
    );
    return r.rows.map((x) => x.action);
  });
}

export async function auditRows(
  h: Harness,
  t: Tenant,
  entityId: string,
  action: string,
): Promise<Array<{ before: unknown; after: unknown }>> {
  return asTenant(h, t.tenantId, async (tx) => {
    const r = await tx.query<{ before: unknown; after: unknown }>(
      'SELECT before, after FROM audit_event WHERE entity_id = $1 AND action = $2 ORDER BY at ASC',
      [entityId, action],
    );
    return r.rows;
  });
}

export async function setSetting(
  h: Harness,
  t: Tenant,
  column:
    | 'max_discount_bp'
    | 'round_to_rupee'
    | 'upi_enabled'
    | 'upi_reference_required'
    | 'cash_enabled',
  value: number | boolean,
): Promise<void> {
  await asTenant(h, t.tenantId, (tx) =>
    tx.query(`UPDATE tenant_settings SET ${column} = $2 WHERE tenant_id = $1`, [t.tenantId, value]),
  );
}

export async function countRows(
  h: Harness,
  t: Tenant,
  sql: string,
  params: unknown[],
): Promise<number> {
  return asTenant(h, t.tenantId, async (tx) =>
    Number((await tx.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0),
  );
}

export async function patchDiscount(
  h: Harness,
  t: Tenant | string,
  billId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(h.app.getHttpServer())
    .patch(`/api/v1/bills/${billId}/adjustments`)
    .set(bearer(t))
    .send(body);
}

export async function billAction(
  h: Harness,
  t: Tenant | string,
  billId: string,
  action: 'finalize' | 'discard' | 'void',
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(h.app.getHttpServer())
    .post(`/api/v1/bills/${billId}/${action}`)
    .set(bearer(t))
    .send(body);
}
