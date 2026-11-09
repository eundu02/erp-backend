// 논문 5장 보조 실험: 고정 안전재고(평균 수요) 기준선, 안전재고 민감도, 분위수 손실, 시드 반복.
// DB 없이 실행한다 (node scripts/backtest-baseline.js). seed-demo.js와 같은 생성 규칙·시드로 데모 판매 데이터를
// 메모리에 다시 만들고, services/forecast.js·services/backtest.js를 그대로 불러 같은 55건을 계산한다.
// TODAY는 논문 실험을 실행한 날(2026-10-28, 기준일 범위 09-23~10-20)이다.
const path = require("path");
const REPO = path.join(__dirname, '..');
const { backtestCase, summarizeBacktest, addDays } = require(path.join(REPO, 'src/services/backtest.js'));
const { bootstrapDemand } = require(path.join(REPO, 'src/services/forecast.js'));

const catalog = [
  { sku: 'FD-001', s: 'food', lt: 3, rp: 7, ss: 30, mean: 9 },
  { sku: 'FD-002', s: 'food', lt: 4, rp: 7, ss: 20, mean: 5 },
  { sku: 'FD-003', s: 'food', lt: 5, rp: 7, ss: 10, mean: 2 },
  { sku: 'LV-001', s: 'living', lt: 7, rp: 14, ss: 15, mean: 3 },
  { sku: 'LV-002', s: 'living', lt: 7, rp: 14, ss: 24, mean: 4 },
  { sku: 'LV-003', s: 'living', lt: 5, rp: 14, ss: 40, mean: 8 },
  { sku: 'OF-001', s: 'office', lt: 7, rp: 7, ss: 20, mean: 4 },
  { sku: 'OF-002', s: 'office', lt: 10, rp: 14, ss: 15, mean: 2 },
  { sku: 'OF-003', s: null, lt: 14, rp: 30, ss: 5, mean: 1 },
];
catalog.forEach((c, i) => { c.product_id = i + 1; });
const history = { food: [[80, 4], [58, 5], [36, 4]], living: [[76, 9], [44, 10]], office: [[84, 8], [64, 7], [44, 9], [24, 8]] };

