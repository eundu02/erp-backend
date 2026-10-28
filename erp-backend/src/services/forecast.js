// 규칙 기반 발주 추천 계산 (평균 수요 + 안전재고, 부트스트랩 분위수).
// DB 접근 없는 순수 함수만 둔다 — 같은 입력(일별 수요, seed)이면 항상 같은 결과가 나와야 재현 가능하다.

const BOOTSTRAP_ITERATIONS = 1000;
const QUANTILES = { p50: 0.5, p70: 0.7, p90: 0.9 };

// 시드 고정 난수 (mulberry32). seed를 calculation_detail에 저장해 두면 동일 결과를 재현할 수 있다.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 선형 보간 분위수 (R type 7 / numpy 기본값). sorted는 오름차순 정렬된 배열.
function quantile(sorted, q) {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 보호기간 수요의 분위수를 부트스트랩으로 추정한다.
 * 일별 수요에서 protectionDays개를 복원추출해 합한 값을 iterations번 만들고, 그 분포의 P50/P70/P90을 구한다.
 * @param {number[]} dailyDemand 사용 가능 기간의 일별 판매량 (판매 없는 날은 0)
 * @param {number} protectionDays 보호기간 일수
 * @param {number} seed
 */
function bootstrapDemand(dailyDemand, protectionDays, seed, iterations = BOOTSTRAP_ITERATIONS) {
  const rand = mulberry32(seed);
  const sums = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let d = 0; d < protectionDays; d++) {
      sum += dailyDemand[Math.floor(rand() * dailyDemand.length)];
    }
    sums[i] = sum;
  }
  sums.sort((a, b) => a - b);
  return Object.fromEntries(Object.entries(QUANTILES).map(([k, q]) => [k, round2(quantile(sums, q))]));
}

/**
 * 권장 발주량 = max(0, 목표재고 − 재고 위치). 양수면 정수로 올림 → 최소 주문량 미만이면 최소 주문량 → 주문 배수로 올림.
 * 권장량이 0이면 최소 주문량을 강제하지 않는다 (발주할 필요가 없음).
 */
function orderQuantity({ demand, safetyStock, inventoryPosition, minimumOrderQty, orderMultiple }) {
  const targetStock = round2(demand + safetyStock);
  const rawQty = round2(Math.max(0, targetStock - inventoryPosition));
  if (rawQty <= 0) {
    return { target_stock: targetStock, raw_qty: 0, after_moq: 0, recommended_qty: 0 };
  }
  const afterMoq = Math.max(Math.ceil(rawQty), minimumOrderQty);
  const recommended = Math.ceil(afterMoq / orderMultiple) * orderMultiple;
  return { target_stock: targetStock, raw_qty: rawQty, after_moq: afterMoq, recommended_qty: recommended };
}

module.exports = { BOOTSTRAP_ITERATIONS, bootstrapDemand, orderQuantity, quantile, mulberry32 };
