// 발표·화면 확인용 데모 데이터 생성 스크립트.
// DB에 직접 INSERT하지 않고 실제 REST API를 호출하므로, 모든 재고 수치가 판매 확정/입고 확정 규칙을 그대로 거친다.
// 단, 과거 발주 이력(공급업체별 실제 납기 실적)을 만들기 위해 발주 확정 직후 발주일(order_date)만 SQL로 과거 날짜로 되돌린다.
// (API는 발주 확정 시 order_date를 확정일=오늘로 기록하므로 과거 이력을 만들 방법이 없음 — 데모 전용 처리)
//
// 사용법: 서버 실행(npm run dev) 후 → npm run seed:demo
// 전제: sql/seed_dev.sql로 user_id=1이 있고, 상품이 하나도 없는 빈 DB (상품이 있으면 중단)
require('dotenv').config();
const pool = require('../src/db/pool');

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const USER = 1;
const DAYS = 30;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// 재현 가능한 의사난수 (매번 같은 데모 데이터)
let seed = 20261015;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
// 평균 mean 근처의 0 이상 정수 (요일 효과: 주말 수요 60%)
function demand(mean, date) {
  const dow = date.getDay();
  const weekend = dow === 0 || dow === 6 ? 0.6 : 1;
  return Math.max(0, Math.round(mean * weekend * (0.5 + rand())));
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

// 발주 → 확정 → 발주일을 n일 전으로 되돌림. expectedDaysAgo를 주면 입고 예정일도 지정.
async function confirmedPoAt(supplierId, items, n, expectedDaysAgo) {
  const po = await call('POST', '/purchase-orders', { supplier_id: supplierId, created_by: USER, items });
  await call('POST', `/purchase-orders/${po.purchase_order_id}/confirm`);
  await pool.query(
    `UPDATE purchase_orders
        SET order_date = CURRENT_DATE - $2::int,
            confirmed_at = now() - make_interval(days => $2::int),
            expected_receipt_date = CURRENT_DATE - COALESCE($3::int, $2::int - (expected_receipt_date - CURRENT_DATE))
      WHERE purchase_order_id = $1`,
    [po.purchase_order_id, n, expectedDaysAgo ?? null]
  );
  return call('GET', `/purchase-orders/${po.purchase_order_id}`);
}

// 입고 등록(+확정). lines: [{ po_item_id, received_qty }]
async function receiveAt(poId, lines, n, confirm = true) {
  const rc = await call('POST', '/receipts', { purchase_order_id: poId, receipt_date: ymd(daysAgo(n)), items: lines });
  if (confirm) await call('POST', `/receipts/${rc.receipt_id}/confirm`, { confirmed_by: USER });
  return rc;
}

async function main() {
  const existing = await call('GET', '/products');
  if (existing.length > 0) {
    console.error('이미 상품 데이터가 있어 중단합니다. 빈 DB에서만 실행하세요.');
    process.exit(1);
  }

  console.log('1) 공급업체·상품 등록');
  const sup = {};
  for (const s of [
    { key: 'food', supplier_name: '한빛식품유통', contact_name: '김민수', phone: '02-1234-5678', email: 'order@hanbit-food.co.kr', address: '서울시 송파구 문정로 12' },
    { key: 'living', supplier_name: '대성생활용품', contact_name: '이지은', phone: '031-555-0101', email: 'sales@daesung-living.co.kr', address: '경기도 성남시 중원구 산업로 45' },
    { key: 'office', supplier_name: '미래오피스', contact_name: '박서준', phone: '02-777-8899', email: 'biz@mirae-office.com', address: '서울시 구로구 디지털로 300' },
  ]) {
    const { key, ...body } = s;
    sup[key] = (await call('POST', '/suppliers', body)).supplier_id;
  }

  // mean: 평일 일평균 판매량, end: 30일 판매 후 남길 목표 재고 (일부러 안전재고 미달 품목을 섞음)
  const catalog = [
    { sku: 'FD-001', product_name: '생수 500ml (20입)', unit: 'BOX', s: 'food', lt: 3, rp: 7, moq: 10, mult: 5, ss: 30, mean: 9, end: 8 },
    { sku: 'FD-002', product_name: '컵라면 큰사발 (16입)', unit: 'BOX', s: 'food', lt: 4, rp: 7, moq: 5, mult: 5, ss: 20, mean: 5, end: 42 },
    { sku: 'FD-003', product_name: '커피믹스 (100T)', unit: 'BOX', s: 'food', lt: 5, rp: 7, moq: 2, mult: 1, ss: 10, mean: 2, end: 15 },
    { sku: 'LV-001', product_name: '화장지 30롤', unit: 'PACK', s: 'living', lt: 7, rp: 14, moq: 10, mult: 10, ss: 15, mean: 3, end: 9 },
    { sku: 'LV-002', product_name: '주방세제 1L', unit: 'EA', s: 'living', lt: 7, rp: 14, moq: 12, mult: 12, ss: 24, mean: 4, end: 51 },
    { sku: 'LV-003', product_name: '물티슈 100매', unit: 'EA', s: 'living', lt: 5, rp: 14, moq: 20, mult: 10, ss: 40, mean: 8, end: 66 },
    { sku: 'OF-001', product_name: 'A4 복사용지 (2500매)', unit: 'BOX', s: 'office', lt: 7, rp: 7, moq: 5, mult: 1, ss: 20, mean: 4, end: 31 },
    { sku: 'OF-002', product_name: '볼펜 0.7mm (12입)', unit: 'SET', s: 'office', lt: 10, rp: 14, moq: 10, mult: 10, ss: 15, mean: 2, end: 6 },
    { sku: 'OF-003', product_name: 'USB 메모리 32GB', unit: 'EA', s: null, lt: 14, rp: 30, moq: 1, mult: 1, ss: 5, mean: 1, end: 12 },
  ];
  for (const c of catalog) {
    const p = await call('POST', '/products', {
      sku: c.sku, product_name: c.product_name, unit: c.unit, supplier_id: c.s ? sup[c.s] : null,
      planned_lead_time_days: c.lt, review_period_days: c.rp, minimum_order_qty: c.moq,
      order_multiple: c.mult, safety_stock_qty: c.ss, default_strategy: c.ss >= 30 ? 'P70' : 'P50',
    });
    c.id = p.product_id;
  }

  console.log('2) 30일치 판매 수요 생성');
  const daily = []; // [{ date, items: [{product_id, quantity}] }]
  for (let i = DAYS; i >= 1; i--) {
    const date = daysAgo(i);
    const items = catalog
      .map((c) => ({ product_id: c.id, quantity: demand(c.mean, date) }))
      .filter((it) => it.quantity > 0);
    if (items.length) daily.push({ date: ymd(date), items });
  }
  const totalDemand = Object.fromEntries(catalog.map((c) => [c.id, 0]));
  daily.forEach((d) => d.items.forEach((it) => { totalDemand[it.product_id] += it.quantity; }));

  console.log('3) 과거 발주·입고 이력으로 기초 재고 확보 (공급업체별 실제 납기 실적)');
  // [발주일(n일 전), 실제 납기(일)] — 식품 실적 3건(+시나리오 1건), 생활용품 2건(표본 부족 → 계획 납기 폴백), 사무용품 4건
  const history = {
    food: [[50, 4], [38, 5], [26, 4]],
    living: [[48, 9], [30, 10]],
    office: [[56, 8], [42, 7], [28, 9], [14, 8]],
  };
  const bySupplier = {};
  for (const c of catalog) {
    const key = c.s ?? 'food'; // 공급업체 미지정 상품은 아무 발주처로 들여올 수 있음
    (bySupplier[key] ??= []).push({ product_id: c.id, total: totalDemand[c.id] + c.end });
  }
  for (const [key, products] of Object.entries(bySupplier)) {
    const rounds = history[key];
    for (let i = 0; i < rounds.length; i++) {
      const [n, lt] = rounds[i];
      // 총량을 회차별로 나눔 (마지막 회차가 나머지)
      const items = products.map((p) => {
        const share = Math.floor(p.total / rounds.length);
        return { product_id: p.product_id, ordered_qty: i === rounds.length - 1 ? p.total - share * (rounds.length - 1) : share };
      }).filter((it) => it.ordered_qty > 0);
      const po = await confirmedPoAt(sup[key], items, n);
      await receiveAt(po.purchase_order_id, po.items.map((it) => ({ po_item_id: it.po_item_id, received_qty: it.ordered_qty })), n - lt);
    }
  }

  console.log(`4) 판매전표 ${daily.length}건 등록·확정`);
  for (const d of daily) {
    const sale = await call('POST', '/sales', { created_by: USER, sale_date: d.date, items: d.items });
    await call('POST', `/sales/${sale.sale_id}/confirm`, { confirmed_by: USER });
  }

  console.log('5) 진행 중 발주·입고 시나리오');
  const P = Object.fromEntries(catalog.map((c) => [c.sku, c.id]));
  // (a) 식품: 확정 후 부분 입고 → partially_received
  const poA = await confirmedPoAt(sup.food,
    [{ product_id: P['FD-001'], ordered_qty: 60, unit_price: 6500 }, { product_id: P['FD-003'], ordered_qty: 10, unit_price: 18900 }], 4);
  await receiveAt(poA.purchase_order_id, [{ po_item_id: poA.items[0].po_item_id, received_qty: 20 }], 0);

  // (b) 생활용품: 입고 예정일이 지난 확정 발주 + 작성중 입고전표
  const poB = await confirmedPoAt(sup.living,
    [{ product_id: P['LV-001'], ordered_qty: 30, unit_price: 15900 }, { product_id: P['LV-003'], ordered_qty: 40, unit_price: 1200 }], 10, 2);
  await receiveAt(poB.purchase_order_id, [{ po_item_id: poB.items[0].po_item_id, received_qty: 10 }], 0, false);

  // (c) 사무용품: 작성중 발주
  await call('POST', '/purchase-orders', {
    supplier_id: sup.office, created_by: USER,
    items: [{ product_id: P['OF-002'], ordered_qty: 30, unit_price: 4800 }],
  });

  // (d) 취소된 판매 (확정 → 취소, 반대 부호 이력) + 오늘자 작성중 판매
  const canceled = await call('POST', '/sales', { created_by: USER, items: [{ product_id: P['FD-002'], quantity: 3, unit_price: 14500 }] });
  await call('POST', `/sales/${canceled.sale_id}/confirm`, { confirmed_by: USER });
  await call('POST', `/sales/${canceled.sale_id}/cancel`, { reason: '고객 주문 취소', canceled_by: USER });
  await call('POST', '/sales', {
    created_by: USER,
    items: [{ product_id: P['FD-001'], quantity: 5, unit_price: 9900 }, { product_id: P['OF-001'], quantity: 2, unit_price: 27000 }],
  });

  const inv = await call('GET', '/inventory');
  console.log('\n완료. 현재 재고:');
  console.table(inv.map((r) => ({
    SKU: r.sku, 상품명: r.product_name, 현재고: r.on_hand_qty, 안전재고: r.safety_stock_qty,
    미입고: r.outstanding_po_qty, 상태: r.below_safety_stock ? '미달' : '정상',
  })));
}

main()
  .catch((err) => {
    console.error('데모 데이터 생성 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
