// 판매 이력 조회 기간 확대, 이전 판단 이력 조회, 판단 사후 평가 검증.
// 빈 테스트 DB 전제. 추천 계산일을 과거로 되돌리기 위해 테스트 DB에 직접 접속한다 — `npm test`로 실행.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const B = process.env.TEST_API_BASE || 'http://localhost:4001/api';
const db = new Pool({ database: process.env.TEST_DB || 'erp_test' });
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

async function sell(productId, qty, daysAgo) {
  const s = await must('POST', '/sales', { created_by: 1, sale_date: ymd(daysAgo), items: [{ product_id: productId, quantity: qty }] });
  await must('POST', `/sales/${s.sale_id}/confirm`, {});
}
// 추천 계산일을 n일 전으로 되돌린다 (보호기간이 이미 지난 과거 판단을 만들기 위함)
const backdate = (recId, n) => db.query(
  "UPDATE replenishment_recommendations SET calculated_at = now() - make_interval(days => $2::int) WHERE recommendation_id = $1",
  [recId, n]
);
const calc = async (pid) => (await must('POST', '/recommendations/calculate', { product_ids: [pid] })).created[0];

(async () => {
  console.log('[준비]');
  const sup = (await must('POST', '/suppliers', { supplier_name: '이력공급사' })).supplier_id;
  const prod = (b) => must('POST', '/products', { unit: 'EA', supplier_id: sup, ...b }).then((p) => p.product_id);
  const LONG = await prod({ sku: 'H-LONG', product_name: '긴보호기간', planned_lead_time_days: 6, review_period_days: 14, safety_stock_qty: 0 });
  const A = await prod({ sku: 'H-A', product_name: '일정수요', planned_lead_time_days: 3, review_period_days: 6, safety_stock_qty: 10 });
  const M = await prod({ sku: 'H-M', product_name: '수요급증', planned_lead_time_days: 3, review_period_days: 6, safety_stock_qty: 5 });
  const S = await prod({ sku: 'H-S', product_name: '수정없음', planned_lead_time_days: 3, review_period_days: 6, safety_stock_qty: 5 });
  // 기초 재고 = 45일 판매량 + 소량 잔여 (공급업체 입고 실적 1건 → 계획 납기 사용).
  // 재고가 넉넉하면 사후 적정량·추천이 모두 0이 되어 비교가 의미 없으므로 잔여를 작게 둔다.
  const opening = [[LONG, 45 * 5 + 100 + 10], [A, 45 * 5 + 10], [M, 20 * 8 + 25 * 2 + 5], [S, 45 * 3 + 5]];
  const po = await must('POST', '/purchase-orders', { supplier_id: sup, created_by: 1, items: opening.map(([id, q]) => ({ product_id: id, ordered_qty: q })) });
  await must('POST', `/purchase-orders/${po.purchase_order_id}/confirm`);
  const full = await must('GET', `/purchase-orders/${po.purchase_order_id}`);
  const rc = await must('POST', '/receipts', { purchase_order_id: po.purchase_order_id, items: full.items.map((i) => ({ po_item_id: i.po_item_id, received_qty: i.ordered_qty })) });
  await must('POST', `/receipts/${rc.receipt_id}/confirm`, {});

  for (let d = 1; d <= 45; d++) {
    await sell(LONG, 5, d);
    await sell(A, 5, d);
    await sell(S, 3, d);
    await sell(M, d <= 20 ? 8 : 2, d); // 최근 20일 수요 급증 (2 → 8개/일)
  }
  await sell(LONG, 100, 42); // 조회 기간(40일) 밖 판매 → 제외돼야 함

  console.log('[조회 기간 = max(28일, 보호기간×2)]');
  const rl = await calc(LONG);
  const dl = rl.calculation_detail;
  check('보호기간 20일 → 조회 기간 40일', dl.protection_period_days === 20 && dl.history_window.days === 40, dl.history_window);
  check('이력 40일 모두 사용 → 필요 40일 충족, 이력 충분', dl.available_days === 40 && dl.required_days === 40 && dl.insufficient_history === false, dl);
  check('일별 수요 40개 모두 5 (42일 전 판매 제외)', dl.daily_demand.length === 40 && dl.daily_demand.every((v) => v === 5));
  check('수요 = 5 × 20 = 100', rl.demand_p50 === 100 && rl.demand_p90 === 100, [rl.demand_p50, rl.demand_p90]);
  const ra = await calc(A);
  check('보호기간 9일 → 조회 기간 최소 28일 유지', ra.calculation_detail.history_window.days === 28 && ra.calculation_detail.daily_demand.length === 28);

  console.log('[과거 판단 만들기: 판단 후 계산일을 20일 전으로]');
  // A: 수요가 일정 → 시스템 추천이 정확, 관리자가 +20 수정 → 시스템이 더 가까움
  const decA = await must('POST', '/decisions', { recommendation_id: ra.recommendation_id, selected_strategy: 'custom', final_qty: ra.recommended_qty_p50 + 20, modification_reason: '행사 대비 추가', decided_by: 1 });
  await backdate(ra.recommendation_id, 20);
  // M: 최근 수요 급증 → 평가 기간 실제 수요는 8×9 = 72. 관리자가 정확히 사후 적정량으로 수정 → 관리자가 더 가까움
  const rm = await calc(M);
  const ipM = rm.calculation_detail.inventory_position;
  const qStarM = Math.max(0, Math.ceil(72 + 5 - ipM));
  const decM = await must('POST', '/decisions', { recommendation_id: rm.recommendation_id, selected_strategy: 'custom', final_qty: qStarM, modification_reason: '최근 판매 급증 반영', decided_by: 1 });
  await backdate(rm.recommendation_id, 20);
  // S: 추천 그대로 수용
  const rs = await calc(S);
  const decS = await must('POST', '/decisions', { recommendation_id: rs.recommendation_id, selected_strategy: 'P50', decided_by: 1 });
  await backdate(rs.recommendation_id, 20);
  // 반려된 판단은 평가 대상이 아님
  const rl2 = await calc(LONG);
  await must('POST', '/decisions', { recommendation_id: rl2.recommendation_id, selected_strategy: 'P50', decision_status: 'rejected', decided_by: 1 });

  console.log('[이전 판단 이력 조회]');
  const ra2 = await calc(A); // 새 추천 (현재 판단 대상)
  const histA = await must('GET', `/decisions?product_id=${A}&exclude_recommendation_id=${ra2.recommendation_id}`);
  check('같은 상품의 이전 판단 1건 조회', histA.length === 1 && histA[0].decision_id === decA.decision_id, histA.map((h) => h.decision_id));
  check('이전 판단에 수정 사유·추천→최종 수량 포함', histA[0].modification_reason === '행사 대비 추가' && histA[0].final_qty - histA[0].system_recommended_qty === 20);
  check('현재 추천은 제외 필터 동작', (await must('GET', `/decisions?product_id=${A}&exclude_recommendation_id=${ra.recommendation_id}`)).length === 0);
  check('반려된 판단은 이력에서 제외', (await must('GET', `/decisions?product_id=${LONG}`)).length === 0);

  console.log('[사후 평가]');
  const eA = histA[0].evaluation;
  const expectA = Math.max(0, Math.ceil(45 + 10 - histA[0].inventory_position));
  check('A: 실제 수요 = 5×9 = 45 (계산일부터 보호기간 9일)', eA.status === 'evaluated' && eA.actual_demand === 45, eA);
  check('A: 사후 적정량 = 45 + 안전 10 − 재고 위치', eA.hindsight_qty === expectA, [eA.hindsight_qty, expectA]);
  check('A: 시스템 오차 0, 관리자 오차 20 → 시스템이 더 가까움', eA.system_error === 0 && eA.manager_error === 20 && eA.closer === 'system', eA);
  const eM = (await must('GET', `/decisions?product_id=${M}`))[0].evaluation;
  check('M: 실제 수요 72, 관리자가 사후 적정량과 일치 → 관리자가 더 가까움', eM.actual_demand === 72 && eM.manager_error === 0 && eM.system_error > 0 && eM.closer === 'manager', eM);
  const eS = (await must('GET', `/decisions?product_id=${S}`))[0].evaluation;
  check('S: 수정 없음 → closer = same', eS.status === 'evaluated' && eS.modified === false && eS.closer === 'same', eS);

  const decNow = await must('POST', '/decisions', { recommendation_id: ra2.recommendation_id, selected_strategy: 'P70', decided_by: 1 });
  const pending = (await must('GET', `/decisions?product_id=${A}`)).find((d) => d.decision_id === decNow.decision_id);
  check('오늘 판단은 평가 대기 (보호기간 9일 남음)', pending.evaluation.status === 'pending' && pending.days_until_evaluable === 9, pending);

  const ev = await must('GET', '/decisions/evaluation');
  const sm = ev.summary;
  check('요약: 전체 4건(반려 제외), 평가 3건, 대기 1건', sm.total === 4 && sm.evaluated === 3 && sm.pending === 1, sm);
  check('요약: 수정한 판단 2건 중 관리자 1·시스템 1', sm.modified_evaluated === 2 && sm.manager_closer === 1 && sm.system_closer === 1, sm);
  check('요약: 수정한 판단의 평균 오차 (시스템 vs 관리자)',
    sm.mae_manager_on_modified === (20 + 0) / 2 && sm.mae_system_on_modified === (0 + eM.system_error) / 2, sm);
  check('상품 필터', (await must('GET', `/decisions/evaluation?product_id=${M}`)).summary.total === 1);

  await db.end();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(async (err) => { console.error(err); await db.end(); process.exit(1); });
