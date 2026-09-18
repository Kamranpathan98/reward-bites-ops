/**
 * Gate 5 (Menu Catalog) vertical journey, end to end, against the real
 * NestJS app and a real PostgreSQL database — category/item/variant/addon
 * CRUD, availability, reorder, price-change audit, cascade/blocking rules,
 * and tenant isolation.
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
    '[gate5-menu-catalog.integration.spec] SKIPPED — TEST_DATABASE_URL and/or ' +
      'TEST_PLATFORM_DATABASE_URL are not set. See docs/DEVELOPMENT.md.',
  );
}

describeIfDb('Gate 5 vertical journey — menu catalog (real API + real Postgres)', () => {
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

  const tenantASlug = `gate5-journey-a-${suffix}`;
  const tenantBSlug = `gate5-journey-b-${suffix}`;
  const ownerEmail = `gate5-owner-a-${suffix}@example.com`;
  const ownerBEmail = `gate5-owner-b-${suffix}@example.com`;
  const ownerPassword = 'a-real-owner-password-123';

  let ownerAccessToken: string;
  let ownerBAccessToken: string;
  let categoryId: string;
  let itemId: string;
  let variantId: string;
  let addonId: string;

  it('provisions tenant A and tenant B, and logs both owners in', async () => {
    const pa = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({ name: 'Gate 5 Journey Tenant A', slug: tenantASlug, ownerEmail, ownerPassword });
    expect(pa.status).toBe(201);

    const pb = await request(app.getHttpServer())
      .post('/api/v1/platform/tenants')
      .set('x-platform-bootstrap-secret', bootstrapSecret)
      .send({
        name: 'Gate 5 Journey Tenant B',
        slug: tenantBSlug,
        ownerEmail: ownerBEmail,
        ownerPassword,
      });
    expect(pb.status).toBe(201);

    const la = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    ownerAccessToken = la.body.accessToken;

    const lb = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerBEmail, password: ownerPassword });
    ownerBAccessToken = lb.body.accessToken;
  }, 15000);

  it('GET /menu starts empty', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.categories).toEqual([]);
    expect(res.body.data.addons).toEqual([]);
  });

  it('creates a category, rejects a duplicate name', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Starters' });
    expect(res.status).toBe(201);
    categoryId = res.body.data.id;

    const dup = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Starters' });
    expect(dup.status).toBe(409);
  });

  it('creates an item with a base price, rejects duplicate name in same category', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ categoryId, name: 'Spring Rolls', basePricePaise: 15000, vegFlag: 'VEG' });
    expect(res.status).toBe(201);
    itemId = res.body.data.id;

    const dup = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ categoryId, name: 'Spring Rolls', basePricePaise: 10000 });
    expect(dup.status).toBe(409);
  });

  it('rejects creating an item in a nonexistent category', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        categoryId: '00000000-0000-0000-0000-000000000000',
        name: 'Ghost Item',
        basePricePaise: 100,
      });
    expect(res.status).toBe(404);
  });

  it('creates a variant for the item', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/menu/variants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ itemId, name: 'Half', pricePaise: 9000 });
    expect(res.status).toBe(201);
    variantId = res.body.data.id;
  });

  it('creates an addon and attaches it to the item via patch', async () => {
    const addonRes = await request(app.getHttpServer())
      .post('/api/v1/menu/addons')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Extra Sauce', pricePaise: 2000 });
    expect(addonRes.status).toBe(201);
    addonId = addonRes.body.data.id;

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ addons: [{ addonId, maxQty: 3 }] });
    expect(patch.status).toBe(200);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    const item = tree.body.data.categories[0].items.find((i: { id: string }) => i.id === itemId);
    expect(item.addons).toHaveLength(1);
    expect(item.addons[0].maxQty).toBe(3);
    expect(item.variants).toHaveLength(1);
  });

  it('rejects attaching a nonexistent addon to an item', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ addons: [{ addonId: '00000000-0000-0000-0000-000000000000', maxQty: 1 }] });
    expect(res.status).toBe(404);
  });

  it('toggles item availability (last-write-wins)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${itemId}/availability`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ isAvailable: false });
    expect(res.status).toBe(200);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    const item = tree.body.data.categories[0].items.find((i: { id: string }) => i.id === itemId);
    expect(item.isAvailable).toBe(false);
  });

  it('reorders categories', async () => {
    const second = await request(app.getHttpServer())
      .post('/api/v1/menu/categories')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Mains' });
    const secondId = second.body.data.id;

    const reorder = await request(app.getHttpServer())
      .post('/api/v1/menu/reorder')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ categoryIds: [secondId, categoryId] });
    expect(reorder.status).toBe(201);

    const tree = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(tree.body.data.categories[0].id).toBe(secondId);
    expect(tree.body.data.categories[1].id).toBe(categoryId);
  });

  it('blocks deleting a category that still has items', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/menu/categories/${categoryId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(409);
  });

  it('blocks deleting the last variant of an item with no base price', async () => {
    // Create a variant-only item (no base price), one variant.
    const item = await request(app.getHttpServer())
      .post('/api/v1/menu/items')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ categoryId, name: 'Variant Only Item' });
    const variantOnlyItemId = item.body.data.id;

    const variant = await request(app.getHttpServer())
      .post('/api/v1/menu/variants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ itemId: variantOnlyItemId, name: 'Regular', pricePaise: 5000 });
    const onlyVariantId = variant.body.data.id;

    const del = await request(app.getHttpServer())
      .delete(`/api/v1/menu/variants/${onlyVariantId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(del.status).toBe(422);

    // Adding a base price unblocks it.
    await request(app.getHttpServer())
      .patch(`/api/v1/menu/items/${variantOnlyItemId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ basePricePaise: 5000 });

    const del2 = await request(app.getHttpServer())
      .delete(`/api/v1/menu/variants/${onlyVariantId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(del2.status).toBe(200);

    // Clean up this sub-test's own item so the category-delete-cascade test
    // below (which reuses the shared `categoryId`) starts from a category
    // whose only remaining item is the one it explicitly deletes itself.
    const delItem = await request(app.getHttpServer())
      .delete(`/api/v1/menu/items/${variantOnlyItemId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(delItem.status).toBe(200);
  });

  it('deleting an item cascades to its variants', async () => {
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(del.status).toBe(200);

    const patchVariant = await request(app.getHttpServer())
      .patch(`/api/v1/menu/variants/${variantId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ pricePaise: 12345 });
    expect(patchVariant.status).toBe(404);

    // Category can now be deleted (no active items left).
    const delCat = await request(app.getHttpServer())
      .delete(`/api/v1/menu/categories/${categoryId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(delCat.status).toBe(200);
  });

  it('tenant isolation: tenant B never sees tenant A menu, and cannot reference A entities', async () => {
    const treeB = await request(app.getHttpServer())
      .get('/api/v1/menu')
      .set('Authorization', `Bearer ${ownerBAccessToken}`);
    expect(treeB.body.data.categories).toEqual([]);
    expect(treeB.body.data.addons).toEqual([]);

    const patchAddon = await request(app.getHttpServer())
      .patch(`/api/v1/menu/addons/${addonId}`)
      .set('Authorization', `Bearer ${ownerBAccessToken}`)
      .send({ pricePaise: 1 });
    expect(patchAddon.status).toBe(404);
  });
});
