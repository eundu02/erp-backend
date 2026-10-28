// 유지보수 기능 검증: 상품 등록 트랜잭션, 공급업체 선택 항목 비우기, 작성중 전표 삭제,
// 추천에서 전환된 발주서 삭제 시 판단 이력 복구. 빈 테스트 DB 전제 — `npm test`로 실행.
const B = process.env.TEST_API_BASE || 'http://localhost:4001/api';
let pass = 0, fail = 0;

async function call(method, p, body) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
async function must(method, p, body) {
  const r = await call(method, p, body);
  if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  console.log('[상품 등록 트랜잭션]');
  const sup = await must('POST', '/suppliers', { supplier_name: '유지보수공급사', contact_name: '홍길동', phone: '010-1111-2222', email: 'a@b.com' });
  const p = await must('POST', '/products', { sku: 'M-001', product_name: '테스트상품', unit: 'EA', supplier_id: sup.supplier_id, planned_lead_time_days: 2, review_period_days: 3 });
  const inv = await must('GET', `/inventory/${p.product_id}`);
  check('상품 등록 시 재고 행이 함께 생성됨 (updated_at 존재)', inv.on_hand_qty === 0 && inv.updated_at !== null, inv);
  const before = (await must('GET', '/products')).length;
  const dup = await call('POST', '/products', { sku: 'M-001', product_name: '중복', unit: 'EA', planned_lead_time_days: 1, review_period_days: 1 });
  check('중복 SKU 409, 상품·재고 행 모두 생성 안 됨', dup.status === 409 && (await must('GET', '/products')).length === before);

  console.log('[공급업체 선택 항목 비우기]');
  const cleared = await must('PUT', `/suppliers/${sup.supplier_id}`, { contact_name: null, phone: '' });
  check('담당자 null, 연락처 빈 문자열 → 둘 다 NULL', cleared.contact_name === null && cleared.phone === null, cleared);
  check('바디에 없는 항목(email)은 유지', cleared.email === 'a@b.com');
  const onlyActive = await must('PUT', `/suppliers/${sup.supplier_id}`, { is_active: false });
  check('is_active만 보내면 이름 유지', onlyActive.supplier_name === '유지보수공급사' && onlyActive.is_active === false);
  await must('PUT', `/suppliers/${sup.supplier_id}`, { is_active: true });
  check('공급업체명 비우기 400', (await call('PUT', `/suppliers/${sup.supplier_id}`, { supplier_name: ' ' })).status === 400);
  check('없는 공급업체 404', (await call('PUT', '/suppliers/9999', { phone: '1' })).status === 404);

  console.log('[작성중 전표 삭제]');
  // 재고 확보: 발주 → 확정 → 입고 확정
  const po = await must('POST', '/purchase-orders', { supplier_id: sup.supplier_id, created_by: 1, items: [{ product_id: p.product_id, ordered_qty: 100 }] });
  await must('POST', `/purchase-orders/${po.purchase_order_id}/confirm`);
  const rcDraft = await must('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: po.items[0].po_item_id, received_qty: 30 }] });
  check('작성중 입고 삭제 204', (await call('DELETE', `/receipts/${rcDraft.receipt_id}`)).status === 204);
  check('삭제된 입고 조회 404', (await call('GET', `/receipts/${rcDraft.receipt_id}`)).status === 404);
  check('작성중 입고 삭제는 누적 입고량에 영향 없음', (await must('GET', `/purchase-orders/${po.purchase_order_id}`)).items[0].received_qty === 0);
  const rc = await must('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: [{ po_item_id: po.items[0].po_item_id, received_qty: 100 }] });
  await must('POST', `/receipts/${rc.receipt_id}/confirm`, {});
  check('확정된 입고 삭제 409', (await call('DELETE', `/receipts/${rc.receipt_id}`)).status === 409);

  const saleDraft = await must('POST', '/sales', { created_by: 1, items: [{ product_id: p.product_id, quantity: 5 }] });
  check('작성중 판매 삭제 204', (await call('DELETE', `/sales/${saleDraft.sale_id}`)).status === 204);
  check('삭제된 판매 조회 404', (await call('GET', `/sales/${saleDraft.sale_id}`)).status === 404);
  check('작성중 판매 삭제는 재고에 영향 없음', (await must('GET', `/inventory/${p.product_id}`)).on_hand_qty === 100);
  const sale = await must('POST', '/sales', { created_by: 1, items: [{ product_id: p.product_id, quantity: 5 }] });
  await must('POST', `/sales/${sale.sale_id}/confirm`, {});
  check('확정된 판매 삭제 409 (취소를 사용)', (await call('DELETE', `/sales/${sale.sale_id}`)).status === 409);

  const poDraft = await must('POST', '/purchase-orders', { supplier_id: sup.supplier_id, created_by: 1, items: [{ product_id: p.product_id, ordered_qty: 10 }] });
  check('작성중 발주 삭제 204', (await call('DELETE', `/purchase-orders/${poDraft.purchase_order_id}`)).status === 204);
  check('확정된 발주 삭제 409', (await call('DELETE', `/purchase-orders/${po.purchase_order_id}`)).status === 409);
  check('없는 전표 삭제 404', (await call('DELETE', '/sales/9999')).status === 404);

  console.log('[추천에서 전환된 발주서 삭제 → 판단 복구]');
  for (let d = 1; d <= 14; d++) {
    const s = await must('POST', '/sales', { created_by: 1, sale_date: ymd(d), items: [{ product_id: p.product_id, quantity: 4 }] });
    await must('POST', `/sales/${s.sale_id}/confirm`, {});
  }
  const rec = (await must('POST', '/recommendations/calculate', { product_ids: [p.product_id] })).created[0];
  const dec = await must('POST', '/decisions', { recommendation_id: rec.recommendation_id, selected_strategy: 'custom', final_qty: 20, modification_reason: '테스트', decided_by: 1 });
  const conv = (await must('POST', '/decisions/convert-to-po', { decision_ids: [dec.decision_id], created_by: 1 })).purchase_orders[0];
  check('전환된 발주서 삭제 204', (await call('DELETE', `/purchase-orders/${conv.purchase_order_id}`)).status === 204);
  const after = (await must('GET', `/recommendations?product_id=${p.product_id}`))[0];
  check('판단 이력이 confirmed로 복구, 발주서 연결 해제', after.decision_status === 'confirmed' && after.purchase_order_id === null, after);
  const reconv = await call('POST', '/decisions/convert-to-po', { decision_ids: [dec.decision_id], created_by: 1 });
  check('복구된 판단은 다시 발주 전환 가능', reconv.status === 201 && reconv.body.purchase_orders[0].items[0].ordered_qty === 20, reconv.body);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
