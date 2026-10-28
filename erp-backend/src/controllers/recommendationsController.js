const crypto = require('crypto');
const pool = require('../db/pool');
const withTransaction = require('../db/transaction');
const httpError = require('../utils/httpError');
const { BOOTSTRAP_ITERATIONS, bootstrapDemand, orderQuantity } = require('../services/forecast');

const HISTORY_DAYS = 28;      // 수요 집계 기간: 어제까지 최근 28일 (오늘은 집계가 끝나지 않아 제외)
const MIN_REQUIRED_DAYS = 14; // 이력 충분 기준: max(보호기간 × 2, 14일)
const MIN_LEAD_TIME_SAMPLES = 3; // 공급업체 실적 납기 사용 기준: 확정 입고 3건 이상
const MODEL_NAME = 'rule_based';
const MODEL_VERSION = 'v1-bootstrap28-lt';
const STRATEGIES = ['p50', 'p70', 'p90'];

// 'YYYY-MM-DD' 날짜 연산 (UTC 기준으로 계산해 시간대 영향 제거)
const toUtc = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
function addDays(s, n) {
  const d = toUtc(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000); // b - a

// numeric 컬럼은 pg가 문자열로 반환하므로 응답에서는 숫자로 바꿔준다.
function normalize(row) {
  for (const k of ['demand_p50', 'demand_p70', 'demand_p90']) {
    if (row[k] !== null && row[k] !== undefined) row[k] = Number(row[k]);
  }
  return row;
}

// 상품별 계산 입력값 (현재고, 미입고 발주량 포함)
async function loadProducts(client, productIds) {
  const { rows } = await client.query(
    `SELECT p.*,
            COALESCE(ib.on_hand_qty, 0) AS on_hand_qty,
            COALESCE(po.outstanding_qty, 0)::int AS outstanding_po_qty
       FROM products p
       LEFT JOIN inventory_balances ib ON ib.product_id = p.product_id
       LEFT JOIN (
         SELECT poi.product_id, SUM(poi.ordered_qty - poi.received_qty) AS outstanding_qty
           FROM purchase_order_items poi
           JOIN purchase_orders o ON o.purchase_order_id = poi.purchase_order_id
          WHERE o.status IN ('confirmed', 'partially_received')
          GROUP BY poi.product_id
       ) po ON po.product_id = p.product_id
      WHERE ${productIds ? 'p.product_id = ANY($1::int[])' : 'p.is_active'}
      ORDER BY p.product_id`,
    productIds ? [productIds] : []
  );
  return rows;
}

// 확정 판매(sale_date 기준)의 일별 합계와 상품별 최초 확정 판매일
async function loadSalesHistory(client, productIds, windowStart, windowEnd) {
  const { rows: daily } = await client.query(
    `SELECT si.product_id, s.sale_date, SUM(si.quantity)::int AS qty
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.sale_id
      WHERE s.status = 'confirmed'
        AND s.sale_date BETWEEN $1 AND $2
        AND si.product_id = ANY($3::int[])
      GROUP BY si.product_id, s.sale_date`,
    [windowStart, windowEnd, productIds]
  );
  const { rows: first } = await client.query(
    `SELECT si.product_id, MIN(s.sale_date) AS first_sale_date
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.sale_id
      WHERE s.status = 'confirmed' AND si.product_id = ANY($1::int[])
      GROUP BY si.product_id`,
    [productIds]
  );

  const byProduct = {};
  for (const r of daily) (byProduct[r.product_id] ??= {})[r.sale_date] = r.qty;
  const firstSale = Object.fromEntries(first.map((r) => [r.product_id, r.first_sale_date]));
  return { byProduct, firstSale };
}

// 공급업체별 실제 납기 실적: 확정 입고 1건 = 표본 1개, 값 = receipt_date − 연결된 발주서 order_date (일).
// 입고일이 발주일보다 앞선 비정상 표본은 평균에서 제외하고 건수만 기록한다.
async function loadSupplierLeadTimes(client, supplierIds) {
  const { rows } = await client.query(
    `SELECT o.supplier_id,
            COUNT(*) FILTER (WHERE r.receipt_date >= o.order_date)::int AS samples,
            AVG(r.receipt_date - o.order_date) FILTER (WHERE r.receipt_date >= o.order_date)::float8 AS avg_days,
            MIN(r.receipt_date - o.order_date) FILTER (WHERE r.receipt_date >= o.order_date) AS min_days,
            MAX(r.receipt_date - o.order_date) FILTER (WHERE r.receipt_date >= o.order_date) AS max_days,
            COUNT(*) FILTER (WHERE r.receipt_date < o.order_date)::int AS excluded
       FROM receipts r
       JOIN purchase_orders o ON o.purchase_order_id = r.purchase_order_id
      WHERE r.status = 'confirmed' AND o.supplier_id = ANY($1::int[])
      GROUP BY o.supplier_id`,
    [supplierIds]
  );
  return Object.fromEntries(rows.map((r) => [r.supplier_id, r]));
}

// 적용 납기 결정: 공급업체 실적 표본이 3건 이상이면 평균 실제 납기(반올림), 아니면 계획 납기로 폴백.
// 어느 쪽을 썼는지와 표본 수를 calculation_detail.lead_time에 남겨 재현 가능하게 한다.
function resolveLeadTime(product, supplierStats) {
  const st = supplierStats[product.supplier_id];
  const samples = st?.samples ?? 0;
  const avg = samples > 0 ? Math.round(st.avg_days * 100) / 100 : null;
  const useActual = samples >= MIN_LEAD_TIME_SAMPLES;
  return {
    source: useActual ? 'actual_supplier_avg' : 'planned',
    applied_days: useActual ? Math.round(st.avg_days) : product.planned_lead_time_days,
    planned_days: product.planned_lead_time_days,
    supplier_id: product.supplier_id,
    actual_samples: samples,
    actual_avg_days: avg,
    actual_min_days: st?.min_days ?? null,
    actual_max_days: st?.max_days ?? null,
    excluded_samples: st?.excluded ?? 0,
    min_samples_required: MIN_LEAD_TIME_SAMPLES,
    rounding: 'round',
  };
}

// POST /api/recommendations/calculate  { product_ids?: number[] }  (생략 시 사용 중인 전 상품)
async function calculate(req, res) {
  const productIds = req.body?.product_ids;
  if (productIds !== undefined) {
    if (!Array.isArray(productIds) || productIds.length === 0 || !productIds.every((v) => Number.isInteger(v) && v > 0)) {
      throw httpError(400, 'product_ids는 1 이상의 정수로 된 배열이어야 합니다.');
    }
  }

  const result = await withTransaction(async (client) => {
    const products = await loadProducts(client, productIds ? [...new Set(productIds)] : null);
    if (productIds) {
      const found = new Set(products.map((p) => p.product_id));
      const missing = productIds.filter((id) => !found.has(id));
      if (missing.length) throw httpError(404, `상품을 찾을 수 없습니다. (product_id=${missing.join(', ')})`);
    }

    const { rows: w } = await client.query(
      `SELECT (CURRENT_DATE - $1::int)::text AS start, (CURRENT_DATE - 1)::text AS "end"`,
      [HISTORY_DAYS]
    );
    const windowStart = w[0].start;
    const windowEnd = w[0].end;
    const { byProduct, firstSale } = await loadSalesHistory(
      client, products.map((p) => p.product_id), windowStart, windowEnd
    );
    const supplierStats = await loadSupplierLeadTimes(
      client, [...new Set(products.map((p) => p.supplier_id).filter((v) => v !== null))]
    );

    const created = [];
    const notForecastable = [];
    const skipped = [];

    for (const p of products) {
      const base = { product_id: p.product_id, sku: p.sku, product_name: p.product_name };
      if (!p.is_active) {
        skipped.push({ ...base, reason: '미사용 상품' });
        continue;
      }
      if (p.supplier_id === null) {
        skipped.push({ ...base, reason: '공급업체 미지정 — 발주 추천 계산 대상에서 제외' });
        continue;
      }

      const sales = byProduct[p.product_id] ?? {};
      const inventoryPosition = p.on_hand_qty + p.outstanding_po_qty;

      // 수요 집계 기간 안에 확정 판매가 한 건도 없으면 예측 불가 → 스냅샷을 저장하지 않고 안전재고만 안내
      if (Object.keys(sales).length === 0) {
        notForecastable.push({
          ...base,
          status: '예측 불가',
          reason: `최근 ${HISTORY_DAYS}일(${windowStart} ~ ${windowEnd}) 확정 판매 이력 없음`,
          safety_stock_qty: p.safety_stock_qty,
          on_hand_qty: p.on_hand_qty,
          outstanding_po_qty: p.outstanding_po_qty,
        });
        continue;
      }

      // 사용 가능 기간: 최초 확정 판매일 이후만 사용 (출시 전 날짜를 0으로 채워 수요를 과소추정하지 않도록)
      const availableStart = firstSale[p.product_id] > windowStart ? firstSale[p.product_id] : windowStart;
      const availableDays = daysBetween(availableStart, windowEnd) + 1;
      const dailyDemand = Array.from({ length: availableDays }, (_, i) => sales[addDays(availableStart, i)] ?? 0);

      const leadTime = resolveLeadTime(p, supplierStats);
      const appliedLeadTime = leadTime.applied_days;
      const protectionDays = appliedLeadTime + p.review_period_days;
      const requiredDays = Math.max(protectionDays * 2, MIN_REQUIRED_DAYS);

      const seed = crypto.randomInt(0, 2 ** 31 - 1);
      const demand = bootstrapDemand(dailyDemand, protectionDays, seed);

      const perStrategy = {};
      for (const s of STRATEGIES) {
        perStrategy[s] = orderQuantity({
          demand: demand[s],
          safetyStock: p.safety_stock_qty,
          inventoryPosition,
          minimumOrderQty: p.minimum_order_qty,
          orderMultiple: p.order_multiple,
        });
      }

      const detail = {
        history_window: { start: windowStart, end: windowEnd, days: HISTORY_DAYS },
        available_start: availableStart,
        available_days: availableDays,
        required_days: requiredDays,
        insufficient_history: availableDays < requiredDays,
        daily_demand: dailyDemand,
        mean_daily_demand: Math.round((dailyDemand.reduce((a, b) => a + b, 0) / availableDays) * 100) / 100,
        lead_time: leadTime,
        protection_period_days: protectionDays,
        inventory_position: inventoryPosition,
        minimum_order_qty: p.minimum_order_qty,
        order_multiple: p.order_multiple,
        bootstrap: { iterations: BOOTSTRAP_ITERATIONS, seed, quantile_method: 'linear (type 7)' },
        strategies: perStrategy,
      };

      const { rows } = await client.query(
        `INSERT INTO replenishment_recommendations
           (product_id, on_hand_qty_snapshot, outstanding_po_qty_snapshot, applied_lead_time_days,
            review_period_days_snapshot, safety_stock_qty_snapshot,
            demand_p50, demand_p70, demand_p90,
            recommended_qty_p50, recommended_qty_p70, recommended_qty_p90,
            model_name, model_version, calculation_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [p.product_id, p.on_hand_qty, p.outstanding_po_qty, appliedLeadTime,
          p.review_period_days, p.safety_stock_qty,
          demand.p50, demand.p70, demand.p90,
          perStrategy.p50.recommended_qty, perStrategy.p70.recommended_qty, perStrategy.p90.recommended_qty,
          MODEL_NAME, MODEL_VERSION, detail]
      );
      created.push({ ...normalize(rows[0]), sku: p.sku, product_name: p.product_name, default_strategy: p.default_strategy });
    }

    return { created, not_forecastable: notForecastable, skipped };
  });

  res.status(201).json(result);
}

// GET /api/recommendations  (?product_id, ?latest=true: 상품별 최신 1건만, ?limit)
// 각 추천에 연결된 최신 판단 이력(decision)을 함께 반환한다.
async function list(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.product_id !== undefined) {
    values.push(req.query.product_id);
    conditions.push(`r.product_id = $${values.length}`);
  }
  if (req.query.latest === 'true') {
    conditions.push(`r.recommendation_id = (
      SELECT MAX(r2.recommendation_id) FROM replenishment_recommendations r2 WHERE r2.product_id = r.product_id)`);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
  values.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT r.*, p.sku, p.product_name, p.unit, p.supplier_id, s.supplier_name, p.default_strategy,
            d.decision_id, d.selected_strategy, d.final_qty, d.decision_status, d.purchase_order_id
       FROM replenishment_recommendations r
       JOIN products p ON p.product_id = r.product_id
       LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
       LEFT JOIN LATERAL (
         SELECT * FROM recommendation_decisions d
          WHERE d.recommendation_id = r.recommendation_id
          ORDER BY d.decision_id DESC
          LIMIT 1
       ) d ON true
       ${where}
      ORDER BY r.recommendation_id DESC
      LIMIT $${values.length}`,
    values
  );
  res.json(rows.map(normalize));
}

module.exports = { calculate, list };