function run({ today = '2026-10-28', seedStart = 20261015, ssScale = 1, baseline = false } = {}) {
  let seed = seedStart;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const daily = {}; let firstSale = {};
  for (let i = 60; i >= 1; i--) {
    const date = addDays(today, -i);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const w = dow === 0 || dow === 6 ? 0.6 : 1;
    for (const c of catalog) {
      const q = Math.max(0, Math.round(c.mean * w * (0.5 + rand())));
      if (q > 0) { (daily[c.product_id] ??= {})[date] = q; if (!firstSale[c.product_id]) firstSale[c.product_id] = date; }
    }
  }
  const receipts = [];
  for (const [k, rounds] of Object.entries(history)) for (const [n, lt] of rounds) receipts.push({ s: k, receipt_date: addDays(today, -(n - lt)), lead: lt });
  const rules = { baseDays: 28, maxDays: 365, minRequired: 14, minLeadSamples: 3 };
  const dates = []; for (let d = addDays(today, -35); d <= addDays(today, -8); d = addDays(d, 3)) dates.push(d);
  const cases = []; const skipped = { not_evaluable: 0, no_history: 0 };
  for (const asOf of dates) for (const c of catalog.filter((x) => x.s)) {
    const p = { product_id: c.product_id, sku: c.sku, product_name: c.sku, planned_lead_time_days: c.lt, review_period_days: c.rp, safety_stock_qty: c.ss * ssScale };
    const lead = receipts.filter((r) => r.s === c.s && r.receipt_date < asOf).map((r) => r.lead);
    const r = backtestCase(p, asOf, daily[c.product_id] ?? {}, firstSale[c.product_id] ?? null, lead, today, rules);
    if (r.skip) { skipped[r.skip]++; continue; }
    // 기준선: 같은 조회 기간 일평균 × 보호기간 + 같은 안전재고
    const windowEnd = addDays(asOf, -1);
    let start = addDays(windowEnd, -(r.window_days - 1)); if (firstSale[c.product_id] > start) start = firstSale[c.product_id];
    const series = []; for (let d = start; d <= windowEnd; d = addDays(d, 1)) series.push(daily[c.product_id]?.[d] ?? 0);
    const avg = series.reduce((a, b) => a + b, 0) / series.length * r.protection_days;
    r.baseline = { demand: avg, target: avg + p.safety_stock_qty };
    r.hist_mean_daily = series.reduce((a, b) => a + b, 0) / series.length;
    cases.push(r);
  }
  return { cases, skipped, summary: summarizeBacktest(cases) };
}
const pinball = (q, y, tau) => (y >= q ? tau * (y - q) : (1 - tau) * (q - y));
function extra(cases) {
  const n = cases.length; const o = {};
  for (const [s, tau] of [['p50', .5], ['p70', .7], ['p90', .9]]) o[s] = { pinball: +(cases.reduce((a, c) => a + pinball(c.strategies[s].demand, c.actual_demand, tau), 0) / n).toFixed(2) };
  const b = cases.map((c) => c.baseline);
  o.baseline = {
    demand_cov: +(cases.filter((c) => c.actual_demand <= c.baseline.demand).length / n * 100).toFixed(2),
    target_cov: +(cases.filter((c) => c.actual_demand <= c.baseline.target).length / n * 100).toFixed(2),
    shortage: +(cases.reduce((a, c) => a + Math.max(0, c.actual_demand - c.baseline.target), 0) / n).toFixed(2),
    excess: +(cases.reduce((a, c) => a + Math.max(0, c.baseline.target - c.actual_demand), 0) / n).toFixed(2),
    mae: +(cases.reduce((a, c) => a + Math.abs(c.baseline.demand - c.actual_demand), 0) / n).toFixed(2),
    pinball50: +(cases.reduce((a, c) => a + pinball(c.baseline.demand, c.actual_demand, .5), 0) / n).toFixed(2),
  };
  return o;
}
module.exports = { run, extra, catalog };

if (require.main === module) {
  const fmt = (s) => `충족률 ${s.target_coverage_pct}% 적중률 ${s.demand_coverage_pct}% 부족 ${s.avg_shortage} 과잉 ${s.avg_excess} MAE ${s.mae_demand}`;
  const base = run();
  console.log(`사례 ${base.cases.length}건, 제외`, base.skipped);
  const av = base.cases.map((c) => c.available_days);
  console.log(`판매 이력 ${Math.min(...av)}~${Math.max(...av)}일, 이력 부족 ${base.cases.filter((c) => c.insufficient_history).length}건`);
  for (const scale of [1, 0.5, 0]) {
    const r = run({ ssScale: scale }); const e = extra(r.cases);
    console.log(`\n[안전재고 x${scale}]`);
    for (const s of ['p50', 'p70', 'p90']) console.log(s.toUpperCase(), fmt(r.summary[s]), '분위수손실', e[s].pinball);
    const b = e.baseline;
    console.log('기준선', `충족률 ${b.target_cov}% 적중률 ${b.demand_cov}% 부족 ${b.shortage} 과잉 ${b.excess} MAE ${b.mae} 분위수손실(0.5) ${b.pinball50}`);
  }
  const agg = { p50: [], p70: [], p90: [] };
  for (let k = 1; k <= 30; k++) { const r = run({ seedStart: 20261015 + k * 7919 }); for (const s of Object.keys(agg)) agg[s].push(r.summary[s].demand_coverage_pct); }
  console.log('\n[시드 30개 반복] 분위수 적중률 평균(최소~최대)');
  for (const [s, v] of Object.entries(agg)) console.log(s.toUpperCase(), (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), `(${Math.min(...v)}~${Math.max(...v)})`);
}
