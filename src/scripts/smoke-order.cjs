// Multi-store checkout verification (GAP 2 fix).
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const db = new PrismaClient();

const BASE = 'http://localhost:3000';
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? '  -> ' + extra : ''));
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
async function q(pid) { return (await db.craftProduct.findUnique({ where: { id: pid }, select: { stock: true } })).stock; }

async function req(path, { method = 'POST', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

(async () => {
  const products = await db.craftProduct.findMany({
    where: { isActive: true, stock: { gt: 0 }, artisan: { status: 'active' } },
    select: { id: true, price: true, stock: true, artisanId: true },
  });
  const byArtisan = new Map();
  for (const p of products) {
    if (!byArtisan.has(p.artisanId)) byArtisan.set(p.artisanId, []);
    byArtisan.get(p.artisanId).push(p);
  }
  const withProducts = [...byArtisan.entries()].map(([aid, prods]) => ({ id: aid, products: prods }));
  if (withProducts.length < 2) {
    console.log('SKIP: need >=2 active artisans with in-stock products; found ' + withProducts.length);
    process.exit(0);
  }
  const storeA = withProducts[0];
  const storeB = withProducts[1];
  const pA = storeA.products[0];
  const pB = storeB.products[0];

  let user = await db.user.findFirst({ where: { role: 'customer', accountStatus: 'active' } });
  if (!user) {
    user = await db.user.create({
      data: { phone: '0770000' + Math.floor(Math.random() * 900 + 100), name: 'Smoke Customer', accountStatus: 'active', role: 'customer' },
    });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const mySessionHashes = [sha256(token)];
  await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 86400000) } });
  const cookie = 'wassilha_session=' + token;

  let r = await req('/api/craft/orders', { body: { items: [{ productId: pA.id, quantity: 1 }] } });
  check('guest POST order -> 401', r.status === 401, 'status=' + r.status);

  r = await req('/api/craft/orders', { body: { items: [] }, cookie });
  check('empty cart -> 400', r.status === 400, 'status=' + r.status);

  r = await req('/api/craft/orders', { body: { items: [{ productId: pA.id, quantity: 9999 }] }, cookie });
  check('qty 9999 -> 400 (schema max 100)', r.status === 400, 'status=' + r.status);

  r = await req('/api/craft/orders', {
    body: { items: [{ productId: pA.id, quantity: 1, unitPrice: 1, totalPrice: 1, price: 1 }] },
    cookie,
  });
  const tamperRes = r;
  const tamperOk = tamperRes.status === 201;
  check('client price fields ignored', tamperOk, 'status=' + tamperRes.status);
  if (tamperOk && tamperRes.body.orders) {
    // assert the stored unit price is the DB price, NOT the client-sent 1
    const persisted = await db.craftOrder.findUnique({
      where: { id: tamperRes.body.orders[0].id },
      select: { totalPrice: true, items: { select: { unitPrice: true } } },
    });
    check('stored unitPrice = DB price (not client 1)', !!persisted && persisted.items[0].unitPrice === pA.price && persisted.totalPrice === pA.price, JSON.stringify(persisted && persisted.items[0]));
    // deleting the order row does NOT undo the transactional stock decrement, so
    // we restore it explicitly here (1 unit of pA).
    await db.craftProduct.update({ where: { id: pA.id }, data: { stock: { increment: 1 } } }).catch(() => {});
    await db.craftOrder.deleteMany({ where: { id: { in: tamperRes.body.orders.map((o) => o.id) } } }).catch(() => {});
  }

  // adapt quantities to available stock (some handmade items have stock=1).
  // Re-read live stock: the tamper test above already consumed 1 unit of pA.
  const liveA = await q(pA.id), liveB = await q(pB.id);
  const qA = Math.min(2, liveA);
  const qB = Math.min(3, liveB);
  const expectTotal = pA.price * qA + pB.price * qB;

  r = await req('/api/craft/orders', {
    body: { items: [{ productId: pA.id, quantity: qA }, { productId: pB.id, quantity: qB }] },
    cookie,
  });
  const multi = r.body;
  check('multi-store -> 201', r.status === 201, 'status=' + r.status);
  check('response is { orders: [...] }', Array.isArray(multi.orders), 'orders=' + (multi.orders && multi.orders.length));
  if (multi.orders) {
    check('multi-store -> exactly 2 orders', multi.orders.length === 2, 'n=' + multi.orders.length);
    const oA = multi.orders.find((o) => o.artisan.id === storeA.id);
    const oB = multi.orders.find((o) => o.artisan.id === storeB.id);
    check('order A belongs to store A', !!oA && oA.artisan.id === storeA.id);
    check('order B belongs to store B', !!oB && oB.artisan.id === storeB.id);
    check('order A has only store-A item', !!oA && oA.items.length === 1 && oA.items[0].product.id === pA.id, oA && oA.items.map((i) => i.quantity).join(','));
    check('order A qty=' + qA, !!oA && oA.items[0].quantity === qA);
    check('order B qty=' + qB, !!oB && oB.items[0].quantity === qB);
    check('order A total = priceA*qA', !!oA && oA.totalPrice === pA.price * qA, oA && oA.totalPrice);
    check('order B total = priceB*qB', !!oB && oB.totalPrice === pB.price * qB, oB && oB.totalPrice);
    check('sum matches cart total', oA && oB && oA.totalPrice + oB.totalPrice === expectTotal, (oA && oA.totalPrice) + '+' + (oB && oB.totalPrice) + '=' + expectTotal);
    check('orders have distinct codes', oA && oB && oA.code !== oB.code, oA && oA.code + ' / ' + oB.code);
    check('orders start HIRFA-', oA && /^HIRFA-/.test(oA.code));
  }

  const afterA = await q(pA.id), afterB = await q(pB.id);
  check('stock A decremented by ' + qA, afterA === liveA - qA, afterA + ' vs ' + liveA);
  check('stock B decremented by ' + qB, afterB === liveB - qB, afterB + ' vs ' + liveB);

  // overstock: request current-stock+1, but the zod schema caps quantity at 100.
  // For high-stock items (>100) we cannot reach the stock check without tripping
  // the schema check first, so we only assert when it is actually reachable.
  let overQ = 0;
  let overCode = null;
  const liveA2 = await q(pA.id);
  if (liveA2 + 1 <= 100) {
    overQ = liveA2 + 1;
    r = await req('/api/craft/orders', { body: { items: [{ productId: pA.id, quantity: overQ }] }, cookie });
    if (r.status === 201 && r.body.orders) overCode = r.body.orders[0].code;
    check('overstock -> 409 insufficientStock', r.status === 409 && r.body.error === 'insufficientStock', 'status=' + r.status + ' err=' + r.body.error);
  } else {
    check('overstock -> 409 insufficientStock (skipped: stock>100)', true, 'stock=' + liveA2);
  }

  r = await req('/api/craft/orders', { body: { items: [{ productId: 'cixxxxxxxxxxxxxxxxxx', quantity: 1 }] }, cookie });
  check('nonexistent product -> 400 productNotFound', r.status === 400 && r.body.error === 'productNotFound', 'status=' + r.status);

  // artisan A visibility
  const artUser = await db.user.findUnique({ where: { id: (await db.artisanProfile.findUnique({ where: { id: storeA.id }, select: { userId: true } })).userId } });
  if (artUser) {
    const atok = crypto.randomBytes(32).toString('hex');
    mySessionHashes.push(sha256(atok));
    await db.session.create({ data: { tokenHash: sha256(atok), userId: artUser.id, expiresAt: new Date(Date.now() + 86400000) } });
    const rA = await req('/api/craft/orders', { method: 'GET', cookie: 'wassilha_session=' + atok });
    const arts = rA.body.orders || [];
    const codes = arts.map((o) => o.code);
    const oAcode = multi.orders && multi.orders.find((o) => o.artisan.id === storeA.id);
    const oBcode = multi.orders && multi.orders.find((o) => o.artisan.id === storeB.id);
    check('artisan A sees own order', rA.status === 200 && oAcode && codes.includes(oAcode.code), codes.join(','));
    check('artisan A does NOT see store B order', !codes.includes(oBcode && oBcode.code), codes.join(','));
  } else {
    check('artisan A user exists', false, 'no user for artisan ' + storeA.id);
  }

  const rC = await req('/api/craft/orders', { method: 'GET', cookie });
  const ccodes = (rC.body.orders || []).map((o) => o.code);
  check('customer sees both orders', rC.status === 200 && ccodes.length >= 2, 'n=' + ccodes.length);

  // ---- self-cleanup: remove only the orders THIS run created (identified by the
  // codes returned from the API), and restore the stock they consumed. Real
  // historical orders for the same customer are never touched. ----
  const myCodes = new Set([
    ...(multi.orders || []).map((o) => o.code),
    ...(tamperOk && tamperRes.body.orders ? tamperRes.body.orders.map((o) => o.code) : []),
    ...(overCode ? [overCode] : []),
  ]);
  if (myCodes.size) {
    const mine = await db.craftOrder.findMany({
      where: { code: { in: [...myCodes] } },
      select: { id: true, code: true, items: { select: { productId: true, quantity: true } } },
    });
    console.log('[cleanup] codes=' + JSON.stringify([...myCodes]) + ' found=' + mine.length);
    for (const o of mine) {
      for (const it of o.items) {
        await db.craftProduct.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
      }
    }
    await db.craftOrderItem.deleteMany({ where: { craftOrderId: { in: mine.map((o) => o.id) } } });
    const del = await db.craftOrder.deleteMany({ where: { id: { in: mine.map((o) => o.id) } } });
    console.log('[cleanup] deleted=' + del.count);
  } else {
    console.log('[cleanup] no codes to clean');
  }
  // Delete ONLY the sessions this run created (by tokenHash). Never the
  // reused real customer's other device sessions.
  await db.session.deleteMany({ where: { tokenHash: { in: mySessionHashes } } }).catch(() => {});

  const pass = results.filter((x) => x.ok).length;
  console.log('\n=== ORDER SMOKE: ' + pass + '/' + results.length + ' passed ===');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
