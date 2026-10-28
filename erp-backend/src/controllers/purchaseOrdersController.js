const pool = require('../db/pool');
const withTransaction = require('../db/transaction');
const httpError = require('../utils/httpError');
const { requirePositiveInt, requireNonEmptyArray } = require('../utils/validate');
const { nextIdAndNo } = require('../services/docNo');

async function fetchPurchaseOrder(db, poId) {
  const { rows } = await db.query(
    `SELECT o.*, s.supplier_name
       FROM purchase_orders o
       JOIN suppliers s ON s.supplier_id = o.supplier_id
      WHERE o.purchase_order_id = $1`,
    [poId]
  );
  if (rows.length === 0) return null;
  const { rows: items } = await db.query(
    `SELECT poi.*, (poi.ordered_qty - poi.received_qty) AS remaining_qty,
            p.sku, p.product_name, p.unit
       FROM purchase_order_items poi
       JOIN products p ON p.product_id = poi.product_id
      WHERE poi.purchase_order_id = $1
      ORDER BY poi.po_item_id`,
    [poId]
  );
  return { ...rows[0], items };
}

async function list(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.status !== undefined) {
    values.push(req.query.status);
    conditions.push(`o.status = $${values.length}`);
  }
  if (req.query.supplier_id !== undefined) {
    values.push(req.query.supplier_id);
    conditions.push(`o.supplier_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT o.*, s.supplier_name,
            COUNT(poi.po_item_id)::int AS item_count,
            COALESCE(SUM(poi.ordered_qty), 0)::int AS total_ordered_qty,
            COALESCE(SUM(poi.received_qty), 0)::int AS total_received_qty
       FROM purchase_orders o
       JOIN suppliers s ON s.supplier_id = o.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = o.purchase_order_id
       ${where}
      GROUP BY o.purchase_order_id, s.supplier_name
      ORDER BY o.purchase_order_id DESC`,
    values
  );
  res.json(rows);
}

async function getOne(req, res) {
  const po = await fetchPurchaseOrder(pool, req.params.id);
  if (!po) throw httpError(404, '발주서를 찾을 수 없습니다.');
  res.json(po);
}

// 발주서 생성 (status=draft)
async function create(req, res) {
  const { po_no, supplier_id, order_date, expected_receipt_date, created_by, items } = req.body;

  requirePositiveInt(supplier_id, 'supplier_id');
  requirePositiveInt(created_by, 'created_by');
  requireNonEmptyArray(items, 'items');
  items.forEach((it, i) => {
    requirePositiveInt(it.product_id, `items[${i}].product_id`);
    requirePositiveInt(it.ordered_qty, `items[${i}].ordered_qty`);
  });

  const poId = await withTransaction(async (client) => {
    // 상품에 지정된 공급업체와 발주처가 다르면 거부 (공급업체 미지정 상품은 허용)
    const productIds = [...new Set(items.map((it) => it.product_id))];
    const { rows: products } = await client.query(
      'SELECT product_id, sku, supplier_id FROM products WHERE product_id = ANY($1::int[])',
      [productIds]
    );
    const found = new Map(products.map((p) => [p.product_id, p]));
    for (const pid of productIds) {
      const p = found.get(pid);
      if (!p) throw httpError(404, `상품을 찾을 수 없습니다. (product_id=${pid})`);
      if (p.supplier_id !== null && p.supplier_id !== supplier_id) {
        throw httpError(400, `상품 ${p.sku}의 공급업체(supplier_id=${p.supplier_id})가 발주처와 다릅니다.`);
      }
    }

    const { id, no } = await nextIdAndNo(client, 'purchase_orders', 'purchase_order_id', 'PO');
    await client.query(
      `INSERT INTO purchase_orders
         (purchase_order_id, po_no, supplier_id, order_date, expected_receipt_date, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6)`,
      [id, po_no || no, supplier_id, order_date ?? null, expected_receipt_date ?? null, created_by]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO purchase_order_items
           (purchase_order_id, product_id, ordered_qty, unit_price, recommendation_decision_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, it.product_id, it.ordered_qty, it.unit_price ?? null, it.recommendation_decision_id ?? null]
      );
    }
    return id;
  });

  res.status(201).json(await fetchPurchaseOrder(pool, poId));
}

// 발주 확정: draft → confirmed.
// order_date는 "발주 확정일"이므로 확정 시점 날짜로 갱신하고,
// expected_receipt_date가 비어 있으면 품목들의 계획 납기(planned_lead_time_days) 최댓값으로 계산한다.
async function confirm(req, res) {
  const poId = req.params.id;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
      [poId]
    );
    if (rows.length === 0) throw httpError(404, '발주서를 찾을 수 없습니다.');
    if (rows[0].status !== 'draft') {
      throw httpError(409, `draft 상태의 발주서만 확정할 수 있습니다. (현재: ${rows[0].status})`);
    }

    const { rows: lt } = await client.query(
      `SELECT COUNT(*)::int AS item_count, MAX(p.planned_lead_time_days) AS max_lead_time
         FROM purchase_order_items poi
         JOIN products p ON p.product_id = poi.product_id
        WHERE poi.purchase_order_id = $1`,
      [poId]
    );
    if (lt[0].item_count === 0) throw httpError(409, '상세 항목이 없는 발주서는 확정할 수 없습니다.');

    await client.query(
      `UPDATE purchase_orders
          SET status = 'confirmed',
              confirmed_at = now(),
              order_date = CURRENT_DATE,
              expected_receipt_date = COALESCE(expected_receipt_date, CURRENT_DATE + $2::int)
        WHERE purchase_order_id = $1`,
      [poId, lt[0].max_lead_time]
    );
  });

  res.json(await fetchPurchaseOrder(pool, poId));
}

// 발주 취소: 아직 한 개도 입고되지 않은 draft/confirmed 발주서만 가능
async function cancel(req, res) {
  const poId = req.params.id;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
      [poId]
    );
    if (rows.length === 0) throw httpError(404, '발주서를 찾을 수 없습니다.');
    if (!['draft', 'confirmed'].includes(rows[0].status)) {
      throw httpError(409, `입고가 시작됐거나 종료된 발주서는 취소할 수 없습니다. (현재: ${rows[0].status})`);
    }
    await client.query(
      "UPDATE purchase_orders SET status = 'canceled' WHERE purchase_order_id = $1",
      [poId]
    );
  });

  res.json(await fetchPurchaseOrder(pool, poId));
}

// 작성중 발주서 삭제. 발주 추천에서 전환된 발주서라면 연결된 판단 이력을
// 다시 '판단 확정(confirmed)'으로 되돌려 재전환할 수 있게 한다.
async function remove(req, res) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT status FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (rows.length === 0) throw httpError(404, '발주서를 찾을 수 없습니다.');
    if (rows[0].status !== 'draft') {
      throw httpError(409, `작성중 발주서만 삭제할 수 있습니다. (현재: ${rows[0].status}) 확정된 발주서는 취소를 사용하세요.`);
    }
    await client.query(
      `UPDATE recommendation_decisions
          SET purchase_order_id = NULL, decision_status = 'confirmed'
        WHERE purchase_order_id = $1`,
      [req.params.id]
    );
    await client.query('DELETE FROM purchase_orders WHERE purchase_order_id = $1', [req.params.id]); // 품목은 CASCADE
  });
  res.status(204).send();
}

module.exports = { list, getOne, create, confirm, cancel, remove, fetchPurchaseOrder };
