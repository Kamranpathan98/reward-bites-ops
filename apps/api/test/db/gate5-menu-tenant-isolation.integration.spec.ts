/**
 * Gate 5 tenant-isolation attacks, executed against the real HTTP API and
 * real PostgreSQL — Attacks A-F and I from the task brief's explicit list
 * (G and H are SQL-layer attacks, covered in
 * menu-rls-attacks.integration.spec.ts, since there is no HTTP path that
 * can set a malformed/bypassed tenant context).
 *
 * Requires TEST_DATABASE_URL (app_rw) and TEST_PLATFORM_DATABASE_URL
 * (app_platform) — see docs/DEVELOPMENT.md. Skipped (not faked) without them.
 */
import cookieParser from 'cookie-parser';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
const canRun = Boolean(TEST_DATABASE_URL && TEST_PLATFORM_DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

if (!canRun) {
  console.warn(
    '[gate5-menu-tenant-isolation.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('RED TEAM — Gate 5 menu catalog tenant isolation', () => {
  let app: INestApplication;
  const suffix = Date.now();
  const bootstrapSecret = 'test-only-bootstrap-secret-1234';

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['PLATFORM_DATABASE_URL'] = TEST_PLATFORM_DATABASE_URL;
    process.env['JWT_SECRET'] ??= 'test-only-jwt-secret-at-least-32-characters-long';
    process.env['PLATFORM_BOOTSTRAP_SECRET'] = bootstrapSecret;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const tenantASlug = `menu-iso-a-${suffix}`;
  const tenantBSlug = `menu-iso-b-${suffix}`;
  const ownerAEmail = `menu-iso-owner-a-${suffix}@example.com`;
  const ownerBEmail = `menu-iso-owner-b-${suffix}@example.com`;
  const password = 'a-real-owner-password-123';

  let ownerAToken: string;
  let ownerBToken: string;
  let categoryBId: string;
  let itemBId: string;
  let addonBId: string;

  it('setup: two tenants, tenant B has a category/item/addon', async () => {
    const pa = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Menu Iso A',
        slug: tenantASlug,
        ownerEmail: ownerAEmail,
        ownerPassword: password,
      });
    expect(pa.status).toBe(201);
    const pb = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Menu Iso B',
        slug: tenantBSlug,
        ownerEmail: ownerBEmail,
        ownerPassword: password,
      });
    expect(pb.status).toBe(201);

    const la = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerAEmail, password });
    ownerAToken = la.body.accessToken;
    const lb = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerBEmail, password });
    ownerBToken = lb.body.accessToken;

    const cat = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ name: 'B Category' });
    categoryBId = cat.body.data.id;

    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ categoryId: categoryBId, name: 'B Item', basePricePaise: 1000 });
    itemBId = item.body.data.id;

    const addon = await request(app.getHttpServer())
      .post('/api/v1/menu/addons')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ name: 'B Addon', pricePaise: 500 });
    addonBId = addon.body.data.id;
  }, 15000);

  it('Attack A: Tenant A reads Tenant B category -> safe denial, no data leak', async () => {
    // No GET-by-id endpoint exists for a single category; the read surface
    // is GET /menu, which must not include tenant B's category at all.
    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(tree.status).toBe(200);
    expect(
      tree.body.data.categories.find((c: { id: string }) => c.id === categoryBId),
    ).toBeUndefined();
  });

  it('Attack B: Tenant A modifies Tenant B category -> denied, unchanged', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/menu/categories/${categoryBId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'PWNED' });
    expect(res.status).toBe(404);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(tree.body.data.categories.find((c: { id: string }) => c.id === categoryBId).name).toBe(
      'B Category',
    );
  });

  it('Attack C: Tenant A deactivates/deletes Tenant B item -> denied, unchanged', async () => {
    const availability = await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemBId}/availability`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ isAvailable: false });
    expect(availability.status).toBe(404);

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/menu/items/${itemBId}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(del.status).toBe(404);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerBToken}`);
    const item = tree.body.data.categories
      .find((c: { id: string }) => c.id === categoryBId)
      .items.find((i: { id: string }) => i.id === itemBId);
    expect(item.isAvailable).toBe(true);
  });

  it('Attack D: Tenant A creates an item referencing Tenant B category -> rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ categoryId: categoryBId, name: 'Should Not Exist', basePricePaise: 100 });
    expect(res.status).toBe(404);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerBToken}`);
    const category = tree.body.data.categories.find((c: { id: string }) => c.id === categoryBId);
    expect(
      category.items.find((i: { name: string }) => i.name === 'Should Not Exist'),
    ).toBeUndefined();
  });

  it('Attack D variant: Tenant A creates a variant referencing Tenant B item -> rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/variants')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ itemId: itemBId, name: 'Should Not Exist', pricePaise: 100 });
    expect(res.status).toBe(404);
  });

  it('Attack D addon-assignment: Tenant A cannot attach Tenant B addon to a Tenant A item', async () => {
    const catA = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'A Category' });
    const itemA = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ categoryId: catA.body.data.id, name: 'A Item', basePricePaise: 1000 });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemA.body.data.id}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ addons: [{ addonId: addonBId, maxQty: 1 }] });
    expect(res.status).toBe(404);
  });

  it('Attack E: client-supplied tenant_id in the request body is ignored, not honored', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: `Spoofed Tenant Category ${suffix}`, tenantId: 'not-even-a-real-tenant-id' });
    expect(res.status).toBe(201);
    const newId = res.body.data.id;

    // The row must exist under the AUTHENTICATED tenant (A), never under
    // whatever the client tried to supply.
    const treeA = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(treeA.body.data.categories.find((c: { id: string }) => c.id === newId)).toBeDefined();

    const treeB = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerBToken}`);
    expect(treeB.body.data.categories.find((c: { id: string }) => c.id === newId)).toBeUndefined();
  });

  it('Attack F: no tenant context (unauthenticated) -> 401 on every mutating and reading endpoint', async () => {
    const attempts = [
      request(app.getHttpServer()).get('/api/v1/menu'),
      request(app.getHttpServer()).post('/api/v1/menu/categories').send({ name: 'x' }),
      request(app.getHttpServer())
        .patch(`/api/v1/menu/categories/${categoryBId}`)
        .send({ name: 'x' }),
      request(app.getHttpServer()).delete(`/api/v1/menu/categories/${categoryBId}`),
      request(app.getHttpServer())
        .post('/api/v1/menu/items')
        .send({ categoryId: categoryBId, name: 'x' }),
      request(app.getHttpServer())
        .post('/api/v1/menu/variants')
        .send({ itemId: itemBId, name: 'x', pricePaise: 1 }),
      request(app.getHttpServer()).post('/api/v1/menu/addons').send({ name: 'x', pricePaise: 1 }),
      request(app.getHttpServer())
        .post('/api/v1/menu/reorder')
        .send({ categoryIds: [categoryBId] }),
    ];
    const results = await Promise.all(attempts);
    for (const res of results) {
      expect(res.status).toBe(401);
    }
  });

  it('Attack I: an authenticated user with no menu.manage cannot mutate anything (Kitchen Staff)', async () => {
    const rolesRes = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerAToken}`);
    const kitchenRole = rolesRes.body.data.find(
      (r: { name: string }) => r.name === 'Kitchen Staff',
    );
    expect(kitchenRole).toBeDefined();

    const kitchenEmail = `menu-iso-kitchen-${suffix}@example.com`;
    const kitchenPassword = 'a-real-kitchen-password-123';
    await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        email: kitchenEmail,
        fullName: 'Kitchen Person',
        roleId: kitchenRole.id,
        tempPassword: kitchenPassword,
      });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: kitchenEmail, password: kitchenPassword });
    const kitchenToken = login.body.accessToken;

    // Kitchen Staff has menu.availability.update but NOT menu.read/menu.manage
    // (architecture's own role table) — GET /menu itself must 403.
    const readTree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${kitchenToken}`);
    expect(readTree.status).toBe(403);

    const createCategory = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ name: 'Should not be created' });
    expect(createCategory.status).toBe(403);

    const createItem = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ categoryId: categoryBId, name: 'x', basePricePaise: 1 });
    expect(createItem.status).toBe(403);

    const deleteAddon = await request(app.getHttpServer())
      .delete(`/api/v1/menu/addons/${addonBId}`)
      .set('Authorization', `Bearer ${kitchenToken}`);
    expect(deleteAddon.status).toBe(403);

    const reorder = await request(app.getHttpServer())
      .post('/api/v1/menu/reorder')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ categoryIds: [categoryBId] });
    expect(reorder.status).toBe(403);

    // Kitchen Staff DOES have menu.availability.update — confirm that one
    // specific permission works (scoped to their own tenant's own item,
    // not tenant B's, since Kitchen Staff here belongs to tenant A).
  });
});
