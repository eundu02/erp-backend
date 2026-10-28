// 발주 추천·관리자 판단·발주 전환 API 시나리오 검증 (실적 납기 포함).
// 빈 테스트 DB를 전제로 하며, 과거 발주일을 만들기 위해 테스트 DB에 직접 접속한다 — `npm test`로 실행.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { bootstrapDemand } = require('../src/services/forecast');

const B = process.env.TEST_API_BASE || 'http://localhost:4001/api';
const db = new Pool({ database: process.env.TEST_DB || 'erp_test' });
const sql = (q, p) => db.query(q, p);
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

// 발주 → 확정 → 발주일을 orderDaysAgo일 전으로 되돌림 → lt일 뒤 날짜로 전량 입고 (실제 납기 = lt)
async function receive(supplierId, items, orderDaysAgo, lt) {
  const po = await must('POST', '/purchase-orders', { supplier_id: supplierId, created_by: 1, items });
  await must('POST', `/purchase-orders/${po.purchase_order_id}/confirm`);
  await sql('UPDATE purchase_orders SET order_date = CURRENT_DATE - $2::int WHERE purchase_order_id = $1', [po.purchase_order_id, orderDaysAgo]);
  const full = await must('GET', `/purchase-orders/${po.purchase_order_id}`);
  const rc = await must('POST', '/receipts', { purchase_order_id: po.purchase_order_id, receipt_date: ymd(orderDaysAgo - lt), items: full.items.map((i) => ({ po_item_id: i.po_item_id, received_qty: i.ordered_qty })) });
  await must('POST', `/receipts/${rc.receipt_id}/confirm`, {});
}
async function sell(productId, qty, daysAgo, { cancel = false } = {}) {
  const s = await must('POST', '/sales', { created_by: 1, sale_date: ymd(daysAgo), items: [{ product_id: productId, quantity: qty }] });
  await must('POST', `/sales/${s.sale_id}/confirm`, {});
  if (cancel) await must('POST', `/sales/${s.sale_id}/cancel`, {});
}
const prod = (body) => must('POST', '/products', { unit: 'EA', review_period_days: 0, ...body });

