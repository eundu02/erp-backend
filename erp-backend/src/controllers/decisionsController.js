const pool = require('../db/pool');
const withTransaction = require('../db/transaction');
const httpError = require('../utils/httpError');
const { requirePositiveInt } = require('../utils/validate');
const { nextIdAndNo } = require('../services/docNo');
const { fetchPurchaseOrder } = require('./purchaseOrdersController');
const { evaluateDecision, summarize } = require('../services/evaluation');

const STRATEGIES = ['P50', 'P70', 'P90', 'custom'];
const ACTIVE_STATUSES = ['pending', 'confirmed', 'converted_to_po']; // 같은 추천에 이 상태의 판단이 있으면 중복 등록 불가

// POST /api/decisions
// 바디: { recommendation_id, selected_strategy: P50|P70|P90|custom, final_qty?, modification_reason?, decided_by, decision_status?: confirmed|rejected }
//  - system_recommended_qty: 선택한 전략의 추천수량을 결정 시점 값으로 고정 (custom이면 상품 기본 전략의 추천수량을 기준으로 삼는다)
//  - final_qty 생략 시 system_recommended_qty 그대로 (custom은 필수)
//  - final_qty ≠ system_recommended_qty면 modification_reason 필수 (DB CHECK와 동일 규칙을 400으로 먼저 안내)
async function create(req, res) {
  const { recommendation_id, selected_strategy, decided_by } = req.body;
  let { final_qty, modification_reason } = req.body;
  const decisionStatus = req.body.decision_status ?? 'confirmed';

  requirePositiveInt(recommendation_id, 'recommendation_id');
  requirePositiveInt(decided_by, 'decided_by');
  if (!STRATEGIES.includes(selected_strategy)) {
    throw httpError(400, `selected_strategy는 ${STRATEGIES.join(', ')} 중 하나여야 합니다.`);
  }
  if (!['confirmed', 'rejected'].includes(decisionStatus)) {
    throw httpError(400, 'decision_status는 confirmed 또는 rejected만 지정할 수 있습니다.');
  }
  if (final_qty !== undefined && final_qty !== null && !(Number.isInteger(final_qty) && final_qty >= 0)) {
    throw httpError(400, 'final_qty는 0 이상의 정수여야 합니다.');
  }
  if (selected_strategy === 'custom' && (final_qty === undefined || final_qty === null)) {
    throw httpError(400, 'custom 전략은 final_qty가 필수입니다.');
  }
  modification_reason = modification_reason ? String(modification_reason).trim() : null;

  const decisionId = await withTransaction(async (client) => {
    // 추천 행을 잠가 같은 추천에 대한 판단이 동시에 두 건 생기지 않게 한다.
    const { rows } = await client.query(
      `SELECT r.*, p.default_strategy
         FROM replenishment_recommendations r
         JOIN products p ON p.product_id = r.product_id
        WHERE r.recommendation_id = $1
        FOR UPDATE OF r`,
      [recommendation_id]
    );
    if (rows.length === 0) throw httpError(404, '추천을 찾을 수 없습니다.');
    const rec = rows[0];

    const { rows: latest } = await client.query(
      'SELECT MAX(recommendation_id) AS id FROM replenishment_recommendations WHERE product_id = $1',
      [rec.product_id]
    );
    if (latest[0].id !== rec.recommendation_id) {
      throw httpError(409, `더 최근에 계산된 추천(recommendation_id=${latest[0].id})이 있습니다. 최신 추천으로 판단하세요.`);
    }

    const { rows: dup } = await client.query(
      'SELECT decision_id, decision_status FROM recommendation_decisions WHERE recommendation_id = $1 AND decision_status = ANY($2)',
      [recommendation_id, ACTIVE_STATUSES]
    );
    if (dup.length) {
      throw httpError(409, `이 추천에는 이미 판단 이력이 있습니다. (decision_id=${dup[0].decision_id}, 상태: ${dup[0].decision_status})`);
    }

    const baseStrategy = selected_strategy === 'custom' ? rec.default_strategy : selected_strategy;
    const systemQty = rec[`recommended_qty_${baseStrategy.toLowerCase()}`];
    const finalQty = final_qty ?? systemQty;
    if (finalQty !== systemQty && !modification_reason) {
      throw httpError(400, `최종 수량(${finalQty})이 시스템 추천(${systemQty})과 다르면 modification_reason(수정 사유)이 필수입니다.`);
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO recommendation_decisions
         (recommendation_id, selected_strategy, system_recommended_qty, final_qty, modification_reason,
          decision_status, decided_by, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING decision_id`,
      [recommendation_id, selected_strategy, systemQty, finalQty, modification_reason, decisionStatus, decided_by]
    );
    return inserted[0].decision_id;
  });

  const { rows } = await pool.query(
    `SELECT d.*, r.product_id, p.sku, p.product_name
       FROM recommendation_decisions d
       JOIN replenishment_recommendations r ON r.recommendation_id = d.recommendation_id
       JOIN products p ON p.product_id = r.product_id
      WHERE d.decision_id = $1`,
    [decisionId]
  );
  res.status(201).json(rows[0]);
}

// POST /api/decisions/convert-to-po  { decision_ids: number[], created_by }
// confirmed 상태 판단들을 공급업체별로 묶어 공급업체당 발주서 1장(draft)을 만든다.
// 발주서는 draft이므로 재고·미입고 발주량에는 영향 없음 (발주 확정은 기존 /api/purchase-orders/:id/confirm으로).
async function convertToPo(req, res) {
  const { decision_ids, created_by } = req.body;

  requirePositiveInt(created_by, 'created_by');
  if (!Array.isArray(decision_ids) || decision_ids.length === 0
      || !decision_ids.every((v) => Number.isInteger(v) && v > 0)) {
    throw httpError(400, 'decision_ids는 1 이상의 정수로 된 배열이어야 합니다.');
  }
  if (new Set(decision_ids).size !== decision_ids.length) {
    throw httpError(400, 'decision_ids에 중복된 값이 있습니다.');
  }

  const poIds = await withTransaction(async (client) => {
    // decision_id 순서로 잠가 동시 전환 시 데드락·중복 전환을 막는다.
    const { rows: decisions } = await client.query(
      `SELECT d.*, r.product_id, p.sku, p.supplier_id
         FROM recommendation_decisions d
         JOIN replenishment_recommendations r ON r.recommendation_id = d.recommendation_id
         JOIN products p ON p.product_id = r.product_id
        WHERE d.decision_id = ANY($1::int[])
        ORDER BY d.decision_id
        FOR UPDATE OF d`,
      [decision_ids]
    );

    const found = new Set(decisions.map((d) => d.decision_id));
    const missing = decision_ids.filter((id) => !found.has(id));
    if (missing.length) throw httpError(404, `판단 이력을 찾을 수 없습니다. (decision_id=${missing.join(', ')})`);

    const problems = [];
    const seenProducts = new Map();
    for (const d of decisions) {
      if (d.decision_status !== 'confirmed') {
        problems.push(`decision_id=${d.decision_id}: confirmed 상태만 전환 가능 (현재: ${d.decision_status})`);
      } else if (d.final_qty <= 0) {
        problems.push(`decision_id=${d.decision_id}: 최종 수량이 0이라 발주할 수 없음`);
      } else if (d.supplier_id === null) {
        problems.push(`decision_id=${d.decision_id}: 상품 ${d.sku}의 공급업체가 지정되지 않음`);
      }
      if (seenProducts.has(d.product_id)) {
        problems.push(`decision_id=${d.decision_id}: 상품 ${d.sku}가 decision_id=${seenProducts.get(d.product_id)}와 중복`);
      }
      seenProducts.set(d.product_id, d.decision_id);
    }
    if (problems.length) throw httpError(409, '발주서로 전환할 수 없는 판단 이력이 있습니다.', problems);

    const bySupplier = new Map();
    for (const d of decisions) {
      if (!bySupplier.has(d.supplier_id)) bySupplier.set(d.supplier_id, []);
      bySupplier.get(d.supplier_id).push(d);
    }

    const created = [];
    for (const [supplierId, group] of bySupplier) {
      const { id, no } = await nextIdAndNo(client, 'purchase_orders', 'purchase_order_id', 'PO');
      await client.query(
        `INSERT INTO purchase_orders (purchase_order_id, po_no, supplier_id, order_date, created_by)
         VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
        [id, no, supplierId, created_by]
      );
      for (const d of group) {
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, product_id, ordered_qty, recommendation_decision_id)
           VALUES ($1, $2, $3, $4)`,
          [id, d.product_id, d.final_qty, d.decision_id]
        );
        await client.query(
          `UPDATE recommendation_decisions
              SET purchase_order_id = $2, decision_status = 'converted_to_po'
            WHERE decision_id = $1`,
          [d.decision_id, id]
        );
      }
      created.push(id);
    }
    return created;
  });

  const purchaseOrders = [];
  for (const id of poIds) purchaseOrders.push(await fetchPurchaseOrder(pool, id));
  res.status(201).json({ purchase_orders: purchaseOrders });
}

// 판단 이력 + 사후 평가 입력값 조회.
// 보호기간 = 추천 계산일부터 calculation_detail.protection_period_days일, 그 기간의 확정 판매량이 실제 수요.
// 평가 결과는 저장하지 않고 조회 시점에 계산한다 (테이블 구조 변경 없이, 판매 취소 등 최신 상태 반영).
async function loadDecisions(filters) {
  const conditions = ["d.decision_status <> 'rejected'"];
  const values = [];
  if (filters.product_id !== undefined) {
    values.push(filters.product_id);
    conditions.push(`r.product_id = $${values.length}`);
  }
  if (filters.exclude_recommendation_id !== undefined) {
    values.push(filters.exclude_recommendation_id);
    conditions.push(`d.recommendation_id <> $${values.length}`);
  }
  values.push(filters.limit);

  const { rows } = await pool.query(
    `SELECT d.decision_id, d.recommendation_id, d.selected_strategy, d.system_recommended_qty, d.final_qty,
            d.modification_reason, d.decision_status, d.purchase_order_id, d.decided_at,
            r.product_id, p.sku, p.product_name, p.unit, r.calculated_at, r.safety_stock_qty_snapshot,
            x.protection_days, x.inventory_position, x.start_date, x.end_date,
            (x.end_date < CURRENT_DATE) AS evaluable,
            GREATEST(x.end_date - CURRENT_DATE + 1, 0) AS days_until_evaluable,
            COALESCE(a.qty, 0)::int AS actual_demand
       FROM recommendation_decisions d
       JOIN replenishment_recommendations r ON r.recommendation_id = d.recommendation_id
       JOIN products p ON p.product_id = r.product_id
       CROSS JOIN LATERAL (
         SELECT (r.calculation_detail->>'protection_period_days')::int AS protection_days,
                (r.calculation_detail->>'inventory_position')::int AS inventory_position,
                r.calculated_at::date AS start_date,
                r.calculated_at::date + (r.calculation_detail->>'protection_period_days')::int - 1 AS end_date
       ) x
       LEFT JOIN LATERAL (
         SELECT SUM(si.quantity) AS qty
           FROM sales s
           JOIN sale_items si ON si.sale_id = s.sale_id
          WHERE s.status = 'confirmed' AND si.product_id = r.product_id
            AND s.sale_date BETWEEN x.start_date AND x.end_date
       ) a ON true
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.decision_id DESC
      LIMIT $${values.length}`,
    values
  );

  return rows.map((r) => {
    const { actual_demand: actualDemand, ...rest } = r;
    return {
      ...rest,
      evaluation: evaluateDecision({
        evaluable: r.evaluable,
        actualDemand,
        safetyStock: r.safety_stock_qty_snapshot,
        inventoryPosition: r.inventory_position,
        systemQty: r.system_recommended_qty,
        finalQty: r.final_qty,
      }),
    };
  });
}

function parseLimit(v, def) {
  return Math.min(Math.max(parseInt(v, 10) || def, 1), 1000);
}

// GET /api/decisions  (?product_id, ?exclude_recommendation_id, ?limit)
// 판단 이력(반려 제외)과 각 판단의 사후 평가. 추천 상세 화면의 '이전 판단' 표시에 사용한다.
async function list(req, res) {
  res.json(await loadDecisions({
    product_id: req.query.product_id,
    exclude_recommendation_id: req.query.exclude_recommendation_id,
    limit: parseLimit(req.query.limit, 100),
  }));
}

// GET /api/decisions/evaluation  (?product_id)
// 사후 평가 요약: 관리자가 추천과 다르게 판단한 경우 시스템 추천과 관리자 수정 중 어느 쪽이 실제 수요에 더 가까웠는가.
async function evaluation(req, res) {
  const items = await loadDecisions({ product_id: req.query.product_id, limit: 1000 });
  res.json({ summary: summarize(items), items });
}

module.exports = { create, convertToPo, list, evaluation };
