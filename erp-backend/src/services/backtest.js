// 백테스트 (DB 접근 없는 순수 함수).
// 과거 기준일 D마다 "D 시점에 알 수 있었던 정보만으로" 수요 분위수를 다시 계산하고,
// D부터 보호기간 동안의 실제 확정 판매량과 비교한다. 미래 정보(D 이후 판매·입고)는 계산에 쓰지 않는다.
//
// 평가는 재고 위치(과거 시점 복원 불가) 대신 목표재고 기준으로 한다:
//   목표재고 = 예측 수요(분위수) + 안전재고. 목표재고까지 채웠다면 실제 수요 > 목표재고일 때만 품절.
const { bootstrapDemand } = require('./forecast');

const STRATEGIES = ['p50', 'p70', 'p90'];
const toUtc = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = toUtc(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
const round2 = (v) => Math.round(v * 100) / 100;

// 상품·기준일로 정해지는 시드 → 같은 데이터면 백테스트 결과가 항상 같다 (재현성)
const seedOf = (productId, asOf) => (productId * 100003 + Math.round(toUtc(asOf) / 86400000)) % 2147483647;

/**
 * 한 상품·한 기준일의 백테스트 사례.
 * @param {object} p        상품 (product_id, sku, product_name, planned_lead_time_days, review_period_days, safety_stock_qty)
 * @param {string} asOf     기준일 'YYYY-MM-DD'
 * @param {object} daily    { 'YYYY-MM-DD': qty } 확정 판매 일별 합계 (전 기간)
 * @param {string|null} firstSale 최초 확정 판매일
 * @param {number[]} leadSamples  기준일 이전에 확정된 입고의 실제 납기 표본(일)
 * @param {string} today    오늘 (평가 가능 여부 판단)
 * @param {object} rules    { baseDays, maxDays, minRequired, minLeadSamples }
 */
function backtestCase(p, asOf, daily, firstSale, leadSamples, today, rules) {
  const useActual = leadSamples.length >= rules.minLeadSamples;
  const leadTime = useActual
    ? Math.round(leadSamples.reduce((a, b) => a + b, 0) / leadSamples.length)
    : p.planned_lead_time_days;
  const T = leadTime + p.review_period_days;
  const evalEnd = addDays(asOf, T - 1);
  if (evalEnd >= today) return { skip: 'not_evaluable' }; // 보호기간이 아직 끝나지 않음

  const requiredDays = Math.max(T * 2, rules.minRequired);
  const windowDays = Math.min(Math.max(rules.baseDays, requiredDays), rules.maxDays);
  const windowEnd = addDays(asOf, -1);
  const windowStart = addDays(windowEnd, -(windowDays - 1));
  if (!firstSale || firstSale > windowEnd) return { skip: 'no_history' };
  const start = firstSale > windowStart ? firstSale : windowStart;
  const n = daysBetween(start, windowEnd) + 1;
  const series = Array.from({ length: n }, (_, i) => daily[addDays(start, i)] ?? 0);
  if (series.every((v) => v === 0)) return { skip: 'no_history' };

  const demand = bootstrapDemand(series, T, seedOf(p.product_id, asOf));
  let actual = 0;
  for (let i = 0; i < T; i++) actual += daily[addDays(asOf, i)] ?? 0;

  const perStrategy = {};
  for (const s of STRATEGIES) {
    const target = round2(demand[s] + p.safety_stock_qty);
    perStrategy[s] = {
      demand: demand[s],
      target,
      demand_covered: actual <= demand[s],   // 분위수 적중 (보정 확인용)
      target_covered: actual <= target,      // 목표재고 충족 (품절 없음)
      shortage: round2(Math.max(0, actual - target)),
      excess: round2(Math.max(0, target - actual)),
    };
  }
  return {
    product_id: p.product_id, sku: p.sku, product_name: p.product_name,
    as_of: asOf, eval_end: evalEnd, lead_time_source: useActual ? 'actual_supplier_avg' : 'planned',
    applied_lead_time_days: leadTime, protection_days: T, window_days: windowDays, available_days: n,
    insufficient_history: n < requiredDays, safety_stock_qty: p.safety_stock_qty,
    actual_demand: actual, strategies: perStrategy,
  };
}

// 전략별 요약: 목표재고 충족률(서비스 수준), 평균 부족·과잉량, 분위수 적중률, P50 절대 오차
function summarizeBacktest(cases) {
  const out = {};
  for (const s of STRATEGIES) {
    const n = cases.length;
    const rate = (key) => (n ? round2((cases.filter((c) => c.strategies[s][key]).length / n) * 100) : null);
    const avg = (key) => (n ? round2(cases.reduce((a, c) => a + c.strategies[s][key], 0) / n) : null);
    out[s] = {
      cases: n,
      target_coverage_pct: rate('target_covered'),
      demand_coverage_pct: rate('demand_covered'),
      nominal_pct: { p50: 50, p70: 70, p90: 90 }[s],
      avg_shortage: avg('shortage'),
      avg_excess: avg('excess'),
      mae_demand: n ? round2(cases.reduce((a, c) => a + Math.abs(c.strategies[s].demand - c.actual_demand), 0) / n) : null,
    };
  }
  return out;
}

module.exports = { backtestCase, summarizeBacktest, addDays };