(async () => {
  await new Promise((r) => setTimeout(r, 800));
  console.log('[준비]');
  const s1 = (await must('POST', '/suppliers', { supplier_name: '공급사1' })).supplier_id;
  const s2 = (await must('POST', '/suppliers', { supplier_name: '공급사2' })).supplier_id;
  // A: 매일 5개 (28일), 보호기간 3+4=7 → 수요 35 (모든 분위수), 안전 10
  const A = (await prod({ sku: 'A', product_name: '일정수요A', supplier_id: s1, planned_lead_time_days: 3, review_period_days: 4, safety_stock_qty: 10 })).product_id;
  // B: 매일 2개, 보호기간 5+5=10 → 수요 20, 안전 5, MOQ 50, 배수 12
  const Bp = (await prod({ sku: 'B', product_name: '최소주문B', supplier_id: s2, planned_lead_time_days: 5, review_period_days: 5, safety_stock_qty: 5, minimum_order_qty: 50, order_multiple: 12 })).product_id;
  // C: 변동 수요 (0,3,10 반복), 보호기간 2+5=7, 기본전략 P70
  const C = (await prod({ sku: 'C', product_name: '변동수요C', supplier_id: s1, planned_lead_time_days: 2, review_period_days: 5, safety_stock_qty: 0, default_strategy: 'P70' })).product_id;
  // D: 5일 전 출시 (이력 부족), 보호기간 3+4=7 → 필요 14일
  const D = (await prod({ sku: 'D', product_name: '신상품D', supplier_id: s2, planned_lead_time_days: 3, review_period_days: 4 })).product_id;
  // E: 판매 이력 없음
  const E = (await prod({ sku: 'E', product_name: '무판매E', supplier_id: s1, planned_lead_time_days: 3, review_period_days: 4, safety_stock_qty: 7 })).product_id;
  // F: 공급업체 미지정
  const F = (await prod({ sku: 'F', product_name: '미지정F', planned_lead_time_days: 3, review_period_days: 4 })).product_id;
  // G: 재고 충분 → 추천 0
  const G = (await prod({ sku: 'G', product_name: '재고충분G', supplier_id: s1, planned_lead_time_days: 1, review_period_days: 1, safety_stock_qty: 1 })).product_id;

  const cPattern = [0, 3, 10];
  await receive(s1, [{ product_id: A, ordered_qty: 140 + 3 + 7 + 10 }, { product_id: C, ordered_qty: 200 }, { product_id: G, ordered_qty: 500 }, { product_id: F, ordered_qty: 30 }], 45, 4);
  await receive(s1, [{ product_id: G, ordered_qty: 10 }], 30, 5); // 공급사1 납기 실적: 4, 5, 5일 → 평균 4.67 → 5일
  await receive(s1, [{ product_id: G, ordered_qty: 10 }], 20, 5);
  await receive(s2, [{ product_id: Bp, ordered_qty: 60 }, { product_id: D, ordered_qty: 100 }], 45, 8); // 공급사2 실적 1건 → 계획 납기로 폴백
  await sell(A, 50, 1, { cancel: true });  // 취소된 판매: 수요에서 제외, 재고는 복원
  for (let d = 1; d <= 28; d++) {
    await sell(A, 5, d);
    await sell(Bp, 2, d);
    const c = cPattern[d % 3]; if (c) await sell(C, c, d);
    await sell(G, 1, d);
    await sell(F, 1, d);
  }
  for (let d = 1; d <= 5; d++) await sell(D, 4, d);
  await sell(A, 3, 0);                     // 오늘 판매: 수요 집계에서 제외돼야 함 (재고는 차감)
  await sell(A, 7, 40);                    // 28일 밖 판매: 제외 (재고 50 중 7 차감)
  // B 미입고 발주 6개 (확정) → 재고 위치 = 4 + 6
  const poB = await must('POST', '/purchase-orders', { supplier_id: s2, created_by: 1, items: [{ product_id: Bp, ordered_qty: 6 }] });
  await must('POST', `/purchase-orders/${poB.purchase_order_id}/confirm`);

  console.log('[추천 계산]');
  check('product_ids 검증 400', (await call('POST', '/recommendations/calculate', { product_ids: [] })).status === 400);
  check('없는 상품 404', (await call('POST', '/recommendations/calculate', { product_ids: [9999] })).status === 404);
  const calc = await must('POST', '/recommendations/calculate', {});
  const rec = Object.fromEntries(calc.created.map((r) => [r.sku, r]));
  check('저장된 추천 = A,B,C,D,G', Object.keys(rec).sort().join() === 'A,B,C,D,G', Object.keys(rec));
  check('F 제외 (공급업체 미지정)', calc.skipped.some((s) => s.sku === 'F' && s.reason.includes('공급업체')));
  const e = calc.not_forecastable.find((x) => x.sku === 'E');
  check('E 예측 불가 + 안전재고 표시, 저장 안 함', e && e.status === '예측 불가' && e.safety_stock_qty === 7, calc.not_forecastable);

  const a = rec.A;
  check('A 현재고 스냅샷 = 10 (오늘·취소·기간외 판매 반영된 재고)', a.on_hand_qty_snapshot === 10, a.on_hand_qty_snapshot);
  check('A 수요 P50=P70=P90=45 (5×보호기간 9일, 오늘·취소·28일 밖 판매 제외)', a.demand_p50 === 45 && a.demand_p70 === 45 && a.demand_p90 === 45, [a.demand_p50, a.demand_p70, a.demand_p90]);
  check('A 권장량 = 45+10-10 = 45', a.recommended_qty_p50 === 45 && a.recommended_qty_p90 === 45);
  check('A 이력 충분 (28일 ≥ 14)', a.calculation_detail.insufficient_history === false && a.calculation_detail.available_days === 28);
  check('A 일별 수요 28개 모두 5', a.calculation_detail.daily_demand.length === 28 && a.calculation_detail.daily_demand.every((v) => v === 5));
  const alt = a.calculation_detail.lead_time;
  check('A 적용 납기 = 공급사1 실적 평균 4.67 → 5일 (표본 3건)', a.applied_lead_time_days === 5 && alt.source === 'actual_supplier_avg' && alt.actual_samples === 3 && alt.actual_avg_days === 4.67 && alt.planned_days === 3, alt);
  check('A 보호기간 = 5 + 4 = 9', a.calculation_detail.protection_period_days === 9);
  const blt = rec.B.calculation_detail.lead_time;
  check('B 적용 납기 = 계획 5일 폴백 (공급사2 표본 1건 < 3)', rec.B.applied_lead_time_days === 5 && blt.source === 'planned' && blt.actual_samples === 1 && blt.actual_avg_days === 8, blt);
  check('D도 같은 공급사2 → 계획 3일', rec.D.applied_lead_time_days === 3 && rec.D.calculation_detail.lead_time.source === 'planned');
  check('model rule_based', a.model_name === 'rule_based');

  const b = rec.B;
  check('B 재고 위치 = 4 + 미입고 6 = 10', b.on_hand_qty_snapshot === 4 && b.outstanding_po_qty_snapshot === 6 && b.calculation_detail.inventory_position === 10);
  check('B 권장량: raw 15 → MOQ 50 → 배수 12로 60', b.recommended_qty_p50 === 60 && b.calculation_detail.strategies.p50.raw_qty === 15 && b.calculation_detail.strategies.p50.after_moq === 50, b.calculation_detail.strategies.p50);

  const c = rec.C;
  check('C 분위수 단조증가 P50 ≤ P70 ≤ P90', c.demand_p50 <= c.demand_p70 && c.demand_p70 <= c.demand_p90, [c.demand_p50, c.demand_p70, c.demand_p90]);
  check('C 분포가 퍼져 있음 (P50 < P90)', c.demand_p50 < c.demand_p90);
  const cd = c.calculation_detail;
  const re = bootstrapDemand(cd.daily_demand, cd.protection_period_days, cd.bootstrap.seed);
  check('C seed로 재계산 시 동일 결과 (재현성)', re.p50 === c.demand_p50 && re.p70 === c.demand_p70 && re.p90 === c.demand_p90, [re, c.demand_p50]);
  check('부트스트랩 1000회', cd.bootstrap.iterations === 1000);
  const mean = cd.daily_demand.reduce((x, y) => x + y, 0) / cd.daily_demand.length;
  const pd = cd.protection_period_days;
  check(`C P50이 평균수요×보호기간 ${pd}일(${(mean * pd).toFixed(1)}) 근처`, pd === 10 && Math.abs(c.demand_p50 - mean * pd) < mean * pd * 0.25, [pd, c.demand_p50]);

  const dd = rec.D.calculation_detail;
  check('D 이력 부족 플래그 + 사용 가능 5일', dd.insufficient_history === true && dd.available_days === 5 && dd.required_days === 14, dd);
  check('D 수요 = 4×7 = 28 (출시 전 날짜 0으로 채우지 않음)', rec.D.demand_p50 === 28, rec.D.demand_p50);
  check('G 재고 충분 → 권장 0 (MOQ 강제 안 함)', rec.G.recommended_qty_p90 === 0);

  console.log('[추천 조회]');
  const latest = await must('GET', '/recommendations?latest=true');
  check('latest=true → 상품별 1건 (5건)', latest.length === 5);
  check('product_id 필터', (await must('GET', `/recommendations?product_id=${A}`)).every((r) => r.product_id === A));
  check('demand 숫자 타입', typeof latest[0].demand_p50 === 'number');

  console.log('[판단 등록]');
  const dA = await must('POST', '/decisions', { recommendation_id: a.recommendation_id, selected_strategy: 'P50', decided_by: 1 });
  check('A P50 판단: final = 추천 45, confirmed', dA.final_qty === 45 && dA.system_recommended_qty === 45 && dA.decision_status === 'confirmed' && dA.decided_at);
  check('같은 추천 중복 판단 409', (await call('POST', '/decisions', { recommendation_id: a.recommendation_id, selected_strategy: 'P70', decided_by: 1 })).status === 409);
  const noReason = await call('POST', '/decisions', { recommendation_id: b.recommendation_id, selected_strategy: 'P90', final_qty: 72, decided_by: 1 });
  check('추천과 다른 수량 + 사유 없음 400', noReason.status === 400, noReason.body);
  const dB = await must('POST', '/decisions', { recommendation_id: b.recommendation_id, selected_strategy: 'P90', final_qty: 72, modification_reason: '프로모션 대비 추가 확보', decided_by: 1 });
  check('사유 포함 수정 판단 201', dB.final_qty === 72 && dB.system_recommended_qty === 60 && dB.modification_reason);
  check('custom final_qty 없음 400', (await call('POST', '/decisions', { recommendation_id: c.recommendation_id, selected_strategy: 'custom', decided_by: 1 })).status === 400);
  const dC = await must('POST', '/decisions', { recommendation_id: c.recommendation_id, selected_strategy: 'custom', final_qty: 999, modification_reason: '대량 납품 계약', decided_by: 1 });
  check('custom 기준 = 기본전략(P70) 추천수량', dC.system_recommended_qty === c.recommended_qty_p70, [dC.system_recommended_qty, c.recommended_qty_p70]);
  const dG = await must('POST', '/decisions', { recommendation_id: rec.G.recommendation_id, selected_strategy: 'P50', decided_by: 1 });
  check('G 판단 final_qty 0', dG.final_qty === 0);
  const dDrej = await must('POST', '/decisions', { recommendation_id: rec.D.recommendation_id, selected_strategy: 'P50', decision_status: 'rejected', decided_by: 1 });
  check('반려(rejected) 판단 등록', dDrej.decision_status === 'rejected');
  // D 재계산 후 옛 추천으로 판단 → 409
  const recalcD = await must('POST', '/recommendations/calculate', { product_ids: [D] });
  check('재계산 후 옛 추천에 판단 409', (await call('POST', '/decisions', { recommendation_id: rec.D.recommendation_id, selected_strategy: 'P50', decided_by: 1 })).status === 409);
  check('잘못된 strategy 400', (await call('POST', '/decisions', { recommendation_id: recalcD.created[0].recommendation_id, selected_strategy: 'P99', decided_by: 1 })).status === 400);

  console.log('[발주서 전환]');
  const invBefore = await must('GET', '/inventory');
  check('빈 배열 400', (await call('POST', '/decisions/convert-to-po', { decision_ids: [], created_by: 1 })).status === 400);
  check('없는 decision 404', (await call('POST', '/decisions/convert-to-po', { decision_ids: [9999], created_by: 1 })).status === 404);
  const bad = await call('POST', '/decisions/convert-to-po', { decision_ids: [dA.decision_id, dDrej.decision_id, dG.decision_id], created_by: 1 });
  check('rejected·수량0 포함 → 409 + 사유 목록', bad.status === 409 && bad.body.detail.length === 2, bad.body);
  check('409 시 아무것도 전환 안 됨 (롤백)', (await must('GET', `/recommendations?product_id=${A}`))[0].decision_status === 'confirmed');

  const conv = await must('POST', '/decisions/convert-to-po', { decision_ids: [dA.decision_id, dB.decision_id, dC.decision_id], created_by: 1 });
  const pos = conv.purchase_orders;
  check('공급업체별 2장 생성', pos.length === 2, pos.map((p) => p.supplier_id));
  const po1 = pos.find((p) => p.supplier_id === s1);
  const po2 = pos.find((p) => p.supplier_id === s2);
  check('공급사1 발주서: A 45 + C 999, draft', po1.status === 'draft' && po1.items.length === 2
    && po1.items.find((i) => i.product_id === A).ordered_qty === 45 && po1.items.find((i) => i.product_id === C).ordered_qty === 999);
  check('공급사2 발주서: B 72', po2.items.length === 1 && po2.items[0].ordered_qty === 72);
  check('품목에 recommendation_decision_id 연결', po1.items.find((i) => i.product_id === A).recommendation_decision_id === dA.decision_id
    && po2.items[0].recommendation_decision_id === dB.decision_id);
  const afterA = (await must('GET', `/recommendations?product_id=${A}`))[0];
  check('decision → converted_to_po + purchase_order_id', afterA.decision_status === 'converted_to_po' && afterA.purchase_order_id === po1.purchase_order_id);
  const invAfter = await must('GET', '/inventory');
  check('전환(draft) 후 재고·미입고 변화 없음', JSON.stringify(invBefore.map((r) => [r.on_hand_qty, r.outstanding_po_qty])) === JSON.stringify(invAfter.map((r) => [r.on_hand_qty, r.outstanding_po_qty])));
  check('재전환 409', (await call('POST', '/decisions/convert-to-po', { decision_ids: [dA.decision_id], created_by: 1 })).status === 409);
  check('중복 id 400', (await call('POST', '/decisions/convert-to-po', { decision_ids: [dA.decision_id, dA.decision_id], created_by: 1 })).status === 400);

  console.log('[전환 발주 확정 → 재계산 반영]');
  await must('POST', `/purchase-orders/${po1.purchase_order_id}/confirm`);
  const reA = (await must('POST', '/recommendations/calculate', { product_ids: [A] })).created[0];
  check('A 미입고 45 반영 → 재계산 권장량 0', reA.outstanding_po_qty_snapshot === 45 && reA.recommended_qty_p50 === 0, [reA.outstanding_po_qty_snapshot, reA.recommended_qty_p50]);

  console.log('[납기 실적 데이터 품질]');
  const badRc = await call('POST', '/receipts', { purchase_order_id: poB.purchase_order_id, receipt_date: ymd(1), items: [{ po_item_id: poB.items[0].po_item_id, received_qty: 1 }] });
  check('입고일 < 발주일 입고 등록 400', badRc.status === 400, badRc.body);
  await sql(`INSERT INTO receipts (receipt_no, purchase_order_id, receipt_date, status)
             SELECT 'BAD-1', purchase_order_id, order_date - 3, 'confirmed' FROM purchase_orders WHERE supplier_id = $1 ORDER BY purchase_order_id LIMIT 1`, [s1]);
  const reA2 = (await must('POST', '/recommendations/calculate', { product_ids: [A] })).created[0].calculation_detail.lead_time;
  check('DB에 직접 들어간 음수 표본은 제외 (표본 3, 제외 1, 평균 유지)', reA2.actual_samples === 3 && reA2.excluded_samples === 1 && reA2.actual_avg_days === 4.67, reA2);
  await db.end();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
