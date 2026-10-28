// 기본 ERP(재고·판매·발주·입고) API 시나리오 검증.
// 빈 테스트 DB(사용자 1명만 있는 상태)를 전제로 한다 — 직접 실행하지 말고 `npm test`(tests/run.js)로 실행.
const B = process.env.TEST_API_BASE || 'http://localhost:4001/api';
let pass = 0, fail = 0;

async function call(method, path, body) {
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const onHand = async (pid) => (await call('GET', `/inventory/${pid}`)).body.on_hand_qty;

(async () => {
  await new Promise((r) => setTimeout(r, 1000));
  console.log('[준비] 공급사/상품');
  const sup = (await call('POST', '/suppliers', { supplier_name: '한글공급사' })).body;
  const sup2 = (await call('POST', '/suppliers', { supplier_name: '다른공급사' })).body;
  const A = (await call('POST', '/products', { sku: 'A-001', product_name: '상품A', unit: 'EA', supplier_id: sup.supplier_id, planned_lead_time_days: 5, review_period_days: 7 })).body;
  const Bp = (await call('POST', '/products', { sku: 'B-001', product_name: '상품B', unit: 'BOX', supplier_id: sup.supplier_id, planned_lead_time_days: 7, review_period_days: 7, safety_stock_qty: 2 })).body;
  check('한글 저장 정상', A.product_name === '상품A', A);

  console.log('[재고 조회]');
  const inv = await call('GET', '/inventory');
  check('전 상품 현재고 0', inv.body.length === 2 && inv.body.every((r) => r.on_hand_qty === 0), inv.body);
  check('B 안전재고 미달 표시', inv.body.find((r) => r.product_id === Bp.product_id).below_safety_stock === true);
  check('없는 상품 404', (await call('GET', '/inventory/9999')).status === 404);
  check('조정 API 없음(404)', (await call('POST', '/inventory/adjustments', {})).status === 404);

  console.log('[판매 — 재고 부족]');
  const s0 = await call('POST', '/sales', { created_by: 1, items: [{ product_id: A.product_id, quantity: 3 }] });
  check('판매전표 생성 201 + draft + 자동번호', s0.status === 201 && s0.body.status === 'draft' && /^SO-\d{8}-\d{5}$/.test(s0.body.sale_no), s0.body);
  const s0c = await call('POST', `/sales/${s0.body.sale_id}/confirm`);
  check('재고 부족 확정 409', s0c.status === 409 && s0c.body.detail.available_qty === 0, s0c.body);
  check('실패 후 여전히 draft', (await call('GET', `/sales/${s0.body.sale_id}`)).body.status === 'draft');
  check('검증: created_by 누락 400', (await call('POST', '/sales', { items: [{ product_id: A.product_id, quantity: 1 }] })).status === 400);
  check('검증: quantity 0 → 400', (await call('POST', '/sales', { created_by: 1, items: [{ product_id: A.product_id, quantity: 0 }] })).status === 400);

  console.log('[발주]');
  check('공급사 불일치 400', (await call('POST', '/purchase-orders', { supplier_id: sup2.supplier_id, created_by: 1, items: [{ product_id: A.product_id, ordered_qty: 1 }] })).status === 400);
  const po = (await call('POST', '/purchase-orders', { supplier_id: sup.supplier_id, created_by: 1, items: [{ product_id: A.product_id, ordered_qty: 10 }, { product_id: Bp.product_id, ordered_qty: 5 }] })).body;
  check('발주서 draft + PO 번호', po.status === 'draft' && po.po_no.startsWith('PO-'), po);
  check('draft 발주에 입고 불가 409', (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: po.items[0].po_item_id, received_qty: 1 }] })).status === 409);
  const poc = (await call('POST', `/purchase-orders/${po.purchase_order_id}/confirm`)).body;
  check('발주 확정 → confirmed', poc.status === 'confirmed' && poc.confirmed_at, poc);
  const exp = new Date(poc.order_date); exp.setDate(exp.getDate() + 7);
  check('입고예정일 = 확정일 + 최대 납기(7일)', new Date(poc.expected_receipt_date).getTime() === exp.getTime(), [poc.order_date, poc.expected_receipt_date]);
  check('발주 확정 시 재고 변화 없음', (await onHand(A.product_id)) === 0 && (await onHand(Bp.product_id)) === 0);
  check('미입고 발주량 반영', (await call('GET', `/inventory/${A.product_id}`)).body.outstanding_po_qty === 10);
  check('이중 확정 409', (await call('POST', `/purchase-orders/${po.purchase_order_id}/confirm`)).status === 409);
  const [itemA, itemB] = po.items;

  console.log('[부분 입고]');
  const r1 = (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: itemA.po_item_id, received_qty: 4 }] })).body;
  check('입고전표 draft', r1.status === 'draft' && r1.receipt_no.startsWith('RC-'), r1);
  check('입고 draft 단계에서는 재고 변화 없음', (await onHand(A.product_id)) === 0);
  const r1c = (await call('POST', `/receipts/${r1.receipt_id}/confirm`, { confirmed_by: 1 })).body;
  check('입고 확정 → A=4', (await onHand(A.product_id)) === 4, r1c);
  let poNow = (await call('GET', `/purchase-orders/${po.purchase_order_id}`)).body;
  check('발주 partially_received + received_qty 4', poNow.status === 'partially_received' && poNow.items[0].received_qty === 4 && poNow.items[0].remaining_qty === 6, poNow);
  check('입고 이중 확정 409', (await call('POST', `/receipts/${r1.receipt_id}/confirm`)).status === 409);
  check('잔량 초과 입고 생성 400', (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: itemA.po_item_id, received_qty: 7 }] })).status === 400);
  check('다른 발주 품목 400', (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: 9999, received_qty: 1 }] })).status === 400);

  // draft 두 장이 같은 잔량을 노리는 경우 — 확정 시점 재검증
  const r2 = (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: itemB.po_item_id, received_qty: 2 }, { po_item_id: itemA.po_item_id, received_qty: 6 }] })).body;
  const r3 = (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: itemB.po_item_id, received_qty: 3 }, { po_item_id: itemA.po_item_id, received_qty: 6 }] })).body;
  check('r2 확정 200', (await call('POST', `/receipts/${r2.receipt_id}/confirm`)).status === 200);
  const r3c = await call('POST', `/receipts/${r3.receipt_id}/confirm`);
  check('r3 잔량 초과 확정 409', r3c.status === 409, r3c.body);
  check('r3 롤백: B는 2 그대로 (부분 반영 없음)', (await onHand(Bp.product_id)) === 2 && (await onHand(A.product_id)) === 10);
  const r4 = (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: itemB.po_item_id, received_qty: 3 }] })).body;
  await call('POST', `/receipts/${r4.receipt_id}/confirm`);
  poNow = (await call('GET', `/purchase-orders/${po.purchase_order_id}`)).body;
  check('전량 입고 → completed', poNow.status === 'completed' && (await onHand(Bp.product_id)) === 5, poNow);
  check('completed 발주 입고 불가 409', (await call('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: itemB.po_item_id, received_qty: 1 }] })).status === 409);
  check('completed 발주 취소 불가 409', (await call('POST', `/purchase-orders/${po.purchase_order_id}/cancel`)).status === 409);
  check('미입고 발주량 0', (await call('GET', `/inventory/${A.product_id}`)).body.outstanding_po_qty === 0);

  console.log('[판매 확정 / 취소]');
  const s1 = (await call('POST', '/sales', { created_by: 1, items: [{ product_id: A.product_id, quantity: 3 }, { product_id: Bp.product_id, quantity: 2, unit_price: 1500 }] })).body;
  const s1c = (await call('POST', `/sales/${s1.sale_id}/confirm`)).body;
  check('판매 확정 → A=7, B=3', s1c.status === 'confirmed' && (await onHand(A.product_id)) === 7 && (await onHand(Bp.product_id)) === 3, s1c);
  check('판매 이중 확정 409', (await call('POST', `/sales/${s1.sale_id}/confirm`)).status === 409);

  // 일부 품목만 부족 → 전체 롤백
  const s2 = (await call('POST', '/sales', { created_by: 1, items: [{ product_id: A.product_id, quantity: 1 }, { product_id: Bp.product_id, quantity: 99 }] })).body;
  check('B 부족 → 409', (await call('POST', `/sales/${s2.sale_id}/confirm`)).status === 409);
  check('롤백: A=7 그대로', (await onHand(A.product_id)) === 7);

  // 동시 확정 — 재고 7에 5짜리 두 건
  const sx = (await call('POST', '/sales', { created_by: 1, items: [{ product_id: A.product_id, quantity: 5 }] })).body;
  const sy = (await call('POST', '/sales', { created_by: 1, items: [{ product_id: A.product_id, quantity: 5 }] })).body;
  const [cx, cy] = await Promise.all([call('POST', `/sales/${sx.sale_id}/confirm`), call('POST', `/sales/${sy.sale_id}/confirm`)]);
  check('동시 확정: 하나만 성공', [cx.status, cy.status].sort().join() === '200,409', [cx.status, cy.status]);
  check('동시 확정 후 A=2 (음수 없음)', (await onHand(A.product_id)) === 2);

  const cancelled = (await call('POST', `/sales/${s1.sale_id}/cancel`, { reason: '고객 반품' })).body;
  check('확정 판매 취소 → A=5, B=5', cancelled.status === 'canceled' && (await onHand(A.product_id)) === 5 && (await onHand(Bp.product_id)) === 5, cancelled);
  check('재취소 409', (await call('POST', `/sales/${s1.sale_id}/cancel`)).status === 409);
  check('draft 취소 200', (await call('POST', `/sales/${s0.body.sale_id}/cancel`)).body.status === 'canceled');
  check('취소된 전표 확정 409', (await call('POST', `/sales/${s0.body.sale_id}/confirm`)).status === 409);

  console.log('[원장 정합성]');
  const mv = (await call('GET', `/stock-movements?product_id=${A.product_id}`)).body;
  const sumA = mv.reduce((a, m) => a + m.quantity_change, 0);
  check('A 원장 합계 == 현재고', sumA === (await onHand(A.product_id)), { sumA, mv: mv.map((m) => [m.movement_type, m.quantity_change]) });
  check('취소는 반대 부호 행으로 추가', mv.some((m) => m.movement_type === 'sale' && m.quantity_change === 3 && m.reason === '고객 반품'));
  check('sale 행엔 sale_item_id만, receipt 행엔 receipt_item_id만', mv.every((m) => (m.movement_type === 'sale' ? m.sale_item_id && !m.receipt_item_id : m.receipt_item_id && !m.sale_item_id)));
  const all = (await call('GET', '/stock-movements')).body;
  const invAll = (await call('GET', '/inventory')).body;
  check('전 상품 원장 합계 == 현재고', invAll.every((r) => all.filter((m) => m.product_id === r.product_id).reduce((a, m) => a + m.quantity_change, 0) === r.on_hand_qty));
  check('movement_type 필터', (await call('GET', '/stock-movements?movement_type=receipt')).body.every((m) => m.movement_type === 'receipt'));

  console.log('[목록 API]');
  check('판매 목록', (await call('GET', '/sales?status=confirmed')).body.every((s) => s.status === 'confirmed'));
  check('발주 목록', (await call('GET', '/purchase-orders')).body[0].total_ordered_qty === 15);
  check('입고 목록', (await call('GET', `/receipts?purchase_order_id=${po.purchase_order_id}`)).body.length === 4);

  // 입고 전 발주 취소
  const po2 = (await call('POST', '/purchase-orders', { supplier_id: sup.supplier_id, created_by: 1, items: [{ product_id: A.product_id, ordered_qty: 3 }] })).body;
  await call('POST', `/purchase-orders/${po2.purchase_order_id}/confirm`);
  check('입고 전 발주 취소 200', (await call('POST', `/purchase-orders/${po2.purchase_order_id}/cancel`)).body.status === 'canceled');

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
